import { describe, expect, it } from 'vitest';
import {
  DAY_DEFINITIONS,
} from '../../assets/scripts/domain/content/days';
import {
  ResultSystem,
  type ResultInput,
  type SessionStatistics,
} from '../../assets/scripts/domain/ResultSystem';

const BASE_STATS: SessionStatistics = {
  bossCompleted: 5,
  bossWorkload: 18,
  totalWorkload: 30,
  bossWorkMs: 72_000,
  meetings: 2,
  usefulMeetings: 1,
  dumpAttempts: 3,
  dumpSuccesses: 0,
  outsources: 0,
  outsourceCost: 0,
  simplePhraseCount: 4,
  unresolvedUrgent: 0,
};

const BASE_METERS = {
  company: 75,
  rectification: 100,
  face: 55,
  trust: 75,
};

const TASK8_EMPTY_STATS: SessionStatistics = {
  bossCompleted: 0,
  bossWorkload: 0,
  totalWorkload: 0,
  bossWorkMs: 0,
  meetings: 0,
  usefulMeetings: 0,
  dumpAttempts: 0,
  dumpSuccesses: 0,
  outsources: 0,
  outsourceCost: 0,
  simplePhraseCount: 0,
  unresolvedUrgent: 0,
  counteredAvoidances: 0,
};

function evaluate(
  overrides: Partial<ResultInput> = {},
) {
  return ResultSystem.evaluate({
    dayId: 'day-3',
    meters: { ...BASE_METERS },
    stats: { ...BASE_STATS },
    ...overrides,
  });
}

function stats(overrides: Partial<SessionStatistics> = {}): SessionStatistics {
  return { ...BASE_STATS, ...overrides };
}

describe('day content', () => {
  it('contains exactly three deeply frozen day definitions', () => {
    expect(DAY_DEFINITIONS).toEqual([
      { id: 'day-1', difficulty: 1, spawnEveryMs: 15_000, goal: { bossCompleted: 3 } },
      { id: 'day-2', difficulty: 2, spawnEveryMs: 12_000, goal: { bossWorkloadRatio: 0.35 } },
      {
        id: 'day-3',
        difficulty: 3,
        spawnEveryMs: 10_000,
        goal: { companyAtLeast: 50, rectificationAtLeast: 70 },
      },
    ]);
    expect(Object.isFrozen(DAY_DEFINITIONS)).toBe(true);
    for (const definition of DAY_DEFINITIONS) {
      expect(Object.isFrozen(definition)).toBe(true);
      expect(Object.isFrozen(definition.goal)).toBe(true);
    }
  });
});

describe('ResultSystem goals and score', () => {
  it('evaluates the exact day-one completed-task boundary', () => {
    expect(evaluate({ dayId: 'day-1', stats: stats({ bossCompleted: 3 }) }).goalMet).toBe(true);
    expect(evaluate({ dayId: 'day-1', stats: stats({ bossCompleted: 2 }) }).goalMet).toBe(false);
  });

  it('uses completed workload for day two, including the .35 boundary and zero denominator', () => {
    expect(evaluate({
      dayId: 'day-2',
      stats: stats({ bossWorkload: 7, totalWorkload: 20 }),
    }).goalMet).toBe(true);
    expect(evaluate({
      dayId: 'day-2',
      stats: stats({ bossWorkload: 6, totalWorkload: 20 }),
    }).goalMet).toBe(false);
    expect(evaluate({
      dayId: 'day-2',
      stats: stats({ bossWorkload: 8, totalWorkload: 20 }),
    }).goalMet).toBe(true);
    expect(evaluate({
      dayId: 'day-2',
      stats: stats({ bossCompleted: 0, bossWorkload: 0, totalWorkload: 0 }),
    }).goalMet).toBe(false);
  });

  it('compares the day-two ratio exactly for large safe integers', () => {
    expect(evaluate({
      dayId: 'day-2',
      stats: stats({
        bossWorkload: 3_152_519_739_159_346,
        totalWorkload: 9_007_199_254_740_989,
      }),
    }).goalMet).toBe(false);
    expect(evaluate({
      dayId: 'day-2',
      stats: stats({
        bossWorkload: 3_152_519_739_159_347,
        totalWorkload: Number.MAX_SAFE_INTEGER,
      }),
    }).goalMet).toBe(true);
    expect(evaluate({
      dayId: 'day-2',
      stats: stats({
        bossWorkload: 3_152_519_739_159_346,
        totalWorkload: Number.MAX_SAFE_INTEGER,
      }),
    }).goalMet).toBe(false);
  });

  it('evaluates both inclusive day-three meter boundaries', () => {
    expect(evaluate({
      meters: { company: 50, rectification: 70, face: 50, trust: 50 },
    }).goalMet).toBe(true);
    expect(evaluate({
      meters: { company: 49.999, rectification: 70, face: 50, trust: 50 },
    }).goalMet).toBe(false);
    expect(evaluate({
      meters: { company: 50, rectification: 69.999, face: 50, trust: 50 },
    }).goalMet).toBe(false);
  });

  it('uses the approved weighted formula, face balance, and Math.round', () => {
    const result = evaluate({
      dayId: 'day-1',
      meters: { company: 63, rectification: 81, face: 37, trust: 58 },
      stats: stats({ unresolvedUrgent: 1 }),
    });
    const expected = Math.round(81 * 0.4 + 63 * 0.25 + 58 * 0.2 + 74 * 0.15);
    expect(result.score).toBe(expected);
  });
});

