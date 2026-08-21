import type { MeterSnapshot } from './model';
import type { DayId } from './content/days';

export type ResultGrade = 'SSS' | 'S' | 'A' | 'B' | 'C' | 'F';
export type ReportEmphasis = 'good' | 'bad' | 'funny';

export interface ReportRow {
  readonly label: string;
  readonly value: string;
  readonly emphasis?: ReportEmphasis;
}

export interface SessionStatistics {
  readonly bossCompleted: number;
  readonly bossWorkload: number;
  readonly totalWorkload: number;
  readonly bossWorkMs: number;
  readonly meetings: number;
  readonly usefulMeetings: number;
  readonly dumpAttempts: number;
  readonly dumpSuccesses: number;
  readonly outsources: number;
  readonly outsourceCost: number;
  readonly simplePhraseCount: number;
  readonly unresolvedUrgent: number;
  readonly counteredAvoidances?: number;
}

export interface ResultInput {
  readonly dayId: DayId;
  readonly meters: MeterSnapshot;
  readonly stats: SessionStatistics;
}

export interface DayResult {
  readonly grade: ResultGrade;
  readonly score: number;
  readonly title: string;
  readonly goalMet: boolean;
  readonly report: readonly ReportRow[];
}

const INPUT_KEYS = Object.freeze(['dayId', 'meters', 'stats'] as const);
const METER_KEYS = Object.freeze(['company', 'rectification', 'face', 'trust'] as const);
const REQUIRED_STAT_KEYS = Object.freeze([
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
] as const);
const OPTIONAL_STAT_KEYS = Object.freeze(['counteredAvoidances'] as const);
const INTEGER_STAT_KEYS = new Set<string>([
  'bossCompleted',
  'bossWorkload',
  'totalWorkload',
  'meetings',
  'usefulMeetings',
  'dumpAttempts',
  'dumpSuccesses',
  'outsources',
  'outsourceCost',
  'simplePhraseCount',
  'unresolvedUrgent',
  'counteredAvoidances',
]);
const DAY_IDS: ReadonlySet<string> = new Set(['day-1', 'day-2', 'day-3']);

type DataRecord = Readonly<Record<string, unknown>>;

function parseDataRecord(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[],
  errorMessage: string,
): DataRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(errorMessage);
  }

  let descriptorSnapshot: PropertyDescriptorMap;
  try {
    descriptorSnapshot = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw new Error(errorMessage);
  }
  const descriptors = descriptorSnapshot as Record<PropertyKey, PropertyDescriptor>;
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  const ownKeys = Reflect.ownKeys(descriptorSnapshot);
  if (
    ownKeys.some((key) => typeof key !== 'string' || !allowed.has(key))
    || requiredKeys.some((key) => !Object.prototype.hasOwnProperty.call(descriptorSnapshot, key))
  ) {
    throw new Error(errorMessage);
  }

  const parsed: Record<string, unknown> = {};
  for (const key of ownKeys) {
    if (typeof key !== 'string') throw new Error(errorMessage);
    const descriptor = descriptors[key];
    if (
      descriptor === undefined
      || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
    ) {
      throw new Error(errorMessage);
    }
    parsed[key] = descriptor.value;
  }
  return parsed;
}

