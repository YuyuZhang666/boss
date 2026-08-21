import type { AvoidanceType, DomainEvent, RuleId } from './model';
import { RULE_DEFINITIONS } from './content/rules';

const MAX_PERMISSIONS = 5;
const AVOIDANCE_TYPES: ReadonlySet<AvoidanceType> = new Set([
  'meeting',
  'dump',
  'outsource',
  'change-request',
  'strategic-upgrade',
]);

export interface RuleUseResult {
  readonly accepted: boolean;
  readonly matched: boolean;
  readonly cost: number;
  readonly events: DomainEvent[];
}

function normalizePermissions(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error('invalid permissions');
  }
  return Math.min(MAX_PERMISSIONS, Math.max(0, value));
}

function event(type: string, payload: Record<string, unknown>): DomainEvent {
  return Object.freeze({
    type,
    payload: Object.freeze({ ...payload }),
  });
}

function result(
  accepted: boolean,
  matched: boolean,
  cost: number,
  events: DomainEvent[],
): RuleUseResult {
  const frozenEvents = Object.freeze(events) as unknown as DomainEvent[];
  return Object.freeze({ accepted, matched, cost, events: frozenEvents });
}

export class RuleSystem {
  private permissions: number;

  constructor(initialPermissions = MAX_PERMISSIONS) {
    this.permissions = normalizePermissions(initialPermissions);
  }

  get remaining(): number {
    return this.permissions;
  }

  use(ruleId: RuleId, avoidance: AvoidanceType): RuleUseResult {
    if (!Object.prototype.hasOwnProperty.call(RULE_DEFINITIONS, ruleId)) {
      throw new Error(`unknown rule: ${String(ruleId)}`);
    }
    if (!AVOIDANCE_TYPES.has(avoidance)) {
      throw new Error(`unknown avoidance: ${String(avoidance)}`);
    }

    const definition = RULE_DEFINITIONS[ruleId];
    if (this.permissions < definition.cost) {
      return result(false, false, 0, [event('rule-rejected', {
        ruleId,
        avoidance,
        requiredCost: definition.cost,
        remaining: this.permissions,
        reason: 'insufficient-permissions',
      })]);
    }

    this.permissions -= definition.cost;
    const matched = definition.counters.includes(avoidance);
    const events = [
      event('rule-used', {
        ruleId,
        avoidance,
        cost: definition.cost,
        remaining: this.permissions,
      }),
      event(matched ? 'avoidance-countered' : 'rule-missed', { ruleId, avoidance }),
    ];
    return result(true, matched, definition.cost, events);
  }

  restore(remaining: number): void {
    const restored = normalizePermissions(remaining);
    this.permissions = restored;
  }
}
