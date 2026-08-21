import { describe, expect, it } from 'vitest';
import { BossAI } from '../../assets/scripts/domain/BossAI';
import {
  BOSS_DIALOGUE,
  BOSS_DIALOGUE_TAGS,
} from '../../assets/scripts/domain/content/dialogue';
import { TASK_DEFINITIONS } from '../../assets/scripts/domain/content/tasks';
import type {
  AvoidanceType,
  RandomSource,
  RuleId,
  TaskDefinition,
} from '../../assets/scripts/domain/model';
import { StubRandom } from '../helpers/StubRandom';

const DEFAULT_CONTEXT = Object.freeze({
  face: 65,
  queueLength: 1,
  minuteOfDay: 600,
  difficulty: 1 as const,
});

const MATCHING_RULE: Readonly<Record<AvoidanceType, RuleId>> = Object.freeze({
  meeting: 'cost-time-audit',
  dump: 'responsibility-chain',
  outsource: 'cost-time-audit',
  'change-request': 'original-request',
  'strategic-upgrade': 'original-request',
});

function task(overrides: Partial<TaskDefinition> = {}): TaskDefinition {
  return {
    id: 'test-task',
    department: 'sales',
    title: '测试任务',
    description: '用于验证老板状态机。',
    workload: 3,
    expertise: 2,
    urgency: 3,
    bossFit: 3,
    deadlineMinutes: 60,
    employeeSuccess: 0.8,
    bossSuccess: 0.6,
    ...overrides,
  };
}

function warningBoss(
  definition: TaskDefinition,
  behaviorRoll: number,
  instanceId = 'task-1',
): BossAI {
  const boss = new BossAI(new StubRandom([0, behaviorRoll]));
  boss.accept(instanceId, definition, 0, DEFAULT_CONTEXT);
  return boss;
}

describe('Boss dialogue content', () => {
  it('keeps the approved exact arrays deeply frozen and tags the simple phrase', () => {
    expect(BOSS_DIALOGUE).toEqual({
      meeting: ['这个需要大家先对齐一下。', '先开个会把问题定义清楚。', '我觉得要形成长期机制。'],
      dump: ['这个让负责人先处理。', '专业的事交给专业的人。', '小张，你来跟进一下。'],
      outsource: ['能花钱解决的问题就不是问题。', '找个外部团队快速落地。', '预算要用在刀刃上。'],
      changeRequest: ['原需求的格局还是小了。', '我们顺便把体验整体升级。', '这个很简单，再加两个入口。'],
      strategicUpgrade: ['要从更高维度看这个问题。', '这不是按钮，这是增长体系。', '先做一版三年战略规划。'],
      complete: ['我早就有这个思路。', '实践证明方向是对的。', '一线工作确实很有启发。', '这个成果可以总结成方法论。'],
    });
    expect(Object.isFrozen(BOSS_DIALOGUE)).toBe(true);
    for (const lines of Object.values(BOSS_DIALOGUE)) {
      expect(Object.isFrozen(lines)).toBe(true);
    }
    expect(BOSS_DIALOGUE_TAGS['这个很简单，再加两个入口。']).toEqual(['simple-phrase']);
    expect(Object.isFrozen(BOSS_DIALOGUE_TAGS)).toBe(true);
    expect(Object.isFrozen(BOSS_DIALOGUE_TAGS['这个很简单，再加两个入口。'])).toBe(true);
  });
});

describe('StubRandom', () => {
  it('uses strict half-open values and throws when its queue is exhausted', () => {
    const random = new StubRandom([0, 0.999]);
    expect(random.int(3, 8)).toBe(3);
    expect(random.int(3, 8)).toBe(7);
    expect(() => random.next()).toThrow('queue exhausted');
    expect(() => new StubRandom([1]).next()).toThrow('[0, 1)');
    expect(() => new StubRandom([Number.NaN]).next()).toThrow('[0, 1)');
    expect(() => new StubRandom([0.5]).int(2, 2)).toThrow('bounds');
    expect(() => new StubRandom([0.5]).int(0.1, 2)).toThrow('bounds');
  });
});

