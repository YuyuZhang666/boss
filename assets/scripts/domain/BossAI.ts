import { RULE_DEFINITIONS } from './content/rules';
import type {
  AvoidanceType,
  BossState,
  DomainEvent,
  GameSnapshot,
  RandomSource,
  RuleId,
  TaskDefinition,
} from './model';

const DEFAULT_WARNING_MS = 1_500;
const MIN_WARNING_MS = 1_200;
const MAX_WARNING_MS = 1_800;
const WORKLOAD_DURATION_MS = 2_500;
const MEETING_DELAY_MS = 3_000;
const STRATEGIC_UPGRADE_DELAY_MS = 4_000;

const BOSS_STATES: ReadonlySet<BossState> = new Set(['idle', 'working', 'warning']);
const AVOIDANCE_TYPES: ReadonlySet<AvoidanceType> = new Set([
  'meeting',
  'dump',
  'outsource',
  'change-request',
  'strategic-upgrade',
]);
const DEPARTMENTS: ReadonlySet<TaskDefinition['department']> = new Set([
  'dev',
  'product',
  'ops',
  'sales',
  'hr',
  'finance',
  'admin',
]);
const ALL_AVOIDANCES = Object.freeze([
  'meeting',
  'dump',
  'outsource',
  'change-request',
  'strategic-upgrade',
] as const);
const LOW_FIT_AVOIDANCES = Object.freeze(['dump', 'outsource'] as const);
const SPECIALIST_AVOIDANCES = Object.freeze(['meeting', 'outsource'] as const);
const PRODUCT_AVOIDANCES = Object.freeze(['change-request', 'strategic-upgrade'] as const);
const EMPTY_EVENTS = Object.freeze([]) as unknown as DomainEvent[];

export interface BossContext {
  readonly face: number;
  readonly queueLength: number;
  readonly minuteOfDay: number;
  readonly difficulty: 1 | 2 | 3;
}

export type BossSnapshot = Readonly<GameSnapshot['boss']>;

function event(type: string, payload: Record<string, unknown>): DomainEvent {
  return Object.freeze({
    type,
    payload: Object.freeze({ ...payload }),
  });
}

function freezeEvents(events: DomainEvent[]): DomainEvent[] {
  return Object.freeze(events) as unknown as DomainEvent[];
}

function isPrimitiveNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRating(value: unknown): value is 1 | 2 | 3 | 4 | 5 {
  return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= 5;
}

function validateTask(task: TaskDefinition): void {
  if (typeof task !== 'object' || task === null) throw new Error('invalid task');
  if (
    !isPrimitiveNonEmptyString(task.id)
    || typeof task.department !== 'string'
    || !DEPARTMENTS.has(task.department)
    || !isPrimitiveNonEmptyString(task.title)
    || !isPrimitiveNonEmptyString(task.description)
    || !isRating(task.workload)
    || !isRating(task.expertise)
    || !isRating(task.urgency)
    || !isRating(task.bossFit)
    || !isFiniteNumber(task.deadlineMinutes)
    || task.deadlineMinutes <= 0
    || !isFiniteNumber(task.employeeSuccess)
    || task.employeeSuccess < 0
    || task.employeeSuccess > 1
    || !isFiniteNumber(task.bossSuccess)
    || task.bossSuccess < 0
    || task.bossSuccess > 1
  ) {
    throw new Error('invalid task');
  }
}

function validateContext(context: BossContext): void {
  if (typeof context !== 'object' || context === null) throw new Error('invalid boss context');
  if (
    !isFiniteNumber(context.face)
    || context.face < 0
    || context.face > 100
    || !Number.isSafeInteger(context.queueLength)
    || context.queueLength < 0
    || !Number.isSafeInteger(context.minuteOfDay)
    || context.minuteOfDay < 0
    || context.minuteOfDay > 24 * 60
    || ![1, 2, 3].includes(context.difficulty)
  ) {
    throw new Error('invalid boss context');
  }
}

function validateUnitRandom(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value >= 1) {
    throw new Error('random source returned a value outside [0, 1)');
  }
  return value;
}

function validateRandomIndex(value: number, length: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value >= length) {
    throw new Error('random source returned an invalid integer');
  }
  return value;
}

function avoidanceCandidates(task: TaskDefinition): readonly AvoidanceType[] {
  // These checks intentionally follow the approved priority order. In particular,
  // low boss fit wins over expertise, and expertise wins over product department.
  if (task.bossFit <= 2) return LOW_FIT_AVOIDANCES;
  if (task.expertise >= 4) return SPECIALIST_AVOIDANCES;
  if (task.department === 'product') return PRODUCT_AVOIDANCES;
  return ALL_AVOIDANCES;
}

