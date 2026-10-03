import {
  applyCheckError,
  
  createLimiter,
  RequestBudget,
  selectBatch,
  syncRecords,
  type DataSet,
} from '@devverify/core';
import {
  loadSource,
  normalizeNow,
  safeError,
  failureResult,
  updateSourceMeta,
  countStatuses,
} from './source.js';
import {
  appendLastRun,
  createStatusClientForRun,
  errorRecord,
  isSpecialError,
  processPackage,
  replaceTimeseriesRow,
  specialFailure,
} from './checks.js';
import type {
  CrawlOptions,
  CrawlResult,
} from './types.js';
import {
  finishAuthFailure,
  finishSummary,
  saveCrawlData,
} from './finish.js';

export const DEFAULT_BUDGET = 950;
export const DEFAULT_CONCURRENCY = 4;
export const DEFAULT_MAX_FINGERPRINTS = 2;
export async function runCrawl(
  options: CrawlOptions,
): Promise<CrawlResult> {
  let now: string;
  try {
    now = normalizeNow(options.now);
  } catch (error) {
    return failureResult(40, 'schema_error', options.budget, [], safeError(error, options.apiKey).message);
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

  let sourceSnapshot: Awaited<ReturnType<typeof loadSource>>;
  try {
    sourceSnapshot = await loadSource(options, data, now);
  } catch (error) {
    return failureResult(30, 'source_fetch_failed', options.budget, data.apps, safeError(error, options.apiKey).message);
  }

  const { snapshot } = sourceSnapshot;
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
    return failureResult(40, 'schema_error', options.budget, data.apps, safeError(error, options.apiKey).message);
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
    return failureResult(1, 'configuration_error', options.budget, data.apps, safeError(error, options.apiKey).message);
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
          const kind = specialFailure(error);
          if (kind === 'auth') {
            authFailure = true;
          } else if (kind === 'budget') {
            budgetFailure = true;
          } else if (kind === 'quota') {
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
  const events: import('@devverify/core').EventRecord[] = [];
  for (const outcome of outcomes) {
    if (outcome.record !== undefined) {
      recordByPackage.set(outcome.package, outcome.record);
      if (outcome.event !== undefined) {
        events.push(outcome.event);
      }
      continue;
    }
    if (isSpecialError(outcome.error)) {
      continue;
    }

    const current = recordByPackage.get(outcome.package);
    if (current !== undefined) {
      recordByPackage.set(
        outcome.package,
        applyCheckError(
          current,
          errorRecord(outcome.error, options.apiKey),
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
    return finishAuthFailure(
      {
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
      },
      options.writeSummary === true,
      options.summaryPath,
    );
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

  const finished = await saveCrawlData(
    store,
    data,
    result,
    options.apiKey,
  );

  return finishSummary(
    finished,
    options.writeSummary === true,
    options.summaryPath,
  );
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