function parseDayId(value: unknown): DayId {
  if (typeof value !== 'string' || !DAY_IDS.has(value)) throw new Error('invalid day ID');
  return value as DayId;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseMeters(value: unknown): MeterSnapshot {
  const record = parseDataRecord(value, METER_KEYS, [], 'invalid meters');
  const meters: Partial<MeterSnapshot> = {};
  for (const key of METER_KEYS) {
    const meter = record[key];
    if (!isFiniteNumber(meter) || meter < 0 || meter > 100) {
      throw new Error('invalid meters');
    }
    meters[key] = meter;
  }
  return meters as MeterSnapshot;
}

function parseStatistics(value: unknown): SessionStatistics {
  const record = parseDataRecord(
    value,
    REQUIRED_STAT_KEYS,
    OPTIONAL_STAT_KEYS,
    'invalid statistics',
  );
  const parsed: Record<string, number> = {};
  for (const key of Reflect.ownKeys(record)) {
    if (typeof key !== 'string') throw new Error('invalid statistics');
    const statistic = record[key];
    if (
      !isFiniteNumber(statistic)
      || statistic < 0
      || (INTEGER_STAT_KEYS.has(key) && !Number.isSafeInteger(statistic))
    ) {
      throw new Error('invalid statistics');
    }
    parsed[key] = statistic;
  }

  if (
    parsed.bossWorkload > parsed.totalWorkload
    || parsed.bossCompleted > parsed.bossWorkload
    || (parsed.bossCompleted === 0 && parsed.bossWorkload !== 0)
    || parsed.usefulMeetings > parsed.meetings
    || parsed.dumpSuccesses > parsed.dumpAttempts
    || (parsed.outsources === 0 && parsed.outsourceCost !== 0)
  ) {
    throw new Error('invalid statistics');
  }

  return parsed as unknown as SessionStatistics;
}

function parseInput(input: unknown): ResultInput {
  const record = parseDataRecord(input, INPUT_KEYS, [], 'invalid result input');
  return {
    dayId: parseDayId(record.dayId),
    meters: parseMeters(record.meters),
    stats: parseStatistics(record.stats),
  };
}

function goalMet(dayId: DayId, meters: MeterSnapshot, stats: SessionStatistics): boolean {
  switch (dayId) {
    case 'day-1':
      return stats.bossCompleted >= 3;
    case 'day-2':
      return (stats.totalWorkload === 0 ? 0 : stats.bossWorkload / stats.totalWorkload) >= 0.35;
    case 'day-3':
      return meters.company >= 50 && meters.rectification >= 70;
  }
}

function calculateScore(meters: MeterSnapshot): number {
  const faceBalance = Math.max(0, 100 - Math.abs(meters.face - 50) * 2);
  return Math.round(
    meters.rectification * 0.40
    + meters.company * 0.25
    + meters.trust * 0.20
    + faceBalance * 0.15,
  );
}

function calculateGrade(
  meters: MeterSnapshot,
  stats: SessionStatistics,
  metGoal: boolean,
  score: number,
): ResultGrade {
  if (meters.company === 0) return 'F';
  if (
    metGoal
    && meters.company >= 70
    && meters.trust >= 70
    && meters.face >= 30
    && meters.face <= 70
    && stats.unresolvedUrgent === 0
  ) return 'SSS';
  if (metGoal && score >= 85) return 'S';
  if (metGoal && score >= 70) return 'A';
  if (score >= 55) return 'B';
  return 'C';
}

function calculateTitle(
  grade: ResultGrade,
  meters: MeterSnapshot,
  stats: SessionStatistics,
): string {
  if (grade === 'SSS') return '让老板心甘情愿打工的人';
  if (stats.meetings >= 5 && stats.usefulMeetings / stats.meetings < 0.3) {
    return '会议终结者';
  }
  if (stats.dumpAttempts >= 4 && stats.dumpSuccesses === 0) return '甩锅回旋镖大师';
  if (meters.rectification === 100 && meters.face < 20) return '赛博周扒皮';
  if (meters.company < 30) return '公司还活着就行';
  return '温和改革派';
}

function row(label: string, value: string, emphasis: ReportEmphasis): ReportRow {
  return Object.freeze({ label, value, emphasis });
}

function formatWorkTime(bossWorkMs: number): string {
  const totalMinutes = Math.round(bossWorkMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}小时${minutes}分钟`;
}

function buildReport(meters: MeterSnapshot, stats: SessionStatistics): readonly ReportRow[] {
  return Object.freeze([
    row('老板亲自工作时长', formatWorkTime(stats.bossWorkMs), 'good'),
    row('老板完成任务数量', `${stats.bossCompleted}个`, 'good'),
    row('老板完成工作量', `${stats.bossWorkload}点`, 'good'),
    row('主持会议次数', `${stats.meetings}次`, 'funny'),
    row('有效会议次数', `${stats.usefulMeetings}次`, 'good'),
    row('尝试甩锅次数', `${stats.dumpAttempts}次`, 'funny'),
    row('成功甩锅次数', `${stats.dumpSuccesses}次`, 'funny'),
    row('外包次数', `${stats.outsources}次`, 'funny'),
    row('外包成本', `${stats.outsourceCost}点`, stats.outsourceCost === 0 ? 'good' : 'bad'),
    row('“这个很简单”出现次数', `${stats.simplePhraseCount}次`, 'funny'),
    row('公司经营', `${meters.company}`, meters.company >= 50 ? 'good' : 'bad'),
    row('整改进度', `${meters.rectification}`, meters.rectification >= 70 ? 'good' : 'bad'),
    row('老板面子', `${meters.face}`, 'funny'),
    row('董事会信任', `${meters.trust}`, meters.trust >= 50 ? 'good' : 'bad'),
  ]);
}

export class ResultSystem {
  static evaluate(input: ResultInput): DayResult {
    const parsed = parseInput(input);
    const metGoal = goalMet(parsed.dayId, parsed.meters, parsed.stats);
    const score = calculateScore(parsed.meters);
    const grade = calculateGrade(parsed.meters, parsed.stats, metGoal, score);
    return Object.freeze({
      grade,
      score,
      title: calculateTitle(grade, parsed.meters, parsed.stats),
      goalMet: metGoal,
      report: buildReport(parsed.meters, parsed.stats),
    });
  }
}
