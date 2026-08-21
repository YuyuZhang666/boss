import { BossAI } from './BossAI';
import { CompanyState } from './CompanyState';
import { EventSystem } from './EventSystem';
import { GameClock } from './GameClock';
import { ResultSystem } from './ResultSystem';
import type { DayResult } from './ResultSystem';
import { RuleSystem } from './RuleSystem';
import { SeededRandom } from './SeededRandom';
import { TaskSystem } from './TaskSystem';
import { BOSS_DIALOGUE, BOSS_DIALOGUE_TAGS } from './content/dialogue';
import { DAY_DEFINITIONS } from './content/days';
import type { DayDefinition, DayId } from './content/days';
import { EVENT_DEFINITIONS } from './content/events';
import { TASK_DEFINITIONS } from './content/tasks';
import type {
  Assignee,
  AvoidanceType,
  DomainEvent,
  GameSnapshot,
  GameStatistics,
  MeterKey,
  MeterSnapshot,
  RuleId,
  TaskDefinition,
  TaskInstance,
} from './model';

const WORKDAY_REAL_MS = 180_000;
const FIXED_STEP_MS = 100;
const OFFER_CAPACITY = 4;
const START_MINUTE = 9 * 60;
const WORKDAY_MINUTES = 9 * 60;
const UINT32_MAX = 0xffff_ffff;
const PHASES = new Set(['intro', 'playing', 'tutorial-paused', 'paused', 'result']);
const AVOIDANCES = new Set<unknown>([
  'meeting', 'dump', 'outsource', 'change-request', 'strategic-upgrade',
]);
const RULE_IDS = new Set<unknown>([
  'responsibility-chain', 'original-request', 'cost-time-audit',
]);
const STAT_KEYS = Object.freeze([
  'bossCompleted',
  'bossWorkload',
  'totalWorkload',
  'bossWorkMs',
  'meetings',
  'usefulMeetings',
  'dumpAttempts',
  'dumpSuccesses',
  'outsources',
  'outsourceCost',
  'simplePhraseCount',
  'unresolvedUrgent',
  'counteredAvoidances',
] as const);
const TASK_STATUSES = new Set<unknown>([
  'offered', 'employee-working', 'boss-queued', 'boss-working',
  'completed', 'failed', 'expired',
]);
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'expired']);
const EMPTY_EVENTS = Object.freeze([]) as unknown as readonly DomainEvent[];

type GamePhase = GameSnapshot['phase'];
type WorkerJob = { instanceId: string; remainingMs: number };
type MutableStats = { -readonly [K in keyof GameStatistics]: GameStatistics[K] };

export type GameCommand =
  | { type: 'assign-task'; instanceId: string; assignee: Assignee }
  | { type: 'use-rule'; ruleId: RuleId }
  | { type: 'event-choice'; eventId: 'secretary-help'; choice: 'ignore' | 'report' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'skip-intro' }
  | { type: 'finish-tutorial' };

const DAY_BY_ID = new Map<DayId, DayDefinition>(
  DAY_DEFINITIONS.map((definition) => [definition.id, definition]),
);
const TASK_BY_ID = new Map<string, TaskDefinition>(
  TASK_DEFINITIONS.map((definition) => [definition.id, definition]),
);

function initialStats(): MutableStats {
  return {
    bossCompleted: 0,
    bossWorkload: 0,
    totalWorkload: 0,
    bossWorkMs: 0,
    meetings: 0,
    usefulMeetings: 0,
    dumpAttempts: 0,
    dumpSuccesses: 0,
    outsources: 0,
    outsourceCost: 0,
    simplePhraseCount: 0,
    unresolvedUrgent: 0,
    counteredAvoidances: 0,
  };
}

function event(type: string, payload: Record<string, unknown>): DomainEvent {
  return Object.freeze({ type, payload: Object.freeze({ ...payload }) });
}

function freezeEvents(events: DomainEvent[]): readonly DomainEvent[] {
  if (events.length === 0) return EMPTY_EVENTS;
  return Object.freeze(events);
}

function isRecord(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidSnapshot(): never {
  throw new Error('invalid game snapshot');
}

function readDataRecord(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[],
): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) invalidSnapshot();
  let descriptorMap: PropertyDescriptorMap;
  try {
    descriptorMap = Object.getOwnPropertyDescriptors(value);
  } catch {
    invalidSnapshot();
  }
  const descriptors = descriptorMap as Record<PropertyKey, PropertyDescriptor>;
  const ownKeys = Reflect.ownKeys(descriptorMap);
  const allowedSet = new Set(allowed);
  if (
    ownKeys.some((key) => typeof key !== 'string' || !allowedSet.has(key))
    || required.some((key) => !Object.prototype.hasOwnProperty.call(descriptorMap, key))
  ) invalidSnapshot();

  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of ownKeys) {
    if (typeof key !== 'string') invalidSnapshot();
    const descriptor = descriptors[key];
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      invalidSnapshot();
    }
    result[key] = descriptor.value;
  }
  return result;
}

function readDataArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) invalidSnapshot();
  const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<
    PropertyKey,
    PropertyDescriptor
  >;
  const lengthDescriptor = descriptors.length;
  if (
    !lengthDescriptor
    || !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value')
    || !Number.isSafeInteger(lengthDescriptor.value)
    || lengthDescriptor.value < 0
  ) invalidSnapshot();
  const length = lengthDescriptor.value as number;
  if (Reflect.ownKeys(descriptors).some((key) => {
    if (key === 'length') return false;
    if (typeof key !== 'string') return true;
    const index = Number(key);
    return !Number.isSafeInteger(index) || index < 0 || index >= length || String(index) !== key;
  })) invalidSnapshot();
  const result: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) invalidSnapshot();
    result.push(descriptor.value);
  }
  return result;
}

