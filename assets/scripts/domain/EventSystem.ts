import type { DomainEvent, GameSnapshot, RandomSource } from './model';
import type {
  EventDefinition,
  EventEffect,
  EventId,
} from './content/events';

const EVENT_IDS: ReadonlySet<string> = new Set([
  'board-observer',
  'vip-visit',
  'secretary-help',
  'team-building',
  'golf-invite',
  'coffee-broken',
]);
const CHOICES: ReadonlySet<string> = new Set(['ignore', 'report']);
const EMPTY_EVENTS = Object.freeze([]) as unknown as DomainEvent[];

interface ActiveEvent {
  readonly id: EventId;
  readonly expiresAtMs: number;
}

interface PendingChoice {
  readonly id: 'secretary-help';
  remainingMs: number;
  expiresAtMs?: number;
}

export interface ConditionalAvoidanceChanceMultiplier {
  readonly sourceEventId: EventId;
  readonly minMinuteOfDay: number;
  readonly multiplier: number;
}

export interface EventModifiers {
  readonly bossWorkSpeed: number;
  readonly employeeWorkSpeed: number;
  readonly avoidanceChanceMultiplier: number;
  readonly trustGainMultiplier: number;
  readonly conditionalAvoidanceChanceMultipliers:
    readonly ConditionalAvoidanceChanceMultiplier[];
}

export interface EventSystemSnapshot {
  readonly activeEvents: GameSnapshot['activeEvents'];
  readonly usedEventIds: GameSnapshot['usedEventIds'];
  readonly pendingEventChoice?: GameSnapshot['pendingEventChoice'];
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNonnegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isPrimitiveNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function invalidDefinition(): never {
  throw new Error('invalid event definition');
}

type ModifierCategory =
  | 'boss-work-speed'
  | 'employee-work-speed'
  | 'avoidance-chance'
  | 'trust-gain';

const MODIFIER_CATEGORIES = Object.freeze([
  'boss-work-speed',
  'employee-work-speed',
  'avoidance-chance',
  'trust-gain',
] as const);

function multiplyFiniteModifier(left: number, right: number, definitionError: boolean): number {
  if (left === 0 || right === 0) return 0;
  const product = left * right;
  if (!Number.isFinite(product) || product < 0) {
    if (definitionError) invalidDefinition();
    throw new Error('invalid internal event modifier product');
  }
  return product;
}

function definitionCategoryFactor(
  definition: EventDefinition,
  category: ModifierCategory,
  avoidanceChannel: 'all' | 'unconditional' | 'conditional' = 'all',
): number {
  const multipliers: number[] = [];
  for (const effect of definition.effects) {
    if (effect.type !== category || effect.multiplier <= 1) continue;
    if (category === 'avoidance-chance' && effect.type === 'avoidance-chance') {
      const conditional = effect.minMinuteOfDay !== undefined;
      if (
        (avoidanceChannel === 'unconditional' && conditional)
        || (avoidanceChannel === 'conditional' && !conditional)
      ) continue;
    }
    multipliers.push(effect.multiplier);
  }
  return multipliers.reduce(
    (product, multiplier) => multiplyFiniteModifier(product, multiplier, true),
    1,
  );
}

function maximumGrowthProduct(
  definitions: readonly EventDefinition[],
  category: ModifierCategory,
  avoidanceChannel: 'all' | 'unconditional' | 'conditional' = 'all',
): number {
  let maximumConcurrentProduct = 1;
  for (const definition of definitions) {
    const groupFactor = definitionCategoryFactor(definition, category, avoidanceChannel);
    if (groupFactor > 1) {
      maximumConcurrentProduct = multiplyFiniteModifier(
        maximumConcurrentProduct,
        groupFactor,
        true,
      );
    }
  }
  return maximumConcurrentProduct;
}

function validateModifierProducts(definitions: readonly EventDefinition[]): void {
  for (const category of MODIFIER_CATEGORIES) {
    if (category !== 'avoidance-chance') {
      maximumGrowthProduct(definitions, category);
    }
  }
  const unconditionalAvoidance = maximumGrowthProduct(
    definitions,
    'avoidance-chance',
    'unconditional',
  );
  const conditionalAvoidance = maximumGrowthProduct(
    definitions,
    'avoidance-chance',
    'conditional',
  );
  multiplyFiniteModifier(unconditionalAvoidance, conditionalAvoidance, true);
}

function checkedExpiry(nowMs: number, durationMs: number): number {
  const expiresAtMs = nowMs + durationMs;
  if (
    !Number.isFinite(expiresAtMs)
    || expiresAtMs < 0
    || (durationMs > 0 && expiresAtMs <= nowMs)
  ) {
    throw new Error('event expiry is not representable');
  }
  return expiresAtMs;
}

function readOwnDataRecord(
  value: unknown,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[],
  invalid: () => never,
): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const descriptorKeys = Reflect.ownKeys(descriptors);
  const allowed = new Set(allowedKeys);
  if (
    descriptorKeys.some((key) => typeof key !== 'string' || !allowed.has(key))
    || requiredKeys.some((key) => !Object.prototype.hasOwnProperty.call(descriptors, key))
  ) invalid();

  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of descriptorKeys) {
    if (typeof key !== 'string') invalid();
    const descriptor = descriptors[key];
    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) invalid();
    result[key] = descriptor.value;
  }
  return result;
}

