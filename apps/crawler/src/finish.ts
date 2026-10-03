import type { DataSet } from '@devverify/core';
import type { DataStore } from '@devverify/core/node';
import { safeError } from './source.js';
import { writeStepSummary } from './summary.js';
import type { CrawlResult } from './types.js';

export async function finishAuthFailure(
  result: CrawlResult,
  writeSummary: boolean,
  summaryPath?: string,
): Promise<CrawlResult> {
  if (writeSummary && summaryPath !== undefined) {
    await writeStepSummary(summaryPath, result).catch(() => undefined);
  }
  return result;
}

export async function saveCrawlData(
  store: DataStore,
  data: DataSet,
  result: CrawlResult,
  apiKey?: string,
): Promise<CrawlResult> {
  if (result.exitCode !== 0 || result.exitReason === 'dry_run') {
    return result;
  }

  try {
    await store.save(data);
  } catch (error) {
    const info = safeError(error, apiKey);
    result.exitCode = info.code === 'DATASET_SCHEMA' ? 40 : 1;
    result.exitReason =
      info.code === 'DATASET_SCHEMA' ? 'schema_error' : 'save_failed';
    result.warnings.push(info.message);
  }

  return result;
}

export async function finishSummary(
  result: CrawlResult,
  writeSummary: boolean,
  summaryPath?: string,
): Promise<CrawlResult> {
  if (writeSummary && summaryPath !== undefined) {
    await writeStepSummary(summaryPath, result).catch(() => undefined);
  }
  return result;
}
