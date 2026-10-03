import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  DEFAULT_BUDGET,
  DEFAULT_CONCURRENCY,
  DEFAULT_MAX_FINGERPRINTS,
  resultJson,
  runCrawl,
  type CrawlOptions,
} from './runner.js';

export { runCrawl, resultJson } from './runner.js';
export { writeStepSummary } from './summary.js';
export type {
  CrawlCounts,
  CrawlExitReason,
  CrawlOptions,
  CrawlResult,
} from './runner.js';

interface CliValues {
  dataDir?: string;
  budget: number;
  concurrency: number;
  dryRun: boolean;
  fake: boolean;
  fixtureIndex?: string;
  maxFingerprints: number;
}

function positiveInteger(value: string, name: string, allowZero = false): number {
  const parsed = Number(value);
  const valid =
    Number.isSafeInteger(parsed) && (allowZero ? parsed >= 0 : parsed > 0);
  if (!valid) {
    throw new Error(
      name +
        ' must be a ' +
        (allowZero ? 'non-negative' : 'positive') +
        ' safe integer.',
    );
  }
  return parsed;
}

export function parseCliArgs(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): CliValues {
  const parsed = parseArgs({
    args: [...argv],
    options: {
      'data-dir': { type: 'string' },
      budget: { type: 'string' },
      concurrency: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      fake: { type: 'boolean', default: false },
      'fixture-index': { type: 'string' },
      'max-fingerprints': { type: 'string' },
    },
    allowPositionals: false,
    strict: true,
  });

  return {
    dataDir: parsed.values['data-dir'] ?? env.DEVVERIFY_DATA_DIR,
    budget:
      parsed.values.budget === undefined
        ? DEFAULT_BUDGET
        : positiveInteger(parsed.values.budget, 'budget', true),
    concurrency:
      parsed.values.concurrency === undefined
        ? DEFAULT_CONCURRENCY
        : positiveInteger(parsed.values.concurrency, 'concurrency'),
    dryRun: parsed.values['dry-run'],
    fake: parsed.values.fake,
    fixtureIndex: parsed.values['fixture-index'],
    maxFingerprints:
      parsed.values['max-fingerprints'] === undefined
        ? DEFAULT_MAX_FINGERPRINTS
        : positiveInteger(
            parsed.values['max-fingerprints'],
            'max-fingerprints',
          ),
  };
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  try {
    const cli = parseCliArgs(argv, env);
    const dataDir = resolve(cli.dataDir ?? './data');
    const fixtureIndex =
      cli.fixtureIndex === undefined
        ? undefined
        : resolve(cli.fixtureIndex);
    const apiKey = env.ANDROID_DEVID_STATUS_API_KEY;
    const summaryPath = env.GITHUB_STEP_SUMMARY;

    const options: CrawlOptions = {
      dataDir,
      budget: cli.budget,
      concurrency: cli.concurrency,
      dryRun: cli.dryRun,
      fake: cli.fake,
      maxFingerprints: cli.maxFingerprints,
      ...(fixtureIndex === undefined ? {} : { fixtureIndex }),
      ...(apiKey === undefined ? {} : { apiKey }),
      ...(summaryPath === undefined
        ? {}
        : { writeSummary: true, summaryPath }),
    };

    const result = await runCrawl(options);
    const earlyQuotaWarning = result.warnings.find(
      (warning) =>
        result.exitReason === 'quota_exhausted' &&
        warning.includes('before half of the configured budget'),
    );
    if (earlyQuotaWarning !== undefined) {
      process.stderr.write('::warning::' + earlyQuotaWarning + '\n');
    }
    process.stdout.write(resultJson(result) + '\n');
    return result.exitCode;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Invalid crawler arguments.';
    process.stderr.write(
      JSON.stringify({
        exitCode: 1,
        exitReason: 'configuration_error',
        message,
      }) + '\n',
    );
    return 1;
  }
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const code = await main();
  process.exitCode = code;
}