function primitiveString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function finiteNonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function safeNonnegative(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function minuteForElapsed(elapsedMs: number): number {
  return Math.min(
    START_MINUTE + WORKDAY_MINUTES,
    START_MINUTE + Math.floor((elapsedMs / WORKDAY_REAL_MS) * WORKDAY_MINUTES),
  );
}

function eventTriggers(dayId: DayId): readonly number[] {
  return dayId === 'day-1' ? Object.freeze([70_000]) : Object.freeze([55_000, 125_000]);
}

function parseMeters(value: unknown): MeterSnapshot {
  const record = readDataRecord(
    value,
    ['company', 'rectification', 'face', 'trust'],
    ['company', 'rectification', 'face', 'trust'],
  );
  const result: Partial<MeterSnapshot> = {};
  for (const key of ['company', 'rectification', 'face', 'trust'] as const) {
    const meter = record[key];
    if (typeof meter !== 'number' || !Number.isFinite(meter) || meter < 0 || meter > 100) {
      invalidSnapshot();
    }
    result[key] = meter;
  }
  return result as MeterSnapshot;
}

function parseStats(value: unknown): MutableStats {
  const record = readDataRecord(value, STAT_KEYS, STAT_KEYS);
  const result = initialStats();
  for (const key of STAT_KEYS) {
    if (!safeNonnegative(record[key])) invalidSnapshot();
    result[key] = record[key] as number;
  }
  return result;
}

function parseTask(value: unknown): TaskInstance {
  const record = readDataRecord(
    value,
    [
      'instanceId', 'definitionId', 'status', 'offeredAtMinute',
      'deadlineAtMinute', 'assignedAtMinute',
    ],
    ['instanceId', 'definitionId', 'status', 'offeredAtMinute', 'deadlineAtMinute'],
  );
  if (
    !primitiveString(record.instanceId)
    || !primitiveString(record.definitionId)
    || !TASK_BY_ID.has(record.definitionId)
    || !TASK_STATUSES.has(record.status)
    || !safeNonnegative(record.offeredAtMinute)
    || !safeNonnegative(record.deadlineAtMinute)
    || (record.assignedAtMinute !== undefined && !safeNonnegative(record.assignedAtMinute))
  ) invalidSnapshot();
  const task: TaskInstance = {
    instanceId: record.instanceId,
    definitionId: record.definitionId,
    status: record.status as TaskInstance['status'],
    offeredAtMinute: record.offeredAtMinute,
    deadlineAtMinute: record.deadlineAtMinute,
  };
  if (record.assignedAtMinute !== undefined) task.assignedAtMinute = record.assignedAtMinute;
  return task;
}

function parseWorker(value: unknown): WorkerJob {
  const record = readDataRecord(
    value,
    ['instanceId', 'remainingMs'],
    ['instanceId', 'remainingMs'],
  );
  if (!primitiveString(record.instanceId) || !finiteNonnegative(record.remainingMs) || record.remainingMs <= 0) {
    invalidSnapshot();
  }
  return { instanceId: record.instanceId, remainingMs: record.remainingMs };
}

function parseBoss(value: unknown): GameSnapshot['boss'] {
  const record = readDataRecord(
    value,
    [
      'state', 'taskInstanceId', 'avoidance', 'avoidanceLegitimate',
      'remainingWorkMs', 'warningRemainingMs', 'nonWorkDelayRemainingMs',
    ],
    ['state', 'remainingWorkMs', 'warningRemainingMs'],
  );
  if (
    (record.state !== 'idle' && record.state !== 'working' && record.state !== 'warning')
    || !finiteNonnegative(record.remainingWorkMs)
    || !finiteNonnegative(record.warningRemainingMs)
    || (record.taskInstanceId !== undefined && !primitiveString(record.taskInstanceId))
    || (record.avoidance !== undefined && !AVOIDANCES.has(record.avoidance))
    || (record.avoidanceLegitimate !== undefined && typeof record.avoidanceLegitimate !== 'boolean')
    || (record.nonWorkDelayRemainingMs !== undefined
      && (!finiteNonnegative(record.nonWorkDelayRemainingMs) || record.nonWorkDelayRemainingMs <= 0))
  ) invalidSnapshot();
  return {
    state: record.state,
    remainingWorkMs: record.remainingWorkMs,
    warningRemainingMs: record.warningRemainingMs,
    ...(record.taskInstanceId === undefined ? {} : { taskInstanceId: record.taskInstanceId }),
    ...(record.avoidance === undefined ? {} : {
      avoidance: record.avoidance as AvoidanceType,
      avoidanceLegitimate: record.avoidanceLegitimate as boolean,
    }),
    ...(record.nonWorkDelayRemainingMs === undefined
      ? {}
      : { nonWorkDelayRemainingMs: record.nonWorkDelayRemainingMs }),
  };
}

function parseActiveEvents(value: unknown): GameSnapshot['activeEvents'] {
  return readDataArray(value).map((item) => {
    const record = readDataRecord(item, ['id', 'expiresAtMs'], ['id', 'expiresAtMs']);
    if (!primitiveString(record.id) || !finiteNonnegative(record.expiresAtMs)) invalidSnapshot();
    return { id: record.id, expiresAtMs: record.expiresAtMs };
  });
}

function parseUsedEvents(value: unknown): GameSnapshot['usedEventIds'] {
  return readDataArray(value).map((item) => {
    if (!primitiveString(item)) invalidSnapshot();
    return item;
  });
}

function parsePendingChoice(value: unknown): GameSnapshot['pendingEventChoice'] {
  if (value === undefined) return undefined;
  const record = readDataRecord(value, ['id', 'remainingMs'], ['id', 'remainingMs']);
  if (record.id !== 'secretary-help' || !finiteNonnegative(record.remainingMs)) invalidSnapshot();
  return { id: 'secretary-help', remainingMs: record.remainingMs };
}

function avoidanceIsLegitimate(task: TaskDefinition, avoidance: AvoidanceType): boolean {
  if (avoidance === 'meeting') {
    return task.bossFit >= 4
      && task.workload >= 3
      && (task.department === 'product' || task.department === 'sales' || task.department === 'hr');
  }
  if (avoidance === 'outsource') {
    return task.urgency >= 4 && task.expertise >= 4 && task.bossSuccess < 0.5;
  }
  return false;
}

function dialogueLines(avoidance: AvoidanceType): readonly string[] {
  switch (avoidance) {
    case 'meeting': return BOSS_DIALOGUE.meeting;
    case 'dump': return BOSS_DIALOGUE.dump;
    case 'outsource': return BOSS_DIALOGUE.outsource;
    case 'change-request': return BOSS_DIALOGUE.changeRequest;
    case 'strategic-upgrade': return BOSS_DIALOGUE.strategicUpgrade;
  }
}

export class GameSession {
  private readonly day: DayDefinition;
  private random: SeededRandom;
  private clock: GameClock;
  private tasks: TaskSystem;
  private rules: RuleSystem;
  private boss: BossAI;
  private eventSystem: EventSystem;
  private company: CompanyState;
  private currentPhase: GamePhase = 'intro';
  private nextSpawnMs = 0;
  private eventTriggerIndex = 0;
  private pendingVipDefinitionId: string | undefined;
  private workerJobs: WorkerJob[] = [];
  private statistics: MutableStats = initialStats();
  private currentResult: DayResult | undefined;

  private constructor(
    private readonly dayId: DayId,
    private readonly seed: number,
  ) {
    this.day = DAY_BY_ID.get(dayId)!;
    this.random = new SeededRandom(seed);
    this.clock = new GameClock(WORKDAY_REAL_MS);
    this.clock.pause();
    this.tasks = new TaskSystem(TASK_DEFINITIONS);
    this.rules = new RuleSystem();
    this.boss = new BossAI(this.random);
    this.eventSystem = new EventSystem(this.random, EVENT_DEFINITIONS);
    this.company = new CompanyState();
  }

  static create(dayId: DayId, seed: number): GameSession {
    if (typeof dayId !== 'string' || !DAY_BY_ID.has(dayId)) throw new Error('invalid day ID');
    if (!Number.isSafeInteger(seed)) throw new Error('invalid game seed');
    return new GameSession(dayId, seed);
  }

  get result(): DayResult | undefined {
    return this.currentResult;
  }

  dispatch(command: GameCommand): readonly DomainEvent[] {
    if (!isRecord(command)) throw new Error('invalid game command');
    const descriptors = Object.getOwnPropertyDescriptors(command);
    const keys = Reflect.ownKeys(descriptors);
    if (!Object.prototype.hasOwnProperty.call(descriptors, 'type')) throw new Error('invalid game command');
    for (const key of keys) {
      if (typeof key !== 'string') throw new Error('invalid game command');
      const descriptor = descriptors[key];
      if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) throw new Error('invalid game command');
    }
    const type = descriptors.type.value;
    const allowedByType: Readonly<Record<string, readonly string[]>> = {
      'assign-task': ['type', 'instanceId', 'assignee'],
      'use-rule': ['type', 'ruleId'],
      'event-choice': ['type', 'eventId', 'choice'],
      pause: ['type'],
      resume: ['type'],
      'skip-intro': ['type'],
      'finish-tutorial': ['type'],
    };
    if (typeof type !== 'string' || !Object.prototype.hasOwnProperty.call(allowedByType, type)) {
      throw new Error('unknown game command');
    }
    const allowed = allowedByType[type];
    if (keys.length !== allowed.length || keys.some((key) => !allowed.includes(key as string))) {
      throw new Error('invalid game command');
    }

    const events: DomainEvent[] = [];
    switch (type) {
      case 'assign-task': {
        const instanceId = descriptors.instanceId.value;
        const assignee = descriptors.assignee.value;
        if (!primitiveString(instanceId) || (assignee !== 'employee' && assignee !== 'boss')) {
          throw new Error('invalid assign command');
        }
        this.requirePhase('playing');
        const assigned = this.tasks.assign(instanceId, assignee, this.clock.minuteOfDay);
        events.push(event('task-assigned', { instanceId, assignee }));
        if (assignee === 'employee') {
          const definition = this.requireDefinition(assigned.definitionId);
          this.workerJobs.push({ instanceId, remainingMs: definition.workload * 2_000 });
        }
        this.offerPendingVip(events);
        this.tryStartBoss(events);
        return freezeEvents(events);
      }
      case 'use-rule': {
        const ruleId = descriptors.ruleId.value;
        if (!RULE_IDS.has(ruleId)) throw new Error('invalid rule command');
        if (this.currentPhase !== 'playing' && this.currentPhase !== 'tutorial-paused') {
          throw new Error('rule cannot be used in this phase');
        }
        const bossSnapshot = this.boss.snapshot();
        if (bossSnapshot.state !== 'warning' || bossSnapshot.avoidance === undefined) {
          throw new Error('there is no avoidance warning');
        }
        const use = this.rules.use(ruleId as RuleId, bossSnapshot.avoidance);
        for (const ruleEvent of use.events) {
          if (ruleEvent.type !== 'avoidance-countered') events.push(ruleEvent);
        }
        if (!use.accepted) return freezeEvents(events);
        if (!use.matched) {
          this.applyMeters({ trust: -2 }, events);
          return freezeEvents(events);
        }
        const counterEvents = this.boss.counter(ruleId as RuleId);
        events.push(...counterEvents);
        if (bossSnapshot.avoidanceLegitimate) {
          this.applyMeters({ company: -2, trust: -3 }, events);
        } else {
          this.statistics.counteredAvoidances += 1;
          this.applyMeters({ face: -3, trust: 1 }, events);
        }
        if (this.company.failed) {
          this.finishDay(events);
          return freezeEvents(events);
        }
        if (this.currentPhase === 'tutorial-paused') this.changePhase('playing', events);
        return freezeEvents(events);
      }
      case 'event-choice': {
        const eventId = descriptors.eventId.value;
        const choice = descriptors.choice.value;
        if (eventId !== 'secretary-help' || (choice !== 'ignore' && choice !== 'report')) {
          throw new Error('invalid event choice command');
        }
        this.requirePhase('playing');
        const choiceEvents = this.eventSystem.choose(eventId, choice, this.clock.elapsedRealMs);
        this.processEventEvents(choiceEvents, events);
        return freezeEvents(events);
      }
      case 'pause':
        this.requirePhase('playing');
        this.changePhase('paused', events);
        return freezeEvents(events);
      case 'resume':
        this.requirePhase('paused');
        this.changePhase('playing', events);
        return freezeEvents(events);
      case 'skip-intro':
        this.requirePhase('intro');
        this.changePhase('playing', events);
        return freezeEvents(events);
      case 'finish-tutorial':
        this.requirePhase('tutorial-paused');
        this.changePhase('playing', events);
        return freezeEvents(events);
      default:
        throw new Error('unknown game command');
    }
  }

  tick(realDeltaMs: number): readonly DomainEvent[] {
    if (!safeNonnegative(realDeltaMs)) throw new Error('realDeltaMs must be a nonnegative integer');
    if (realDeltaMs === 0 || this.currentPhase !== 'playing') return EMPTY_EVENTS;

    const events: DomainEvent[] = [];
    let remaining = realDeltaMs;
    while (remaining > 0 && this.currentPhase === 'playing') {
      const available = WORKDAY_REAL_MS - this.clock.elapsedRealMs;
      if (available <= 0) {
        this.finishDay(events);
        break;
      }
      const step = Math.min(FIXED_STEP_MS, remaining, available);
      remaining -= step;
      this.tickStep(step, events);
    }
    return freezeEvents(events);
  }

  snapshot(): Readonly<GameSnapshot> {
    const taskSnapshot = this.tasks.snapshot();
    const eventSnapshot = this.eventSystem.snapshot();
    const workerJobs = Object.freeze(this.workerJobs.map((job) => Object.freeze({ ...job })));
    const stats = Object.freeze({ ...this.statistics });
    return Object.freeze({
      version: 1,
      dayId: this.dayId,
      seed: this.seed,
      rngState: this.random.snapshot(),
      phase: this.currentPhase,
      elapsedRealMs: this.clock.elapsedRealMs,
      nextTaskSpawnMs: this.nextSpawnMs,
      nextEventTriggerIndex: this.eventTriggerIndex,
      ...(this.pendingVipDefinitionId === undefined
        ? {}
        : { pendingVipDefinitionId: this.pendingVipDefinitionId }),
      meters: this.company.snapshot(),
      permissions: this.rules.remaining,
      tasks: taskSnapshot.tasks,
      taskSequence: taskSnapshot.sequence,
      workerJobs,
      boss: this.boss.snapshot(),
      activeEvents: eventSnapshot.activeEvents,
      usedEventIds: eventSnapshot.usedEventIds,
      ...(eventSnapshot.pendingEventChoice === undefined
        ? {}
        : { pendingEventChoice: eventSnapshot.pendingEventChoice }),
      stats,
    });
  }

  restore(snapshot: GameSnapshot): void {
    const candidate = this.parseAndBuildSnapshot(snapshot);
    this.random = candidate.random;
    this.clock = candidate.clock;
    this.tasks = candidate.tasks;
    this.rules = candidate.rules;
    this.boss = candidate.boss;
    this.eventSystem = candidate.eventSystem;
    this.company = candidate.company;
    this.currentPhase = candidate.currentPhase;
    this.nextSpawnMs = candidate.nextSpawnMs;
    this.eventTriggerIndex = candidate.eventTriggerIndex;
    this.pendingVipDefinitionId = candidate.pendingVipDefinitionId;
    this.workerJobs = candidate.workerJobs;
    this.statistics = candidate.statistics;
    this.currentResult = candidate.currentResult;
  }

  private tickStep(deltaMs: number, events: DomainEvent[]): void {
    this.clock.advance(deltaMs);
    const nowMinute = this.clock.minuteOfDay;

    this.processExpiryEvents(this.tasks.expire(nowMinute), events);
    if (this.company.failed) {
      this.finishDay(events);
      return;
    }
    this.offerPendingVip(events);

    this.tickWorkers(deltaMs, events);
    if (this.company.failed) {
      this.finishDay(events);
      return;
    }
    this.offerPendingVip(events);

    this.tickEvents(events);
    if (this.company.failed) {
      this.finishDay(events);
      return;
    }
    this.offerPendingVip(events);

    this.tryStartBoss(events);
    if (this.currentPhase !== 'playing') return;
    const modifiers = this.eventSystem.modifiers();
    const bossEvents = this.boss.tick(deltaMs, modifiers.bossWorkSpeed);
    this.statistics.bossWorkMs += Math.round(this.boss.workedRealMsLastTick);
    this.processBossEvents(bossEvents, events);
    if (this.company.failed) {
      this.finishDay(events);
      return;
    }
    if (this.currentPhase !== 'playing') return;
    this.tryStartBoss(events);

    if (!this.clock.finished) this.offerScheduledTasks(events);
    if (this.clock.finished) this.finishDay(events);
  }

  private tickWorkers(deltaMs: number, events: DomainEvent[]): void {
    const speed = this.eventSystem.modifiers().employeeWorkSpeed;
    if (speed === 0) return;
    const completed: string[] = [];
    for (const job of this.workerJobs) {
      job.remainingMs -= deltaMs * speed;
      if (job.remainingMs > 0) continue;
      completed.push(job.instanceId);
      const task = this.requireTask(job.instanceId);
      const definition = this.requireDefinition(task.definitionId);
      this.finishStandardTask(job.instanceId, this.random.next() < definition.employeeSuccess, false, events);
      if (this.company.failed) break;
    }
    if (completed.length > 0) {
      const completedSet = new Set(completed);
      this.workerJobs = this.workerJobs.filter((job) => !completedSet.has(job.instanceId));
    }
  }

  private tickEvents(events: DomainEvent[]): void {
    const triggers = eventTriggers(this.dayId);
    while (
      this.eventTriggerIndex < triggers.length
      && triggers[this.eventTriggerIndex] <= this.clock.elapsedRealMs
    ) {
      const triggerMs = triggers[this.eventTriggerIndex];
      this.eventTriggerIndex += 1;
      const drawn = this.eventSystem.draw(1)[0];
      this.processEventEvents(this.eventSystem.activate(drawn, triggerMs), events);
    }
    this.processEventEvents(this.eventSystem.tick(this.clock.elapsedRealMs), events);
  }

  private processEventEvents(source: readonly DomainEvent[], events: DomainEvent[]): void {
    for (const item of source) {
      events.push(item);
      if (item.type === 'event-task-offer-requested') {
        const definitionId = item.payload.definitionId;
        if (!primitiveString(definitionId) || !TASK_BY_ID.has(definitionId)) {
          throw new Error('invalid event task request');
        }
        this.pendingVipDefinitionId = definitionId;
        this.offerPendingVip(events);
      } else if (item.type === 'event-choice-resolved') {
        const choice = item.payload.choice;
        if (choice === 'ignore') {
          this.applyMeters({ rectification: 4, trust: -3 }, events);
        } else if (choice === 'report') {
          this.applyMeters({ trust: 3, face: -4 }, events);
        }
      }
    }
  }

  private processBossEvents(source: readonly DomainEvent[], events: DomainEvent[]): void {
    for (const item of source) {
      events.push(item);
      if (item.type === 'avoidance-warning') {
        const avoidance = item.payload.avoidance;
        if (!AVOIDANCES.has(avoidance)) throw new Error('invalid BossAI warning');
        const typedAvoidance = avoidance as AvoidanceType;
        if (typedAvoidance === 'dump') this.statistics.dumpAttempts += 1;
        const lines = dialogueLines(typedAvoidance);
        const line = lines[this.random.int(0, lines.length)];
        const tags = Object.prototype.hasOwnProperty.call(BOSS_DIALOGUE_TAGS, line)
          ? BOSS_DIALOGUE_TAGS[line as keyof typeof BOSS_DIALOGUE_TAGS]
          : Object.freeze([] as string[]);
        if (tags.includes('simple-phrase')) this.statistics.simplePhraseCount += 1;
        events.push(event('boss-dialogue', {
          avoidance: typedAvoidance,
          line,
          tags,
        }));
        if (
          this.dayId === 'day-1'
          && typedAvoidance === 'dump'
          && this.statistics.dumpAttempts === 1
          && this.currentPhase === 'playing'
        ) this.changePhase('tutorial-paused', events);
      } else if (item.type === 'avoidance-succeeded') {
        this.applyAvoidance(item, events);
      } else if (item.type === 'boss-task-completed') {
        const instanceId = item.payload.taskInstanceId;
        if (!primitiveString(instanceId)) throw new Error('invalid BossAI completion');
        const task = this.requireTask(instanceId);
        const definition = this.requireDefinition(task.definitionId);
        this.finishStandardTask(instanceId, this.random.next() < definition.bossSuccess, true, events);
      }
    }
  }

  private applyAvoidance(item: DomainEvent, events: DomainEvent[]): void {
    const instanceId = item.payload.taskInstanceId;
    const avoidance = item.payload.avoidance;
    const legitimate = item.payload.legitimate;
    if (!primitiveString(instanceId) || !AVOIDANCES.has(avoidance) || typeof legitimate !== 'boolean') {
      throw new Error('invalid BossAI avoidance');
    }
    const task = this.requireTask(instanceId);
    const definition = this.requireDefinition(task.definitionId);
    switch (avoidance as AvoidanceType) {
      case 'meeting':
        this.statistics.meetings += 1;
        if (legitimate) {
          this.statistics.usefulMeetings += 1;
          this.applyMeters({ company: 1, trust: 1 }, events);
        } else {
          this.applyMeters({ company: -2 }, events);
        }
        break;
      case 'dump':
        this.statistics.dumpSuccesses += 1;
        this.applyMeters({ face: 2 }, events);
        this.tasks.reassignToEmployee(instanceId, this.clock.minuteOfDay);
        this.workerJobs.push({ instanceId, remainingMs: definition.workload * 2_000 });
        events.push(event('task-reassigned', { instanceId, assignee: 'employee' }));
        break;
      case 'outsource': {
        const cost = definition.workload * (legitimate ? 1 : 2);
        this.statistics.outsources += 1;
        this.statistics.outsourceCost += cost;
        this.applyMeters({ company: -cost }, events);
        this.finishSpecialSuccess(instanceId, events);
        break;
      }
      case 'change-request':
        this.applyMeters({ trust: -3, rectification: definition.workload * 2 }, events);
        this.finishSpecialSuccess(instanceId, events);
        break;
      case 'strategic-upgrade':
        this.statistics.meetings += 1;
        this.applyMeters({ company: -3 }, events);
        break;
    }
  }

  private finishSpecialSuccess(instanceId: string, events: DomainEvent[]): void {
    const task = this.requireTask(instanceId);
    const definition = this.requireDefinition(task.definitionId);
    events.push(this.tasks.complete(instanceId, true, this.clock.minuteOfDay));
    this.statistics.totalWorkload += definition.workload;
  }

  private finishStandardTask(
    instanceId: string,
    success: boolean,
    byBoss: boolean,
    events: DomainEvent[],
  ): void {
    const task = this.requireTask(instanceId);
    const definition = this.requireDefinition(task.definitionId);
    events.push(this.tasks.complete(instanceId, success, this.clock.minuteOfDay));
    if (success) {
      this.statistics.totalWorkload += definition.workload;
      if (byBoss) {
        this.statistics.bossCompleted += 1;
        this.statistics.bossWorkload += definition.workload;
        this.applyMeters({
          company: definition.workload,
          rectification: definition.workload * 4,
          face: -2,
          trust: 2,
        }, events);
      } else {
        this.applyMeters({ company: definition.workload }, events);
      }
    } else {
      this.applyMeters({ company: -(definition.urgency * 2), trust: -1 }, events);
    }
  }

  private processExpiryEvents(source: readonly DomainEvent[], events: DomainEvent[]): void {
    let applyConsequences = !this.company.failed;
    for (const item of source) {
      events.push(item);
      const instanceId = item.payload.instanceId;
      const definitionId = item.payload.definitionId;
      if (!primitiveString(instanceId) || !primitiveString(definitionId)) {
        throw new Error('invalid task expiry');
      }
      const definition = this.requireDefinition(definitionId);
      this.workerJobs = this.workerJobs.filter((job) => job.instanceId !== instanceId);
      const cancellation = this.boss.cancel(instanceId);
      events.push(...cancellation);
      if (applyConsequences) {
        this.applyMeters({ company: -(definition.urgency * 3), trust: -2 }, events);
        applyConsequences = !this.company.failed;
      }
    }
  }

  private offerScheduledTasks(events: DomainEvent[]): void {
    while (this.nextSpawnMs <= this.clock.elapsedRealMs) {
      const scheduledAt = this.nextSpawnMs;
      this.nextSpawnMs += this.day.spawnEveryMs;
      if (this.offeredCount() >= OFFER_CAPACITY) continue;
      const definition = TASK_DEFINITIONS[this.random.int(0, TASK_DEFINITIONS.length)];
      const task = this.tasks.offer(definition.id, minuteForElapsed(scheduledAt));
      events.push(event('task-offered', {
        instanceId: task.instanceId,
        definitionId: task.definitionId,
        source: 'schedule',
      }));
    }
  }

  private offerPendingVip(events: DomainEvent[]): void {
    if (this.pendingVipDefinitionId === undefined || this.offeredCount() >= OFFER_CAPACITY) return;
    const definitionId = this.pendingVipDefinitionId;
    const task = this.tasks.offer(definitionId, this.clock.minuteOfDay);
    this.pendingVipDefinitionId = undefined;
    events.push(event('task-offered', {
      instanceId: task.instanceId,
      definitionId,
      source: 'vip-visit',
    }));
  }

  private tryStartBoss(events: DomainEvent[]): void {
    if (this.currentPhase !== 'playing' || this.boss.snapshot().state !== 'idle') return;
    const queued = this.tasks.snapshot().tasks.find((task) => task.status === 'boss-queued');
    if (!queued) return;
    this.tasks.startBoss(queued.instanceId);
    const definition = this.requireDefinition(queued.definitionId);
    const taskSnapshot = this.tasks.snapshot().tasks;
    const modifiers = this.eventSystem.modifiers();
    let avoidanceMultiplier = modifiers.avoidanceChanceMultiplier;
    for (const conditional of modifiers.conditionalAvoidanceChanceMultipliers) {
      if (this.clock.minuteOfDay >= conditional.minMinuteOfDay) {
        avoidanceMultiplier *= conditional.multiplier;
      }
    }
    const accepted = this.boss.accept(
      queued.instanceId,
      definition,
      this.clock.elapsedRealMs,
      {
        face: this.company.snapshot().face,
        queueLength: taskSnapshot.filter((task) => (
          task.status === 'boss-queued' || task.status === 'boss-working'
        )).length,
        minuteOfDay: this.clock.minuteOfDay,
        difficulty: this.day.difficulty,
      },
      avoidanceMultiplier,
    );
    this.processBossEvents(accepted, events);
  }

  private applyMeters(
    delta: Partial<Record<MeterKey, number>>,
    events: DomainEvent[],
  ): void {
    const adjusted = { ...delta };
    if (adjusted.trust !== undefined && adjusted.trust > 0) {
      adjusted.trust *= this.eventSystem.modifiers().trustGainMultiplier;
    }
    events.push(...this.company.apply(adjusted));
  }

  private finishDay(events: DomainEvent[]): void {
    if (this.currentPhase === 'result') return;
    this.eventTriggerIndex = eventTriggers(this.dayId)
      .filter((trigger) => trigger <= this.clock.elapsedRealMs).length;
    const unresolved = this.tasks.snapshot().tasks.filter((task) => !TERMINAL_STATUSES.has(task.status));
    this.statistics.unresolvedUrgent += unresolved.filter((task) => (
      this.requireDefinition(task.definitionId).urgency >= 4
    )).length;
    const endEvents = this.tasks.expireAll();
    let applyConsequences = !this.company.failed;
    for (const item of endEvents) {
      events.push(item);
      const instanceId = item.payload.instanceId;
      const definitionId = item.payload.definitionId;
      if (!primitiveString(instanceId) || !primitiveString(definitionId)) {
        throw new Error('invalid task expiry');
      }
      this.workerJobs = this.workerJobs.filter((job) => job.instanceId !== instanceId);
      events.push(...this.boss.cancel(instanceId));
      const definition = this.requireDefinition(definitionId);
      if (definition.urgency >= 4 && applyConsequences) {
        this.applyMeters({ company: -(definition.urgency * 3), trust: -2 }, events);
        applyConsequences = !this.company.failed;
      }
    }
    this.workerJobs = [];
    this.pendingVipDefinitionId = undefined;
    this.currentResult = ResultSystem.evaluate({
      dayId: this.dayId,
      meters: this.company.snapshot(),
      stats: this.statistics,
    });
    events.push(event('day-result', {
      grade: this.currentResult.grade,
      score: this.currentResult.score,
      title: this.currentResult.title,
      goalMet: this.currentResult.goalMet,
    }));
    this.changePhase('result', events);
  }

  private changePhase(next: GamePhase, events: DomainEvent[]): void {
    const previous = this.currentPhase;
    this.currentPhase = next;
    if (next === 'playing') this.clock.resume();
    else this.clock.pause();
    events.push(event('phase-changed', { from: previous, to: next }));
  }

  private requirePhase(expected: GamePhase): void {
    if (this.currentPhase !== expected) throw new Error(`command requires ${expected} phase`);
  }

  private requireDefinition(definitionId: string): TaskDefinition {
    const definition = TASK_BY_ID.get(definitionId);
    if (!definition) throw new Error(`unknown task definition: ${definitionId}`);
    return definition;
  }

  private requireTask(instanceId: string): TaskInstance {
    const task = this.tasks.snapshot().tasks.find((candidate) => candidate.instanceId === instanceId);
    if (!task) throw new Error(`unknown task instance: ${instanceId}`);
    return task;
  }

  private offeredCount(): number {
    return this.tasks.snapshot().tasks.filter((task) => task.status === 'offered').length;
  }

  private parseAndBuildSnapshot(input: unknown): GameSession {
    const required = [
      'version', 'dayId', 'seed', 'rngState', 'phase', 'elapsedRealMs',
      'nextTaskSpawnMs', 'nextEventTriggerIndex', 'meters', 'permissions',
      'tasks', 'taskSequence', 'workerJobs', 'boss', 'activeEvents',
      'usedEventIds', 'stats',
    ];
    const allowed = [...required, 'pendingVipDefinitionId', 'pendingEventChoice'];
    const record = readDataRecord(input, allowed, required);
    if (
      record.version !== 1
      || record.dayId !== this.dayId
      || record.seed !== this.seed
      || !safeNonnegative(record.elapsedRealMs)
      || record.elapsedRealMs > WORKDAY_REAL_MS
      || typeof record.phase !== 'string'
      || !PHASES.has(record.phase)
      || !safeNonnegative(record.rngState)
      || record.rngState === 0
      || record.rngState > UINT32_MAX
      || !safeNonnegative(record.nextTaskSpawnMs)
      || !safeNonnegative(record.nextEventTriggerIndex)
      || !safeNonnegative(record.permissions)
      || record.permissions > 5
      || !safeNonnegative(record.taskSequence)
    ) invalidSnapshot();

    const elapsed = record.elapsedRealMs;
    const phase = record.phase as GamePhase;
    const meters = parseMeters(record.meters);
    const stats = parseStats(record.stats);
    const parsedTasks = readDataArray(record.tasks).map(parseTask);
    const workers = readDataArray(record.workerJobs).map(parseWorker);
    const boss = parseBoss(record.boss);
    const activeEvents = parseActiveEvents(record.activeEvents);
    const usedEventIds = parseUsedEvents(record.usedEventIds);
    const pendingEventChoice = parsePendingChoice(record.pendingEventChoice);
    const pendingVip = record.pendingVipDefinitionId;
    if (pendingVip !== undefined && pendingVip !== 'sales-complaint') invalidSnapshot();

    const currentMinute = minuteForElapsed(elapsed);
    if (record.taskSequence !== parsedTasks.length) invalidSnapshot();
    for (let taskIndex = 0; taskIndex < parsedTasks.length; taskIndex += 1) {
      const task = parsedTasks[taskIndex];
      const definition = this.requireDefinition(task.definitionId);
      const suffix = task.instanceId.slice(`${task.definitionId}-`.length);
      if (
        !task.instanceId.startsWith(`${task.definitionId}-`)
        || suffix !== String(taskIndex + 1)
        || task.offeredAtMinute < START_MINUTE
        || task.offeredAtMinute > currentMinute
        || task.deadlineAtMinute !== task.offeredAtMinute + definition.deadlineMinutes
        || (task.assignedAtMinute !== undefined
          && (task.assignedAtMinute < task.offeredAtMinute || task.assignedAtMinute > currentMinute))
        || (task.status === 'offered' && task.assignedAtMinute !== undefined)
        || ((task.status === 'employee-working'
          || task.status === 'boss-queued'
          || task.status === 'boss-working'
          || task.status === 'completed'
          || task.status === 'failed') && task.assignedAtMinute === undefined)
        || (phase !== 'result' && !TERMINAL_STATUSES.has(task.status)
          && task.deadlineAtMinute <= currentMinute)
      ) invalidSnapshot();
    }

    const tasksById = new Map(parsedTasks.map((task) => [task.instanceId, task]));
    const workerIds = new Set<string>();
    for (const worker of workers) {
      if (workerIds.has(worker.instanceId) || tasksById.get(worker.instanceId)?.status !== 'employee-working') {
        invalidSnapshot();
      }
      workerIds.add(worker.instanceId);
    }
    if (parsedTasks.some((task) => task.status === 'employee-working' && !workerIds.has(task.instanceId))) {
      invalidSnapshot();
    }
    const bossWorking = parsedTasks.filter((task) => task.status === 'boss-working');
    if (boss.state === 'idle') {
      if (bossWorking.length !== 0) invalidSnapshot();
    } else if (
      bossWorking.length !== 1
      || boss.taskInstanceId !== bossWorking[0].instanceId
    ) invalidSnapshot();
    if (boss.state === 'warning') {
      const definition = this.requireDefinition(bossWorking[0].definitionId);
      if (
        boss.remainingWorkMs > definition.workload * 2_500
        || avoidanceIsLegitimate(definition, boss.avoidance!) !== boss.avoidanceLegitimate
      ) {
        invalidSnapshot();
      }
    } else if (boss.state === 'working') {
      const definition = this.requireDefinition(bossWorking[0].definitionId);
      const delay = boss.nonWorkDelayRemainingMs ?? 0;
      if (
        delay > 4_000
        || delay >= boss.remainingWorkMs
        || boss.remainingWorkMs > definition.workload * 2_500 + delay
      ) invalidSnapshot();
    }

    const triggers = eventTriggers(this.dayId);
    const expectedTriggerIndex = triggers.filter((trigger) => trigger <= elapsed).length;
    if (
      record.nextEventTriggerIndex !== expectedTriggerIndex
      || (phase === 'result'
        ? usedEventIds.length > expectedTriggerIndex
        : usedEventIds.length !== expectedTriggerIndex)
      || new Set(usedEventIds).size !== usedEventIds.length
      || (phase !== 'result' && activeEvents.some((active) => active.expiresAtMs <= elapsed))
    ) invalidSnapshot();
    if (
      pendingVip !== undefined
      && (!usedEventIds.includes('vip-visit')
        || parsedTasks.filter((task) => task.status === 'offered').length < OFFER_CAPACITY)
    ) invalidSnapshot();

    const nextSpawn = record.nextTaskSpawnMs;
    if (
      nextSpawn % this.day.spawnEveryMs !== 0
      || nextSpawn > WORKDAY_REAL_MS + this.day.spawnEveryMs
      || (phase === 'intro' && (elapsed !== 0 || nextSpawn !== 0 || parsedTasks.length !== 0))
      || (phase === 'playing' && nextSpawn <= elapsed)
    ) invalidSnapshot();
    if (
      (phase !== 'result' && meters.company === 0)
      || (phase !== 'result' && elapsed >= WORKDAY_REAL_MS)
      || (phase === 'result' && elapsed < WORKDAY_REAL_MS && meters.company !== 0)
      || (phase === 'result' && parsedTasks.some((task) => !TERMINAL_STATUSES.has(task.status)))
      || (phase === 'result' && (workers.length !== 0 || boss.state !== 'idle'))
      || stats.bossWorkMs > elapsed
    ) invalidSnapshot();
    if (
      phase === 'tutorial-paused'
      && (this.dayId !== 'day-1'
        || boss.state !== 'warning'
        || boss.avoidance !== 'dump'
        || stats.dumpAttempts !== 1)
    ) invalidSnapshot();
    if (phase === 'intro') {
      const pristineRng = new SeededRandom(this.seed).snapshot();
      const pristineMeters = new CompanyState().snapshot();
      if (
        record.rngState !== pristineRng
        || record.permissions !== 5
        || Object.values(stats).some((value) => value !== 0)
        || meters.company !== pristineMeters.company
        || meters.rectification !== pristineMeters.rectification
        || meters.face !== pristineMeters.face
        || meters.trust !== pristineMeters.trust
        || boss.state !== 'idle'
        || activeEvents.length !== 0
        || usedEventIds.length !== 0
        || pendingEventChoice !== undefined
        || pendingVip !== undefined
      ) invalidSnapshot();
    }

    try {
      ResultSystem.evaluate({ dayId: this.dayId, meters, stats });
    } catch {
      invalidSnapshot();
    }

    const candidate = new GameSession(this.dayId, this.seed);
    try {
      candidate.random.restore(record.rngState);
      candidate.clock.restore({ elapsedRealMs: elapsed, paused: phase !== 'playing' });
      candidate.tasks.restore({ tasks: parsedTasks, sequence: record.taskSequence });
      candidate.rules.restore(record.permissions);
      candidate.boss.restore(boss);
      candidate.eventSystem.restore({
        activeEvents,
        usedEventIds,
        ...(pendingEventChoice === undefined ? {} : { pendingEventChoice }),
      });
      candidate.company = new CompanyState(meters);
    } catch {
      invalidSnapshot();
    }
    candidate.currentPhase = phase;
    candidate.nextSpawnMs = nextSpawn;
    candidate.eventTriggerIndex = record.nextEventTriggerIndex;
    candidate.pendingVipDefinitionId = pendingVip as string | undefined;
    candidate.workerJobs = workers.map((worker) => ({ ...worker }));
    candidate.statistics = { ...stats };
    candidate.currentResult = phase === 'result'
      ? ResultSystem.evaluate({ dayId: this.dayId, meters, stats })
      : undefined;
    return candidate;
  }
}