describe('ResultSystem grades', () => {
  it('awards SSS only when every approved condition is met at inclusive boundaries', () => {
    for (const face of [30, 70]) {
      expect(evaluate({
        meters: { company: 70, rectification: 70, face, trust: 70 },
      })).toMatchObject({ grade: 'SSS', goalMet: true });
    }

    expect(evaluate({ meters: { company: 69.999, rectification: 100, face: 50, trust: 100 } }).grade)
      .not.toBe('SSS');
    expect(evaluate({ meters: { company: 100, rectification: 100, face: 50, trust: 69.999 } }).grade)
      .not.toBe('SSS');
    expect(evaluate({ meters: { company: 100, rectification: 100, face: 29.999, trust: 100 } }).grade)
      .not.toBe('SSS');
    expect(evaluate({ meters: { company: 100, rectification: 100, face: 70.001, trust: 100 } }).grade)
      .not.toBe('SSS');
    expect(evaluate({ stats: stats({ unresolvedUrgent: 1 }) }).grade).not.toBe('SSS');
  });

  it('honors every S, A, B, and C rounded score threshold', () => {
    const cases = [
      [{ company: 100, rectification: 100, face: 50, trust: 25 }, 'S', 85],
      [{ company: 100, rectification: 98, face: 50, trust: 25 }, 'A', 84],
      [{ company: 80, rectification: 75, face: 50, trust: 25 }, 'A', 70],
      [{ company: 80, rectification: 73, face: 50, trust: 25 }, 'B', 69],
      [{ company: 60, rectification: 50, face: 50, trust: 25 }, 'B', 55],
      [{ company: 60, rectification: 48, face: 50, trust: 25 }, 'C', 54],
    ] as const;

    for (const [meters, grade, score] of cases) {
      expect(evaluate({
        dayId: 'day-1',
        meters,
        stats: stats({ unresolvedUrgent: 1 }),
      })).toMatchObject({ grade, score, goalMet: true });
    }
  });

  it('caps a high score at B when the hard goal fails and always makes company zero F', () => {
    expect(evaluate({
      meters: { company: 49, rectification: 100, face: 50, trust: 100 },
    })).toMatchObject({ grade: 'B', goalMet: false, score: 87 });
    expect(evaluate({
      dayId: 'day-1',
      meters: { company: 0, rectification: 100, face: 50, trust: 100 },
    }).grade).toBe('F');
  });
});

