import { describe, expect, it } from 'vitest';
import type { AppRecord } from '../data/schemas.js';
import type { StatusCheckResult } from '../status/client.js';
import {
  applyCheckError,
  applyCheckResult,
  checkFingerprints,
  computeTimeseriesRow,
} from './apply.js';

const NOW = '2026-10-03T12:00:00.000Z';
const FP_A = 'a'.repeat(64);
const FP_B = 'b'.repeat(64);

function record(
  packageName = 'com.example.test',
  overrides: Partial<AppRecord> = {},
): AppRecord {
  return {
    package: packageName,
    source: 'fdroid',
    fingerprints: [FP_A, FP_B],
    checkedFingerprints: [FP_A],
    status: 'not_registered',
    firstSeenAt: '2026-09-01T00:00:00.000Z',
    checkedAt: '2026-10-02T12:00:00.000Z',
    errorCount: 2,
    lastError: {
      at: '2026-10-02T11:00:00.000Z',
      code: 'TRANSIENT_ERROR',
      message: 'old error',
    },
    ...overrides,
  };
}

function result(fingerprint: string, state: StatusCheckResult['state']): StatusCheckResult {
  return {
    package: 'com.example.test',
    fingerprint,
    state,
    rawState: state,
  };
}

describe('applyCheckResult', () => {
  it('derives status, records the event, and sets firstRegisteredAt', () => {
    const applied = applyCheckResult(
      record(),
      [
        result(FP_A, 'REGISTERED_WITH_ANOTHER_CERTIFICATE_FINGERPRINT'),
        result(FP_B, 'REGISTERED'),
      ],
      NOW,
    );

    expect(applied.event).toEqual({
      at: NOW,
      package: 'com.example.test',
      from: 'not_registered',
      to: 'registered',
    });
    expect(applied.record).toEqual(
      expect.objectContaining({
        status: 'registered',
        checkedAt: NOW,
        checkedFingerprints: [FP_A, FP_B],
        statusChangedAt: NOW,
        firstRegisteredAt: NOW,
        errorCount: 0,
      }),
    );
    expect(applied.record.lastError).toBeUndefined();
  });

  it('does not emit an event when the derived status is unchanged', () => {
    const applied = applyCheckResult(
      record('com.example.registered', {
        status: 'registered',
        firstRegisteredAt: '2026-09-15T00:00:00.000Z',
      }),
      [result(FP_A, 'REGISTERED')],
      NOW,
    );

    expect(applied.event).toBeUndefined();
    expect(applied.record.firstRegisteredAt).toBe('2026-09-15T00:00:00.000Z');
    expect(applied.record.statusChangedAt).toBeUndefined();
  });

  it('repairs a missing firstRegisteredAt on an already-registered record', () => {
    const applied = applyCheckResult(
      record('com.example.registered', { status: 'registered' }),
      [result(FP_A, 'REGISTERED')],
      NOW,
    );

    expect(applied.record.firstRegisteredAt).toBe(NOW);
  });
});

describe('applyCheckError', () => {
  it('increments the error count and sanitizes/truncates the message', () => {
    const message = 'prefix\n\t' + 'x'.repeat(300);
    const next = applyCheckError(
      record(),
      { code: ' TRANSIENT_ERROR ', message },
      NOW,
    );

    expect(next.status).toBe('not_registered');
    expect(next.errorCount).toBe(3);
    expect(next.lastError).toEqual({
      at: NOW,
      code: 'TRANSIENT_ERROR',
      message: expect.any(String),
    });
    expect(next.lastError?.message).toHaveLength(200);
    expect(next.lastError?.message).not.toMatch(/[\r\n\t]/);
  });
});

describe('computeTimeseriesRow', () => {
  it('counts only non-removed records', () => {
    const row = computeTimeseriesRow(
      [
        record('com.example.a', { status: 'registered' }),
        record('com.example.b', { status: 'registered_other_key' }),
        record('com.example.c', { status: 'not_registered' }),
        record('com.example.d', { status: 'unknown', removedAt: NOW }),
      ],
      new Date('2026-10-03T23:59:59.000Z'),
    );

    expect(row).toEqual({
      date: '2026-10-03',
      total: 3,
      registered: 1,
      registered_other_key: 1,
      not_registered: 1,
      unknown: 0,
    });
  });

  it('rejects an invalid date', () => {
    expect(() => computeTimeseriesRow([], new Date('invalid'))).toThrow(
      /valid Date/,
    );
  });
});

describe('checkFingerprints', () => {
  it('returns a deterministic bounded fingerprint list', () => {
    expect(checkFingerprints(record(), 1)).toEqual([FP_A]);
    expect(checkFingerprints(record(), 2)).toEqual([FP_A, FP_B]);
  });

  it('rejects non-positive limits', () => {
    expect(() => checkFingerprints(record(), 0)).toThrow(/positive/);
  });
});
