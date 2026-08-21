import { describe, expect, it } from 'vitest';
import { simulate } from '../helpers/strategies';

describe('MVP balance', () => {
  it('lets a sensible strategy win most seeded games without guaranteeing SSS', () => {
    const results = Array.from(
      { length: 100 },
      (_, seed) => simulate('day-3', seed + 1, 'sensible'),
    );
    const wins = results.filter((result) => result.goalMet).length;
    const sss = results.filter((result) => result.grade === 'SSS').length;
    expect(wins).toBeGreaterThanOrEqual(60);
    expect(wins).toBeLessThanOrEqual(90);
    expect(sss).toBeLessThanOrEqual(20);
  });

  it('does not reward giving every task to the boss', () => {
    const results = Array.from(
      { length: 100 },
      (_, seed) => simulate('day-3', seed + 101, 'boss-only'),
    );
    expect(results.filter((result) => ['SSS', 'S'].includes(result.grade)).length)
      .toBeLessThanOrEqual(10);
  });
});
