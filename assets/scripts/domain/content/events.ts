export type EventId =
  | 'board-observer'
  | 'vip-visit'
  | 'secretary-help'
  | 'team-building'
  | 'golf-invite'
  | 'coffee-broken';

export type EventEffect =
  | Readonly<{ type: 'boss-work-speed'; multiplier: number }>
  | Readonly<{ type: 'employee-work-speed'; multiplier: number }>
  | Readonly<{ type: 'avoidance-chance'; multiplier: number; minMinuteOfDay?: number }>
  | Readonly<{ type: 'trust-gain'; multiplier: number }>
  | Readonly<{ type: 'request-task-offer'; definitionId: string }>;

export interface EventDefinition {
  readonly id: EventId;
  readonly durationMs: number;
  readonly effects: readonly EventEffect[];
  readonly choiceDurationMs?: number;
}

function effect<T extends EventEffect>(value: T): T {
  return Object.freeze({ ...value });
}

function definition(
  id: EventId,
  durationMs: number,
  effects: readonly EventEffect[],
  choiceDurationMs?: number,
): EventDefinition {
  return Object.freeze({
    id,
    durationMs,
    effects: Object.freeze([...effects]),
    ...(choiceDurationMs === undefined ? {} : { choiceDurationMs }),
  });
}

export const EVENT_DEFINITIONS: readonly EventDefinition[] = Object.freeze([
  definition('board-observer', 30_000, [
    effect({ type: 'boss-work-speed', multiplier: 1.3 }),
    effect({ type: 'avoidance-chance', multiplier: 0.2 }),
  ]),
  definition('vip-visit', 0, [
    effect({ type: 'request-task-offer', definitionId: 'sales-complaint' }),
  ]),
  definition('secretary-help', 20_000, [
    effect({ type: 'boss-work-speed', multiplier: 1.2 }),
    effect({ type: 'trust-gain', multiplier: 0.8 }),
  ], 5_000),
  definition('team-building', 25_000, [
    effect({ type: 'employee-work-speed', multiplier: 0.7 }),
  ]),
  definition('golf-invite', 20_000, [
    effect({ type: 'avoidance-chance', multiplier: 1.5, minMinuteOfDay: 990 }),
  ]),
  definition('coffee-broken', 8_000, [
    effect({ type: 'boss-work-speed', multiplier: 0 }),
  ]),
]);
