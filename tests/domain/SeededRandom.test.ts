import { describe, expect, it } from 'vitest';
import { SeededRandom } from '../../assets/scripts/domain/SeededRandom';

describe('SeededRandom', () => {
  it('uses the approved xorshift32 sequence deterministically', () => {
    const a = new SeededRandom(42);
    const b = new SeededRandom(42);

    expect([a.next(), a.next(), a.int(2, 8)]).toEqual([
      11_355_432 / 0x1_0000_0000,
      2_836_018_348 / 0x1_0000_0000,
      2,
    ]);
    expect(b.next()).toBe(11_355_432 / 0x1_0000_0000);
  });

  it('keeps integers inside the half-open range', () => {
    const rng = new SeededRandom(9);

    for (let i = 0; i < 100; i += 1) {
      expect(rng.int(3, 7)).toBeGreaterThanOrEqual(3);
      expect(rng.int(3, 7)).toBeLessThan(7);
    }
  });

  it('normalizes a zero seed to the approved non-zero fallback', () => {
    const zero = new SeededRandom(0);
    const fallback = new SeededRandom(0x6d2b79f5);

    expect(zero.snapshot()).toBe(0x6d2b79f5);
    expect(zero.next()).toBe(fallback.next());
  });

  it('restores the unsigned state and continues the same sequence', () => {
    const source = new SeededRandom(123);
    source.next();
    const state = source.snapshot();
    const restored = new SeededRandom(999);

    restored.restore(state);
    expect(restored.snapshot()).toBe(state);
    expect(restored.next()).toBe(source.next());

    restored.restore(-1);
    expect(restored.snapshot()).toBe(0xffff_ffff);
    restored.restore(0);
    expect(restored.snapshot()).toBe(0x6d2b79f5);
  });

  it('rejects empty, reversed, and incomparable integer ranges', () => {
    const rng = new SeededRandom(1);

    expect(() => rng.int(3, 3)).toThrow('maxExclusive must be greater than minInclusive');
    expect(() => rng.int(4, 3)).toThrow('maxExclusive must be greater than minInclusive');
    expect(() => rng.int(3, Number.NaN)).toThrow(
      'maxExclusive must be greater than minInclusive',
    );
  });
});
