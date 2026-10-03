import { isValidPackageName } from '../package-name.js';
import { normalizeFingerprint } from '../fingerprint.js';
import { SourceFormatError } from '../source.js';

export type SignerIndexShape = 'A' | 'B' | 'C';

export interface SignerIndexEntry {
  package: string;
  fingerprints: string[];
}

export interface ParsedSignerIndex {
  entries: SignerIndexEntry[];
  warnings: string[];
  shape: SignerIndexShape;
}

const FINGERPRINT_KEYS = [
  'signer',
  'signers',
  'sha256',
  'fingerprint',
  'fingerprints',
] as const;

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fingerprintValues(value: unknown): unknown[] {
  if (typeof value === 'string') {
    return [value];
  }

  if (Array.isArray(value)) {
    return value;
  }

  return [];
}

function collectFingerprints(
  value: unknown,
  packageName: string,
  warnings: string[],
): string[] {
  if (!isRecord(value)) {
    return fingerprintValues(value).flatMap((item) =>
      typeof item === 'string'
        ? normalizeOne(item, packageName, warnings)
        : warnInvalid(item, packageName, warnings),
    );
  }

  const values: string[] = [];
  for (const key of FINGERPRINT_KEYS) {
    if (!(key in value)) {
      continue;
    }

    for (const item of fingerprintValues(value[key])) {
      if (typeof item === 'string') {
        values.push(...normalizeOne(item, packageName, warnings));
      } else {
        warnings.push(`Invalid fingerprint for ${packageName}: expected a string.`);
      }
    }
  }

  return values;
}

function warnInvalid(
  _value: unknown,
  packageName: string,
  warnings: string[],
): string[] {
  warnings.push(`Invalid fingerprint for ${packageName}: expected a string.`);
  return [];
}

function normalizeOne(
  value: string,
  packageName: string,
  warnings: string[],
): string[] {
  try {
    return [normalizeFingerprint(value)];
  } catch {
    warnings.push(`Invalid fingerprint for ${packageName}.`);
    return [];
  }
}

function addEntry(
  map: Map<string, Set<string>>,
  packageName: unknown,
  value: unknown,
  warnings: string[],
): void {
  if (typeof packageName !== 'string' || !isValidPackageName(packageName)) {
    warnings.push('Invalid package name in signer index.');
    return;
  }

  const fingerprints = collectFingerprints(value, packageName, warnings);
  if (fingerprints.length === 0) {
    return;
  }

  const current = map.get(packageName) ?? new Set<string>();
  for (const fingerprint of fingerprints) {
    current.add(fingerprint);
  }
  map.set(packageName, current);
}

function parseMap(
  input: RecordValue,
  shape: SignerIndexShape,
  warnings: string[],
): ParsedSignerIndex {
  const entries = new Map<string, Set<string>>();

  for (const [packageName, value] of Object.entries(input)) {
    addEntry(entries, packageName, value, warnings);
  }

  return finish(entries, warnings, shape);
}

function parseArray(
  input: unknown[],
  warnings: string[],
): ParsedSignerIndex {
  const entries = new Map<string, Set<string>>();

  for (const row of input) {
    if (!isRecord(row)) {
      warnings.push('Unrecognized signer-index array entry.');
      continue;
    }

    const packageName =
      typeof row.package === 'string'
        ? row.package
        : typeof row.packageName === 'string'
          ? row.packageName
          : row.id;

    addEntry(entries, packageName, row, warnings);
  }

  return finish(entries, warnings, 'C');
}

function finish(
  entries: Map<string, Set<string>>,
  warnings: string[],
  shape: SignerIndexShape,
): ParsedSignerIndex {
  return {
    entries: [...entries.entries()]
      .map(([packageName, fingerprints]) => ({
        package: packageName,
        fingerprints: [...fingerprints].sort(),
      }))
      .sort((left, right) => left.package.localeCompare(right.package)),
    warnings,
    shape,
  };
}

function hasRecognizableMapShape(input: RecordValue): SignerIndexShape | undefined {
  const values = Object.values(input);

  if (values.some(Array.isArray)) {
    return 'A';
  }

  if (
    values.some(
      (value) =>
        isRecord(value) &&
        FINGERPRINT_KEYS.some((key) => key in value),
    )
  ) {
    return 'B';
  }

  return undefined;
}

/**
 * Parses known and tolerant signer-index representations without assigning
 * meaning to fingerprint ordering.
 */
export function parseSignerIndex(json: unknown): ParsedSignerIndex {
  const warnings: string[] = [];

  if (Array.isArray(json)) {
    const recognizable = json.some(
      (row) =>
        isRecord(row) &&
        ('package' in row || 'packageName' in row || 'id' in row) &&
        FINGERPRINT_KEYS.some((key) => key in row),
    );

    if (!recognizable) {
      throw new SourceFormatError('Signer index array contains no recognizable entries.');
    }

    return parseArray(json, warnings);
  }

  if (!isRecord(json)) {
    throw new SourceFormatError('Signer index must be an object or array.');
  }

  const shape = hasRecognizableMapShape(json);
  if (shape === undefined) {
    throw new SourceFormatError(
      'Signer index contains no recognizable package-to-fingerprint entries.',
    );
  }

  return parseMap(json, shape, warnings);
}
