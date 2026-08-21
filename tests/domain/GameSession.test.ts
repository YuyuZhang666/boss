import { describe, expect, it } from 'vitest';
import { GameSession } from '../../assets/scripts/domain/GameSession';
import { TASK_DEFINITIONS } from '../../assets/scripts/domain/content/tasks';
import type { AvoidanceType, GameSnapshot, RuleId } from '../../assets/scripts/domain/model';

const MATCHING_RULE: Readonly<Record<AvoidanceType, RuleId>> = Object.freeze({
  meeting: 'cost-time-audit',
  dump: 'responsibility-chain',
  outsource: 'cost-time-audit',
  'change-request': 'original-request',
  'strategic-upgrade': 'original-request',
});

function cloneSnapshot(snapshot: Readonly<GameSnapshot>): GameSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as GameSnapshot;
}

function findWarning(dayId: 'day-1' | 'day-3', wanted?: AvoidanceType): GameSession {
  for (let seed = 1; seed <= 2_000; seed += 1) {
    const game = GameSession.create(dayId, seed);
    game.dispatch({ type: 'skip-intro' });
    game.tick(100);
    const offered = game.snapshot().tasks.find((task) => task.status === 'offered')!;
    game.dispatch({ type: 'assign-task', instanceId: offered.instanceId, assignee: 'boss' });
    const boss = game.snapshot().boss;
    if (boss.state === 'warning' && (wanted === undefined || boss.avoidance === wanted)) {
      return game;
    }
  }
  throw new Error('unable to find a seeded warning');
}