function readOwnDataArray(value: unknown, invalid: () => never): readonly unknown[] {
  if (!Array.isArray(value)) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<
    PropertyKey,
    PropertyDescriptor
  >;
  const lengthDescriptor = descriptors.length;
  if (
    lengthDescriptor === undefined
    || !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value')
    || !Number.isSafeInteger(lengthDescriptor.value)
    || lengthDescriptor.value < 0
  ) invalid();
  const length = lengthDescriptor.value as number;
  const descriptorKeys = Reflect.ownKeys(descriptors);
  if (descriptorKeys.some((key) => {
    if (key === 'length') return false;
    if (typeof key !== 'string') return true;
    const index = Number(key);
    return !Number.isSafeInteger(index) || index < 0 || index >= length || String(index) !== key;
  })) invalid();

  const result: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (
      descriptor === undefined
      || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
    ) invalid();
    result.push(descriptor.value);
  }
  return result;
}

function cloneEffect(value: unknown): EventEffect {
  const candidate = readOwnDataRecord(
    value,
    ['type', 'multiplier', 'minMinuteOfDay', 'definitionId'],
    ['type'],
    invalidDefinition,
  );
  if (typeof candidate.type !== 'string') invalidDefinition();

  if (candidate.type === 'request-task-offer') {
    if (
      Reflect.ownKeys(candidate).some((key) => key !== 'type' && key !== 'definitionId')
      || !isPrimitiveNonEmptyString(candidate.definitionId)
    ) invalidDefinition();
    return Object.freeze({ type: candidate.type, definitionId: candidate.definitionId });
  }

  if (
    candidate.type !== 'boss-work-speed'
    && candidate.type !== 'employee-work-speed'
    && candidate.type !== 'avoidance-chance'
    && candidate.type !== 'trust-gain'
  ) invalidDefinition();
  if (
    typeof candidate.multiplier !== 'number'
    || !Number.isFinite(candidate.multiplier)
    || candidate.multiplier < 0
  ) invalidDefinition();

  if (candidate.type === 'avoidance-chance') {
    if (Reflect.ownKeys(candidate).some(
      (key) => key !== 'type' && key !== 'multiplier' && key !== 'minMinuteOfDay',
    )) invalidDefinition();
    const minMinuteOfDay = candidate.minMinuteOfDay;
    if (
      minMinuteOfDay !== undefined
      && (!Number.isSafeInteger(minMinuteOfDay) || (minMinuteOfDay as number) < 0 || (minMinuteOfDay as number) > 1_440)
    ) invalidDefinition();
    return Object.freeze({
      type: candidate.type,
      multiplier: candidate.multiplier,
      ...(minMinuteOfDay === undefined ? {} : { minMinuteOfDay: minMinuteOfDay as number }),
    });
  }

  if (Reflect.ownKeys(candidate).some((key) => key !== 'type' && key !== 'multiplier')) {
    invalidDefinition();
  }
  return Object.freeze({ type: candidate.type, multiplier: candidate.multiplier }) as EventEffect;
}

