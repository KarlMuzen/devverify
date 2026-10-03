import { parseSignerIndex } from '../packages/core/src/fdroid/signer-index.js';

const URL = 'https://f-droid.org/repo/signer-index.json';

function topLevelType(value: unknown): string {
  if (Array.isArray(value)) {
    return 'array';
  }
  if (value === null) {
    return 'null';
  }
  return typeof value;
}

function truncateFingerprint(value: string): string {
  return value.length <= 16 ? value : value.slice(0, 16) + '…';
}

async function main(): Promise<void> {
  if (process.env.LIVE !== '1') {
    console.error('This live check only runs when LIVE=1.');
    process.exitCode = 2;
    return;
  }

  const response = await fetch(URL, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const json: unknown = await response.json();
  const parsed = parseSignerIndex(json);

  console.log(`top-level type: ${topLevelType(json)}`);
  console.log(`matched parser shape: ${parsed.shape}`);
  console.log(`entry count: ${parsed.entries.length}`);
  console.log(`ETag: ${response.headers.get('ETag') ?? '(none)'}`);
  console.log(
    `Last-Modified: ${response.headers.get('Last-Modified') ?? '(none)'}`,
  );

  for (const entry of parsed.entries.slice(0, 3)) {
    const samples = entry.fingerprints
      .slice(0, 3)
      .map(truncateFingerprint)
      .join(', ');
    console.log(`sample: ${entry.package} -> [${samples}]`);
  }

  if (parsed.warnings.length > 0) {
    console.log(`warnings: ${parsed.warnings.length}`);
  }
}

await main();
