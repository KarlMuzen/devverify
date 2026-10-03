import { stat } from 'node:fs/promises';
import type {
  DataSet,
  DataStore,
} from '@devverify/core';
import type { Meta } from '@devverify/core';
import { DataStoreError } from '@devverify/core/node';
import type { MutableCrawlData } from './types.js';

function emptyData(): MutableCrawlData {
  const meta: Meta = {
    schemaVersion: 1,
    sources: {},
  };
  return {
    apps: [],
    events: [],
    timeseries: [],
    meta,
  };
}

async function assertDirectoryExists(
  dir: string,
): Promise<boolean> {
  try {
    const info = await stat(dir);
    if (!info.isDirectory()) {
      throw new DataStoreError(
        'DATASET_SCHEMA',
        'Crawler data path exists but is not a directory.',
      );
    }
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as { code?: unknown }).code === 'ENOENT'
    ) {
      return false;
    }
    throw error;
  }
}

export async function loadCrawlData(
  store: DataStore,
  dir: string,
  dryRun: boolean,
): Promise<MutableCrawlData> {
  if (dryRun && !(await assertDirectoryExists(dir))) {
    return emptyData();
  }

  const loaded: DataSet = await store.load();
  return {
    apps: [...loaded.apps],
    events: [...loaded.events],
    timeseries: [...loaded.timeseries],
    meta: loaded.meta,
  };
}