function cloneDefinitions(definitions: unknown): readonly EventDefinition[] {
  const definitionValues = readOwnDataArray(definitions, invalidDefinition);
  if (definitionValues.length === 0) invalidDefinition();

  const ids = new Set<string>();
  const result: EventDefinition[] = [];
  for (const value of definitionValues) {
    const candidate = readOwnDataRecord(
      value,
      ['id', 'durationMs', 'effects', 'choiceDurationMs'],
      ['id', 'durationMs', 'effects'],
      invalidDefinition,
    );
    if (
      !isPrimitiveNonEmptyString(candidate.id)
      || !EVENT_IDS.has(candidate.id)
      || ids.has(candidate.id)
      || !Number.isSafeInteger(candidate.durationMs)
      || (candidate.durationMs as number) < 0
    ) invalidDefinition();

    const id = candidate.id as EventId;
    const durationMs = candidate.durationMs as number;
    const effectValues = readOwnDataArray(candidate.effects, invalidDefinition);
    if (effectValues.length === 0) invalidDefinition();
    const effects = Object.freeze(effectValues.map(cloneEffect));
    const choiceDurationMs = candidate.choiceDurationMs;
    const hasRequestEffect = effects.some((effect) => effect.type === 'request-task-offer');

    if (id === 'vip-visit') {
      if (
        durationMs !== 0
        || choiceDurationMs !== undefined
        || effects.length !== 1
        || !hasRequestEffect
      ) invalidDefinition();
    } else if (id === 'secretary-help') {
      if (
        durationMs <= 0
        || !Number.isSafeInteger(choiceDurationMs)
        || (choiceDurationMs as number) <= 0
        || hasRequestEffect
      ) invalidDefinition();
    } else if (durationMs <= 0 || choiceDurationMs !== undefined || hasRequestEffect) {
      invalidDefinition();
    }

    ids.add(id);
    result.push(Object.freeze({
      id,
      durationMs,
      effects,
      ...(choiceDurationMs === undefined ? {} : { choiceDurationMs: choiceDurationMs as number }),
    }));
  }
  validateModifierProducts(result);
  return Object.freeze(result);
}

function domainEvent(type: string, payload: Record<string, unknown>): DomainEvent {
  return Object.freeze({ type, payload: Object.freeze({ ...payload }) });
}

function freezeEvents(events: DomainEvent[]): DomainEvent[] {
  return events.length === 0
    ? EMPTY_EVENTS
    : Object.freeze(events) as unknown as DomainEvent[];
}

function validateNow(nowMs: unknown): asserts nowMs is number {
  if (!isFiniteNonnegativeNumber(nowMs)) throw new Error('invalid event time');
}

function invalidSnapshot(): never {
  throw new Error('invalid event snapshot');
}

export class EventSystem {
  private readonly definitions: readonly EventDefinition[];
  private readonly definitionsById: ReadonlyMap<EventId, EventDefinition>;
  private readonly definitionOrder: ReadonlyMap<EventId, number>;
  private activeEvents: ActiveEvent[] = [];
  private usedEventIds = new Set<EventId>();
  private pendingChoice: PendingChoice | undefined;
  private lastNowMs: number | undefined;

  constructor(random: RandomSource, definitions: readonly EventDefinition[]) {
    if (
      typeof random !== 'object'
      || random === null
      || typeof random.next !== 'function'
      || typeof random.int !== 'function'
    ) {
      throw new Error('invalid random source');
    }
    this.random = random;
    this.definitions = cloneDefinitions(definitions);
    this.definitionsById = new Map(this.definitions.map((definition) => [definition.id, definition]));
    this.definitionOrder = new Map(this.definitions.map((definition, index) => [definition.id, index]));
  }

  private readonly random: RandomSource;

  draw(count: number): EventId[] {
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('invalid draw count');
    const candidates = this.definitions
      .filter((definition) => !this.usedEventIds.has(definition.id))
      .map((definition) => definition.id);
    if (count > candidates.length) throw new Error('not enough available events');

    const drawn: EventId[] = [];
    for (let index = 0; index < count; index += 1) {
      const selectedIndex = this.random.int(0, candidates.length);
      if (
        !Number.isSafeInteger(selectedIndex)
        || selectedIndex < 0
        || selectedIndex >= candidates.length
      ) {
        throw new Error('random source returned an invalid event index');
      }
      drawn.push(candidates.splice(selectedIndex, 1)[0]);
    }
    return Object.freeze(drawn) as unknown as EventId[];
  }