function avoidanceIsLegitimate(task: TaskDefinition, avoidance: AvoidanceType): boolean {
  if (avoidance === 'meeting') {
    return task.bossFit >= 4
      && task.workload >= 3
      && (task.department === 'product' || task.department === 'sales' || task.department === 'hr');
  }
  if (avoidance === 'outsource') {
    return task.urgency >= 4 && task.expertise >= 4 && task.bossSuccess < 0.5;
  }
  return false;
}

function avoidanceChance(context: BossContext): number {
  let chance = 0.16 + context.difficulty * 0.05 + context.queueLength * 0.04;
  if (context.face > 80) chance += 0.12;
  if (context.face < 20) chance += 0.08;
  return Math.min(0.65, Math.max(0.05, chance));
}

function invalidSnapshot(): never {
  throw new Error('invalid boss snapshot');
}

export class BossAI {
  private currentState: BossState = 'idle';
  private currentTaskInstanceId: string | undefined;
  private currentAvoidance: AvoidanceType | undefined;
  private currentAvoidanceLegitimate: boolean | undefined;
  private currentRemainingWorkMs = 0;
  private currentWarningRemainingMs = 0;

  constructor(private readonly random: RandomSource) {
    if (typeof random !== 'object' || random === null) {
      throw new Error('invalid random source');
    }
  }

  accept(
    instanceId: string,
    task: TaskDefinition,
    nowMs: number,
    context: BossContext,
  ): DomainEvent[] {
    if (this.currentState !== 'idle') throw new Error('BossAI can only accept while idle');
    if (!isPrimitiveNonEmptyString(instanceId)) throw new Error('invalid task instance ID');
    validateTask(task);
    if (!isFiniteNumber(nowMs) || nowMs < 0) throw new Error('invalid current time');
    validateContext(context);

    const chanceRoll = validateUnitRandom(this.random.next());
    let selectedAvoidance: AvoidanceType | undefined;
    let selectedLegitimate: boolean | undefined;
    if (chanceRoll < avoidanceChance(context)) {
      const candidates = avoidanceCandidates(task);
      const index = validateRandomIndex(this.random.int(0, candidates.length), candidates.length);
      selectedAvoidance = candidates[index];
      selectedLegitimate = avoidanceIsLegitimate(task, selectedAvoidance);
    }

    const events: DomainEvent[] = [];
    this.currentTaskInstanceId = instanceId;
    this.currentRemainingWorkMs = task.workload * WORKLOAD_DURATION_MS;
    this.transitionTo('working', events);

    if (selectedAvoidance !== undefined) {
      this.currentAvoidance = selectedAvoidance;
      this.currentAvoidanceLegitimate = selectedLegitimate!;
      this.currentWarningRemainingMs = Math.min(
        MAX_WARNING_MS,
        Math.max(MIN_WARNING_MS, DEFAULT_WARNING_MS),
      );
      this.transitionTo('warning', events);
      events.push(event('avoidance-warning', {
        taskInstanceId: instanceId,
        avoidance: selectedAvoidance,
        legitimate: selectedLegitimate,
      }));
    }

    return freezeEvents(events);
  }

  tick(deltaMs: number): DomainEvent[] {
    if (!isFiniteNumber(deltaMs)) throw new Error('deltaMs must be finite');
    if (deltaMs <= 0) return EMPTY_EVENTS;

    let remainingDeltaMs = deltaMs;
    const events: DomainEvent[] = [];
    while (remainingDeltaMs > 0) {
      if (this.currentState === 'idle') break;
      if (this.currentState === 'warning') {
        if (remainingDeltaMs < this.currentWarningRemainingMs) {
          this.currentWarningRemainingMs -= remainingDeltaMs;
          remainingDeltaMs = 0;
          continue;
        }

        remainingDeltaMs -= this.currentWarningRemainingMs;
        this.currentWarningRemainingMs = 0;
        const taskInstanceId = this.currentTaskInstanceId!;
        const avoidance = this.currentAvoidance!;
        const legitimate = this.currentAvoidanceLegitimate!;
        events.push(event('avoidance-succeeded', {
          taskInstanceId,
          avoidance,
          legitimate,
        }));

        if (avoidance === 'meeting' || avoidance === 'strategic-upgrade') {
          this.currentRemainingWorkMs += avoidance === 'meeting'
            ? MEETING_DELAY_MS
            : STRATEGIC_UPGRADE_DELAY_MS;
          this.clearWarning();
          this.transitionTo('working', events);
        } else {
          this.transitionTo('idle', events);
        }
        continue;
      }

      if (remainingDeltaMs < this.currentRemainingWorkMs) {
        this.currentRemainingWorkMs -= remainingDeltaMs;
        remainingDeltaMs = 0;
        continue;
      }

      remainingDeltaMs -= this.currentRemainingWorkMs;
      this.currentRemainingWorkMs = 0;
      events.push(event('boss-task-completed', {
        taskInstanceId: this.currentTaskInstanceId!,
      }));
      this.transitionTo('idle', events);
    }

    return events.length === 0 ? EMPTY_EVENTS : freezeEvents(events);
  }