describe('ResultSystem title precedence', () => {
  it('uses first-match precedence and avoids division by zero', () => {
    const cases: readonly [Partial<ResultInput>, string][] = [
      [{
        meters: { company: 70, rectification: 100, face: 30, trust: 70 },
        stats: stats({ meetings: 5, usefulMeetings: 0, dumpAttempts: 4, dumpSuccesses: 0 }),
      }, '让老板心甘情愿打工的人'],
      [{
        dayId: 'day-1',
        meters: { company: 50, rectification: 50, face: 50, trust: 50 },
        stats: stats({ meetings: 5, usefulMeetings: 1, dumpAttempts: 4, dumpSuccesses: 0 }),
      }, '会议终结者'],
      [{
        dayId: 'day-1',
        meters: { company: 50, rectification: 100, face: 10, trust: 50 },
        stats: stats({ meetings: 4, usefulMeetings: 0, dumpAttempts: 4, dumpSuccesses: 0 }),
      }, '甩锅回旋镖大师'],
      [{
        dayId: 'day-1',
        meters: { company: 20, rectification: 100, face: 19.999, trust: 50 },
        stats: stats({ meetings: 0, usefulMeetings: 0, dumpAttempts: 3, dumpSuccesses: 0 }),
      }, '赛博周扒皮'],
      [{
        dayId: 'day-1',
        meters: { company: 29.999, rectification: 99, face: 20, trust: 50 },
        stats: stats({ meetings: 0, usefulMeetings: 0, dumpAttempts: 3, dumpSuccesses: 0 }),
      }, '公司还活着就行'],
      [{
        dayId: 'day-1',
        meters: { company: 30, rectification: 99, face: 20, trust: 50 },
        stats: stats({ meetings: 0, usefulMeetings: 0, dumpAttempts: 3, dumpSuccesses: 0 }),
      }, '温和改革派'],
    ];

    for (const [input, title] of cases) expect(evaluate(input).title).toBe(title);
  });

  it('requires a strict sub-.3 meeting ratio at the inclusive count boundary', () => {
    expect(evaluate({
      dayId: 'day-1',
      meters: { company: 50, rectification: 50, face: 50, trust: 50 },
      stats: stats({ meetings: 10, usefulMeetings: 3 }),
    }).title).toBe('温和改革派');
    expect(evaluate({
      dayId: 'day-1',
      meters: { company: 50, rectification: 50, face: 50, trust: 50 },
      stats: stats({ meetings: 10, usefulMeetings: 2 }),
    }).title).toBe('会议终结者');
    expect(evaluate({
      dayId: 'day-1',
      meters: { company: 50, rectification: 50, face: 50, trust: 50 },
      stats: stats({ meetings: 10, usefulMeetings: 4 }),
    }).title).toBe('温和改革派');
  });

  it('compares the meeting ratio exactly at MAX_SAFE_INTEGER', () => {
    const common = {
      dayId: 'day-1' as const,
      meters: { company: 50, rectification: 50, face: 50, trust: 50 },
    };
    expect(evaluate({
      ...common,
      stats: stats({
        meetings: Number.MAX_SAFE_INTEGER,
        usefulMeetings: 2_702_159_776_422_297,
      }),
    }).title).toBe('会议终结者');
    expect(evaluate({
      ...common,
      stats: stats({
        meetings: Number.MAX_SAFE_INTEGER,
        usefulMeetings: 2_702_159_776_422_298,
      }),
    }).title).toBe('温和改革派');
  });
});

