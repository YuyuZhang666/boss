import type { AvoidanceType, RuleId } from '../model';

export interface RuleDefinition {
  readonly cost: 1 | 2;
  readonly counters: readonly AvoidanceType[];
}

function definition(cost: 1 | 2, counters: readonly AvoidanceType[]): RuleDefinition {
  return Object.freeze({ cost, counters: Object.freeze([...counters]) });
}

export const RULE_DEFINITIONS: Readonly<Record<RuleId, RuleDefinition>> = Object.freeze({
  'responsibility-chain': definition(2, ['dump']),
  'original-request': definition(1, ['change-request', 'strategic-upgrade']),
  'cost-time-audit': definition(1, ['meeting', 'outsource']),
});
