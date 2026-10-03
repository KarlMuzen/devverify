import { appendFile, readFile } from 'node:fs/promises';
import {
  AuthError,
  BudgetExhaustedError,
  QuotaExhaustedError,
  SourceFetchError,
  SourceFormatError,
  applyCheckError,
  applyCheckResult,
  checkFingerprints,
  computeTimeseriesRow,
  createFakeStatusClient,
  createFdroidSource,
  createLimiter,
  createStatusClient,
  parseSignerIndex,
  RequestBudget,
  selectBatch,
  syncRecords,
  type AppRecord,
  type AppStatus,
  type DataSet,
  type EventRecord,
  type PackageSource,
  type SourceSnapshot,
  type StatusCheckResult,
  type StatusClient,
} from '@devverify/core';
import {
  createDataStore,
  DataStoreError,
} from '@devverify/core/node';
import { redactSecrets } from '@devverify/core';

export const DEFAULT_BUDGET = 950;
export const DEFAULT_CONCURRENCY = 4;
export const DEFAULT_MAX_FINGERPRINTS = 2;
export const DEFAULT_FAKE_SEED = 'devverify-crawler';

export interface CrawlOptions {
  dataDir: string;
  budget: number;
  concurrency: number;
  dryRun: boolean;
  fake: boolean;
  fixtureIndex?: string;
  maxFingerprints: number;
  apiKey?: string;
  now?: string;
  source?: PackageSource;
  statusClient?: StatusClient;
  writeSummary?: boolean;
  summaryPath?: string;
}

export interface CrawlCounts {
  registered: number;
  registered_other_key: number;
  not_registered: number;
  unknown: number;
  added: number;
  removed: number;
  fingerprintChanged: number;
  errors: number;
}

export type CrawlExitReason =
  | 'completed'
  | 'dry_run'
  | 'budget_exhausted'
  | 'quota_exhausted'
  | 'auth_error'
  | 'source_fetch_failed'
  | 'schema_error'
  | 'configuration_error'
  | 'save_failed';

export interface CrawlResult {
  exitCode: number;
  exitReason: CrawlExitReason;
  requestsUsed: number;
  budget: number;
  counts: CrawlCounts;
  warnings: string[];
}

interface PackageOutcome {
  package: string;
  record?: AppRecord;
  event?: EventRecord;
  error?: unknown;
}

function normalizeNow(value?: string): string {
  if (value === undefined) {
    return new Date().toISOString();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new DataStoreError('DATASET_SCHEMA', 'now must be a valid ISO timestamp.');
  }
  return parsed.toISOString();
}

function countStatuses(records: readonly AppRecord[]): Pick<
  CrawlCounts,
  AppStatus