describe('ResultSystem report', () => {
  it('returns the exact stable 14-row CEO report with units and emphasis', () => {
    const result = evaluate({
      dayId: 'day-1',
      meters: { company: 49, rectification: 80, face: 55, trust: 40 },
    });
    expect(result.report).toEqual([
      { label: '老板亲自工作时长', value: '0小时1分钟', emphasis: 'good' },
      { label: '老板完成任务数量', value: '5个', emphasis: 'good' },
      { label: '老板完成工作量', value: '18点', emphasis: 'good' },
      { label: '主持会议次数', value: '2次', emphasis: 'funny' },
      { label: '有效会议次数', value: '1次', emphasis: 'good' },
      { label: '尝试甩锅次数', value: '3次', emphasis: 'funny' },
      { label: '成功甩锅次数', value: '0次', emphasis: 'funny' },
      { label: '外包次数', value: '0次', emphasis: 'funny' },
      { label: '外包成本', value: '0点', emphasis: 'good' },
      { label: '“这个很简单”出现次数', value: '4次', emphasis: 'funny' },
      { label: '公司经营', value: '49', emphasis: 'bad' },
      { label: '整改进度', value: '80', emphasis: 'good' },
      { label: '老板面子', value: '55', emphasis: 'funny' },
      { label: '董事会信任', value: '40', emphasis: 'bad' },
    ]);
  });

  it('rounds game-time minutes before splitting hours and minutes', () => {
    expect(evaluate({
      stats: stats({ bossWorkMs: 29_999 }),
    }).report[0].value).toBe('0小时0分钟');
    expect(evaluate({
      stats: stats({ bossWorkMs: 30_000 }),
    }).report[0].value).toBe('0小时1分钟');
    expect(evaluate({
      stats: stats({ bossWorkMs: 3_630_000 }),
    }).report[0].value).toBe('1小时1分钟');
  });

  it('formats the largest accepted work time without scientific notation', () => {
    const value = evaluate({
      stats: stats({ bossWorkMs: Number.MAX_SAFE_INTEGER }),
    }).report[0].value;
    const match = /^(\d+)小时(\d+)分钟$/.exec(value);
    expect(value).not.toMatch(/[eE]/);
    expect(match).not.toBeNull();
    expect(Number(match![2])).toBeGreaterThanOrEqual(0);
    expect(Number(match![2])).toBeLessThan(60);
  });

  it('formats meters with at most six decimals without changing scoring inputs', () => {
    const result = evaluate({
      dayId: 'day-1',
      meters: {
        company: 54.800000000000004,
        rectification: 0,
        face: 100,
        trust: 12.3456789,
      },
    });
    expect(result.report.slice(10).map((row) => row.value)).toEqual([
      '54.8', '0', '100', '12.345679',
    ]);
    expect(result.score).toBe(Math.round(
      54.800000000000004 * 0.25 + 12.3456789 * 0.20,
    ));

    const scoringProbe = evaluate({
      dayId: 'day-1',
      meters: { company: 1.9999998, rectification: 0, face: 100, trust: 0 },
    });
    expect(scoringProbe.report[10].value).toBe('2');
    expect(scoringProbe.score).toBe(0);
  });

  it('accepts the locked Task 8 useful-meeting-only state and reports both counters', () => {
    const result = evaluate({
      dayId: 'day-1',
      meters: { company: 50, rectification: 50, face: 50, trust: 50 },
      stats: { ...TASK8_EMPTY_STATS, usefulMeetings: 1 },
    });
    expect(result.title).toBe('温和改革派');
    expect(result.report[3].value).toBe('0次');
    expect(result.report[4].value).toBe('1次');
  });

  it('does not add internal totals, urgent work, or future counters to the report', () => {
    const result = evaluate({ stats: { ...BASE_STATS, counteredAvoidances: 2 } });
    expect(result.report).toHaveLength(14);
    expect(result.report.map((row) => row.label)).not.toContain('总工作量');
    expect(result.report.map((row) => row.label)).not.toContain('未处理紧急任务');
    expect(result.report.map((row) => row.label)).not.toContain('反制回避次数');
  });
});