describe('GameSession orchestration', () => {
  it('is deterministic for one seed and command stream', () => {
    const a = GameSession.create('day-1', 20260820);
    const b = GameSession.create('day-1', 20260820);
    a.dispatch({ type: 'skip-intro' });
    b.dispatch({ type: 'skip-intro' });
    for (let index = 0; index < 40; index += 1) {
      expect(a.tick(500)).toEqual(b.tick(500));
    }
    expect(a.snapshot()).toEqual(b.snapshot());
  });

  it('freezes the complete simulation while paused', () => {
    const game = GameSession.create('day-1', 7);
    game.dispatch({ type: 'skip-intro' });
    game.tick(10_000);
    game.dispatch({ type: 'pause' });
    const before = game.snapshot();
    expect(game.tick(60_000)).toEqual([]);
    expect(game.snapshot()).toEqual(before);
  });

  it('round-trips every in-progress subsystem state and random stream', () => {
    const original = GameSession.create('day-2', 88);
    original.dispatch({ type: 'skip-intro' });
    for (let elapsed = 0; elapsed < 65_000; elapsed += 100) {
      const offered = original.snapshot().tasks.filter((task) => task.status === 'offered');
      for (const task of offered) {
        original.dispatch({ type: 'assign-task', instanceId: task.instanceId, assignee: 'employee' });
      }
      original.tick(100);
    }

    const saved = original.snapshot();
    const restored = GameSession.create('day-2', 88);
    restored.restore(saved);
    expect(restored.snapshot()).toEqual(saved);
    for (let index = 0; index < 100; index += 1) {
      expect(restored.tick(100)).toEqual(original.tick(100));
    }
    expect(restored.snapshot()).toEqual(original.snapshot());
  });

  it('enforces exact phase commands and freezes intro, pause, and tutorial time', () => {
    const game = GameSession.create('day-1', 9);
    const intro = game.snapshot();
    expect(game.tick(1_000)).toEqual([]);
    expect(game.snapshot()).toEqual(intro);
    expect(game.dispatch({ type: 'skip-intro' }).map((item) => item.type)).toEqual(['phase-changed']);
    expect(() => game.dispatch({ type: 'skip-intro' })).toThrow('intro');

    game.tick(500);
    expect(game.dispatch({ type: 'pause' })[0].payload).toEqual({ from: 'playing', to: 'paused' });
    const paused = game.snapshot();
    expect(game.tick(10_000)).toEqual([]);
    expect(game.snapshot()).toEqual(paused);
    expect(game.dispatch({ type: 'resume' })[0].payload).toEqual({ from: 'paused', to: 'playing' });

    const tutorial = findWarning('day-1', 'dump');
    expect(tutorial.snapshot().phase).toBe('tutorial-paused');
    const before = tutorial.snapshot();
    expect(tutorial.tick(5_000)).toEqual([]);
    expect(tutorial.snapshot()).toEqual(before);
    tutorial.dispatch({ type: 'finish-tutorial' });
    expect(tutorial.snapshot().phase).toBe('playing');
  });

  it('publishes one canonical counter event and keeps mismatched rules active', () => {
    const matched = findWarning('day-3');
    const warning = matched.snapshot().boss;
    const beforeCountered = matched.snapshot().stats.counteredAvoidances;
    const counterEvents = matched.dispatch({
      type: 'use-rule',
      ruleId: MATCHING_RULE[warning.avoidance!],
    });
    expect(counterEvents.filter((item) => item.type === 'avoidance-countered')).toHaveLength(1);
    expect(matched.snapshot().boss.state).toBe('working');
    expect(matched.snapshot().stats.counteredAvoidances).toBe(
      beforeCountered + (warning.avoidanceLegitimate ? 0 : 1),
    );

    const missed = findWarning('day-3');
    const missedWarning = missed.snapshot().boss.avoidance!;
    const wrongRule: RuleId = missedWarning === 'dump'
      ? 'original-request'
      : 'responsibility-chain';
    const beforeTrust = missed.snapshot().meters.trust;
    const missedEvents = missed.dispatch({ type: 'use-rule', ruleId: wrongRule });
    expect(missedEvents.filter((item) => item.type === 'rule-missed')).toHaveLength(1);
    expect(missed.snapshot().boss.state).toBe('warning');
    expect(missed.snapshot().meters.trust).toBe(beforeTrust - 2);
  });

  it('holds a VIP request behind a full queue and starts its deadline at actual offer time', () => {
    const game = GameSession.create('day-2', 22);
    game.dispatch({ type: 'skip-intro' });
    const snapshot = cloneSnapshot(game.snapshot());
    snapshot.elapsedRealMs = 54_000;
    snapshot.nextTaskSpawnMs = 60_000;
    snapshot.rngState = 2_688;
    snapshot.tasks = Object.freeze(Array.from({ length: 4 }, (_, index) => ({
      instanceId: `admin-coffee-${index + 1}`,
      definitionId: 'admin-coffee',
      status: 'offered' as const,
      offeredAtMinute: 684,
      deadlineAtMinute: 864,
    })));
    snapshot.taskSequence = 4;
    game.restore(snapshot);

    game.tick(1_000);
    const waiting = game.snapshot();
    expect(waiting.usedEventIds).toEqual(['vip-visit']);
    expect(waiting.pendingVipDefinitionId).toBe('sales-complaint');
    const first = waiting.tasks.find((task) => task.status === 'offered')!;
    game.dispatch({ type: 'assign-task', instanceId: first.instanceId, assignee: 'employee' });
    const offeredVip = game.snapshot().tasks.find((task) => task.instanceId === 'sales-complaint-5');
    expect(offeredVip).toMatchObject({
      status: 'offered',
      offeredAtMinute: 705,
      deadlineAtMinute: 750,
    });
    expect(game.snapshot()).not.toHaveProperty('pendingVipDefinitionId');
  });

  it('strictly rejects hostile or dangling restores without changing the session', () => {
    const game = GameSession.create('day-2', 41);
    game.dispatch({ type: 'skip-intro' });
    game.tick(100);
    const offered = game.snapshot().tasks.find((task) => task.status === 'offered')!;
    game.dispatch({ type: 'assign-task', instanceId: offered.instanceId, assignee: 'employee' });
    const saved = game.snapshot();

    const dangling = cloneSnapshot(saved);
    dangling.workerJobs = Object.freeze([{ instanceId: 'missing-1', remainingMs: 100 }]);
    expect(() => game.restore(dangling)).toThrow('game snapshot');
    expect(game.snapshot()).toEqual(saved);

    let reads = 0;
    const hostile = { ...saved } as Record<string, unknown>;
    Object.defineProperty(hostile, 'rngState', {
      enumerable: true,
      get() {
        reads += 1;
        return saved.rngState;
      },
    });
    expect(() => game.restore(hostile as never)).toThrow('game snapshot');
    expect(reads).toBe(0);
    expect(game.snapshot()).toEqual(saved);
  });

  it('settles immediately without drawing a crossed event after company reaches zero', () => {
    const game = GameSession.create('day-2', 55);
    game.dispatch({ type: 'skip-intro' });
    const snapshot = cloneSnapshot(game.snapshot());
    snapshot.elapsedRealMs = 54_900;
    snapshot.nextTaskSpawnMs = 60_000;
    snapshot.rngState = 15_872;
    snapshot.meters = { company: 1, rectification: 0, face: 65, trust: 50 };
    snapshot.tasks = Object.freeze([{
      instanceId: 'admin-coffee-1',
      definitionId: 'admin-coffee',
      status: 'employee-working',
      offeredAtMinute: 684,
      deadlineAtMinute: 864,
      assignedAtMinute: 684,
    }]);
    snapshot.taskSequence = 1;
    snapshot.workerJobs = Object.freeze([{ instanceId: 'admin-coffee-1', remainingMs: 100 }]);
    game.restore(snapshot);

    const events = game.tick(100);
    expect(events.some((item) => item.type === 'task-failed')).toBe(true);
    const result = game.snapshot();
    expect(result.phase).toBe('result');
    expect(result.meters.company).toBe(0);
    expect(result.nextEventTriggerIndex).toBe(1);
    expect(result.usedEventIds).toEqual([]);
    const restored = GameSession.create('day-2', 55);
    expect(() => restored.restore(result)).not.toThrow();
    expect(restored.snapshot()).toEqual(result);
  });

  it('deep-freezes aggregate state and settles all work exactly once', () => {
    const game = GameSession.create('day-3', 314);
    game.dispatch({ type: 'skip-intro' });
    for (let step = 0; step < 1_800 && game.snapshot().phase !== 'result'; step += 1) {
      let snapshot = game.snapshot();
      if (snapshot.pendingEventChoice) {
        game.dispatch({ type: 'event-choice', eventId: 'secretary-help', choice: 'report' });
        snapshot = game.snapshot();
      }
      for (const task of snapshot.tasks.filter((candidate) => candidate.status === 'offered')) {
        game.dispatch({ type: 'assign-task', instanceId: task.instanceId, assignee: 'employee' });
      }
      game.tick(100);
    }
    const settled = game.snapshot();
    expect(settled.phase).toBe('result');
    expect(settled.tasks.every((task) => ['completed', 'failed', 'expired'].includes(task.status)))
      .toBe(true);
    expect(settled.workerJobs).toEqual([]);
    expect(settled.boss.state).toBe('idle');
    expect(game.result).toBeDefined();
    const result = game.result;
    expect(game.tick(60_000)).toEqual([]);
    expect(game.result).toBe(result);
    expect(Object.isFrozen(settled)).toBe(true);
    expect(Object.isFrozen(settled.tasks)).toBe(true);
    expect(Object.isFrozen(settled.tasks[0])).toBe(true);
    expect(Object.isFrozen(settled.stats)).toBe(true);

    const restored = GameSession.create('day-3', 314);
    restored.restore(settled);
    expect(restored.snapshot()).toEqual(settled);
    expect(restored.result).toEqual(result);
  });

  it('rejects malformed commands before mutating task, phase, or RNG state', () => {
    const game = GameSession.create('day-3', 1);
    game.dispatch({ type: 'skip-intro' });
    game.tick(100);
    const before = game.snapshot();
    for (const invalid of [
      { type: 'assign-task', instanceId: 'missing-1', assignee: 'employee' },
      { type: 'pause', extra: true },
      { type: 'event-choice', eventId: 'secretary-help', choice: 'later' },
      { type: 'mystery' },
    ]) {
      expect(() => game.dispatch(invalid as never)).toThrow();
      expect(game.snapshot()).toEqual(before);
    }
    expect(TASK_DEFINITIONS).toHaveLength(20);
  });
});
