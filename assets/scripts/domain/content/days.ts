import type { GameSnapshot } from '../model';

export type DayId = GameSnapshot['dayId'];

export type DayGoal =
  | Readonly<{ bossCompleted: 3 }>
  | Readonly<{ bossWorkloadRatio: 0.35 }>
  | Readonly<{ companyAtLeast: 50; rectificationAtLeast: 70 }>;

export interface DayDefinition {
  readonly id: DayId;
  readonly difficulty: 1 | 2 | 3;
  readonly spawnEveryMs: number;
  readonly goal: DayGoal;
}

function definition<T extends DayDefinition>(value: T): T {
  return Object.freeze({
    ...value,
    goal: Object.freeze({ ...value.goal }),
  }) as T;
}

export const DAY_DEFINITIONS: readonly DayDefinition[] = Object.freeze([
  definition({
    id: 'day-1',
    difficulty: 1,
    spawnEveryMs: 15_000,
    goal: { bossCompleted: 3 },
  }),
  definition({
    id: 'day-2',
    difficulty: 2,
    spawnEveryMs: 12_000,
    goal: { bossWorkloadRatio: 0.35 },
  }),
  definition({
    id: 'day-3',
    difficulty: 3,
    spawnEveryMs: 9_000,
    goal: { companyAtLeast: 50, rectificationAtLeast: 70 },
  }),
]);