describe('ResultSystem immutability and validation', () => {
  it('deeply freezes detached output, rows, report, and day content', () => {
    const meters = { ...BASE_METERS };
    const inputStats = { ...BASE_STATS };
    const result = ResultSystem.evaluate({ dayId: 'day-3', meters, stats: inputStats });
    meters.company = 0;
    inputStats.bossCompleted = 0;

    expect(result).toMatchObject({ grade: 'SSS', goalMet: true });
    expect(result.report[1].value).toBe('5个');
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.report)).toBe(true);
    for (const row of result.report) expect(Object.isFrozen(row)).toBe(true);
  });

  it('accepts only the optional future counter and otherwise exact own data properties', () => {
    expect(() => evaluate({ stats: { ...BASE_STATS, counteredAvoidances: 0 } })).not.toThrow();

    const invalidStats = [
      { ...BASE_STATS, extra: 0 },
      Object.assign({ ...BASE_STATS }, { [Symbol('extra')]: 0 }),
      { ...BASE_STATS, counteredAvoidances: -1 },
      { ...BASE_STATS, counteredAvoidances: 0.5 },
    ];
    for (const candidate of invalidStats) {
      expect(() => evaluate({ stats: candidate as never })).toThrow('statistics');
    }
  });

  it('rejects missing, boxed, negative, non-finite, unsafe-integer, and inconsistent statistics', () => {
    const missing = { ...BASE_STATS } as Record<string, unknown>;
    delete missing.bossCompleted;
    const invalidStats: unknown[] = [
      missing,
      { ...BASE_STATS, bossCompleted: new Number(5) },
      { ...BASE_STATS, bossCompleted: -1 },
      { ...BASE_STATS, bossCompleted: 0.5 },
      { ...BASE_STATS, bossCompleted: Number.MAX_SAFE_INTEGER + 1 },
      { ...BASE_STATS, bossWorkMs: Number.NaN },
      { ...BASE_STATS, bossWorkMs: Number.POSITIVE_INFINITY },
      { ...BASE_STATS, bossWorkMs: Number.MAX_VALUE },
      { ...BASE_STATS, bossWorkMs: Number.MAX_SAFE_INTEGER + 1 },
      { ...BASE_STATS, bossWorkMs: 0.5 },
      { ...BASE_STATS, outsourceCost: -0.01 },
      { ...BASE_STATS, outsources: 1, outsourceCost: 0.5 },
      { ...BASE_STATS, bossWorkload: 31, totalWorkload: 30 },
      { ...BASE_STATS, bossCompleted: 19, bossWorkload: 18 },
      { ...BASE_STATS, bossCompleted: 0, bossWorkload: 1 },
      { ...BASE_STATS, dumpSuccesses: 4, dumpAttempts: 3 },
      { ...BASE_STATS, outsources: 0, outsourceCost: 1 },
    ];
    for (const candidate of invalidStats) {
      expect(() => evaluate({ stats: candidate as never })).toThrow('statistics');
    }
  });

  it('rejects unknown, boxed, and coercible day IDs without coercion', () => {
    let calls = 0;
    const coercible = { toString: () => { calls += 1; return 'day-3'; } };
    for (const dayId of ['day-4', new String('day-3'), coercible]) {
      expect(() => evaluate({ dayId: dayId as never })).toThrow('day ID');
    }
    expect(calls).toBe(0);
  });

  it('requires exactly four own primitive finite meters in the 0..100 range', () => {
    const missing = { ...BASE_METERS } as Record<string, unknown>;
    delete missing.company;
    const invalidMeters: unknown[] = [
      missing,
      { ...BASE_METERS, extra: 1 },
      Object.assign({ ...BASE_METERS }, { [Symbol('extra')]: 0 }),
      { ...BASE_METERS, company: new Number(75) },
      { ...BASE_METERS, company: Number.NaN },
      { ...BASE_METERS, company: Number.POSITIVE_INFINITY },
      { ...BASE_METERS, company: -0.001 },
      { ...BASE_METERS, company: 100.001 },
    ];
    for (const candidate of invalidMeters) {
      expect(() => evaluate({ meters: candidate as never })).toThrow('meters');
    }
  });

  it('rejects accessors and top-level extras without invoking any getter', () => {
    let calls = 0;
    const meterAccessor = { ...BASE_METERS };
    Object.defineProperty(meterAccessor, 'company', {
      enumerable: true,
      get: () => { calls += 1; return 75; },
    });
    const statsAccessor = { ...BASE_STATS };
    Object.defineProperty(statsAccessor, 'bossCompleted', {
      enumerable: true,
      get: () => { calls += 1; return 5; },
    });
    const inputAccessor = {
      dayId: 'day-3',
      meters: { ...BASE_METERS },
      get stats() { calls += 1; return { ...BASE_STATS }; },
    };

    expect(() => evaluate({ meters: meterAccessor })).toThrow('meters');
    expect(() => evaluate({ stats: statsAccessor })).toThrow('statistics');
    expect(() => ResultSystem.evaluate(inputAccessor as never)).toThrow('result input');
    expect(() => ResultSystem.evaluate({
      dayId: 'day-3', meters: BASE_METERS, stats: BASE_STATS, extra: 1,
    } as never)).toThrow('result input');
    expect(() => ResultSystem.evaluate(Object.assign({
      dayId: 'day-3', meters: BASE_METERS, stats: BASE_STATS,
    }, { [Symbol('extra')]: 1 }) as never)).toThrow('result input');
    expect(calls).toBe(0);
  });

  it('uses one descriptor snapshot so proxies cannot flip values after validation', () => {
    let dayIdDescriptorCalls = 0;
    const target = {
      dayId: 'day-3',
      meters: { ...BASE_METERS },
      stats: { ...BASE_STATS },
    };
    const input = new Proxy(target, {
      getOwnPropertyDescriptor(object, key) {
        if (key !== 'dayId') return Reflect.getOwnPropertyDescriptor(object, key);
        dayIdDescriptorCalls += 1;
        return {
          configurable: true,
          enumerable: true,
          writable: true,
          value: dayIdDescriptorCalls === 1 ? 'day-3' : 'day-4',
        };
      },
    });

    expect(ResultSystem.evaluate(input)).toMatchObject({ grade: 'SSS', goalMet: true });
    expect(dayIdDescriptorCalls).toBe(1);
  });
});
