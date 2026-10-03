import {
  AuthError,
  BudgetExhaustedError,
  QuotaExhaustedError,
  applyCheckResult,
  checkFingerprints,
  createFakeStatusClient,
  createStatusClient,
  type AppRecord,
  type DataSet,
  type EventRecord,
  type StatusCheckResult,
  type StatusClient,
} from '@devverify/core';
import type {
  CrawlExitReason,
  CrawlOptions,
  CrawlResult,
  PackageOutcome,
} from './types.js';
import { countStatuses, safeError } from './source.js';

export function createStatusClientForRun(
  options: CrawlOptions,
  budget: import('@devverify/core').RequestBudget,
  onRequest: () => void,
): StatusClient {
  if (options.statusClient !== undefined) {
    return options.statusClient;
  }
  if (options.fake) {
    return createFakeStatusClient({ seed: 'devverify-crawler' });
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

export async function processPackage(
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

export function appendLastRun(
  data: DataSet,
  now: string,
  exitReason: CrawlExitReason,
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

export function specialFailure(
  error: unknown,
): 'auth' | 'budget' | 'quota' | undefined {
  if (error instanceof AuthError) {
    return 'auth';
  }
  if (error instanceof BudgetExhaustedError) {
    return 'budget';
  }
  if (error instanceof QuotaExhaustedError) {
    return 'quota';
  }
  return undefined;
}

export function isSpecialError(error: unknown): boolean {
  return specialFailure(error) !== undefined;
}

export function errorRecord(
  error: unknown,
  apiKey?: string,
): { code: string; message: string } {
  return safeError(error, apiKey);
}
