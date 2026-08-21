import { GameSession } from '../../assets/scripts/domain/GameSession';
import type { DayResult } from '../../assets/scripts/domain/ResultSystem';
import { RULE_DEFINITIONS } from '../../assets/scripts/domain/content/rules';
import { TASK_DEFINITIONS } from '../../assets/scripts/domain/content/tasks';
import type { Assignee, AvoidanceType, RuleId, TaskDefinition } from '../../assets/scripts/domain/model';
import type { DayId } from '../../assets/scripts/domain/content/days';

const TASK_BY_ID = new Map<string, TaskDefinition>(
  TASK_DEFINITIONS.map((definition) => [definition.id, definition]),
);

export interface Strategy {
  assign(task: TaskDefinition): Assignee;
  counter(warning: { type: AvoidanceType; legitimate: boolean }): RuleId | undefined;
}

export const sensibleStrategy: Strategy = Object.freeze({
  assign(task: TaskDefinition): Assignee {
    return task.bossFit >= 4 ? 'boss' : 'employee';
  },
  counter(warning: { type: AvoidanceType; legitimate: boolean }): RuleId | undefined {
    if (warning.legitimate) return undefined;
    if (warning.type === 'dump') return 'responsibility-chain';
    if (warning.type === 'meeting' || warning.type === 'outsource') return 'cost-time-audit';
    return 'original-request';
  },
});

export const bossOnlyStrategy: Strategy = Object.freeze({
  assign(): Assignee {
    return 'boss';
  },
  counter(): undefined {
    return undefined;
  },
});

export type StrategyName = 'sensible' | 'boss-only';

export function simulate(dayId: DayId, seed: number, strategyName: StrategyName): DayResult {
  const strategy = strategyName === 'sensible' ? sensibleStrategy : bossOnlyStrategy;
  const game = GameSession.create(dayId, seed);
  game.dispatch({ type: 'skip-intro' });

  for (let step = 0; step <= 1_800; step += 1) {
    let snapshot = game.snapshot();
    if (snapshot.phase === 'result') return game.result!;
    if (snapshot.phase === 'tutorial-paused') {
      game.dispatch({ type: 'finish-tutorial' });
      snapshot = game.snapshot();
    }
    const warning = snapshot.boss;
    if (warning.state === 'warning') {
      const ruleId = strategy.counter({
        type: warning.avoidance!,
        legitimate: warning.avoidanceLegitimate!,
      });
      if (ruleId !== undefined && snapshot.permissions >= RULE_DEFINITIONS[ruleId].cost) {
        game.dispatch({ type: 'use-rule', ruleId });
        snapshot = game.snapshot();
      }
    }

    let bossCount = snapshot.tasks.filter((task) => (
      task.status === 'boss-queued' || task.status === 'boss-working'
    )).length;
    for (const task of snapshot.tasks.filter((candidate) => candidate.status === 'offered')) {
      const definition = TASK_BY_ID.get(task.definitionId)!;
      const assignee = strategy.assign(definition);
      if (assignee === 'boss' && bossCount >= 3) continue;
      game.dispatch({ type: 'assign-task', instanceId: task.instanceId, assignee });
      if (assignee === 'boss') bossCount += 1;
    }
    game.tick(100);
  }
  throw new Error('simulation did not reach result');
}
