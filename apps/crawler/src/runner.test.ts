import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AuthError,
  BudgetExhaustedError,
  QuotaExhaustedError,
  SourceFetchError,
  TransientError,
  type StatusClient,
} from '@devverify/core';
import { runCrawl } from './runner.js';

const SAMPLE_DIR = resolve(process.cwd(), 'fixtures/sample-data');
const FIXTURE_INDEX = resolve(
  process.cwd(),
  'fixtures/fdroid/signer-index.shapeA.json',
);
const DATA_FILES = [
  'apps.ndjson',
  'events.ndjson',
  'timeseries.csv',
  'meta.json',
] as const;
const NOW = '2026-10-03T12:00:00.000Z';

const tempDirs: string[] = [];

async function cloneSample(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'devverify-crawler-'));
  tempDirs.push(dir);
  for (const file of DATA_FILES) {
    await copyFile(join(SAMPLE_DIR, file), join(dir, file));
  }
  return dir;
}

async function snapshot(dir: string): Promise<Record<string, string>> {
  const entries: Record<string, string> = {};
  for (const file of DATA_FILES) {
    entries[file] = await readFile(join(dir, file), 'utf8');
  }
  return entries;
}

function clientFor(
  check: StatusClient['check'],
): StatusClient {
  return { check };
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) =>
      rm(dir, { recursive: true, force: true }),
    ),
  );
});

describe('runCrawl', () => {
  it('is deterministic for fake mode with the fixture index', async () => {
    const firstDir = await cloneSample();
    const secondDir = await cloneSample();

    const options = {
      budget: 20,
      concurrency: 2,
      dryRun: false,
      fake: true,
      fixtureIndex: FIXTURE_INDEX,
      maxFingerprints: 2,
      now: NOW,
    } as const;

    const first = await runCrawl({ ...options, dataDir: firstDir });
    const second = await runCrawl({ ...options, dataDir: secondDir });

    expect(first).toEqual(second);
    expect(first.exitCode).toBe(0);
    expect(first.requestsUsed).toBe(0);
    expect(await snapshot(firstDir)).toEqual(await snapshot(secondDir));
  });

  it('dry-run performs the full offline flow without changing files', async () => {
    const dir = await cloneSample();
    const before = await snapshot(dir);

    const result = await runCrawl({
      dataDir: dir,
      budget: 20,
      concurrency: 2,
      dryRun: true,
      fake: true,
      fixtureIndex: FIXTURE_INDEX,
      maxFingerprints: 2,
      now: NOW,
    });

    expect(result.exitCode).toBe(0);
    expect(result.exitReason).toBe('dry_run');
    expect(result.warnings).toContain('Dry run: no dataset files were written.');
    expect(await snapshot(dir)).toEqual(before);
  });

  it('returns 20 for auth failure and leaves the dataset untouched', async () => {
    const dir = await cloneSample();
    const before = await snapshot(dir);
    const client = clientFor(() => {
      throw new AuthError(401, 'bad credentials');
    });

    const result = await runCrawl({
      dataDir: dir,
      budget: 20,
      concurrency: 2,
      dryRun: false,
      fake: false,
      fixtureIndex: FIXTURE_INDEX,
      maxFingerprints: 2,
      now: NOW,
      statusClient: client,
    });

    expect(result.exitCode).toBe(20);
    expect(result.exitReason).toBe('auth_error');
    expect(await snapshot(dir)).toEqual(before);
  });

  it('returns 30 for source failure without writing anything', async () => {
    const dir = await cloneSample();
    const before = await snapshot(dir);
    const source = {
      id: 'fdroid-signer-index',
      load: () => {
        throw new SourceFetchError('fixture source failed');
      },
    };

    const result = await runCrawl({
      dataDir: dir,
      budget: 20,
      concurrency: 2,
      dryRun: false,
      fake: true,
      maxFingerprints: 2,
      now: NOW,
      source,
    });

    expect(result.exitCode).toBe(30);
    expect(result.exitReason).toBe('source_fetch_failed');
    expect(await snapshot(dir)).toEqual(before);
  });

  it('returns 40 for a newer dataset schema', async () => {
    const dir = await cloneSample();
    await writeFile(
      join(dir, 'meta.json'),
      JSON.stringify({
        schemaVersion: 999,
        sources: {},
      }) + '\n',
      'utf8',
    );

    const result = await runCrawl({
      dataDir: dir,
      budget: 20,
      concurrency: 2,
      dryRun: false,
      fake: true,
      maxFingerprints: 2,
      now: NOW,
    });

    expect(result.exitCode).toBe(40);
    expect(result.exitReason).toBe('schema_error');
  });

  it('continues after ordinary check errors and persists error records', async () => {
    const dir = await cloneSample();
    const client = clientFor(async () => {
      throw new TransientError('temporary');
    });

    const result = await runCrawl({
      dataDir: dir,
      budget: 2,
      concurrency: 1,
      dryRun: false,
      fake: false,
      fixtureIndex: FIXTURE_INDEX,
      maxFingerprints: 1,
      now: NOW,
      statusClient: client,
    });

    expect(result.exitCode).toBe(0);
    expect(result.exitReason).toBe('completed');
    expect(result.counts.errors).toBeGreaterThan(0);
    expect(result.requestsUsed).toBeGreaterThan(0);

    const apps = await readFile(join(dir, 'apps.ndjson'), 'utf8');
    expect(apps).toContain('"errorCount":1');
  });

  it('saves partial progress and exits 0 on quota exhaustion', async () => {
    const dir = await cloneSample();
    const client = clientFor(async () => {
      throw new QuotaExhaustedError('quota exhausted');
    });

    const before = await snapshot(dir);
    const result = await runCrawl({
      dataDir: dir,
      budget: 20,
      concurrency: 1,
      dryRun: false,
      fake: false,
      fixtureIndex: FIXTURE_INDEX,
      maxFingerprints: 1,
      now: NOW,
      statusClient: client,
    });

    expect(result.exitCode).toBe(0);
    expect(result.exitReason).toBe('quota_exhausted');
    expect(await snapshot(dir)).not.toEqual(before);
  });

  it('saves partial progress and exits 0 when the budget is exhausted', async () => {
    const dir = await cloneSample();
    const client = clientFor(async () => {
      throw new BudgetExhaustedError();
    });

    const before = await snapshot(dir);
    const result = await runCrawl({
      dataDir: dir,
      budget: 20,
      concurrency: 1,
      dryRun: false,
      fake: false,
      fixtureIndex: FIXTURE_INDEX,
      maxFingerprints: 1,
      now: NOW,
      statusClient: client,
    });

    expect(result.exitCode).toBe(0);
    expect(result.exitReason).toBe('budget_exhausted');
    expect(await snapshot(dir)).not.toEqual(before);
  });
});
