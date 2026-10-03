import { describe, expect, it } from 'vitest';
import type { AppRecord } from '../data/schemas.js';
import {
  DEFAULT_AVERAGE_CALLS_PER_PACKAGE,
  DEFAULT_PRIORITY_WEIGHTS,
  DEFAULT_RECHECK_AFTER_HOURS,
  selectBatch,
} from './schedule.js';

const START = '2026-01-01T00:00:00.000Z';

function record(
  packageName: string,
  status: AppRecord['status'],
  checkedAt = START,
  overrides: Partial<AppRecord> = {},
): AppRecord {
  return {
    package: packageName,
    source: 'fdroid',
    fingerprints: ['a'.repeat(64)],
    checkedFingerprints: ['a'.repeat(64)],
    status,
    firstSeenAt: '2025-12-01T00:00:00.000Z',
    checkedAt,
    errorCount: 0,
    ...overrides,
  };
}

describe('selectBatch', () => {
  it('exports the specified defaults and derives package capacity from call budget', () => {
    expect(DEFAULT_RECHECK_AFTER_HOURS).toEqual({
      not_registered: 24,
      registered_other_key: 24,
      unknown: 12,
      registered: 168,
    });
    expect(DEFAULT_PRIORITY_WEIGHTS).toEqual({
      not_registered: 2,
      registered_other_key: 1,
      unknown: 1,
      registered: 3,
    });
    expect(Math.floor(950 / DEFAULT_AVERAGE_CALLS_PER_PACKAGE)).toBe(730);
  });

  it('selects never-checked records first by firstSeenAt then package', () => {
    const records = [
      record('com.example.checked', 'registered'),
      record('com.example.new-b', 'unknown', undefined, {
        checkedAt: undefined,
        firstSeenAt: '2025-12-02T00:00:00.000Z',
      }),
      record('com.example.new-a', 'unknown', undefined, {
        checkedAt: undefined,
        firstSeenAt: '2025-12-01T00:00:00.000Z',
      }),
      record('com.example.removed', 'unknown', undefined, {
        checkedAt: undefined,
        firstSeenAt: '2025-11-01T00:00:00.000Z',
        removedAt: START,
      }),
    ];

    expect(
      selectBatch({
        records,
        now: '2026-01-10T00:00:00.000Z',
        budget: 100,
        config: { maxPackages: 2 },
      }),
    ).toEqual(['com.example.new-a', 'com.example.new-b']);
  });

  it('ranks due records by weighted age and breaks ties by package name', () => {
    const now = '2026-01-02T00:00:00.000Z';
    const records = [
      record('com.example.registered', 'registered'),
      record('com.example.not', 'not_registered'),
      record('com.example.other', 'registered_other_key'),
      record('com.example.unknown', 'unknown'),
    ];

    const selected = selectBatch({
      records,
      now,
      budget: 10,
      config: { maxPackages: 2 },
    });

    expect(selected).toEqual(['com.example.not', 'com.example.unknown']);
  });

  it('honors error backoff using the last attempt timestamp', () => {
    const records = [
      record('com.example.one', 'not_registered', START, {
        errorCount: 1,
        lastError: {
          at: '2026-01-01T23:00:00.000Z',
          code: 'TRANSIENT_ERROR',
          message: 'one',
        },
      }),
      record('com.example.two', 'not_registered', START, {
        errorCount: 3,
        lastError: {
          at: START,
          code: 'TRANSIENT_ERROR',
          message: 'two',
        },
      }),
    ];

    expect(
      selectBatch({
        records,
        now: '2026-01-02T00:00:00.000Z',
        budget: 10,
        config: { maxPackages: 10 },
      }),
    ).toEqual(['com.example.one']);

    expect(
      selectBatch({
        records,
        now: '2026-01-02T09:00:00.000Z',
        budget: 10,
        config: { maxPackages: 10 },
      }),
    ).toEqual(['com.example.two', 'com.example.one']);
  });

  it('excludes removed records and is deterministic', () => {
    const records = [
      record('com.example.a', 'not_registered'),
      record('com.example.b', 'not_registered'),
      record('com.example.removed', 'not_registered', START, { removedAt: START }),
    ];
    const options = {
      records,
      now: '2026-01-02T00:00:00.000Z',
      budget: 10,
      config: { maxPackages: 10 },
    };

    expect(selectBatch(options)).toEqual(selectBatch(options));
    expect(selectBatch(options)).not.toContain('com.example.removed');
  });

  it('validates budgets and configuration', () => {
    expect(() =>
      selectBatch({
        records: [],
        now: START,
        budget: -1,
      }),
    ).toThrow(/non-negative/);

    expect(() =>
      selectBatch({
        records: [],
        now: START,
        budget: 10,
        config: { recheckAfterHours: { unknown: 0 } },
      }),
    ).toThrow(/positive/);

    expect(() =>
      selectBatch({
        records: [],
        now: START,
        budget: 10,
        config: { maxPackages: -1 },
      }),
    ).toThrow(/non-negative/);
  });

  it('keeps the 3,800-record simulation within the required bounds', () => {
    const total = 3_800;
    const budget = 950;
    const maxPackages = Math.floor(budget / DEFAULT_AVERAGE_CALLS_PER_PACKAGE);
    const start = new Date('2026-01-01T00:00:00.000Z');
    let records: AppRecord[] = Array.from({ length: total }, (_, index) => {
      const bucket = index % 10;
      const status =
        bucket < 7
          ? 'not_registered'
          : bucket === 7
            ? 'registered_other_key'
            : bucket === 8
              ? 'unknown'
              : 'registered';
      return record('com.example.' + index.toString().padStart(4, '0'), status);
    });

    const lastChecked = new Map<string, Date>(records.map((item) => [item.package, start]));
    let maxNotRegisteredWait = 0;
    let maxAnyWait = 0;

    for (let day = 1; day <= 60; day += 1) {
      const now = new Date(start.getTime() + day * 86_400_000);
      const selected = selectBatch({
        records,
        now: now.toISOString(),
        budget,
        config: { maxPackages },
      });

      const selectedSet = new Set(selected);
      const nextChecked = new Map(lastChecked);
      for (const packageName of selected) {
        const previous = lastChecked.get(packageName);
        if (previous !== undefined) {
          const waitDays = (now.getTime() - previous.getTime()) / 86_400_000;
          maxAnyWait = Math.max(maxAnyWait, waitDays);
          const selectedRecord = records.find((item) => item.package === packageName);
          if (selectedRecord?.status === 'not_registered') {
            maxNotRegisteredWait = Math.max(maxNotRegisteredWait, waitDays);
          }
        }
        nextChecked.set(packageName, now);
      }
      lastChecked.clear();
      for (const entry of nextChecked) {
        lastChecked.set(entry[0], entry[1]);
      }

      records = records.map((item) =>
        selectedSet.has(item.package)
          ? { ...item, checkedAt: now.toISOString(), errorCount: 0 }
          : item,
      );
    }

    expect(maxNotRegisteredWait).toBeLessThanOrEqual(5);
    expect(maxAnyWait).toBeLessThanOrEqual(30);
  });
});