  counter(ruleId: RuleId): DomainEvent[] {
    if (this.currentState !== 'warning') return EMPTY_EVENTS;
    if (
      typeof ruleId !== 'string'
      || !Object.prototype.hasOwnProperty.call(RULE_DEFINITIONS, ruleId)
      || !RULE_DEFINITIONS[ruleId].counters.includes(this.currentAvoidance!)
    ) {
      return EMPTY_EVENTS;
    }

    const events = [event('avoidance-countered', {
      taskInstanceId: this.currentTaskInstanceId!,
      avoidance: this.currentAvoidance!,
      legitimate: this.currentAvoidanceLegitimate!,
      ruleId,
    })];
    this.currentRemainingWorkMs = Math.ceil(this.currentRemainingWorkMs * 0.8);
    this.currentWarningRemainingMs = 0;
    this.clearWarning();
    this.transitionTo('working', events);
    return freezeEvents(events);
  }

  snapshot(): BossSnapshot {
    const snapshot: GameSnapshot['boss'] = {
      state: this.currentState,
      remainingWorkMs: this.currentRemainingWorkMs,
      warningRemainingMs: this.currentWarningRemainingMs,
    };
    if (this.currentTaskInstanceId !== undefined) {
      snapshot.taskInstanceId = this.currentTaskInstanceId;
    }
    if (this.currentAvoidance !== undefined) {
      snapshot.avoidance = this.currentAvoidance;
      snapshot.avoidanceLegitimate = this.currentAvoidanceLegitimate;
    }
    return Object.freeze(snapshot);
  }

  restore(snapshot: BossSnapshot): void {
    if (typeof snapshot !== 'object' || snapshot === null) invalidSnapshot();

    const state = snapshot.state;
    const taskInstanceId = snapshot.taskInstanceId;
    const avoidance = snapshot.avoidance;
    const avoidanceLegitimate = snapshot.avoidanceLegitimate;
    const remainingWorkMs = snapshot.remainingWorkMs;
    const warningRemainingMs = snapshot.warningRemainingMs;

    if (typeof state !== 'string' || !BOSS_STATES.has(state)) invalidSnapshot();
    if (!isFiniteNumber(remainingWorkMs) || remainingWorkMs < 0) invalidSnapshot();
    if (!isFiniteNumber(warningRemainingMs) || warningRemainingMs < 0) invalidSnapshot();

    if (state === 'idle') {
      if (
        taskInstanceId !== undefined
        || avoidance !== undefined
        || avoidanceLegitimate !== undefined
        || remainingWorkMs !== 0
        || warningRemainingMs !== 0
      ) invalidSnapshot();
    } else if (state === 'working') {
      if (
        !isPrimitiveNonEmptyString(taskInstanceId)
        || avoidance !== undefined
        || avoidanceLegitimate !== undefined
        || remainingWorkMs <= 0
        || warningRemainingMs !== 0
      ) invalidSnapshot();
    } else if (
      !isPrimitiveNonEmptyString(taskInstanceId)
      || typeof avoidance !== 'string'
      || !AVOIDANCE_TYPES.has(avoidance)
      || typeof avoidanceLegitimate !== 'boolean'
      || remainingWorkMs <= 0
      || warningRemainingMs <= 0
      || warningRemainingMs > MAX_WARNING_MS
    ) {
      invalidSnapshot();
    }

    this.currentState = state;
    this.currentTaskInstanceId = taskInstanceId;
    this.currentAvoidance = avoidance;
    this.currentAvoidanceLegitimate = avoidanceLegitimate;
    this.currentRemainingWorkMs = remainingWorkMs;
    this.currentWarningRemainingMs = warningRemainingMs;
  }

  private clearWarning(): void {
    this.currentAvoidance = undefined;
    this.currentAvoidanceLegitimate = undefined;
  }

  private transitionTo(next: BossState, events: DomainEvent[]): void {
    const previous = this.currentState;
    const taskInstanceId = this.currentTaskInstanceId;
    this.currentState = next;
    events.push(event('boss-state-changed', {
      from: previous,
      to: next,
      ...(taskInstanceId === undefined ? {} : { taskInstanceId }),
    }));
    if (next === 'idle') {
      this.currentTaskInstanceId = undefined;
      this.currentAvoidance = undefined;
      this.currentAvoidanceLegitimate = undefined;
      this.currentRemainingWorkMs = 0;
      this.currentWarningRemainingMs = 0;
    }
  }
}
