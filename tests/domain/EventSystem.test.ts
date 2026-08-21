import { describe, expect, it } from 'vitest';
import {
  EVENT_DEFINITIONS,
  type EventDefinition,
} from '../../assets/scripts/domain/content/events';
import { EventSystem } from '../../assets/scripts/domain/EventSystem';
import type { RandomSource } from '../../assets/scripts/domain/model';
import { StubRandom } from '../helpers/StubRandom';

function system(values: readonly number[] = []): EventSystem {
  return new EventSystem(new StubRandom(values), EVENT_DEFINITIONS);
}

function activate(eventId: string, atMs = 1_000): EventSystem {
  const events = system();
  events.activate(eventId, atMs);
  return events;
}

const BASE_MODIFIERS = Object.freeze({
  bossWorkSpeed: 1,
  employeeWorkSpeed: 1,
  avoidanceChanceMultiplier: 1,
  trustGainMultiplier: 1,
  conditionalAvoidanceChanceMultipliers: [],
});

describe('event content', () => {
  it('contains the exact six unique, deeply frozen definitions and effects', () => {
    expect(EVENT_DEFINITIONS.map((event) => ({
      id: event.id,
      durationMs: event.durationMs,
      effects: event.effects,
      choiceDurationMs: event.choiceDurationMs,
    }))).toEqual([
      {
        id: 'board-observer',
        durationMs: 30_000,
        effects: [
          { type: 'boss-work-speed', multiplier: 1.3 },
          { type: 'avoidance-chance', multiplier: 0.2 },
        ],
        choiceDurationMs: undefined,
      },
      {
        id: 'vip-visit',
        durationMs: 0,
        effects: [{ type: 'request-task-offer', definitionId: 'sales-complaint' }],
        choiceDurationMs: undefined,
      },
      {
        id: 'secretary-help',
        durationMs: 20_000,
        effects: [
          { type: 'boss-work-speed', multiplier: 1.2 },
          { type: 'trust-gain', multiplier: 0.8 },
        ],
        choiceDurationMs: 5_000,
      },
      {
        id: 'team-building',
        durationMs: 25_000,
        effects: [{ type: 'employee-work-speed', multiplier: 0.7 }],
        choiceDurationMs: undefined,
      },
      {
        id: 'golf-invite',
        durationMs: 20_000,
        effects: [{ type: 'avoidance-chance', multiplier: 1.5, minMinuteOfDay: 990 }],
        choiceDurationMs: undefined,
      },
      {
        id: 'coffee-broken',
        durationMs: 8_000,
        effects: [{ type: 'boss-work-speed', multiplier: 0 }],
        choiceDurationMs: undefined,
      },
    ]);
    expect(new Set(EVENT_DEFINITIONS.map((event) => event.id)).size).toBe(6);
    expect(Object.isFrozen(EVENT_DEFINITIONS)).toBe(true);
    for (const definition of EVENT_DEFINITIONS) {
      expect(Object.isFrozen(definition)).toBe(true);
      expect(Object.isFrozen(definition.effects)).toBe(true);
      for (const effect of definition.effects) expect(Object.isFrozen(effect)).toBe(true);
    }
  });
});

