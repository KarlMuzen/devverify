import { describe, expect, it } from 'vitest';
import {
  parseAppsNdjson,
  parseEventsNdjson,
  parseMetaJson,
  parseTimeseriesCsv,
  toMetaJson,
  toNdjson,
  toTimeseriesCsv,
} from './serialize.js';

const appA = {
  package: 'com.example.a',
  source: 'fdroid' as const,
  fingerprints: ['BB', 'AA'],
  checkedFingerprints: ['AA'],
  status: 'registered' as const,
  firstSeenAt: '2026-10-01T00:00:00Z',
  errorCount: 0,
};

const appB = {
  package: 'com.example.b',
  source: 'fdroid' as const,
  fingerprints: [],
  checkedFingerprints: [],
  status: 'unknown' as const,
  firstSeenAt: '2026-10-02T00:00:00Z',
  errorCount: 0,
};

describe('dataset serialization', () => {
  it('sorts apps and preserves the fixed app key order', () => {
    const text = toNdjson([appB, appA]);
    expect(text).toBe(
      '{"package":"com.example.a","source":"fdroid","fingerprints":["BB","AA"],"checkedFingerprints":["AA"],"status":"registered","firstSeenAt":"2026-10-01T00:00:00Z","errorCount":0}\n' +
      '{"package":"com.example.b","source":"fdroid","fingerprints":[],"checkedFingerprints":[],"status":"unknown","firstSeenAt":"2026-10-02T00:00:00Z","errorCount":0}\n',
    );
    expect(parseAppsNdjson(text)).toEqual([appA, appB]);
  });

  it('sorts events by time and package', () => {
    const text = toNdjson([
      { at: '2026-10-02T00:00:00Z', package: 'com.example.b', from: null, to: 'registered' },
      { at: '2026-10-01T00:00:00Z', package: 'com.example.b', from: 'unknown', to: 'not_registered' },
    ]);
    expect(parseEventsNdjson(text)).toEqual([
      { at: '2026-10-01T00:00:00Z', package: 'com.example.b', from: 'unknown', to: 'not_registered' },
      { at: '2026-10-02T00:00:00Z', package: 'com.example.b', from: null, to: 'registered' },
    ]);
  });

  it('reports the line number for malformed NDJSON', () => {
    expect(() => parseAppsNdjson('{}\nnot-json\n')).toThrow(
      'apps.ndjson line 2 is not valid JSON.',
    );
  });

  it('round-trips CSV and sorted meta JSON', () => {
    const csv = toTimeseriesCsv([
      { date: '2026-10-02', total: 2, registered: 1, registered_other_key: 0, not_registered: 1, unknown: 0 },
      { date: '2026-10-01', total: 1, registered: 0, registered_other_key: 0, not_registered: 1, unknown: 0 },
    ]);
    expect(parseTimeseriesCsv(csv)).toEqual([
      { date: '2026-10-01', total: 1, registered: 0, registered_other_key: 0, not_registered: 1, unknown: 0 },
      { date: '2026-10-02', total: 2, registered: 1, registered_other_key: 0, not_registered: 1, unknown: 0 },
    ]);
    const meta = {
      schemaVersion: 1 as const,
      sources: {
        fdroid: {
          packageCount: 2,
          fetchedAt: '2026-10-01T00:00:00Z',
          etag: '"sample"',
        },
      },
    };
    const metaText = toMetaJson(meta);
    expect(metaText.indexOf('"schemaVersion"')).toBeGreaterThan(-1);
    expect(metaText.indexOf('"sources"')).toBeGreaterThan(metaText.indexOf('"schemaVersion"'));
    expect(parseMetaJson(metaText)).toEqual(meta);
  });
});
