import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BUDGET } from './runner.js';
import { writeStepSummary } from './summary.js';

describe('writeStepSummary', () => {
  it('writes the crawl metrics to the GitHub step summary', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'devverify-summary-'));
    const path = join(dir, 'summary.md');
    const result = {
      exitCode: 0,
      exitReason: 'completed' as const,
      requestsUsed: 12,
      budget: DEFAULT_BUDGET,
      counts: {
        registered: 4,
        registered_other_key: 2,
        not_registered: 10,
        unknown: 1,
        added: 2,
        removed: 1,
        fingerprintChanged: 3,
        errors: 0,
      },
      warnings: [],
    };

    try {
      await writeStepSummary(path, result);
      const content = await readFile(path, 'utf8');
      expect(content).toContain('# devverify crawl');
      expect(content).toContain('Requests used: 12/950');
      expect(content).toContain('| registered | 4 |');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