describe('EventSystem draws and activation', () => {
  it('draws deterministically without replacement and rejects overdraw atomically', () => {
    const events = system([0, 0.999]);
    expect(events.draw(2)).toEqual(['board-observer', 'coffee-broken']);
    expect(() => events.draw(7)).toThrow('available');
    expect(events.snapshot()).toEqual({ activeEvents: [], usedEventIds: [] });
  });

  it('does not reserve draws, but only allows one actual activation per session', () => {
    const events = system([0, 0, 0, 0, 0, 0, 0]);
    expect(events.draw(1)).toEqual(['board-observer']);
    expect(events.draw(1)).toEqual(['board-observer']);
    expect(events.activate('board-observer', 100)).toHaveLength(1);
    expect(() => events.activate('board-observer', 101)).toThrow('already used');
    expect(events.draw(5)).not.toContain('board-observer');
  });

  it('marks the instant VIP event used and requests the exact task without making it active', () => {
    const events = system();
    expect(events.activate('vip-visit', 1_000)).toEqual([
      {
        type: 'event-task-offer-requested',
        payload: { eventId: 'vip-visit', definitionId: 'sales-complaint' },
      },
    ]);
    expect(events.snapshot()).toEqual({ activeEvents: [], usedEventIds: ['vip-visit'] });
    expect(events.modifiers()).toEqual(BASE_MODIFIERS);
  });

  it('validates primitive inputs, time monotonicity, count, and random indices atomically', () => {
    const badRandoms: RandomSource[] = [
      { next: () => 0, int: () => -1 },
      { next: () => 0, int: () => 0.5 },
      { next: () => 0, int: () => Number.NaN },
    ];
    for (const random of badRandoms) {
      const events = new EventSystem(random, EVENT_DEFINITIONS);
      expect(() => events.draw(1)).toThrow('random');
      expect(events.snapshot()).toEqual({ activeEvents: [], usedEventIds: [] });
    }

    const events = system();
    for (const invalidCount of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => events.draw(invalidCount)).toThrow('count');
    }
    let calls = 0;
    const coercible = { toString: () => { calls += 1; return 'board-observer'; } };
    expect(() => events.activate(coercible as never, 0)).toThrow('event ID');
    expect(() => events.activate('board-observer', Number.NaN)).toThrow('time');
    expect(calls).toBe(0);

    events.activate('board-observer', 10);
    const before = events.snapshot();
    expect(() => events.tick(9)).toThrow('monotonic');
    expect(events.snapshot()).toEqual(before);
  });
});

describe('EventSystem modifiers and time', () => {
  it('multiplies simultaneous effects, keeps golf conditional, and restores coffee composition', () => {
    const events = system();
    events.activate('board-observer', 1_000);
    events.activate('golf-invite', 1_000);
    events.activate('coffee-broken', 1_000);

    expect(events.modifiers()).toEqual({
      bossWorkSpeed: 0,
      employeeWorkSpeed: 1,
      avoidanceChanceMultiplier: 0.2,
      trustGainMultiplier: 1,
      conditionalAvoidanceChanceMultipliers: [
        { sourceEventId: 'golf-invite', minMinuteOfDay: 990, multiplier: 1.5 },
      ],
    });
    expect(events.tick(9_000).map((event) => event.payload.eventId)).toEqual(['coffee-broken']);
    expect(events.modifiers().bossWorkSpeed).toBe(1.3);
    expect(events.tick(21_000).map((event) => event.payload.eventId)).toEqual(['golf-invite']);
    expect(events.modifiers().avoidanceChanceMultiplier).toBe(0.2);
    expect(events.tick(31_000).map((event) => event.payload.eventId)).toEqual(['board-observer']);
    expect(events.modifiers()).toEqual(BASE_MODIFIERS);
  });

  it('uses exact expiry boundaries and orders large-step expiries chronologically', () => {
    const events = system();
    events.activate('team-building', 0);
    events.activate('coffee-broken', 0);
    expect(events.tick(7_999)).toEqual([]);
    expect(events.tick(8_000)[0].payload).toEqual({ eventId: 'coffee-broken', expiredAtMs: 8_000 });
    expect(events.tick(25_000)[0].payload).toEqual({ eventId: 'team-building', expiredAtMs: 25_000 });
  });

  it('uses definition order to break equal expiry times deterministically', () => {
    const events = new EventSystem(new StubRandom([]), [
      EVENT_DEFINITIONS[3],
      EVENT_DEFINITIONS[0],
    ]);
    events.activate('board-observer', 0);
    events.activate('team-building', 5_000);
    expect(events.tick(30_000).map((event) => event.payload.eventId)).toEqual([
      'team-building',
      'board-observer',
    ]);
  });
});

