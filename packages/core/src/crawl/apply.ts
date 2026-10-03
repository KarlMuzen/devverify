import type { StatusCheckResult } from '../status/client.js';
import { deriveAppStatus } from '../status/derive.js';
import type { AppRecord, EventRecord, TimeseriesRow } from '../data/schemas.js';

export interface CheckError {
  code: string;
  message: string;
}

export interface ApplyCheckResult {
  record: AppRecord;
  event?: EventRecord;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function sanitizeMessage(message: string): string {
  return message
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

function sanitizeCode(code: string): string {
  const value = code.trim().replace(/[\u0000-\u001f\u007f]+/g, '_').slice(0, 64);
  return value || 'UNKNOWN_ERROR';
}

/**
 * Applies successful fingerprint checks and records a status-change event.
 */
export function applyCheckResult(
  record: AppRecord,
  results: readonly StatusCheckResult[],
  now: string,
): ApplyCheckResult {
  const nextStatus = deriveAppStatus(
    results.map((result) => ({
      fingerprint: result.fingerprint ?? '',
      state: result.state,
    })),
  );
  const checkedFingerprints = uniqueSorted(
    results.flatMap((result) =>
      result.fingerprint === undefined ? [] : [result.fingerprint],
    ),
  );
  const next: AppRecord = {
    ...record,
    checkedAt: now,
    checkedFingerprints,
    status: nextStatus,
    errorCount: 0,
  };
  delete next.lastError;
  if (nextStatus !== record.status) {
    next.statusChangedAt = now;
    const event: EventRecord = {
      at: now,
      package: record.package,
      from: record.status,
      to: nextStatus,
    };
    if (nextStatus === 'registered' && record.firstRegisteredAt === undefined) {
      next.firstRegisteredAt = now;
    }
    return { record: next, event };
  }

  if (nextStatus === 'registered' && record.firstRegisteredAt === undefined) {
    next.firstRegisteredAt = now;
  }

  return { record: next };
}

/**
 * Records a failed check without changing the last known status.
 */
export function applyCheckError(
  record: AppRecord,
  error: CheckError,
  now: string,
): AppRecord {
  return {
    ...record,
    errorCount: record.errorCount + 1,
    lastError: {
      at: now,
      code: sanitizeCode(error.code),
      message: sanitizeMessage(error.message),
    },
  };
}

/**
 * Counts active records for one UTC calendar date.
 */
export function computeTimeseriesRow(
  records: readonly AppRecord[],
  dateUtc: Date,
): TimeseriesRow {
  if (Number.isNaN(dateUtc.getTime())) {
    throw new RangeError('dateUtc must be a valid Date.');
  }

  const counts = {
    registered: 0,
    registered_other_key: 0,
    not_registered: 0,
    unknown: 0,
  };

  for (const record of records) {
    if (record.removedAt !== undefined) {
      continue;
    }
    counts[record.status] += 1;
  }

  return {
    date: dateUtc.toISOString().slice(0, 10),
    total:
      counts.registered +
      counts.registered_other_key +
      counts.not_registered +
      counts.unknown,
    ...counts,
  };
}

/**
 * Returns the bounded fingerprint list a crawler may check for a package.
 * The caller must stop iterating when one result is REGISTERED.
 */
export function checkFingerprints(
  record: AppRecord,
  maxPerPackage = 2,
): string[] {
  if (!Number.isSafeInteger(maxPerPackage) || maxPerPackage < 1) {
    throw new RangeError('maxPerPackage must be a positive safe integer.');
  }
  return uniqueSorted(record.fingerprints).slice(0, maxPerPackage);
}