> {
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

async function loadFixtureSnapshot(
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

async function loadSource(
  options: CrawlOptions,
  data: DataSet,
  now: string,
): Promise<{ source: PackageSource; snapshot: SourceSnapshot }> {
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

function createStatusClientForRun(
  options: CrawlOptions,
  budget: RequestBudget,
  onRequest: () => void,
): StatusClient {
  if (options.statusClient !== undefined) {
    return options.statusClient;
  }
  if (options.fake) {
    return createFakeStatusClient({ seed: DEFAULT_FAKE_SEED });
  }
  if (options.apiKey === undefined || options.apiKey.length === 0) {
    throw new Error(
      'ANDROID_DEVID_STATUS_API_KEY is required unless --fake is used.',
    );
  }
  return createStatusClient({
    apiKey: options.apiKey,
    budget,
    onRequest,
  });
}

function safeError(
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

async function processPackage(
  record: AppRecord,
  statusClient: StatusClient,
  maxFingerprints: number,
  now: string,
  onCheck: () => void,
): Promise<PackageOutcome> {
  const results: StatusCheckResult[] = [];
  for (const fingerprint of checkFingerprints(record, maxFingerprints)) {
    onCheck();
    const result = await statusClient.check(record.package, fingerprint);
    results.push(result);
    if (result.state === 'REGISTERED') {
      break;
    }
  }

  const applied = applyCheckResult(record, results, now);
  return {
    package: record.package,
    record: applied.record,
    ...(applied.event === undefined ? {} : { event: applied.event }),
  };
}

function replaceTimeseriesRow(
  data: DataSet,
  now: string,
): void {
  const row = computeTimeseriesRow(data.apps, new Date(now));
  data.timeseries = [
    ...data.timeseries.filter((item) => item.date !== row.date),
    row,
  ].sort((a, b) => a.date.localeCompare(b.date));
}

function resultSummary(result: CrawlResult): string {
  const counts = result.counts;
  return [
    '# devverify crawl',
    '',
    '- Exit: ' + result.exitReason + ' (' + result.exitCode + ')',
    '- Requests used: ' + result.requestsUsed + '/' + result.budget,
    '- Added: ' + counts.added,
    '- Removed: ' + counts.removed,
    '- Fingerprint changes: ' + counts.fingerprintChanged,
    '- Check errors: ' + counts.errors,
    '',
    '| Status | Count |',
    '| --- | ---: |',
    '| registered | ' + counts.registered + ' |',
    '| registered_other_key | ' + counts.registered_other_key + ' |',
    '| not_registered | ' + counts.not_registered + ' |',
    '| unknown | ' + counts.unknown + ' |',
    '',
    ...result.warnings.map((warning) => '> Warning: ' + warning),
    '',
  ].join('\n');
}

export async function writeStepSummary(
  path: string,
  result: CrawlResult,
): Promise<void> {
  await appendFile(path, resultSummary(result), 'utf8');
}

function baseCounts(records: readonly AppRecord[]): CrawlCounts {
  return {
    ...countStatuses(records),
    added: 0,
    removed: 0,
    fingerprintChanged: 0,
    errors: 0,
  };
}

function failureResult(
  exitCode: number,
  exitReason: CrawlExitReason,
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

export async function runCrawl(
  options: CrawlOptions,
): Promise<CrawlResult> {
  let now: string;
  try {
    now = normalizeNow(options.now);
  } catch (error) {
    return failureResult(
      40,
      'schema_error',
      options.budget,
      [],
      safeError(error, options.apiKey).message,
    );
  }

  const store = createDataStore(options.dataDir);
  let data: DataSet;
  try {
    data = await store.load();
  } catch (error) {
    const info = safeError(error, options.apiKey);
    return failureResult(
      40,
      'schema_error',
      options.budget,
      [],
      info.message,
    );
  }

  let source: PackageSource;
  let snapshot: SourceSnapshot;
  try {
    ({ source, snapshot } = await loadSource(options, data, now));
  } catch (error) {
    const info = safeError(error, options.apiKey);
    return failureResult(
      30,
      'source_fetch_failed',
      options.budget,
      data.apps,
      info.message,
    );
  }

  const warnings = [...snapshot.warnings];
  const sourceMeta = data.meta.sources[source.id];
  const sync =
    snapshot.notModified
      ? {
          records: data.apps,
          added: 0,
          removed: 0,
          fingerprintChanged: 0,
        }
      : syncRecords({
          records: data.apps,
          entries: snapshot.entries,
          now,
          source: 'fdroid',
        });

  data.apps = sync.records;
  data.meta = {
    ...data.meta,
    sources: {
      ...data.meta.sources,
      [source.id]: {
        ...(sourceMeta?.etag === undefined && snapshot.validators?.etag === undefined
          ? {}
          : { etag: snapshot.validators?.etag ?? sourceMeta?.etag }),
        ...(sourceMeta?.lastModified === undefined &&
        snapshot.validators?.lastModified === undefined
          ? {}
          : {
              lastModified:
                snapshot.validators?.lastModified ?? sourceMeta?.lastModified,
            }),
        fetchedAt: snapshot.fetchedAt,
        packageCount: snapshot.notModified
          ? sourceMeta?.packageCount ?? data.apps.length
          : snapshot.entries.length,
      },
    },
  };

  let selectedPackages: string[];
  try {
    selectedPackages = selectBatch({
      records: data.apps,
      now,
      budget: options.budget,
    });
  } catch (error) {
    const info = safeError(error, options.apiKey);
    return failureResult(
      40,
      'schema_error',
      options.budget,
      data.apps,
      info.message,
    );
  }

  const recordByPackage = new Map(
    data.apps.map((record) => [record.package, record]),
  );
  const limiter = createLimiter(options.concurrency);
  const requestBudget = new RequestBudget(options.budget);
  let requestAttempts = 0;
  let logicalChecks = 0;
  let authFailure = false;
  let budgetFailure = false;
  let quotaFailure = false;

  let statusClient: StatusClient;
  try {
    statusClient = createStatusClientForRun(
      options,
      requestBudget,
      () => {
        requestAttempts += 1;
      },
    );
  } catch (error) {
    const info = safeError(error, options.apiKey);
    return failureResult(
      1,
      'configuration_error',
      options.budget,
      data.apps,
      info.message,
    );
  }

  const outcomes = await Promise.all(
    selectedPackages.map((packageName) =>
      limiter(async () => {
        const record = recordByPackage.get(packageName);
        if (record === undefined) {
          throw new DataStoreError(
            'DATASET_SCHEMA',
            'Scheduled package disappeared before checking.',
          );
        }

        try {
          const outcome = await processPackage(
            record,
            statusClient,
            options.maxFingerprints,
            now,
            () => {
              logicalChecks += 1;
            },
          );
          return outcome;
        } catch (error) {
          if (error instanceof AuthError) {
            authFailure = true;
          } else if (error instanceof BudgetExhaustedError) {
            budgetFailure = true;
          } else if (error instanceof QuotaExhaustedError) {
            quotaFailure = true;
          }
          return {
            package: packageName,
            error,
          };
        }
      }),
    ),
  );

  let errorCount = 0;
  const events: EventRecord[] = [];
  for (const outcome of outcomes) {
    if (outcome.record !== undefined) {
      recordByPackage.set(outcome.package, outcome.record);
      if (outcome.event !== undefined) {
        events.push(outcome.event);
      }
      continue;
    }

    if (
      outcome.error instanceof AuthError ||
      outcome.error instanceof BudgetExhaustedError ||
      outcome.error instanceof QuotaExhaustedError
    ) {
      continue;
    }

    const current = recordByPackage.get(outcome.package);
    if (current !== undefined) {
      recordByPackage.set(
        outcome.package,
        applyCheckError(
          current,
          safeError(outcome.error, options.apiKey),
          now,
        ),
      );
      errorCount += 1;
    }
  }

  const requestsUsed = requestAttempts || (
    options.statusClient === undefined && options.fake ? 0 : logicalChecks
  );

  if (authFailure) {
    const result = {
      exitCode: 20,
      exitReason: 'auth_error' as const,
      requestsUsed,
      budget: options.budget,
      counts: {
        ...countStatuses(data.apps),
        added: sync.added,
        removed: sync.removed,
        fingerprintChanged: sync.fingerprintChanged,
        errors: errorCount,
      },
      warnings: ['Authentication failed; no dataset changes were written.'],
    };
    if (
      options.writeSummary === true &&
      options.summaryPath !== undefined
    ) {
      await writeStepSummary(options.summaryPath, result).catch(() => undefined);
    }
    return result;
  }

  data.apps = [...recordByPackage.values()].sort((a, b) =>
    a.package.localeCompare(b.package),
  );
  data.events = [...data.events, ...events];
  replaceTimeseriesRow(data, now);

  let exitReason: CrawlExitReason = 'completed';
  if (quotaFailure) {
    exitReason = 'quota_exhausted';
    if (requestAttempts < options.budget / 2) {
      warnings.push(
        'Status API quota was exhausted before half of the configured budget was used.',
      );
    }
  } else if (budgetFailure) {
    exitReason = 'budget_exhausted';
  } else if (options.dryRun) {
    exitReason = 'dry_run';
    warnings.push('Dry run: no dataset files were written.');
  }

  data.meta = {
    ...data.meta,
    lastRun: {
      startedAt: now,
      finishedAt: now,
      requestsUsed,
      budget: options.budget,
      exitReason,
      counts: {
        ...countStatuses(data.apps),
        added: sync.added,
        removed: sync.removed,
        fingerprintChanged: sync.fingerprintChanged,
        errors: errorCount,
      },
    },
  };

  const result: CrawlResult = {
    exitCode: 0,
    exitReason,
    requestsUsed,
    budget: options.budget,
    counts: {
      ...countStatuses(data.apps),
      added: sync.added,
      removed: sync.removed,
      fingerprintChanged: sync.fingerprintChanged,
      errors: errorCount,
    },
    warnings,
  };

  if (!options.dryRun) {
    try {
      await store.save(data);
    } catch (error) {
      const info = safeError(error, options.apiKey);
      result.exitCode = info.code === 'DATASET_SCHEMA' ? 40 : 1;
      result.exitReason =
        info.code === 'DATASET_SCHEMA' ? 'schema_error' : 'save_failed';
      result.warnings.push(info.message);
    }
  }

  if (
    options.writeSummary === true &&
    options.summaryPath !== undefined
  ) {
    await writeStepSummary(options.summaryPath, result).catch(() => undefined);
  }

  return result;
}

export function resultJson(result: CrawlResult): string {
  return JSON.stringify(result);
}