describe('secretary choice lifecycle', () => {
  it('holds modifiers pending, rejects another activation, and applies ignore for 20 seconds', () => {
    const events = system();
    expect(events.activate('secretary-help', 1_000)[0].type).toBe('event-choice-pending');
    expect(events.modifiers()).toEqual(BASE_MODIFIERS);
    const before = events.snapshot();
    expect(() => events.activate('board-observer', 2_000)).toThrow('pending');
    expect(events.snapshot()).toEqual(before);

    expect(events.choose('secretary-help', 'ignore', 2_000).map((event) => event.type)).toEqual([
      'event-choice-resolved',
      'event-activated',
    ]);
    expect(events.modifiers()).toMatchObject({ bossWorkSpeed: 1.2, trustGainMultiplier: 0.8 });
    expect(events.tick(21_999)).toEqual([]);
    expect(events.tick(22_000)[0].type).toBe('event-expired');
  });

  it('closes report without a modifier and validates pending choice atomically', () => {
    const events = system();
    events.activate('secretary-help', 1_000);
    const before = events.snapshot();
    expect(() => events.choose('not-secretary', 'ignore', 2_000)).toThrow('pending choice');
    expect(() => events.choose('secretary-help', 'later' as never, 2_000)).toThrow('choice');
    expect(events.snapshot()).toEqual(before);
    expect(events.choose('secretary-help', 'report', 2_000)).toEqual([
      {
        type: 'event-choice-resolved',
        payload: { eventId: 'secretary-help', choice: 'report', automatic: false, resolvedAtMs: 2_000 },
      },
    ]);
    expect(events.modifiers()).toEqual(BASE_MODIFIERS);
  });

  it('auto-ignores at exactly five seconds and consumes a large tick chronologically', () => {
    const events = system();
    events.activate('secretary-help', 1_000);
    expect(events.tick(5_999)).toEqual([]);
    const started = events.tick(6_000);
    expect(started.map((event) => event.type)).toEqual(['event-choice-resolved', 'event-activated']);
    expect(started[0].payload).toMatchObject({ choice: 'ignore', automatic: true, resolvedAtMs: 6_000 });

    const large = system();
    large.activate('secretary-help', 1_000);
    expect(large.tick(26_000).map((event) => event.type)).toEqual([
      'event-choice-resolved',
      'event-activated',
      'event-expired',
    ]);
    expect(large.modifiers()).toEqual(BASE_MODIFIERS);
  });

  it('gives timeout precedence over a player report submitted at the exact deadline', () => {
    const events = system();
    events.activate('secretary-help', 1_000);
    expect(events.choose('secretary-help', 'report', 6_000).map((event) => event.type)).toEqual([
      'event-choice-resolved',
      'event-activated',
    ]);
    expect(events.modifiers()).toMatchObject({ bossWorkSpeed: 1.2, trustGainMultiplier: 0.8 });
  });
});

