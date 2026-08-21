import type { RandomSource } from './model';

const ZERO_STATE_FALLBACK = 0x6d2b79f5;
const UINT32_RANGE = 0x1_0000_0000;

function normalizeState(state: number): number {
  const normalized = state >>> 0;
  return normalized === 0 ? ZERO_STATE_FALLBACK : normalized;
}

export class SeededRandom implements RandomSource {
  private state: number;

  constructor(seed: number) {
    this.state = normalizeState(seed);
  }

  next(): number {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state / UINT32_RANGE;
  }

  int(minInclusive: number, maxExclusive: number): number {
    if (!(maxExclusive > minInclusive)) {
      throw new RangeError('maxExclusive must be greater than minInclusive');
    }
    return minInclusive + Math.floor(this.next() * (maxExclusive - minInclusive));
  }

  snapshot(): number {
    return this.state;
  }

  restore(state: number): void {
    this.state = normalizeState(state);
  }
}
