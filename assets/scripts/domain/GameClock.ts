const START_MINUTE = 9 * 60;
const END_MINUTE = 18 * 60;
const WORKDAY_MINUTES = END_MINUTE - START_MINUTE;

export interface GameClockSnapshot {
  readonly elapsedRealMs: number;
  readonly paused: boolean;
}

export class GameClock {
  private currentElapsedRealMs = 0;
  private currentMinuteOfDay = START_MINUTE;
  private currentFinished = false;
  private paused = false;

  constructor(private readonly realDurationMs: number) {
    if (!Number.isFinite(realDurationMs) || realDurationMs <= 0) {
      throw new RangeError('realDurationMs must be a positive finite number');
    }
  }

  get elapsedRealMs(): number {
    return this.currentElapsedRealMs;
  }

  get minuteOfDay(): number {
    return this.currentMinuteOfDay;
  }

  get finished(): boolean {
    return this.currentFinished;
  }

  advance(deltaMs: number): void {
    if (this.paused) return;
    this.currentElapsedRealMs = Math.min(
      this.realDurationMs,
      this.currentElapsedRealMs + Math.max(0, deltaMs),
    );
    this.recalculateDerivedValues();
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  snapshot(): Readonly<GameClockSnapshot> {
    return Object.freeze({
      elapsedRealMs: this.currentElapsedRealMs,
      paused: this.paused,
    });
  }

  restore(snapshot: GameClockSnapshot): void {
    this.currentElapsedRealMs = Math.min(
      this.realDurationMs,
      Math.max(0, snapshot.elapsedRealMs),
    );
    this.paused = snapshot.paused;
    this.recalculateDerivedValues();
  }

  private recalculateDerivedValues(): void {
    this.currentMinuteOfDay = Math.min(
      END_MINUTE,
      START_MINUTE
        + Math.floor((this.currentElapsedRealMs / this.realDurationMs) * WORKDAY_MINUTES),
    );
    this.currentFinished = this.currentElapsedRealMs >= this.realDurationMs;
  }
}