  activate(id: string, nowMs: number): DomainEvent[] {
    const definition = this.requireDefinition(id);
    validateNow(nowMs);
    this.requireMonotonic(nowMs);
    if (this.usedEventIds.has(definition.id)) throw new Error('event already used');

    if (this.pendingChoice !== undefined) {
      if (
        this.pendingChoice.expiresAtMs === undefined
        || nowMs < this.pendingChoice.expiresAtMs
      ) {
        throw new Error('an event choice is pending');
      }
    }

    let activationExpiry: number | undefined;
    let choiceExpiry: number | undefined;
    if (definition.id === 'secretary-help') {
      choiceExpiry = checkedExpiry(nowMs, definition.choiceDurationMs!);
    } else if (definition.id !== 'vip-visit') {
      activationExpiry = checkedExpiry(nowMs, definition.durationMs);
    }
    this.validateAdvanceTo(nowMs);
    const events = this.advanceTo(nowMs);
    this.usedEventIds.add(definition.id);

    if (definition.id === 'vip-visit') {
      const request = definition.effects[0];
      if (request.type !== 'request-task-offer') invalidDefinition();
      events.push(domainEvent('event-task-offer-requested', {
        eventId: definition.id,
        definitionId: request.definitionId,
      }));
      return freezeEvents(events);
    }

    if (definition.id === 'secretary-help') {
      const choiceDurationMs = definition.choiceDurationMs!;
      this.pendingChoice = {
        id: definition.id,
        remainingMs: choiceDurationMs,
        expiresAtMs: choiceExpiry!,
      };
      events.push(domainEvent('event-choice-pending', {
        eventId: definition.id,
        expiresAtMs: choiceExpiry!,
        choiceDurationMs,
      }));
      return freezeEvents(events);
    }

    this.startActive(definition, nowMs, events, activationExpiry);
    return freezeEvents(events);
  }

  choose(id: string, choice: 'ignore' | 'report', nowMs: number): DomainEvent[] {
    if (!isPrimitiveNonEmptyString(id) || id !== 'secretary-help') {
      throw new Error('invalid pending choice event ID');
    }
    if (typeof choice !== 'string' || !CHOICES.has(choice)) throw new Error('invalid event choice');
    validateNow(nowMs);
    this.requireMonotonic(nowMs);
    if (this.pendingChoice === undefined || this.pendingChoice.id !== id) {
      throw new Error('no matching pending choice');
    }

    const pendingExpiry = this.pendingChoice.expiresAtMs
      ?? checkedExpiry(nowMs, this.pendingChoice.remainingMs);
    this.validateAdvanceTo(nowMs);
    const explicitIgnoreExpiry = choice === 'ignore' && pendingExpiry > nowMs
      ? checkedExpiry(nowMs, this.definitionsById.get(id)!.durationMs)
      : undefined;
    const events = this.advanceTo(nowMs);
    if (this.pendingChoice === undefined) return freezeEvents(events);

    this.pendingChoice = undefined;
    events.push(domainEvent('event-choice-resolved', {
      eventId: id,
      choice,
      automatic: false,
      resolvedAtMs: nowMs,
    }));
    if (choice === 'ignore') {
      this.startActive(this.definitionsById.get(id)!, nowMs, events, explicitIgnoreExpiry);
    }
    return freezeEvents(events);
  }

  tick(nowMs: number): DomainEvent[] {
    validateNow(nowMs);
    this.requireMonotonic(nowMs);
    this.validateAdvanceTo(nowMs);
    return freezeEvents(this.advanceTo(nowMs));
  }