describe('BossAI state machine', () => {
  it('works for exactly workload * 2500 ms and emits every state transition', () => {
    const boss = new BossAI(new StubRandom([0.99]));
    const accepted = boss.accept('quick-1', task({ workload: 1 }), 0, DEFAULT_CONTEXT);
    expect(accepted.map((event) => event.type)).toEqual(['boss-state-changed']);
    expect(accepted[0].payload).toMatchObject({ from: 'idle', to: 'working', taskInstanceId: 'quick-1' });
    expect(boss.tick(2_499)).toEqual([]);
    expect(boss.snapshot()).toMatchObject({ state: 'working', remainingWorkMs: 1 });

    const completed = boss.tick(1);
    expect(completed.map((event) => event.type)).toEqual([
      'boss-task-completed',
      'boss-state-changed',
    ]);
    expect(completed[0].payload).toEqual({ taskInstanceId: 'quick-1' });
    expect(boss.snapshot()).toEqual({
      state: 'idle',
      remainingWorkMs: 0,
      warningRemainingMs: 0,
    });
  });

  it('uses the exact chance formula, strict threshold, face modifiers, and upper clamp', () => {
    const moderateTrigger = new BossAI(new StubRandom([0.249, 0]));
    moderateTrigger.accept('a', task(), 0, DEFAULT_CONTEXT);
    expect(moderateTrigger.snapshot().state).toBe('warning');

    const strictThreshold = new BossAI(new StubRandom([0.25]));
    strictThreshold.accept('b', task(), 0, DEFAULT_CONTEXT);
    expect(strictThreshold.snapshot().state).toBe('working');

    const highFace = new BossAI(new StubRandom([0.36, 0]));
    highFace.accept('c', task(), 0, { ...DEFAULT_CONTEXT, face: 81 });
    expect(highFace.snapshot().state).toBe('warning');

    const lowFace = new BossAI(new StubRandom([0.32, 0]));
    lowFace.accept('d', task(), 0, { ...DEFAULT_CONTEXT, face: 19 });
    expect(lowFace.snapshot().state).toBe('warning');

    const capped = new BossAI(new StubRandom([0.649, 0]));
    capped.accept('e', task(), 0, { ...DEFAULT_CONTEXT, queueLength: 100, difficulty: 3 });
    expect(capped.snapshot().state).toBe('warning');
  });

  it('applies an optional validated event multiplier after the base chance clamp', () => {
    const omitted = new BossAI(new StubRandom([0.249, 0]));
    omitted.accept('omitted', task(), 0, DEFAULT_CONTEXT);
    expect(omitted.snapshot().state).toBe('warning');

    const explicitDefault = new BossAI(new StubRandom([0.249, 0]));
    explicitDefault.accept('explicit-default', task(), 0, DEFAULT_CONTEXT, 1);
    expect(explicitDefault.snapshot().state).toBe('warning');

    const reduced = new BossAI(new StubRandom([0.1]));
    reduced.accept('reduced', task(), 0, DEFAULT_CONTEXT, 0.2);
    expect(reduced.snapshot().state).toBe('working');

    const increased = new BossAI(new StubRandom([0.3, 0]));
    increased.accept('increased', task(), 0, DEFAULT_CONTEXT, 1.5);
    expect(increased.snapshot().state).toBe('warning');

    const disabled = new BossAI(new StubRandom([0]));
    disabled.accept('disabled', task(), 0, DEFAULT_CONTEXT, 0);
    expect(disabled.snapshot().state).toBe('working');
  });

  it('rejects invalid event chance multipliers atomically without consuming RNG', () => {
    for (const invalid of [
      -0.1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      new Number(1),
    ]) {
      const boss = new BossAI(new StubRandom([0.99]));
      expect(() => boss.accept('invalid-multiplier', task(), 0, DEFAULT_CONTEXT, invalid as number))
        .toThrow('multiplier');
      expect(boss.snapshot()).toEqual({
        state: 'idle',
        remainingWorkMs: 0,
        warningRemainingMs: 0,
      });
      expect(() => boss.accept('valid-after-rejection', task(), 0, DEFAULT_CONTEXT)).not.toThrow();
      expect(boss.snapshot().state).toBe('working');
    }
  });

  it('publishes both warning transitions and the legitimacy flag without losing the task ID', () => {
    const boss = new BossAI(new StubRandom([0, 0]));
    const events = boss.accept(
      'meeting-1',
      task({ expertise: 4, bossFit: 4, workload: 3 }),
      0,
      DEFAULT_CONTEXT,
    );
    expect(events.map((domainEvent) => domainEvent.type)).toEqual([
      'boss-state-changed',
      'boss-state-changed',
      'avoidance-warning',
    ]);
    expect(events[1].payload).toMatchObject({
      from: 'working',
      to: 'warning',
      taskInstanceId: 'meeting-1',
    });
    expect(events[2].payload).toEqual({
      taskInstanceId: 'meeting-1',
      avoidance: 'meeting',
      legitimate: true,
    });
  });

  it('applies the documented candidate priority without accidental branch shadowing', () => {
    const cases: readonly [TaskDefinition, number, AvoidanceType][] = [
      [task({ bossFit: 2, expertise: 5, department: 'product' }), 0, 'dump'],
      [task({ bossFit: 2, expertise: 5, department: 'product' }), 0.999, 'outsource'],
      [task({ bossFit: 3, expertise: 4, department: 'product' }), 0, 'meeting'],
      [task({ bossFit: 3, expertise: 4, department: 'product' }), 0.999, 'outsource'],
      [task({ bossFit: 3, expertise: 3, department: 'product' }), 0, 'change-request'],
      [task({ bossFit: 3, expertise: 3, department: 'product' }), 0.999, 'strategic-upgrade'],
      [task(), 0, 'meeting'],
      [task(), 0.2, 'dump'],
      [task(), 0.4, 'outsource'],
      [task(), 0.6, 'change-request'],
      [task(), 0.8, 'strategic-upgrade'],
    ];
    for (const [definition, roll, expected] of cases) {
      expect(warningBoss(definition, roll).snapshot().avoidance).toBe(expected);
    }
  });

  it('marks only the exact approved meeting and outsource cases legitimate', () => {
    for (const department of ['product', 'sales', 'hr'] as const) {
      const boss = warningBoss(task({ department, bossFit: 4, workload: 3, expertise: 4 }), 0);
      expect(boss.snapshot()).toMatchObject({ avoidance: 'meeting', avoidanceLegitimate: true });
    }
    for (const overrides of [
      { bossFit: 3 as const, workload: 3 as const, department: 'sales' as const },
      { bossFit: 4 as const, workload: 2 as const, department: 'sales' as const },
      { bossFit: 4 as const, workload: 3 as const, department: 'dev' as const },
    ]) {
      const boss = warningBoss(task({ ...overrides, expertise: 4 }), 0);
      expect(boss.snapshot().avoidanceLegitimate).toBe(false);
    }

    const legitimateOutsource = warningBoss(TASK_DEFINITIONS[0], 0.999);
    expect(legitimateOutsource.snapshot()).toMatchObject({
      avoidance: 'outsource',
      avoidanceLegitimate: true,
    });
    for (const overrides of [
      { urgency: 3 as const, expertise: 4 as const, bossSuccess: 0.49 },
      { urgency: 4 as const, expertise: 3 as const, bossSuccess: 0.49 },
      { urgency: 4 as const, expertise: 4 as const, bossSuccess: 0.5 },
    ]) {
      const boss = warningBoss(task({ ...overrides, bossFit: 2 }), 0.999);
      expect(boss.snapshot()).toMatchObject({ avoidance: 'outsource', avoidanceLegitimate: false });
    }
  });

  it('counters every warning only with its matching rule and rounds 80% upward', () => {
    const behaviorRoll: Readonly<Record<AvoidanceType, number>> = Object.freeze({
      meeting: 0,
      dump: 0.2,
      outsource: 0.4,
      'change-request': 0.6,
      'strategic-upgrade': 0.8,
    });
    for (const avoidance of Object.keys(behaviorRoll) as AvoidanceType[]) {
      const boss = warningBoss(task(), behaviorRoll[avoidance]);
      const events = boss.counter(MATCHING_RULE[avoidance]);
      expect(events.map((event) => event.type)).toEqual([
        'avoidance-countered',
        'boss-state-changed',
      ]);
      expect(events[0].payload).toMatchObject({ avoidance, taskInstanceId: 'task-1' });
      expect(boss.snapshot()).toMatchObject({
        state: 'working',
        remainingWorkMs: 6_000,
        warningRemainingMs: 0,
      });
      expect(boss.snapshot()).not.toHaveProperty('avoidance');
    }

    const rounded = new BossAI(new StubRandom([]));
    rounded.restore({
      state: 'warning',
      taskInstanceId: 'rounding-1',
      avoidance: 'dump',
      avoidanceLegitimate: false,
      remainingWorkMs: 1_001,
      warningRemainingMs: 200,
    });
    rounded.counter('responsibility-chain');
    expect(rounded.snapshot().remainingWorkMs).toBe(801);
  });

  it('leaves state unchanged for mismatched rules or when no warning exists', () => {
    const warning = warningBoss(task(), 0.2);
    const beforeWarning = warning.snapshot();
    expect(warning.counter('original-request')).toEqual([]);
    expect(warning.snapshot()).toEqual(beforeWarning);
    expect(warning.counter('not-a-rule' as RuleId)).toEqual([]);
    expect(warning.snapshot()).toEqual(beforeWarning);

    const working = new BossAI(new StubRandom([0.99]));
    working.accept('working-1', task(), 0, DEFAULT_CONTEXT);
    const beforeWorking = working.snapshot();
    expect(working.counter('cost-time-audit')).toEqual([]);
    expect(working.snapshot()).toEqual(beforeWorking);
  });

  it('holds a 1500 ms warning through the exact boundary and succeeds once', () => {
    const boss = warningBoss(task(), 0.2);
    expect(boss.snapshot().warningRemainingMs).toBe(1_500);
    expect(boss.tick(1_499)).toEqual([]);
    expect(boss.snapshot().state).toBe('warning');
    const events = boss.tick(1);
    expect(events.map((event) => event.type)).toEqual([
      'avoidance-succeeded',
      'boss-state-changed',
    ]);
    expect(events[0].payload).toMatchObject({
      taskInstanceId: 'task-1',
      avoidance: 'dump',
      legitimate: false,
    });
    expect(boss.snapshot().state).toBe('idle');
    expect(boss.tick(10_000)).toEqual([]);
  });

  it('adds meeting delay then consumes leftover delta across all exact boundaries', () => {
    const boss = warningBoss(task({ expertise: 4 }), 0);
    const events = boss.tick(12_000);
    expect(events.map((event) => event.type)).toEqual([
      'avoidance-succeeded',
      'boss-state-changed',
      'boss-task-completed',
      'boss-state-changed',
    ]);
    expect(events[0].payload).toMatchObject({ avoidance: 'meeting' });
    expect(boss.snapshot().state).toBe('idle');
  });

  it('adds strategic-upgrade delay and preserves its task ID until returning idle', () => {
    const boss = warningBoss(task({ department: 'product' }), 0.999, 'strategy-1');
    expect(boss.snapshot()).toMatchObject({
      state: 'warning',
      taskInstanceId: 'strategy-1',
      avoidance: 'strategic-upgrade',
      remainingWorkMs: 7_500,
    });
    boss.tick(1_500);
    expect(boss.snapshot()).toMatchObject({
      state: 'working',
      taskInstanceId: 'strategy-1',
      remainingWorkMs: 11_500,
    });
    boss.tick(11_500);
    expect(boss.snapshot()).not.toHaveProperty('taskInstanceId');
  });

  it('keeps warning and non-work delay on real time while speeding only productive work', () => {
    const boss = warningBoss(task({ bossFit: 4, workload: 3, expertise: 4 }), 0);
    boss.tick(750, 99);
    expect(boss.snapshot().warningRemainingMs).toBe(750);
    expect(boss.workedRealMsLastTick).toBe(0);

    boss.tick(750, 99);
    expect(boss.snapshot()).toMatchObject({
      state: 'working',
      remainingWorkMs: 9_500,
      nonWorkDelayRemainingMs: 2_000,
    });
    boss.tick(1_000, 99);
    expect(boss.snapshot()).toMatchObject({
      remainingWorkMs: 8_500,
      nonWorkDelayRemainingMs: 1_000,
    });
    expect(boss.workedRealMsLastTick).toBe(0);
    boss.tick(1_000, 99);
    expect(boss.snapshot()).not.toHaveProperty('nonWorkDelayRemainingMs');
    expect(boss.workedRealMsLastTick).toBe(0);

    boss.tick(75, 100);
    expect(boss.snapshot().state).toBe('idle');
    expect(boss.workedRealMsLastTick).toBe(75);
  });

  it('cancels only the matching active task and clears every timer', () => {
    const boss = warningBoss(task(), 0.2, 'cancel-me');
    const before = boss.snapshot();
    expect(boss.cancel('someone-else')).toEqual([]);
    expect(boss.snapshot()).toEqual(before);
    expect(boss.cancel('cancel-me').map((item) => item.type)).toEqual([
      'boss-task-cancelled',
      'boss-state-changed',
    ]);
    expect(boss.snapshot()).toEqual({
      state: 'idle',
      remainingWorkMs: 0,
      warningRemainingMs: 0,
    });
  });

  it('treats negative delta as no progress and rejects non-finite delta atomically', () => {
    const boss = new BossAI(new StubRandom([0.99]));
    boss.accept('time-1', task(), 0, DEFAULT_CONTEXT);
    const before = boss.snapshot();
    expect(boss.tick(-1)).toEqual([]);
    expect(boss.snapshot()).toEqual(before);
    for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => boss.tick(invalid)).toThrow('finite');
      expect(boss.snapshot()).toEqual(before);
    }
  });

  it('validates accept inputs and busy state without partial mutation', () => {
    const invalidCases: readonly [unknown, unknown, unknown, unknown][] = [
      ['', task(), 0, DEFAULT_CONTEXT],
      ['   ', task(), 0, DEFAULT_CONTEXT],
      [new String('boxed'), task(), 0, DEFAULT_CONTEXT],
      ['valid', task({ workload: 0 as never }), 0, DEFAULT_CONTEXT],
      ['valid', task(), Number.NaN, DEFAULT_CONTEXT],
      ['valid', task(), 0, { ...DEFAULT_CONTEXT, face: Number.NaN }],
      ['valid', task(), 0, { ...DEFAULT_CONTEXT, queueLength: -1 }],
      ['valid', task(), 0, { ...DEFAULT_CONTEXT, difficulty: 4 }],
    ];
    for (const [instanceId, definition, nowMs, context] of invalidCases) {
      const boss = new BossAI(new StubRandom([0.99]));
      expect(() => boss.accept(instanceId as string, definition as TaskDefinition, nowMs as number, context as never))
        .toThrow();
      expect(boss.snapshot().state).toBe('idle');
    }

    const busy = new BossAI(new StubRandom([0.99]));
    busy.accept('first', task(), 0, DEFAULT_CONTEXT);
    const before = busy.snapshot();
    expect(() => busy.accept('second', task(), 0, DEFAULT_CONTEXT)).toThrow('idle');
    expect(busy.snapshot()).toEqual(before);
  });

  it('rejects coercible objects without invoking their toString hooks', () => {
    let calls = 0;
    const coercible = {
      toString() {
        calls += 1;
        return 'responsibility-chain';
      },
    };
    const boss = warningBoss(task(), 0.2);
    const before = boss.snapshot();
    expect(boss.counter(coercible as never)).toEqual([]);
    expect(() => boss.restore({ ...before, taskInstanceId: coercible } as never))
      .toThrow('invalid boss snapshot');
    expect(calls).toBe(0);
    expect(boss.snapshot()).toEqual(before);
  });

  it('rejects invalid random-source outputs without changing BossAI state', () => {
    const sources: RandomSource[] = [
      { next: () => 1, int: () => 0 },
      { next: () => Number.NaN, int: () => 0 },
      { next: () => 0, int: () => 99 },
    ];
    for (const source of sources) {
      const boss = new BossAI(source);
      expect(() => boss.accept('random-1', task(), 0, DEFAULT_CONTEXT)).toThrow('random');
      expect(boss.snapshot()).toEqual({
        state: 'idle',
        remainingWorkMs: 0,
        warningRemainingMs: 0,
      });
    }
  });

  it('returns deeply frozen detached snapshots and event collections', () => {
    const definition = task();
    const boss = warningBoss(definition, 0.2, 'freeze-1');
    const snapshot = boss.snapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(snapshot).not.toHaveProperty('task');
    expect(Object.values(snapshot).includes(definition as never)).toBe(false);

    const events = boss.counter('responsibility-chain');
    expect(Object.isFrozen(events)).toBe(true);
    for (const domainEvent of events) {
      expect(Object.isFrozen(domainEvent)).toBe(true);
      expect(Object.isFrozen(domainEvent.payload)).toBe(true);
    }
  });

  it('round-trips valid snapshots and strongly rejects invalid restores atomically', () => {
    const boss = warningBoss(task(), 0.2, 'restore-1');
    const saved = boss.snapshot();
    const restored = new BossAI(new StubRandom([]));
    restored.restore(saved);
    expect(restored.snapshot()).toEqual(saved);

    const invalidSnapshots: unknown[] = [
      null,
      { ...saved, state: new String('warning') },
      { ...saved, state: 'unknown' },
      { ...saved, taskInstanceId: '' },
      { ...saved, taskInstanceId: new String('boxed') },
      { ...saved, remainingWorkMs: Number.NaN },
      { ...saved, warningRemainingMs: Number.POSITIVE_INFINITY },
      { ...saved, warningRemainingMs: -1 },
      { ...saved, warningRemainingMs: 1_801 },
      { ...saved, avoidance: 'unknown' },
      { ...saved, avoidanceLegitimate: 1 },
      { state: 'working', taskInstanceId: 'x', remainingWorkMs: 1, warningRemainingMs: 1 },
      { state: 'working', taskInstanceId: 'x', avoidance: 'dump', remainingWorkMs: 1, warningRemainingMs: 0 },
      { state: 'idle', taskInstanceId: 'x', remainingWorkMs: 0, warningRemainingMs: 0 },
      { state: 'idle', remainingWorkMs: 1, warningRemainingMs: 0 },
    ];
    for (const invalid of invalidSnapshots) {
      expect(() => restored.restore(invalid as never)).toThrow('invalid boss snapshot');
      expect(restored.snapshot()).toEqual(saved);
    }
  });

  it('rejects legitimate=true for avoidances that can never be legitimate', () => {
    const boss = warningBoss(task(), 0, 'legitimacy-restore-1');
    const original = boss.snapshot();
    for (const avoidance of ['dump', 'change-request', 'strategic-upgrade'] as const) {
      expect(() => boss.restore({
        state: 'warning',
        taskInstanceId: 'forged-legitimacy-1',
        avoidance,
        avoidanceLegitimate: true,
        remainingWorkMs: 1_000,
        warningRemainingMs: 500,
      })).toThrow('invalid boss snapshot');
      expect(boss.snapshot()).toEqual(original);
    }
  });
});
