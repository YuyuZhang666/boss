export type MeterKey = 'company' | 'rectification' | 'face' | 'trust';
export type Assignee = 'employee' | 'boss';
export type TaskStatus =
  | 'offered' | 'employee-working' | 'boss-queued' | 'boss-working'
  | 'completed' | 'failed' | 'expired';
export type AvoidanceType =
  | 'meeting' | 'dump' | 'outsource' | 'change-request' | 'strategic-upgrade';
export type RuleId = 'responsibility-chain' | 'original-request' | 'cost-time-audit';
export type BossState = 'idle' | 'working' | 'warning';

export interface RandomSource {
  next(): number;
  int(minInclusive: number, maxExclusive: number): number;
}

export interface TaskDefinition {
  id: string;
  department: 'dev' | 'product' | 'ops' | 'sales' | 'hr' | 'finance' | 'admin';
  title: string;
  description: string;
  workload: 1 | 2 | 3 | 4 | 5;
  expertise: 1 | 2 | 3 | 4 | 5;
  urgency: 1 | 2 | 3 | 4 | 5;
  bossFit: 1 | 2 | 3 | 4 | 5;
  deadlineMinutes: number;
  employeeSuccess: number;
  bossSuccess: number;
}

export interface TaskInstance {
  instanceId: string;
  definitionId: string;
  status: TaskStatus;
  offeredAtMinute: number;
  deadlineAtMinute: number;
  assignedAtMinute?: number;
}

export interface MeterSnapshot {
  company: number;
  rectification: number;
  face: number;
  trust: number;
}

export interface DomainEvent {
  type: string;
  payload: Readonly<Record<string, unknown>>;
}

export interface GameSnapshot {
  version: 1;
  dayId: 'day-1' | 'day-2' | 'day-3';
  seed: number;
  rngState: number;
  phase: 'intro' | 'playing' | 'tutorial-paused' | 'paused' | 'result';
  elapsedRealMs: number;
  nextTaskSpawnMs: number;
  meters: MeterSnapshot;
  permissions: number;
  tasks: readonly TaskInstance[];
  taskSequence: number;
  workerJobs: readonly { instanceId: string; remainingMs: number }[];
  boss: {
    state: BossState;
    taskInstanceId?: string;
    avoidance?: AvoidanceType;
    avoidanceLegitimate?: boolean;
    remainingWorkMs: number;
    warningRemainingMs: number;
  };
  activeEvents: readonly { id: string; expiresAtMs: number }[];
  usedEventIds: readonly string[];
  pendingEventChoice?: { id: 'secretary-help'; remainingMs: number };
  stats: Readonly<Record<string, number>>;
}
