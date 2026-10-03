import type { AppRecord } from '../data/schemas.js';

export interface SyncEntry {
  package: string;
  fingerprints: string[];
}

export interface SyncOptions {
  records: AppRecord[];
  entries: SyncEntry[];
  now: string;
  source: AppRecord['source'];
}

export interface SyncResult {
  records: AppRecord[];
  added: number;
  removed: number;
  fingerprintChanged: number;
}

const PURGE_AFTER_MS = 30 * 24 * 60 * 60 * 1_000;

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  const a = uniqueSorted(left);
  const b = uniqueSorted(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function assertValidNow(now: string): number {
  const timestamp = Date.parse(now);
  if (!Number.isFinite(timestamp)) {
    throw new RangeError('now must be a valid ISO timestamp.');
  }
  return timestamp;
}

function mergeEntries(entries: readonly SyncEntry[]): Map<string, string[]> {
  const merged = new Map<string, string[]>();
  for (const entry of entries) {
    const previous = merged.get(entry.package) ?? [];
    merged.set(entry.package, uniqueSorted([...previous, ...entry.fingerprints]));
  }
  return merged;
}

/**
 * Reconciles stored records with one source snapshot without performing I/O.
 */
export function syncRecords(options: SyncOptions): SyncResult {
  const nowMs = assertValidNow(options.now);
  const entries = mergeEntries(options.entries);
  const nextRecords: AppRecord[] = [];
  let added = 0;
  let removed = 0;
  let fingerprintChanged = 0;

  for (const record of options.records) {
    if (record.source !== options.source) {
      nextRecords.push(record);
      continue;
    }

    const entryFingerprints = entries.get(record.package);
    if (entryFingerprints !== undefined) {
      const changed = !sameSet(record.fingerprints, entryFingerprints);
      const next: AppRecord = {
        ...record,
        fingerprints: entryFingerprints,
        ...(record.removedAt === undefined ? {} : { removedAt: undefined }),
      };
      if (changed) {
        next.checkedAt = undefined;
        next.checkedFingerprints = [];
        fingerprintChanged += 1;
      }
      nextRecords.push(next);
      continue;
    }

    if (record.removedAt !== undefined) {
      const removedAtMs = Date.parse(record.removedAt);
      if (Number.isFinite(removedAtMs) && nowMs - removedAtMs > PURGE_AFTER_MS) {
        continue;
      }
      nextRecords.push(record);
      continue;
    }

    nextRecords.push({
      ...record,
      removedAt: options.now,
    });
    removed += 1;
  }

  const packages = [...entries.keys()].sort((a, b) => a.localeCompare(b));
  for (const packageName of packages) {
    if (nextRecords.some((record) => record.source === options.source && record.package === packageName)) {
      continue;
    }
    const fingerprints = entries.get(packageName);
    if (fingerprints === undefined) {
      continue;
    }
    nextRecords.push({
      package: packageName,
      source: options.source,
      fingerprints,
      checkedFingerprints: [],
      status: 'unknown',
      firstSeenAt: options.now,
      errorCount: 0,
    });
    added += 1;
  }

  nextRecords.sort((a, b) => {
    if (a.source !== b.source) {
      return a.source.localeCompare(b.source);
    }
    return a.package.localeCompare(b.package);
  });

  return { records: nextRecords, added, removed, fingerprintChanged };
}
