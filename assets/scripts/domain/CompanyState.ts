import type { DomainEvent, MeterKey, MeterSnapshot } from './model';

const METER_KEYS = Object.freeze([
  'company',
  'rectification',
  'face',
  'trust',
] as const);
const METER_KEY_SET: ReadonlySet<string> = new Set(METER_KEYS);
const DEFAULT_METERS: Readonly<MeterSnapshot> = Object.freeze({
  company: 73,
  rectification: 0,
  face: 65,
  trust: 50,
});

function isFinitePrimitiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clampMeter(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function objectKeys(value: object): readonly PropertyKey[] {
  return Reflect.ownKeys(value);
}

function ownDataValue(value: object, key: PropertyKey): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
    throw new Error('invalid meter value');
  }
  return descriptor.value;
}

function parseInitial(initial: unknown): MeterSnapshot {
  if (typeof initial !== 'object' || initial === null || Array.isArray(initial)) {
    throw new Error('invalid initial meters');
  }
  const keys = objectKeys(initial);
  if (
    keys.length !== METER_KEYS.length
    || keys.some((key) => typeof key !== 'string' || !METER_KEY_SET.has(key))
    || METER_KEYS.some((key) => !Object.prototype.hasOwnProperty.call(initial, key))
  ) {
    throw new Error('invalid initial meters');
  }
  const values: Partial<Record<MeterKey, number>> = {};
  for (const key of METER_KEYS) {
    let value: unknown;
    try {
      value = ownDataValue(initial, key);
    } catch {
      throw new Error('invalid initial meters');
    }
    if (!isFinitePrimitiveNumber(value)) throw new Error('invalid initial meters');
    values[key] = value;
  }
  return values as MeterSnapshot;
}

function parseDelta(delta: unknown): Partial<Record<MeterKey, number>> {
  if (typeof delta !== 'object' || delta === null || Array.isArray(delta)) {
    throw new Error('invalid meter delta');
  }
  const values: Partial<Record<MeterKey, number>> = {};
  for (const key of objectKeys(delta)) {
    if (typeof key !== 'string' || !METER_KEY_SET.has(key)) throw new Error('invalid meter delta');
    let value: unknown;
    try {
      value = ownDataValue(delta, key);
    } catch {
      throw new Error('invalid meter delta');
    }
    if (!isFinitePrimitiveNumber(value)) throw new Error('invalid meter delta');
    values[key as MeterKey] = value;
  }
  return values;
}

function meterEvent(
  key: MeterKey,
  previous: number,
  current: number,
): DomainEvent {
  return Object.freeze({
    type: 'meter-changed',
    payload: Object.freeze({ key, previous, current, delta: current - previous }),
  });
}

function freezeEvents(events: DomainEvent[]): DomainEvent[] {
  return Object.freeze(events) as unknown as DomainEvent[];
}

export class CompanyState {
  private meters: MeterSnapshot;

  constructor(initial?: MeterSnapshot) {
    if (initial === undefined) {
      this.meters = { ...DEFAULT_METERS };
      return;
    }
    const values = parseInitial(initial);
    this.meters = {
      company: clampMeter(values.company),
      rectification: clampMeter(values.rectification),
      face: clampMeter(values.face),
      trust: clampMeter(values.trust),
    };
  }

  get failed(): boolean {
    return this.meters.company === 0;
  }

  apply(delta: Partial<Record<MeterKey, number>>): DomainEvent[] {
    const values = parseDelta(delta);

    const next: MeterSnapshot = { ...this.meters };
    const events: DomainEvent[] = [];
    for (const key of METER_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(values, key)) continue;
      const previous = this.meters[key];
      const current = clampMeter(previous + values[key]!);
      next[key] = current;
      if (current !== previous) events.push(meterEvent(key, previous, current));
    }

    this.meters = next;
    return freezeEvents(events);
  }

  snapshot(): Readonly<MeterSnapshot> {
    return Object.freeze({ ...this.meters });
  }
}
