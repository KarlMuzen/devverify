import { readFile } from 'node:fs/promises';
import {
  SourceFetchError,
  SourceFormatError,
  createFdroidSource,
  parseSignerIndex,
  type AppRecord,
  type AppStatus,
  type DataSet,
  type PackageSource,
  type SourceSnapshot,
} from '@devverify/core';
import { DataStoreError } from '@devverify/core/node';
import { redactSecrets } from '@devverify/core';
import type {
  CrawlCounts,
  CrawlOptions,
  CrawlResult,
  LoadedSource,
} from './types.js';

export function normalizeNow(value?: string): string {
  if (value === undefined) {
    return new Date().toISOString();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new DataStoreError('DATASET_SCHEMA', 'now must be a valid ISO timestamp.');
  }
  return parsed.toISOString();
}

export function countStatuses(
  records: readonly AppRecord[],
): Pick<CrawlCounts, AppStatus> {
  const counts = {
    registered: 0,
    registered_other_key: 0,
    not_registered: 0,
    unknown: 0,
  };
  for (const record of records) {
    if (record.removedAt === undefined) {
      counts[record.status] += 1;
    }
  }
  return counts;
}

export async function loadFixtureSnapshot(
  path: string,
  now: string,
): Promise<SourceSnapshot> {
  let body: string;
  try {
    body = await readFile(path, 'utf8');
  } catch {
    throw new SourceFetchError('Fixture signer-index could not be read.');
  }

  let json: unknown;
  try {
    json = JSON.parse(body) as unknown;
  } catch {
    throw new SourceFormatError('Fixture signer-index is not valid JSON.');
  }

  const parsed = parseSignerIndex(json);
  return {
    entries: parsed.entries.map((entry) => ({
      package: entry.package,
      fingerprints: [...entry.fingerprints],
    })),
    fetchedAt: now,
    warnings: [...parsed.warnings],
  };
}

export async function loadSource(
  options: CrawlOptions,
  data: DataSet,
  now: string,
): Promise<LoadedSource> {
  const source =
    options.source ??
    createFdroidSource({
      url: 'https://f-droid.org/repo/signer-index.json',
    });

  if (options.fixtureIndex !== undefined) {
    return {
      source,
      snapshot: await loadFixtureSnapshot(options.fixtureIndex, now),
    };
  }

  const stored = data.meta.sources[source.id];
  return {
    source,
    snapshot: await source.load({
      validators:
        stored === undefined
          ? undefined
          : {
              ...(stored.etag === undefined ? {} : { etag: stored.etag }),
              ...(stored.lastModified === undefined
                ? {}
                : { lastModified: stored.lastModified }),
            },
    }),
  };
}

export function updateSourceMeta(
  data: DataSet,
  source: LoadedSource,
): void {
  const stored = data.meta.sources[source.source.id];
  const snapshot = source.snapshot;
  data.meta = {
    ...data.meta,
    sources: {
      ...data.meta.sources,
      [source.source.id]: {
        ...(stored?.etag === undefined && snapshot.validators?.etag === undefined
          ? {}
          : { etag: snapshot.validators?.etag ?? stored?.etag }),
        ...(stored?.lastModified === undefined &&
        snapshot.validators?.lastModified === undefined
          ? {}
          : {
              lastModified:
                snapshot.validators?.lastModified ?? stored?.lastModified,
            }),
        fetchedAt: snapshot.fetchedAt,
        packageCount: snapshot.notModified
          ? stored?.packageCount ?? data.apps.length
          : snapshot.entries.length,
      },
    },
  };
}

export function safeError(
  error: unknown,
  apiKey?: string,
): { code: string; message: string } {
  if (error instanceof DataStoreError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error) {
    return {
      code: error.name || 'ERROR',
      message: redactSecrets(
        error.message,
        apiKey === undefined ? [] : [apiKey],
      ),
    };
  }
  return { code: 'UNKNOWN_ERROR', message: 'Unknown crawler error.' };
}

export function baseCounts(
  records: readonly AppRecord[],
): CrawlCounts {
  return {
    ...countStatuses(records),
    added: 0,
    removed: 0,
    fingerprintChanged: 0,
    errors: 0,
  };
}

export function failureResult(
  exitCode: number,
  exitReason: CrawlResult['exitReason'],
  budget: number,
  records: readonly AppRecord[],
  message: string,
): CrawlResult {
  return {
    exitCode,
    exitReason,
    requestsUsed: 0,
    budget,
    counts: baseCounts(records),
    warnings: [message],
  };
}