  modifiers(): Readonly<EventModifiers> {
    let bossWorkSpeed = 1;
    let employeeWorkSpeed = 1;
    let avoidanceChanceMultiplier = 1;
    let trustGainMultiplier = 1;
    const conditional: ConditionalAvoidanceChanceMultiplier[] = [];

    for (const active of this.activeEvents) {
      const definition = this.definitionsById.get(active.id)!;
      for (const effect of definition.effects) {
        switch (effect.type) {
          case 'boss-work-speed':
            bossWorkSpeed = multiplyFiniteModifier(bossWorkSpeed, effect.multiplier, false);
            break;
          case 'employee-work-speed':
            employeeWorkSpeed = multiplyFiniteModifier(employeeWorkSpeed, effect.multiplier, false);
            break;
          case 'trust-gain':
            trustGainMultiplier = multiplyFiniteModifier(
              trustGainMultiplier,
              effect.multiplier,
              false,
            );
            break;
          case 'avoidance-chance':
            if (effect.minMinuteOfDay === undefined) {
              avoidanceChanceMultiplier = multiplyFiniteModifier(
                avoidanceChanceMultiplier,
                effect.multiplier,
                false,
              );
            } else {
              conditional.push(Object.freeze({
                sourceEventId: active.id,
                minMinuteOfDay: effect.minMinuteOfDay,
                multiplier: effect.multiplier,
              }));
            }
            break;
          case 'request-task-offer':
            break;
        }
      }
    }

    return Object.freeze({
      bossWorkSpeed,
      employeeWorkSpeed,
      avoidanceChanceMultiplier,
      trustGainMultiplier,
      conditionalAvoidanceChanceMultipliers: Object.freeze(conditional),
    });
  }

  snapshot(): Readonly<EventSystemSnapshot> {
    const activeEvents = Object.freeze(this.activeEvents.map((active) => Object.freeze({
      id: active.id,
      expiresAtMs: active.expiresAtMs,
    })));
    const usedEventIds = Object.freeze([...this.usedEventIds]);
    const snapshot: {
      activeEvents: typeof activeEvents;
      usedEventIds: typeof usedEventIds;
      pendingEventChoice?: Readonly<{ id: 'secretary-help'; remainingMs: number }>;
    } = { activeEvents, usedEventIds };
    if (this.pendingChoice !== undefined) {
      const remainingMs = this.pendingChoice.expiresAtMs === undefined
        ? this.pendingChoice.remainingMs
        : Math.max(0, this.pendingChoice.expiresAtMs - this.lastNowMs!);
      snapshot.pendingEventChoice = Object.freeze({
        id: this.pendingChoice.id,
        remainingMs,
      });
    }
    return Object.freeze(snapshot);
  }

  restore(snapshot: EventSystemSnapshot): void {
    const snapshotFields = readOwnDataRecord(
      snapshot,
      ['activeEvents', 'usedEventIds', 'pendingEventChoice'],
      ['activeEvents', 'usedEventIds'],
      invalidSnapshot,
    );
    const activeInput = readOwnDataArray(snapshotFields.activeEvents, invalidSnapshot);
    const usedInput = readOwnDataArray(snapshotFields.usedEventIds, invalidSnapshot);
    const pendingInput = snapshotFields.pendingEventChoice;

    const nextUsed = new Set<EventId>();
    for (const id of usedInput) {
      if (
        !isPrimitiveNonEmptyString(id)
        || !this.definitionsById.has(id as EventId)
        || nextUsed.has(id as EventId)
      ) invalidSnapshot();
      nextUsed.add(id as EventId);
    }

    const activeIds = new Set<EventId>();
    const nextActive: ActiveEvent[] = [];
    for (const activeValue of activeInput) {
      const active = readOwnDataRecord(
        activeValue,
        ['id', 'expiresAtMs'],
        ['id', 'expiresAtMs'],
        invalidSnapshot,
      );
      if (
        !isPrimitiveNonEmptyString(active.id)
        || !this.definitionsById.has(active.id as EventId)
        || activeIds.has(active.id as EventId)
        || !isFiniteNonnegativeNumber(active.expiresAtMs)
      ) invalidSnapshot();
      const id = active.id as EventId;
      const definition = this.definitionsById.get(id)!;
      if (definition.durationMs <= 0 || id === 'vip-visit' || !nextUsed.has(id)) invalidSnapshot();
      activeIds.add(id);
      nextActive.push({ id, expiresAtMs: active.expiresAtMs });
    }

    let nextPending: PendingChoice | undefined;
    if (pendingInput !== undefined) {
      const pending = readOwnDataRecord(
        pendingInput,
        ['id', 'remainingMs'],
        ['id', 'remainingMs'],
        invalidSnapshot,
      );
      const maximumRemainingMs = this.definitionsById.get('secretary-help')?.choiceDurationMs;
      if (
        pending.id !== 'secretary-help'
        || !isFiniteNonnegativeNumber(pending.remainingMs)
        || maximumRemainingMs === undefined
        || pending.remainingMs > maximumRemainingMs
        || !nextUsed.has('secretary-help')
        || activeIds.has('secretary-help')
      ) invalidSnapshot();
      nextPending = {
        id: 'secretary-help',
        remainingMs: pending.remainingMs,
      };
    }

    this.activeEvents = nextActive;
    this.usedEventIds = nextUsed;
    this.pendingChoice = nextPending;
    this.lastNowMs = undefined;
  }

