import type {
  Assignee,
  DomainEvent,
  TaskDefinition,
  TaskInstance,
  TaskStatus,
} from './model';

const OFFER_CAPACITY = 4;
const BOSS_CAPACITY = 3;
const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set(['completed', 'failed', 'expired']);
const TASK_STATUSES: ReadonlySet<TaskStatus> = new Set([
  'offered',
  'employee-working',
  'boss-queued',
  'boss-working',
  'completed',
  'failed',
  'expired',
]);

export interface TaskSystemSnapshot {
  readonly tasks: readonly TaskInstance[];
  readonly sequence: number;
}

function freezeTask(task: TaskInstance): Readonly<TaskInstance> {
  return Object.freeze({ ...task });
}

function event(type: string, payload: Record<string, unknown>): DomainEvent {
  return Object.freeze({
    type,
    payload: Object.freeze({ ...payload }),
  });
}

function isTerminal(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export class TaskSystem {
  private readonly definitions: ReadonlyMap<string, TaskDefinition>;
  private tasks: TaskInstance[] = [];
  private sequence = 0;

  constructor(definitions: readonly TaskDefinition[]) {
    const byId = new Map<string, TaskDefinition>();
    for (const definition of definitions) {
      if (byId.has(definition.id)) {
        throw new Error(`duplicate task definition: ${definition.id}`);
      }
      byId.set(definition.id, definition);
    }
    this.definitions = byId;
  }

  offer(definitionId: string, nowMinute: number): Readonly<TaskInstance> {
    const definition = this.definitions.get(definitionId);
    if (!definition) throw new Error(`unknown task definition: ${definitionId}`);
    if (this.countStatus('offered') >= OFFER_CAPACITY) throw new Error('offer queue is full');

    this.sequence += 1;
    const task: TaskInstance = {
      instanceId: `${definitionId}-${this.sequence}`,
      definitionId,
      status: 'offered',
      offeredAtMinute: nowMinute,
      deadlineAtMinute: nowMinute + definition.deadlineMinutes,
    };
    this.tasks.push(task);
    return freezeTask(task);
  }

  assign(instanceId: string, assignee: Assignee, nowMinute: number): Readonly<TaskInstance> {
    const task = this.requireTask(instanceId);
    this.rejectTerminal(task);
    if (task.status !== 'offered') throw new Error('task is not offered');
    if (assignee !== 'employee' && assignee !== 'boss') throw new Error('unknown assignee');
    if (assignee === 'boss' && this.bossTaskCount() >= BOSS_CAPACITY) {
      throw new Error('boss queue is full');
    }

    task.status = assignee === 'employee' ? 'employee-working' : 'boss-queued';
    task.assignedAtMinute = nowMinute;
    return freezeTask(task);
  }

  startBoss(instanceId: string): Readonly<TaskInstance> {
    const task = this.requireTask(instanceId);
    this.rejectTerminal(task);
    if (task.status !== 'boss-queued') throw new Error('cannot start boss task');
    task.status = 'boss-working';
    return freezeTask(task);
  }

  reassignToEmployee(instanceId: string, nowMinute: number): Readonly<TaskInstance> {
    const task = this.requireTask(instanceId);
    this.rejectTerminal(task);
    if (task.status !== 'boss-working') throw new Error('task is not boss-working');
    task.status = 'employee-working';
    task.assignedAtMinute = nowMinute;
    return freezeTask(task);
  }

  complete(instanceId: string, success: boolean, nowMinute: number): DomainEvent {
    const task = this.requireTask(instanceId);
    this.rejectTerminal(task);
    if (task.status !== 'employee-working' && task.status !== 'boss-working') {
      throw new Error('task is not working');
    }

    task.status = success ? 'completed' : 'failed';
    return event(success ? 'task-completed' : 'task-failed', {
      instanceId: task.instanceId,
      definitionId: task.definitionId,
      completedAtMinute: nowMinute,
    });
  }

  expire(nowMinute: number): readonly DomainEvent[] {
    const events: DomainEvent[] = [];
    for (const task of this.tasks) {
      if (!isTerminal(task.status) && task.deadlineAtMinute <= nowMinute) {
        task.status = 'expired';
        events.push(event('task-expired', {
          instanceId: task.instanceId,
          definitionId: task.definitionId,
        }));
      }
    }
    return Object.freeze(events);
  }

  snapshot(): Readonly<TaskSystemSnapshot> {
    const tasks = Object.freeze(this.tasks.map((task) => freezeTask(task)));
    return Object.freeze({ tasks, sequence: this.sequence });
  }

  restore(snapshot: TaskSystemSnapshot): void {
    if (!snapshot || !Array.isArray(snapshot.tasks)) throw new Error('invalid task snapshot');
    if (!Number.isInteger(snapshot.sequence) || snapshot.sequence < 0) {
      throw new Error('invalid task sequence');
    }

    const ids = new Set<string>();
    let highestSuffix = 0;
    let offeredCount = 0;
    let bossCount = 0;
    const restored = snapshot.tasks.map((source) => {
      if (!source || typeof source !== 'object') throw new Error('invalid task instance');
      if (!this.definitions.has(source.definitionId)) {
        throw new Error(`unknown task definition: ${source.definitionId}`);
      }
      if (!TASK_STATUSES.has(source.status)) throw new Error(`invalid task status: ${source.status}`);
      if (ids.has(source.instanceId)) throw new Error(`duplicate task instance: ${source.instanceId}`);
      ids.add(source.instanceId);

      const prefix = `${source.definitionId}-`;
      const suffixText = source.instanceId.startsWith(prefix)
        ? source.instanceId.slice(prefix.length)
        : '';
      const suffix = Number(suffixText);
      if (!/^[1-9]\d*$/.test(suffixText) || !Number.isSafeInteger(suffix)) {
        throw new Error(`invalid task instance id: ${source.instanceId}`);
      }
      highestSuffix = Math.max(highestSuffix, suffix);

      if (!Number.isFinite(source.offeredAtMinute) || !Number.isFinite(source.deadlineAtMinute)) {
        throw new Error(`invalid task timing: ${source.instanceId}`);
      }
      if (source.assignedAtMinute !== undefined && !Number.isFinite(source.assignedAtMinute)) {
        throw new Error(`invalid task assignment time: ${source.instanceId}`);
      }
      if (source.status === 'offered') offeredCount += 1;
      if (source.status === 'boss-queued' || source.status === 'boss-working') bossCount += 1;
      return { ...source };
    });

    if (snapshot.sequence < highestSuffix) throw new Error('task sequence trails instance IDs');
    if (offeredCount > OFFER_CAPACITY) throw new Error('offer queue is full');
    if (bossCount > BOSS_CAPACITY) throw new Error('boss queue is full');

    this.tasks = restored;
    this.sequence = snapshot.sequence;
  }

  private countStatus(status: TaskStatus): number {
    let count = 0;
    for (const task of this.tasks) if (task.status === status) count += 1;
    return count;
  }

  private bossTaskCount(): number {
    let count = 0;
    for (const task of this.tasks) {
      if (task.status === 'boss-queued' || task.status === 'boss-working') count += 1;
    }
    return count;
  }

  private requireTask(instanceId: string): TaskInstance {
    const task = this.tasks.find((candidate) => candidate.instanceId === instanceId);
    if (!task) throw new Error(`unknown task instance: ${instanceId}`);
    return task;
  }

  private rejectTerminal(task: TaskInstance): void {
    if (isTerminal(task.status)) throw new Error('terminal task');
  }
}
