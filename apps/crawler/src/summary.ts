import { appendFile } from 'node:fs/promises';
import type { CrawlResult } from './types.js';

function summaryText(result: CrawlResult): string {
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
  await appendFile(path, summaryText(result), 'utf8');
}