  private requireDefinition(id: unknown): EventDefinition {
    if (!isPrimitiveNonEmptyString(id)) throw new Error('invalid event ID');
    const definition = this.definitionsById.get(id as EventId);
    if (definition === undefined) throw new Error('unknown event ID');
    return definition;
  }

  private requireMonotonic(nowMs: number): void {
    if (this.lastNowMs !== undefined && nowMs < this.lastNowMs) {
      throw new Error('event time must be monotonic');
    }
  }

  private startActive(
    definition: EventDefinition,
    activatedAtMs: number,
    events: DomainEvent[],
    precomputedExpiry?: number,
  ): void {
    const expiresAtMs = precomputedExpiry
      ?? checkedExpiry(activatedAtMs, definition.durationMs);
    this.activeEvents.push({ id: definition.id, expiresAtMs });
    events.push(domainEvent('event-activated', {
      eventId: definition.id,
      activatedAtMs,
      expiresAtMs,
    }));
  }

  private advanceTo(nowMs: number): DomainEvent[] {
    const events: DomainEvent[] = [];
    if (this.lastNowMs === undefined) {
      if (this.pendingChoice !== undefined && this.pendingChoice.expiresAtMs === undefined) {
        this.pendingChoice.expiresAtMs = checkedExpiry(nowMs, this.pendingChoice.remainingMs);
      }
      this.lastNowMs = nowMs;
    }

    while (true) {
      let nextActiveExpiry = Number.POSITIVE_INFINITY;
      for (const active of this.activeEvents) {
        if (active.expiresAtMs < nextActiveExpiry) nextActiveExpiry = active.expiresAtMs;
      }
      const pendingExpiry = this.pendingChoice?.expiresAtMs ?? Number.POSITIVE_INFINITY;
      const nextTime = Math.min(nextActiveExpiry, pendingExpiry);
      if (nextTime > nowMs) break;

      if (nextActiveExpiry <= pendingExpiry) {
        const expired = this.activeEvents
          .filter((active) => active.expiresAtMs === nextActiveExpiry)
          .sort((left, right) => (
            this.definitionOrder.get(left.id)! - this.definitionOrder.get(right.id)!
          ));
        const expiredIds = new Set(expired.map((active) => active.id));
        this.activeEvents = this.activeEvents.filter((active) => !expiredIds.has(active.id));
        for (const active of expired) {
          events.push(domainEvent('event-expired', {
            eventId: active.id,
            expiredAtMs: active.expiresAtMs,
          }));
        }
        continue;
      }

      const resolvedAtMs = pendingExpiry;
      this.pendingChoice = undefined;
      events.push(domainEvent('event-choice-resolved', {
        eventId: 'secretary-help',
        choice: 'ignore',
        automatic: true,
        resolvedAtMs,
      }));
      this.startActive(this.definitionsById.get('secretary-help')!, resolvedAtMs, events);
    }

    this.lastNowMs = nowMs;
    if (this.pendingChoice !== undefined && this.pendingChoice.expiresAtMs !== undefined) {
      this.pendingChoice.remainingMs = Math.max(0, this.pendingChoice.expiresAtMs - nowMs);
    }
    return events;
  }

  private validateAdvanceTo(nowMs: number): void {
    if (this.pendingChoice === undefined) return;
    const pendingExpiry = this.pendingChoice.expiresAtMs
      ?? checkedExpiry(nowMs, this.pendingChoice.remainingMs);
    if (pendingExpiry <= nowMs) {
      checkedExpiry(
        pendingExpiry,
        this.definitionsById.get('secretary-help')!.durationMs,
      );
    }
  }
}