describe('EventSystem snapshots and configuration validation', () => {
  it('round-trips frozen detached state and anchors restored pending time on first tick', () => {
    const original = system();
    original.activate('board-observer', 1_000);
    original.activate('secretary-help', 1_000);
    original.tick(3_000);
    const saved = original.snapshot();
    expect(saved.pendingEventChoice).toEqual({ id: 'secretary-help', remainingMs: 3_000 });
    expect(Object.isFrozen(saved)).toBe(true);
    expect(Object.isFrozen(saved.activeEvents)).toBe(true);
    expect(Object.isFrozen(saved.usedEventIds)).toBe(true);
    expect(Object.isFrozen(saved.pendingEventChoice)).toBe(true);

    const restored = system();
    restored.restore(saved);
    expect(restored.snapshot()).toEqual(saved);
    expect(restored.tick(50_000).map((event) => event.type)).toEqual(['event-expired']);
    expect(restored.snapshot().pendingEventChoice).toEqual({ id: 'secretary-help', remainingMs: 3_000 });
    expect(restored.tick(52_999)).toEqual([]);
    expect(restored.tick(53_000).map((event) => event.type)).toEqual([
      'event-choice-resolved',
      'event-activated',
    ]);
  });

  it('rejects malformed and impossible restores atomically and prevents reuse after restore', () => {
    const events = activate('board-observer', 1_000);
    const saved = events.snapshot();
    const invalidSnapshots: unknown[] = [
      null,
      { activeEvents: [], usedEventIds: 'board-observer' },
      { activeEvents: [{ id: 'unknown', expiresAtMs: 2_000 }], usedEventIds: ['unknown'] },
      { activeEvents: [{ id: 'vip-visit', expiresAtMs: 2_000 }], usedEventIds: ['vip-visit'] },
      { activeEvents: [{ id: 'board-observer', expiresAtMs: Number.NaN }], usedEventIds: ['board-observer'] },
      { activeEvents: [{ id: 'board-observer', expiresAtMs: 2_000 }], usedEventIds: [] },
      {
        activeEvents: [
          { id: 'board-observer', expiresAtMs: 2_000 },
          { id: 'board-observer', expiresAtMs: 3_000 },
        ],
        usedEventIds: ['board-observer'],
      },
      { activeEvents: [], usedEventIds: ['board-observer', 'board-observer'] },
      { activeEvents: [], usedEventIds: ['unknown'] },
      {
        activeEvents: [],
        usedEventIds: ['secretary-help'],
        pendingEventChoice: { id: 'secretary-help', remainingMs: 5_001 },
      },
      {
        activeEvents: [{ id: 'secretary-help', expiresAtMs: 20_000 }],
        usedEventIds: ['secretary-help'],
        pendingEventChoice: { id: 'secretary-help', remainingMs: 1_000 },
      },
    ];
    for (const invalid of invalidSnapshots) {
      expect(() => events.restore(invalid as never)).toThrow('event snapshot');
      expect(events.snapshot()).toEqual(saved);
    }

    const restored = system();
    restored.restore(saved);
    expect(() => restored.activate('board-observer', 1_001)).toThrow('already used');
  });

  it('rejects accessor TOCTOU snapshots and unknown top-level fields atomically', () => {
    const events = activate('board-observer', 1_000);
    const saved = events.snapshot();

    let expiryReads = 0;
    const active = { id: 'board-observer' } as Record<string, unknown>;
    Object.defineProperty(active, 'expiresAtMs', {
      enumerable: true,
      get() {
        expiryReads += 1;
        return expiryReads === 1 ? 2_000 : Number.POSITIVE_INFINITY;
      },
    });

    let remainingReads = 0;
    const pending = { id: 'secretary-help' } as Record<string, unknown>;
    Object.defineProperty(pending, 'remainingMs', {
      enumerable: true,
      get() {
        remainingReads += 1;
        return remainingReads <= 2 ? 1_000 : Number.POSITIVE_INFINITY;
      },
    });

    for (const invalid of [
      { activeEvents: [active], usedEventIds: ['board-observer'] },
      { activeEvents: [], usedEventIds: ['secretary-help'], pendingEventChoice: pending },
      { activeEvents: [], usedEventIds: [], extra: true },
      { activeEvents: [{ id: 'board-observer', expiresAtMs: 2_000, extra: true }], usedEventIds: ['board-observer'] },
      { activeEvents: [], usedEventIds: [], [Symbol('extra')]: true },
    ]) {
      expect(() => events.restore(invalid as never)).toThrow('event snapshot');
      expect(events.snapshot()).toEqual(saved);
    }
    expect(expiryReads).toBe(0);
    expect(remainingReads).toBe(0);
  });

  it('round-trips a custom secretary choice duration from its validated definitions', () => {
    const custom = EVENT_DEFINITIONS.map((definition) => (
      definition.id === 'secretary-help'
        ? { ...definition, choiceDurationMs: 6_000 }
        : definition
    ));
    const original = new EventSystem(new StubRandom([]), custom);
    original.activate('secretary-help', 1_000);
    const saved = original.snapshot();
    expect(saved.pendingEventChoice).toEqual({ id: 'secretary-help', remainingMs: 6_000 });

    const restored = new EventSystem(new StubRandom([]), custom);
    expect(() => restored.restore(saved)).not.toThrow();
    expect(restored.snapshot()).toEqual(saved);
    expect(() => restored.restore({
      activeEvents: [],
      usedEventIds: ['secretary-help'],
      pendingEventChoice: { id: 'secretary-help', remainingMs: 6_001 },
    })).toThrow('event snapshot');
  });

  it('clones definitions and rejects duplicates, missing fields, and unknown effects', () => {
    const mutable = EVENT_DEFINITIONS.map((definition) => ({
      ...definition,
      effects: definition.effects.map((effect) => ({ ...effect })),
    })) as EventDefinition[];
    const events = new EventSystem(new StubRandom([]), mutable);
    mutable[0].durationMs = 1;
    mutable[0].effects[0] = { type: 'boss-work-speed', multiplier: 9 };
    events.activate('board-observer', 0);
    expect(events.snapshot().activeEvents[0].expiresAtMs).toBe(30_000);
    expect(events.modifiers().bossWorkSpeed).toBe(1.3);

    const board = EVENT_DEFINITIONS[0];
    for (const invalid of [
      [{ ...board }, { ...board }],
      [{ id: 'board-observer', effects: board.effects }],
      [{ ...board, effects: [{ type: 'mystery', multiplier: 1 }] }],
    ]) {
      expect(() => new EventSystem(new StubRandom([]), invalid as never)).toThrow('event definition');
    }
  });

  it('rejects definition/effect/array accessors before reading or retaining them', () => {
    let durationReads = 0;
    const durationAccessor = {
      id: 'board-observer',
      effects: EVENT_DEFINITIONS[0].effects,
    } as Record<string, unknown>;
    Object.defineProperty(durationAccessor, 'durationMs', {
      enumerable: true,
      get() {
        durationReads += 1;
        return durationReads === 1 ? 30_000 : Number.POSITIVE_INFINITY;
      },
    });

    let multiplierReads = 0;
    const multiplierAccessor = { type: 'boss-work-speed' } as Record<string, unknown>;
    Object.defineProperty(multiplierAccessor, 'multiplier', {
      enumerable: true,
      get() {
        multiplierReads += 1;
        return multiplierReads <= 3 ? 1.3 : Number.POSITIVE_INFINITY;
      },
    });

    let definitionIndexReads = 0;
    const accessorDefinitions: EventDefinition[] = [];
    Object.defineProperty(accessorDefinitions, '0', {
      enumerable: true,
      configurable: true,
      get() {
        definitionIndexReads += 1;
        return EVENT_DEFINITIONS[0];
      },
    });
    Object.defineProperty(accessorDefinitions, 'length', { value: 1, writable: true });

    let effectIndexReads = 0;
    const accessorEffects: unknown[] = [];
    Object.defineProperty(accessorEffects, '0', {
      enumerable: true,
      configurable: true,
      get() {
        effectIndexReads += 1;
        return EVENT_DEFINITIONS[0].effects[0];
      },
    });
    Object.defineProperty(accessorEffects, 'length', { value: 1, writable: true });

    for (const invalid of [
      [durationAccessor],
      [{ ...EVENT_DEFINITIONS[0], effects: [multiplierAccessor] }],
      accessorDefinitions,
      [{ ...EVENT_DEFINITIONS[0], effects: accessorEffects }],
    ]) {
      expect(() => new EventSystem(new StubRandom([]), invalid as never)).toThrow('event definition');
    }
    expect(durationReads).toBe(0);
    expect(multiplierReads).toBe(0);
    expect(definitionIndexReads).toBe(0);
    expect(effectIndexReads).toBe(0);
  });

  it('rejects per-event and concurrent modifier products that can overflow', () => {
    const overflowingAvoidance = [{
      ...EVENT_DEFINITIONS[0],
      effects: [
        { type: 'avoidance-chance', multiplier: 1e200 },
        { type: 'avoidance-chance', multiplier: 1e200, minMinuteOfDay: 990 },
      ],
    }];
    expect(() => new EventSystem(new StubRandom([]), overflowingAvoidance as never))
      .toThrow('event definition');

    const overflowingConcurrentBossSpeed = EVENT_DEFINITIONS
      .filter((definition) => (
        definition.id === 'board-observer'
        || definition.id === 'secretary-help'
        || definition.id === 'coffee-broken'
      ))
      .map((definition) => {
        if (definition.id === 'coffee-broken') return definition;
        return {
          ...definition,
          effects: [{ type: 'boss-work-speed', multiplier: 1e200 }],
        };
      });
    expect(() => new EventSystem(new StubRandom([]), overflowingConcurrentBossSpeed as never))
      .toThrow('event definition');
  });

  it('does not let zero multipliers mask overflowing scalar or conditional channels', () => {
    const maskedConditionalAvoidance = [{
      ...EVENT_DEFINITIONS[0],
      effects: [
        { type: 'avoidance-chance', multiplier: 0 },
        { type: 'avoidance-chance', multiplier: 1e200, minMinuteOfDay: 900 },
        { type: 'avoidance-chance', multiplier: 1e200, minMinuteOfDay: 990 },
      ],
    }];
    expect(() => new EventSystem(new StubRandom([]), maskedConditionalAvoidance as never))
      .toThrow('event definition');

    const maskedBossSpeed = [{
      ...EVENT_DEFINITIONS[0],
      effects: [
        { type: 'boss-work-speed', multiplier: 1e200 },
        { type: 'boss-work-speed', multiplier: 1e200 },
        { type: 'boss-work-speed', multiplier: 0 },
      ],
    }];
    expect(() => new EventSystem(new StubRandom([]), maskedBossSpeed as never))
      .toThrow('event definition');
  });

  it('rejects unrepresentable activation expiries before any state or used-ID mutation', () => {
    const ordinary = system();
    const ordinaryBefore = ordinary.snapshot();
    expect(() => ordinary.activate('board-observer', Number.MAX_VALUE)).toThrow('expiry');
    expect(ordinary.snapshot()).toEqual(ordinaryBefore);

    const secretary = system();
    const secretaryBefore = secretary.snapshot();
    expect(() => secretary.activate('secretary-help', Number.MAX_VALUE)).toThrow('expiry');
    expect(secretary.snapshot()).toEqual(secretaryBefore);
  });

  it('keeps restored pending state and time anchor atomic when expiry arithmetic fails', () => {
    const longSecretary = EVENT_DEFINITIONS.map((definition) => (
      definition.id === 'secretary-help'
        ? { ...definition, durationMs: Number.MAX_SAFE_INTEGER }
        : definition
    ));
    const pendingZero = {
      activeEvents: [],
      usedEventIds: ['secretary-help'],
      pendingEventChoice: { id: 'secretary-help' as const, remainingMs: 0 },
    };

    const choosing = new EventSystem(new StubRandom([]), longSecretary);
    choosing.restore(pendingZero);
    const chooseBefore = choosing.snapshot();
    expect(() => choosing.choose('secretary-help', 'ignore', Number.MAX_VALUE / 2))
      .toThrow('expiry');
    expect(choosing.snapshot()).toEqual(chooseBefore);
    expect(() => choosing.choose('secretary-help', 'ignore', 0)).not.toThrow();

    const ticking = new EventSystem(new StubRandom([]), longSecretary);
    ticking.restore(pendingZero);
    const tickBefore = ticking.snapshot();
    expect(() => ticking.tick(Number.MAX_VALUE / 2)).toThrow('expiry');
    expect(ticking.snapshot()).toEqual(tickBefore);
    expect(() => ticking.tick(0)).not.toThrow();

    const binding = system();
    binding.restore({
      activeEvents: [],
      usedEventIds: ['secretary-help'],
      pendingEventChoice: { id: 'secretary-help', remainingMs: 1 },
    });
    const bindingBefore = binding.snapshot();
    expect(() => binding.tick(Number.MAX_VALUE)).toThrow('expiry');
    expect(binding.snapshot()).toEqual(bindingBefore);
    expect(() => binding.tick(0)).not.toThrow();
  });

  it('returns frozen detached modifier and event values', () => {
    const events = system();
    const activated = events.activate('golf-invite', 0);
    const modifiers = events.modifiers();
    expect(Object.isFrozen(activated)).toBe(true);
    expect(Object.isFrozen(activated[0])).toBe(true);
    expect(Object.isFrozen(activated[0].payload)).toBe(true);
    expect(Object.isFrozen(modifiers)).toBe(true);
    expect(Object.isFrozen(modifiers.conditionalAvoidanceChanceMultipliers)).toBe(true);
    expect(Object.isFrozen(modifiers.conditionalAvoidanceChanceMultipliers[0])).toBe(true);
  });
});
