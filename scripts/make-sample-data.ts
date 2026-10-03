import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  toMetaJson,
  toNdjson,
  toTimeseriesCsv,
  type AppRecord,
  type EventRecord,
  type Meta,
  type TimeseriesRow,
} from '../packages/core/src/data/index.js';

const SEED = 0xdecafbad;
const PACKAGE_COUNT = 80;
const DAYS = 120;
const EVENT_COUNT = 60;
const END_DATE = '2026-10-01';

function nextRandom(state: { value: number }): number {
  state.value = (state.value + 0x6d2b79f5) >>> 0;
  let value = Math.imul(state.value ^ (state.value >>> 15), 1 | state.value);
  value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

function dateFromEnd(offset: number): string {
  const date = new Date(END_DATE + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

function timestamp(dayOffset: number, hour: number): string {
  return dateFromEnd(dayOffset) + 'T' + String(hour).padStart(2, '0') + ':00:00Z';
}

function fingerprint(index: number, variant: number): string {
  return Array.from({ length: 32 }, (_, byte) =>
    ((index * 13 + variant * 17 + byte * 7) % 256).toString(16).padStart(2, '0').toUpperCase(),
  ).join(':');
}

function buildApps(): AppRecord[] {
  const state = { value: SEED };
  const statuses = ['registered', 'registered_other_key', 'not_registered', 'unknown'] as const;
  return Array.from({ length: PACKAGE_COUNT }, (_, index) => {
    const status = statuses[Math.floor(nextRandom(state) * statuses.length)] ?? 'unknown';
    const firstSeenAt = timestamp(150 - (index % 20), index % 24);
    const fingerprints = [fingerprint(index, 0)];
    if (index % 11 === 0) fingerprints.push(fingerprint(index, 1));
    const checkedFingerprints = index % 3 === 0 ? [] : [fingerprints[0]];
    const checkedAt = checkedFingerprints.length > 0 ? timestamp(90 - (index % 18), (index + 3) % 24) : undefined;
    const errorCount = index % 23 === 0 ? 1 : 0;
    const removedAt = index % 17 === 0 ? timestamp(15 + (index % 5), 4) : undefined;
    const record: AppRecord = {
      package: 'com.example.app' + String(index).padStart(2, '0'),
      source: 'fdroid',
      fingerprints,
      checkedFingerprints,
      status,
      firstSeenAt,
      errorCount,
    };
    if (checkedAt !== undefined) record.checkedAt = checkedAt;
    if (status !== 'unknown') record.statusChangedAt = timestamp(100 - (index % 25), 6);
    if (status === 'registered') record.firstRegisteredAt = timestamp(100 - (index % 25), 6);
    if (errorCount > 0) {
      record.lastError = {
        at: timestamp(5, 2),
        code: 'TRANSIENT',
        message: 'synthetic fixture error',
      };
    }
    if (removedAt !== undefined) record.removedAt = removedAt;
    return record;
  }).sort((left, right) => left.package.localeCompare(right.package));
}

function buildEvents(): EventRecord[] {
  const statuses = ['registered', 'registered_other_key', 'not_registered', 'unknown'] as const;
  return Array.from({ length: EVENT_COUNT }, (_, index) => ({
    at: timestamp(index * 2, index % 24),
    package: 'com.example.app' + String((index * 7) % PACKAGE_COUNT).padStart(2, '0'),
    from: index === 0 ? null : statuses[(index - 1) % statuses.length] ?? null,
    to: statuses[index % statuses.length] ?? 'unknown',
  })).sort((left, right) => left.at.localeCompare(right.at) || left.package.localeCompare(right.package));
}

function buildTimeseries(): TimeseriesRow[] {
  return Array.from({ length: DAYS }, (_, index) => {
    const total = PACKAGE_COUNT - Math.floor(index / 40);
    const registered = 12 + (index % 7);
    const registeredOther = 10 + (index % 5);
    const notRegistered = 30 + (index % 11);
    return {
      date: dateFromEnd(DAYS - 1 - index),
      total,
      registered,
      registered_other_key: registeredOther,
      not_registered: notRegistered,
      unknown: total - registered - registeredOther - notRegistered,
    };
  });
}

function buildMeta(): Meta {
  return {
    schemaVersion: 1,
    sources: {
      fdroid: {
        etag: '"sample-fixture-v1"',
        lastModified: 'Thu, 01 Oct 2026 00:00:00 GMT',
        fetchedAt: '2026-10-01T00:05:00Z',
        packageCount: PACKAGE_COUNT,
      },
    },
    lastRun: {
      startedAt: '2026-10-01T00:10:00Z',
      finishedAt: '2026-10-01T00:12:00Z',
      requestsUsed: 80,
      budget: 950,
      exitReason: 'completed',
      counts: {
        registered: 20,
        registered_other_key: 20,
        not_registered: 20,
        unknown: 20,
      },
    },
  };
}

async function main(): Promise<void> {
  const directory = fileURLToPath(new URL('../fixtures/sample-data/', import.meta.url));
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'apps.ndjson'), toNdjson(buildApps()), 'utf8');
  await writeFile(join(directory, 'events.ndjson'), toNdjson(buildEvents()), 'utf8');
  await writeFile(join(directory, 'timeseries.csv'), toTimeseriesCsv(buildTimeseries()), 'utf8');
  await writeFile(join(directory, 'meta.json'), toMetaJson(buildMeta()), 'utf8');
  void dirname;
}

await main();