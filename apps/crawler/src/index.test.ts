import { describe, expect, it } from 'vitest';

import { parseCliArgs } from './index.js';

describe('crawler CLI', () => {
  it('uses documented defaults and the environment data directory', () => {
    expect(
      parseCliArgs([], {
        DEVVERIFY_DATA_DIR: '/tmp/devverify-data',
      }),
    ).toEqual({
      dataDir: '/tmp/devverify-data',
      budget: 950,
      concurrency: 4,
      dryRun: false,
      fake: false,
      fixtureIndex: undefined,
      maxFingerprints: 2,
    });
  });

  it('parses all crawler flags', () => {
    expect(
      parseCliArgs([
        '--data-dir',
        './dataset',
        '--budget',
        '20',
        '--concurrency',
        '3',
        '--dry-run',
        '--fake',
        '--fixture-index',
        './index.json',
        '--max-fingerprints',
        '1',
      ]),
    ).toEqual({
      dataDir: './dataset',
      budget: 20,
      concurrency: 3,
      dryRun: true,
      fake: true,
      fixtureIndex: './index.json',
      maxFingerprints: 1,
    });
  });

  it('rejects invalid numeric flags', () => {
    expect(() => parseCliArgs(['--budget=-1'])).toThrow(
      /budget must be a non-negative/,
    );
    expect(() => parseCliArgs(['--concurrency', '0'])).toThrow(
      /concurrency must be a positive/,
    );
    expect(() => parseCliArgs(['--max-fingerprints', '0'])).toThrow(
      /max-fingerprints must be a positive/,
    );
  });
});
