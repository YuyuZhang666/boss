import { describe, expect, it } from 'vitest';
import type { TaskDefinition, TaskInstance } from '../../assets/scripts/domain/model';
import { TaskSystem } from '../../assets/scripts/domain/TaskSystem';
import { TASK_DEFINITIONS } from '../../assets/scripts/domain/content/tasks';

function createSystem(): TaskSystem {
  return new TaskSystem(TASK_DEFINITIONS);
}

describe('TaskSystem', () => {
  it('offers stable sequential instances and caps the decision queue at four', () => {
    const tasks = createSystem();
    const first = tasks.offer(TASK_DEFINITIONS[0].id, 540);

    expect(first).toEqual({
      instanceId: 'dev-payment-error-1',
      definitionId: 'dev-payment-error',
      status: 'offered',
      offeredAtMinute: 540,
      deadlineAtMinute: 585,
    });
    TASK_DEFINITIONS.slice(1, 4).forEach((definition, index) => {
      tasks.offer(definition.id, 541 + index);
    });
    expect(() => tasks.offer(TASK_DEFINITIONS[4].id, 550)).toThrow('offer queue is full');
    expect(() => tasks.offer('missing-task', 550)).toThrow('unknown task definition');
  });

  it('supports employee work, boss queue/work, reassignment, and completion outcomes', () => {
    const tasks = createSystem();
    const employeeId = tasks.offer('dev-payment-error', 540).instanceId;
    const bossId = tasks.offer('sales-complaint', 541).instanceId;

    expect(tasks.assign(employeeId, 'employee', 545).status).toBe('employee-working');
    expect(tasks.complete(employeeId, true, 550)).toMatchObject({
      type: 'task-completed',
      payload: { instanceId: employeeId, completedAtMinute: 550 },
    });

    expect(tasks.assign(bossId, 'boss', 545).status).toBe('boss-queued');
    expect(tasks.startBoss(bossId).status).toBe('boss-working');
    expect(tasks.reassignToEmployee(bossId, 548)).toMatchObject({
      status: 'employee-working',
      assignedAtMinute: 548,
    });
    expect(tasks.complete(bossId, false, 551)).toMatchObject({
      type: 'task-failed',
      payload: { instanceId: bossId, completedAtMinute: 551 },
    });
  });

  it('caps queued plus working boss tasks at three without consuming a rejected assignment', () => {
    const tasks = createSystem();
    const ids = TASK_DEFINITIONS.slice(0, 4).map((definition, index) => (
      tasks.offer(definition.id, 540 + index).instanceId
    ));

    ids.slice(0, 3).forEach((id) => tasks.assign(id, 'boss', 545));
    tasks.startBoss(ids[0]);
    expect(() => tasks.assign(ids[3], 'boss', 545)).toThrow('boss queue is full');
    expect(tasks.snapshot().tasks.find((task) => task.instanceId === ids[3])?.status).toBe('offered');
  });

  it('rejects invalid and terminal transitions', () => {
    const tasks = createSystem();
    const id = tasks.offer('admin-coffee', 540).instanceId;

    expect(() => tasks.startBoss(id)).toThrow('cannot start boss task');
    expect(() => tasks.complete(id, true, 541)).toThrow('task is not working');
    expect(() => tasks.assign('missing-instance', 'employee', 541)).toThrow('unknown task instance');
    tasks.assign(id, 'employee', 541);
    expect(() => tasks.assign(id, 'boss', 542)).toThrow('task is not offered');
    tasks.complete(id, true, 543);
    expect(() => tasks.complete(id, true, 544)).toThrow('terminal task');
    expect(() => tasks.reassignToEmployee(id, 544)).toThrow('terminal task');
  });

  it('expires every reached non-terminal deadline once and leaves later work alone', () => {
    const tasks = createSystem();
    const early = tasks.offer('dev-online-crash', 540).instanceId;
    const exact = tasks.offer('sales-complaint', 540).instanceId;
    const later = tasks.offer('admin-coffee', 540).instanceId;
    const completed = tasks.offer('dev-payment-error', 540).instanceId;
    tasks.assign(early, 'employee', 541);
    tasks.assign(exact, 'boss', 541);
    tasks.assign(completed, 'employee', 541);
    tasks.complete(completed, true, 550);

    expect(tasks.expire(585)).toEqual([
      { type: 'task-expired', payload: { instanceId: early, definitionId: 'dev-online-crash' } },
      { type: 'task-expired', payload: { instanceId: exact, definitionId: 'sales-complaint' } },
    ]);
    expect(tasks.expire(1080)).toEqual([
      { type: 'task-expired', payload: { instanceId: later, definitionId: 'admin-coffee' } },
    ]);
    expect(tasks.expire(1080)).toEqual([]);
  });

  it('returns detached frozen snapshots', () => {
    const tasks = createSystem();
    const id = tasks.offer('admin-coffee', 540).instanceId;
    const snapshot = tasks.snapshot();

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.tasks)).toBe(true);
    expect(Object.isFrozen(snapshot.tasks[0])).toBe(true);
    expect(tasks.snapshot()).not.toBe(snapshot);
    expect(tasks.snapshot().tasks).not.toBe(snapshot.tasks);
    expect(() => {
      (snapshot.tasks[0] as TaskInstance).status = 'failed';
    }).toThrow();
    expect(tasks.snapshot().tasks[0]).toMatchObject({ instanceId: id, status: 'offered' });
  });

  it('round-trips state and resumes the stable instance sequence', () => {
    const original = createSystem();
    const first = original.offer('dev-payment-error', 540);
    original.assign(first.instanceId, 'employee', 541);
    const saved = original.snapshot();
    const restored = createSystem();

    restored.restore(saved);
    expect(restored.snapshot()).toEqual(saved);
    expect(restored.offer('sales-complaint', 550).instanceId).toBe('sales-complaint-2');
  });

  it('rejects corrupt restores atomically', () => {
    const tasks = createSystem();
    tasks.offer('admin-coffee', 540);
    const before = tasks.snapshot();
    const invalidCases = [
      { tasks: [{ ...before.tasks[0], definitionId: 'missing' }], sequence: 1 },
      { tasks: [{ ...before.tasks[0], status: 'mystery' }], sequence: 1 },
      { tasks: [before.tasks[0], { ...before.tasks[0] }], sequence: 1 },
      { tasks: before.tasks, sequence: 0 },
    ];

    for (const value of invalidCases) {
      expect(() => tasks.restore(value as never)).toThrow();
      expect(tasks.snapshot()).toEqual(before);
    }
  });

  it('rejects unsafe restore sequences atomically', () => {
    const tasks = createSystem();
    tasks.offer('admin-coffee', 540);
    const before = tasks.snapshot();

    expect(() => tasks.restore({
      tasks: before.tasks,
      sequence: Number.MAX_SAFE_INTEGER + 1,
    })).toThrow('invalid task sequence');
    expect(tasks.snapshot()).toEqual(before);
  });

  it('rejects offers before the instance sequence would become unsafe', () => {
    const tasks = createSystem();
    tasks.restore({ tasks: [], sequence: Number.MAX_SAFE_INTEGER - 1 });

    expect(tasks.offer('admin-coffee', 540).instanceId).toBe(
      `admin-coffee-${Number.MAX_SAFE_INTEGER}`,
    );
    const beforeRejectedOffer = tasks.snapshot();
    expect(() => tasks.offer('dev-button-color', 541)).toThrow('task sequence is exhausted');
    expect(tasks.snapshot()).toEqual(beforeRejectedOffer);
  });

  it('detaches constructor definitions from retained caller references', () => {
    const definitions: TaskDefinition[] = [{ ...TASK_DEFINITIONS[0] }];
    const tasks = new TaskSystem(definitions);

    definitions[0].deadlineMinutes = 999;
    definitions[0].title = '调用方篡改后的标题';

    expect(tasks.offer(definitions[0].id, 540)).toMatchObject({
      definitionId: 'dev-payment-error',
      deadlineAtMinute: 585,
    });
  });
});
