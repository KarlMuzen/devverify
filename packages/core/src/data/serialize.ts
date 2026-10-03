import { type ZodType } from 'zod';
import {
  AppRecordSchema,
  EventRecordSchema,
  MetaSchema,
  TimeseriesRowSchema,
  type AppRecord,
  type EventRecord,
  type Meta,
  type TimeseriesRow,
} from './schemas.js';

export class DataFormatError extends Error {
  public readonly code = 'DATA_FORMAT_ERROR';

  public constructor(message: string) {
    super(message);
    this.name = 'DataFormatError';
  }
}

export const DATA_FILES = {
  apps: 'apps.ndjson',
  events: 'events.ndjson',
  timeseries: 'timeseries.csv',
  meta: 'meta.json',
} as const;

type DatasetRecord = AppRecord | EventRecord;

const APP_KEYS: readonly (keyof AppRecord)[] = [
  'package',
  'source',
  'fingerprints',
  'checkedFingerprints',
  'status',
  'firstSeenAt',
  'checkedAt',
  'statusChangedAt',
  'firstRegisteredAt',
  'errorCount',
  'lastError',
  'removedAt',
];

const EVENT_KEYS: readonly (keyof EventRecord)[] = ['at', 'package', 'from', 'to'];

function orderedRecord(value: DatasetRecord): Record<string, unknown> {
  const record = value as unknown as Record<string, unknown>;
  const keys = 'source' in record ? APP_KEYS : EVENT_KEYS;
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in record && record[key] !== undefined) {
      result[key] = record[key];
    }
  }
  return result;
}

function compareRecords(left: DatasetRecord, right: DatasetRecord): number {
  const leftRecord = left as unknown as Record<string, unknown>;
  const rightRecord = right as unknown as Record<string, unknown>;
  if ('source' in leftRecord && 'source' in rightRecord) {
    return left.package.localeCompare(right.package);
  }
  if ('at' in leftRecord && 'at' in rightRecord) {
    return left.at.localeCompare(right.at) ||
      left.package.localeCompare(right.package) ||
      left.to.localeCompare(right.to);
  }
  return 'source' in leftRecord ? -1 : 1;
}

export function toNdjson(records: readonly DatasetRecord[]): string {
  if (records.length === 0) {
    return '';
  }
  const lines = [...records]
    .sort(compareRecords)
    .map((record) => JSON.stringify(orderedRecord(record)));
  return lines.join('\n') + '\n';
}

export function parseNdjson<T>(
  text: string,
  schema: ZodType<T>,
  label = 'NDJSON',
): T[] {
  if (text.length === 0) {
    return [];
  }
  const lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n');
  return lines.map((line, index) => {
    const lineNumber = index + 1;
    if (line.trim().length === 0) {
      throw new DataFormatError(label + ' line ' + lineNumber + ' is empty.');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      throw new DataFormatError(label + ' line ' + lineNumber + ' is not valid JSON.');
    }
    const result = schema.safeParse(parsed);
    if (!result.success) {
      throw new DataFormatError(
        label + ' line ' + lineNumber + ' is invalid: ' +
          (result.error.issues[0]?.message ?? 'schema error') + '.',
      );
    }
    return result.data;
  });
}

export function toTimeseriesCsv(rows: readonly TimeseriesRow[]): string {
  const header = 'date,total,registered,registered_other_key,not_registered,unknown';
  const lines = [...rows]
    .map((row) => TimeseriesRowSchema.parse(row))
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((row) => [
      row.date,
      row.total,
      row.registered,
      row.registered_other_key,
      row.not_registered,
      row.unknown,
    ].join(','));
  return [header, ...lines].join('\n') + '\n';
}

export function parseTimeseriesCsv(text: string): TimeseriesRow[] {
  if (text.length === 0) {
    return [];
  }
  const lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n');
  const header = 'date,total,registered,registered_other_key,not_registered,unknown';
  if (lines[0] !== header) {
    throw new DataFormatError('Timeseries CSV header is invalid.');
  }
  return lines.slice(1).map((line, index) => {
    const lineNumber = index + 2;
    const fields = line.split(',');
    if (fields.length !== 6) {
      throw new DataFormatError('Timeseries CSV line ' + lineNumber + ' has the wrong field count.');
    }
    const [date, total, registered, otherKey, notRegistered, unknown] = fields;
    const numbers = [total, registered, otherKey, notRegistered, unknown].map(Number);
    if (numbers.some((value) => !Number.isInteger(value) || value < 0)) {
      throw new DataFormatError('Timeseries CSV line ' + lineNumber + ' contains an invalid count.');
    }
    const result = TimeseriesRowSchema.safeParse({
      date,
      total: numbers[0],
      registered: numbers[1],
      registered_other_key: numbers[2],
      not_registered: numbers[3],
      unknown: numbers[4],
    });
    if (!result.success) {
      throw new DataFormatError(
        'Timeseries CSV line ' + lineNumber + ' is invalid: ' +
          (result.error.issues[0]?.message ?? 'schema error') + '.',
      );
    }
    return result.data;
  });
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (typeof value === 'object' && value !== null) {
    const input = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) {
      result[key] = sortKeys(input[key]);
    }
    return result;
  }
  return value;
}

export function toMetaJson(meta: Meta): string {
  return JSON.stringify(sortKeys(MetaSchema.parse(meta)), null, 2) + '\n';
}

export function parseMetaJson(text: string): Meta {
  if (text.length === 0) {
    throw new DataFormatError('meta.json is empty.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new DataFormatError('meta.json is not valid JSON.');
  }
  const result = MetaSchema.safeParse(parsed);
  if (!result.success) {
    throw new DataFormatError(
      'meta.json is invalid: ' + (result.error.issues[0]?.message ?? 'schema error') + '.',
    );
  }
  return result.data;
}

export function parseAppsNdjson(text: string): AppRecord[] {
  return parseNdjson(text, AppRecordSchema, 'apps.ndjson');
}

export function parseEventsNdjson(text: string): EventRecord[] {
  return parseNdjson(text, EventRecordSchema, 'events.ndjson');
}