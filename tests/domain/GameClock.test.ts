import { describe, expect, it } from 'vitest';
import { GameClock } from '../../assets/scripts/domain/GameClock';

describe('GameClock', () => {
  it('maps 180 real seconds to 09:00 through 18:00', () => {
    const clock = new GameClock(180_000);

    expect(clock.minuteOfDay).toBe(540);
    expect(clock.finished).toBe(false);
    clock.advance(1_000);
    expect(clock.minuteOfDay).toBe(543);
    clock.advance(178_999);
    expect(clock.minuteOfDay).toBe(1_079);
    expect(clock.finished).toBe(false);
    clock.advance(1);
    expect(clock.minuteOfDay).toBe(1_080);
    expect(clock.finished).toBe(true);
  });

  it('clamps elapsed time and the displayed minute at the end boundary', () => {
    const clock = new GameClock(180_000);

    clock.advance(200_000);
    expect(clock.elapsedRealMs).toBe(180_000);
    expect(clock.minuteOfDay).toBe(1_080);
    expect(clock.finished).toBe(true);
    clock.advance(1_000);
    expect(clock.elapsedRealMs).toBe(180_000);
  });

  it('ignores negative deltas and does not advance until explicitly resumed', () => {
    const clock = new GameClock(180_000);

    clock.advance(-1_000);
    expect(clock.elapsedRealMs).toBe(0);
    clock.pause();
    clock.pause();
    clock.advance(30_000);
    expect(clock.elapsedRealMs).toBe(0);
    clock.resume();
    clock.resume();
    clock.advance(1_000);
    expect(clock.elapsedRealMs).toBe(1_000);
  });

  it('returns immutable value snapshots and restores pause state', () => {
    const clock = new GameClock(180_000);
    clock.advance(60_000);
    clock.pause();

    const snapshot = clock.snapshot();
    expect(snapshot).toEqual({ elapsedRealMs: 60_000, paused: true });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(clock.snapshot()).not.toBe(snapshot);

    const restored = new GameClock(180_000);
    const tamperedSnapshot = {
      elapsedRealMs: 90_000,
      paused: true,
      minuteOfDay: 1_080,
      finished: true,
    };
    restored.restore(tamperedSnapshot);
    expect(restored.elapsedRealMs).toBe(90_000);
    expect(restored.minuteOfDay).toBe(810);
    expect(restored.finished).toBe(false);
    restored.advance(10_000);
    expect(restored.elapsedRealMs).toBe(90_000);
    restored.resume();
    restored.advance(10_000);
    expect(restored.elapsedRealMs).toBe(100_000);
  });

  it('clamps restored elapsed time and recalculates derived boundary values', () => {
    const clock = new GameClock(180_000);

    clock.restore({ elapsedRealMs: -1, paused: false });
    expect(clock.snapshot()).toEqual({ elapsedRealMs: 0, paused: false });
    expect(clock.minuteOfDay).toBe(540);
    expect(clock.finished).toBe(false);

    clock.restore({ elapsedRealMs: 180_001, paused: false });
    expect(clock.snapshot()).toEqual({ elapsedRealMs: 180_000, paused: false });
    expect(clock.minuteOfDay).toBe(1_080);
    expect(clock.finished).toBe(true);
  });

  it('rejects a non-positive or non-finite real duration', () => {
    expect(() => new GameClock(0)).toThrow('realDurationMs must be a positive finite number');
    expect(() => new GameClock(-1)).toThrow('realDurationMs must be a positive finite number');
    expect(() => new GameClock(Number.POSITIVE_INFINITY)).toThrow(
      'realDurationMs must be a positive finite number',
    );
  });
});
