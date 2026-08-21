import { describe, expect, it } from 'vitest';
import type { AvoidanceType, RuleId } from '../../assets/scripts/domain/model';
import { RuleSystem } from '../../assets/scripts/domain/RuleSystem';
import { RULE_DEFINITIONS } from '../../assets/scripts/domain/content/rules';

describe('rule definitions', () => {
  it('defines exactly three deeply frozen rules with the approved costs and counters', () => {
    expect(RULE_DEFINITIONS).toEqual({
      'responsibility-chain': { cost: 2, counters: ['dump'] },
      'original-request': { cost: 1, counters: ['change-request', 'strategic-upgrade'] },
      'cost-time-audit': { cost: 1, counters: ['meeting', 'outsource'] },
    });
    expect(Object.isFrozen(RULE_DEFINITIONS)).toBe(true);
    for (const definition of Object.values(RULE_DEFINITIONS)) {
      expect(Object.isFrozen(definition)).toBe(true);
      expect(Object.isFrozen(definition.counters)).toBe(true);
    }
  });
});

describe('RuleSystem', () => {
  it('maps all five avoidances to one of three rules', () => {
    expect(new RuleSystem(5).use('responsibility-chain', 'dump').matched).toBe(true);
    expect(new RuleSystem(5).use('original-request', 'change-request').matched).toBe(true);
    expect(new RuleSystem(5).use('original-request', 'strategic-upgrade').matched).toBe(true);
    expect(new RuleSystem(5).use('cost-time-audit', 'meeting').matched).toBe(true);
    expect(new RuleSystem(5).use('cost-time-audit', 'outsource').matched).toBe(true);
  });

  it('charges a wrong rule and emits ordered immutable events', () => {
    const rules = new RuleSystem(1);
    const result = rules.use('original-request', 'meeting');

    expect(result).toMatchObject({ accepted: true, matched: false, cost: 1 });
    expect(result.events.map(({ type }) => type)).toEqual(['rule-used', 'rule-missed']);
    expect(result.events[0].payload).toEqual({
      ruleId: 'original-request',
      avoidance: 'meeting',
      cost: 1,
      remaining: 0,
    });
    expect(rules.remaining).toBe(0);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.events)).toBe(true);
    expect(result.events.every((entry) => Object.isFrozen(entry))).toBe(true);
    expect(result.events.every((entry) => Object.isFrozen(entry.payload))).toBe(true);
    expect(() => result.events.push({ type: 'tampered', payload: {} })).toThrow();
    expect(rules.remaining).toBe(0);
  });

  it('emits countered after rule-used for an accepted match', () => {
    const result = new RuleSystem().use('responsibility-chain', 'dump');

    expect(result).toMatchObject({ accepted: true, matched: true, cost: 2 });
    expect(result.events.map(({ type }) => type)).toEqual([
      'rule-used',
      'avoidance-countered',
    ]);
    expect(result.events[1].payload).toEqual({
      ruleId: 'responsibility-chain',
      avoidance: 'dump',
    });
  });

  it('rejects a two-point rule at one point without charging or going negative', () => {
    const rules = new RuleSystem(1);
    const rejected = rules.use('responsibility-chain', 'dump');

    expect(rejected).toMatchObject({ accepted: false, matched: false, cost: 0 });
    expect(rejected.events).toHaveLength(1);
    expect(rejected.events[0]).toEqual({
      type: 'rule-rejected',
      payload: {
        ruleId: 'responsibility-chain',
        avoidance: 'dump',
        requiredCost: 2,
        remaining: 1,
        reason: 'insufficient-permissions',
      },
    });
    expect(rules.remaining).toBe(1);
  });

  it('rejects unknown rules and avoidances atomically', () => {
    const rules = new RuleSystem(5);

    expect(() => rules.use('unknown' as RuleId, 'dump')).toThrow('unknown rule');
    expect(rules.remaining).toBe(5);
    expect(() => rules.use('original-request', 'unknown' as AvoidanceType)).toThrow(
      'unknown avoidance',
    );
    expect(rules.remaining).toBe(5);
  });

  it('clamps valid restored balances and rejects invalid values atomically', () => {
    const rules = new RuleSystem();

    rules.restore(-4);
    expect(rules.remaining).toBe(0);
    rules.restore(99);
    expect(rules.remaining).toBe(5);
    rules.restore(3);
    expect(rules.remaining).toBe(3);

    for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, 1.5, '3', null]) {
      expect(() => rules.restore(invalid as number)).toThrow('invalid permissions');
      expect(rules.remaining).toBe(3);
    }
  });

  it('enforces the same permission invariant at construction', () => {
    expect(new RuleSystem(-1).remaining).toBe(0);
    expect(new RuleSystem(9).remaining).toBe(5);
    expect(() => new RuleSystem(Number.NaN)).toThrow('invalid permissions');
    expect(() => new RuleSystem(2.5)).toThrow('invalid permissions');
  });
});
