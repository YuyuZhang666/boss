import type { RandomSource } from '../../assets/scripts/domain/model';

export class StubRandom implements RandomSource {
  private readonly values: number[];

  constructor(values: readonly number[]) {
    this.values = [...values];
  }

  next(): number {
    if (this.values.length === 0) {
      throw new Error('StubRandom queue exhausted');
    }
    const value = this.values.shift()!;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value >= 1) {
      throw new RangeError('StubRandom values must be in [0, 1)');
    }
    return value;
  }

  int(minInclusive: number, maxExclusive: number): number {
    if (
      !Number.isSafeInteger(minInclusive)
      || !Number.isSafeInteger(maxExclusive)
      || maxExclusive <= minInclusive
    ) {
      throw new RangeError('StubRandom bounds must be safe integers with max > min');
    }
    return minInclusive + Math.floor(this.next() * (maxExclusive - minInclusive));
  }
}
