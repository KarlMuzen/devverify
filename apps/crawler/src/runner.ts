import {
  AuthError,
  BudgetExhaustedError,
  QuotaExhaustedError,
  applyCheckError,
  applyCheckResult,
  checkFingerprints,
  computeTimeseriesRow,
  createDataStore,
  createFakeStatusClient,
  createLimiter,
  createStatusClient,
  RequestBudget,
  selectBatch,
  syncRecords,
  type AppRecord,
  type DataSet,
  type EventRecord,
  type StatusCheckResult,
  type StatusClient,
} from '@devverify/core';
import {
  loadSource,
  normalizeNow,
  safeError,
  failureResult,
  updateSourceMeta,
  countStatuses,
} from './source.js';
import type {
  CrawlOptions,
  CrawlResult,
  PackageOutcome,
} from './types.js';
import { writeStepSummary } from './summary.js';

export const DEFAULT_BUDGET = 950;
export const DEFAULT_CONCURRENCY = 4;
export const DEFAULT_MAX_FINGERPRINTS = 2;
export const DEFAULT_FAKE_SEED = 'devverify-crawler';

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

function replaceTimeseriesRow(data: DataSet, now: string): void {
  const row = computeTimeseriesRow(data.apps, new Date(now));
  data.timeseries = [
    ...data.timeseries.filter((item) => item.date !== row.date),
    row,
  ].sort((a, b) => a.date.localeCompare(b.date));
}

function appendLastRun(
  data: DataSet,
  now: string,
  exitReason: CrawlResult['exitReason'],
  requestsUsed: number,
  budget: number,
  added: number,
  removed: number,
  fingerprintChanged: number,
  errors: number,
): void {
  data.meta = {
    ...data.meta,
    lastRun: {
      startedAt: now,
      finishedAt: now,
      requestsUsed,
      budget,
      exitReason,
      counts: {
        ...countStatuses(data.apps),
        added,
        removed,
        fingerprintChanged,
        errors,
      },
    },
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
    return failureResult(
      40,
      'schema_error',
      options.budget,
      [],
      safeError(error, options.apiKey).message,
    );
  }

  let sourceSnapshot;
  try {
    sourceSnapshot = await loadSource(options, data, now);
  } catch (error) {
    return failureResult(
      30,
      'source_fetch_failed',
      options.budget,
      data.apps,
      safeError(error, options.apiKey).message,
    );
  }

  const { source, snapshot } = sourceSnapshot;
  const warnings = [...snapshot.warnings];
  const sync = snapshot.notModified
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
  updateSourceMeta(data, sourceSnapshot);

  let selectedPackages: string[];
  try {
    selectedPackages = selectBatch({
      records: data.apps,
      now,
      budget: options.budget,
    });
  } catch (error) {
    return failureResult(
      40,
      'schema_error',
      options.budget,
      data.apps,
      safeError(error, options.apiKey).message,
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
    return failureResult(
      1,
      'configuration_error',
      options.budget,
      data.apps,
      safeError(error, options.apiKey).message,
    );
  }

  const outcomes = await Promise.all(
    selectedPackages.map((packageName) =>
      limiter(async () => {
        const record = recordByPackage.get(packageName);
        if (record === undefined) {
          throw new Error(
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
    const result: CrawlResult = {
      exitCode: 20,
      exitReason: 'auth_error',
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
    if (options.writeSummary === true && options.summaryPath !== undefined) {
      await writeStepSummary(options.summaryPath, result).catch(
        () => undefined,
      );
    }
    return result;
  }

  data.apps = [...recordByPackage.values()].sort((a, b) =>
    a.package.localeCompare(b.package),
  );
  data.events = [...data.events, ...events];
  replaceTimeseriesRow(data, now);

  let exitReason: CrawlResult['exitReason'] = 'completed';
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

  appendLastRun(
    data,
    now,
    exitReason,
    requestsUsed,
    options.budget,
    sync.added,
    sync.removed,
    sync.fingerprintChanged,
    errorCount,
  );

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

  if (options.writeSummary === true && options.summaryPath !== undefined) {
    await writeStepSummary(options.summaryPath, result).catch(
      () => undefined,
    );
  }

  return result;
}

export function resultJson(result: CrawlResult): string {
  return JSON.stringify(result);
}

export { writeStepSummary } from './summary.js';
export type {
  CrawlCounts,
  CrawlExitReason,
  CrawlOptions,
  CrawlResult,
} from './types.js';
