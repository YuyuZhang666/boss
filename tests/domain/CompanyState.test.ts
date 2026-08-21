import { describe, expect, it } from 'vitest';
import { CompanyState } from '../../assets/scripts/domain/CompanyState';

const APPROVED_METERS = Object.freeze({
  company: 70,
  rectification: 0,
  face: 65,
  trust: 50,
});

describe('CompanyState', () => {
  it('starts at the approved values, clamps atomically, and fails at zero company', () => {
    const state = new CompanyState();
    expect(state.snapshot()).toEqual(APPROVED_METERS);

    const events = state.apply({ company: -100, rectification: 120, face: 80, trust: -90 });
    expect(state.snapshot()).toEqual({ company: 0, rectification: 100, face: 100, trust: 0 });
    expect(state.failed).toBe(true);
    expect(events.map((event) => event.payload.key)).toEqual([
      'company',
      'rectification',
      'face',
      'trust',
    ]);
  });

  it('emits one ordered event per effective change and no event for a clamped no-op', () => {
    const state = new CompanyState();
    const events = state.apply({ trust: 7, company: -5, face: 0, rectification: -10 });

    expect(events.map((event) => event.type)).toEqual(['meter-changed', 'meter-changed']);
    expect(events.map((event) => event.payload)).toEqual([
      { key: 'company', previous: 70, current: 65, delta: -5 },
      { key: 'trust', previous: 50, current: 57, delta: 7 },
    ]);
    expect(state.failed).toBe(false);
  });

  it('accepts only a complete finite initial snapshot and clones then clamps it', () => {
    const initial = { company: 110, rectification: -5, face: 42.5, trust: 60 };
    const state = new CompanyState(initial);
    initial.company = 1;
    expect(state.snapshot()).toEqual({ company: 100, rectification: 0, face: 42.5, trust: 60 });

    for (const invalid of [
      null,
      {},
      { company: 1, rectification: 2, face: 3 },
      { company: 1, rectification: 2, face: 3, trust: 4, extra: 5 },
      { company: new Number(1), rectification: 2, face: 3, trust: 4 },
      { company: Number.NaN, rectification: 2, face: 3, trust: 4 },
      { company: Number.POSITIVE_INFINITY, rectification: 2, face: 3, trust: 4 },
    ]) {
      expect(() => new CompanyState(invalid as never)).toThrow('initial meters');
    }
  });

  it('validates the whole delta before mutation without coercion', () => {
    const state = new CompanyState();
    const before = state.snapshot();
    let calls = 0;
    const coercible = {
      valueOf() {
        calls += 1;
        return 5;
      },
    };
    const accessorDelta = {} as Record<string, unknown>;
    Object.defineProperty(accessorDelta, 'company', {
      enumerable: true,
      get() {
        calls += 1;
        return 5;
      },
    });

    for (const invalid of [
      null,
      [],
      { company: 1, unknown: 2 },
      { company: 1, trust: Number.NaN },
      { company: new Number(1) },
      { company: coercible },
      accessorDelta,
      { company: Number.NaN },
      { company: Number.NEGATIVE_INFINITY },
    ]) {
      expect(() => state.apply(invalid as never)).toThrow('meter delta');
      expect(state.snapshot()).toEqual(before);
    }
    expect(calls).toBe(0);
  });

  it('does not invoke boxed/coercible hooks while rejecting initial values', () => {
    let calls = 0;
    const coercible = {
      valueOf() {
        calls += 1;
        return 5;
      },
    };
    expect(() => new CompanyState({
      company: coercible,
      rectification: 0,
      face: 65,
      trust: 50,
    } as never)).toThrow('initial meters');
    expect(calls).toBe(0);
  });

  it('returns detached deeply frozen snapshots and events', () => {
    const state = new CompanyState();
    const snapshot = state.snapshot();
    const events = state.apply({ trust: 1 });

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(snapshot.trust).toBe(50);
    expect(Object.isFrozen(events)).toBe(true);
    expect(Object.isFrozen(events[0])).toBe(true);
    expect(Object.isFrozen(events[0].payload)).toBe(true);
  });
});
