import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { SourceFormatError } from '../source.js';
import { parseSignerIndex } from './signer-index.js';

const FIXTURE_ROOT = new URL('../../../../../fixtures/fdroid/', import.meta.url);

async function fixture(name: string): Promise<unknown> {
  const text = await readFile(new URL(name, FIXTURE_ROOT), 'utf8');
  return JSON.parse(text) as unknown;
}

describe('parseSignerIndex', () => {
  it('normalizes shape A, B, and C to identical entries', async () => {
    const [a, b, c] = await Promise.all([
      fixture('signer-index.shapeA.json'),
      fixture('signer-index.shapeB.json'),
      fixture('signer-index.shapeC.json'),
    ]);

    const normalize = (json: unknown) => parseSignerIndex(json);

    const resultA = normalize(a);
    const resultB = normalize(b);
    const resultC = normalize(c);
    const expected = resultA.entries;

    expect(resultB.entries).toEqual(expected);
    expect(resultC.entries).toEqual(expected);
    expect(resultA.shape).toBe('A');
    expect(resultB.shape).toBe('B');
    expect(resultC.shape).toBe('C');
    expect(resultA.warnings).toEqual([]);
    expect(resultB.warnings).toEqual([]);
    expect(resultC.warnings).toEqual([]);
  });

  it('warns and drops invalid fingerprints while keeping valid ones', () => {
    const result = parseSignerIndex({
      'com.example.app': ['11'.repeat(32), 'not-a-fingerprint'],
    });

    expect(result.entries).toEqual([
      {
        package: 'com.example.app',
        fingerprints: ['11'.repeat(32)],
      },
    ]);
    expect(result.warnings).toHaveLength(1);
  });

  it('warns and drops invalid package names', () => {
    const result = parseSignerIndex({
      invalid: ['11'.repeat(32)],
      'com.example.valid': ['22'.repeat(32)],
    });

    expect(result.entries).toEqual([
      {
        package: 'com.example.valid',
        fingerprints: ['22'.repeat(32)],
      },
    ]);
    expect(result.warnings).toHaveLength(1);
  });

  it('deduplicates fingerprints without assigning order semantics', () => {
    const result = parseSignerIndex({
      'com.example.app': {
        signer: ['22'.repeat(32), '11'.repeat(32)],
        fingerprints: ['22'.repeat(32)],
      },
    });

    expect(result.entries[0]?.fingerprints).toEqual([
      '11'.repeat(32),
      '22'.repeat(32),
    ]);
  });

  it('throws SourceFormatError for an unrecognizable payload', async () => {
    const malformed = await fixture('malformed.json');

    expect(() => parseSignerIndex(malformed)).toThrowError(SourceFormatError);
    expect(() => parseSignerIndex(null)).toThrowError(SourceFormatError);
    expect(() => parseSignerIndex(['not-an-object'])).toThrowError(SourceFormatError);
  });
});
