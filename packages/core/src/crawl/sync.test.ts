import { describe, expect, it } from 'vitest';
import type { AppRecord } from '../data/schemas.js';
import { syncRecords } from './sync.js';

const NOW = '2026-10-03T12:00:00.000Z';

function record(
  packageName: string,
  overrides: Partial<AppRecord> = {},
): AppRecord {
  return {
    package: packageName,
    source: 'fdroid',
    fingerprints: ['a'.repeat(64)],
    checkedFingerprints: ['a'.repeat(64)],
    status: 'not_registered',
    firstSeenAt: '2026-09-01T00:00:00.000Z',
    checkedAt: '2026-10-02T12:00:00.000Z',
    errorCount: 0,
    ...overrides,
  };
}

describe('syncRecords', () => {
  it('adds new entries as unknown and never checked', () => {
    const result = syncRecords({
      records: [],
      entries: [{ package: 'com.example.new', fingerprints: ['b'.repeat(64)] }],
      now: NOW,
      source: 'fdroid',
    });

    expect(result.added).toBe(1);
    expect(result.removed).toBe(0);
    expect(result.fingerprintChanged).toBe(0);
    expect(result.records).toEqual([
      {
        package: 'com.example.new',
        source: 'fdroid',
        fingerprints: ['b'.repeat(64)],
        checkedFingerprints: [],
        status: 'unknown',
        firstSeenAt: NOW,
        errorCount: 0,
      },
    ]);
  });

  it('marks missing records removed but preserves their existing removal timestamp', () => {
    const alreadyRemoved = record('com.example.old', {
      removedAt: '2026-09-20T00:00:00.000Z',
    });
    const result = syncRecords({
      records: [record('com.example.missing'), alreadyRemoved],
      entries: [],
      now: NOW,
      source: 'fdroid',
    });

    expect(result.removed).toBe(1);
    expect(result.records).toEqual([
      expect.objectContaining({
        package: 'com.example.missing',
        removedAt: NOW,
      }),
      expect.objectContaining({
        package: 'com.example.old',
        removedAt: '2026-09-20T00:00:00.000Z',
      }),
    ]);
  });

  it('clears removedAt when an entry reappears and detects fingerprint changes', () => {
    const result = syncRecords({
      records: [
        record('com.example.changed', {
          removedAt: '2026-10-01T00:00:00.000Z',
          fingerprints: ['a'.repeat(64)],
          checkedFingerprints: ['a'.repeat(64)],
          checkedAt: '2026-10-02T00:00:00.000Z',
        }),
      ],
      entries: [
        {
          package: 'com.example.changed',
          fingerprints: ['c'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)],
        },
      ],
      now: NOW,
      source: 'fdroid',
    });

    expect(result.fingerprintChanged).toBe(1);
    expect(result.records).toEqual([
      expect.objectContaining({
        package: 'com.example.changed',
        fingerprints: ['b'.repeat(64), 'c'.repeat(64)],
        checkedFingerprints: [],
        checkedAt: undefined,
        removedAt: undefined,
        status: 'not_registered',
      }),
    ]);
  });

  it('purges records removed for more than 30 days', () => {
    const result = syncRecords({
      records: [
        record('com.example.keep', {
          removedAt: '2026-09-04T12:00:00.000Z',
        }),
        record('com.example.purge', {
          removedAt: '2026-09-03T11:59:59.000Z',
        }),
      ],
      entries: [],
      now: NOW,
      source: 'fdroid',
    });

    expect(result.records.map((item) => item.package)).toEqual([
      'com.example.keep',
    ]);
  });

  it('is deterministic and merges duplicate source entries by fingerprint set', () => {
    const a = syncRecords({
      records: [record('com.example.existing')],
      entries: [
        { package: 'com.example.new', fingerprints: ['b'.repeat(64)] },
        { package: 'com.example.new', fingerprints: ['a'.repeat(64)] },
      ],
      now: NOW,
      source: 'fdroid',
    });
    const b = syncRecords({
      records: [record('com.example.existing')],
      entries: [
        { package: 'com.example.new', fingerprints: ['a'.repeat(64)] },
        { package: 'com.example.new', fingerprints: ['b'.repeat(64)] },
      ],
      now: NOW,
      source: 'fdroid',
    });

    expect(a).toEqual(b);
    expect(a.records.find((item) => item.package === 'com.example.new')?.fingerprints).toEqual([
      'a'.repeat(64),
      'b'.repeat(64),
    ]);
  });

  it('rejects invalid timestamps', () => {
    expect(() =>
      syncRecords({
        records: [],
        entries: [],
        now: 'not-a-date',
        source: 'fdroid',
      }),
    ).toThrow(/valid ISO timestamp/);
  });
});
