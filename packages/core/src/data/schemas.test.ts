import { describe, expect, it } from 'vitest';
import { AppRecordSchema, MetaSchema, TimeseriesRowSchema } from './schemas.js';

describe('dataset schemas', () => {
  it('defaults errorCount and accepts optional record metadata', () => {
    const record = AppRecordSchema.parse({
      package: 'com.example.test',
      source: 'fdroid',
      fingerprints: ['AA'],
      checkedFingerprints: [],
      status: 'unknown',
      firstSeenAt: '2026-10-01T00:00:00Z',
    });
    expect(record.errorCount).toBe(0);
  });

  it('rejects invalid dates and statuses', () => {
    expect(() =>
      AppRecordSchema.parse({
        package: 'com.example.test',
        source: 'fdroid',
        fingerprints: [],
        checkedFingerprints: [],
        status: 'pending',
        firstSeenAt: 'not-a-date',
      }),
    ).toThrow();
    expect(() =>
      TimeseriesRowSchema.parse({
        date: '2026-1-1',
        total: 1,
        registered: 1,
        registered_other_key: 0,
        not_registered: 0,
        unknown: 0,
      }),
    ).toThrow();
  });

  it('rejects newer dataset metadata', () => {
    expect(() =>
      MetaSchema.parse({
        schemaVersion: 2,
        sources: {},
      }),
    ).toThrow();
  });
});
