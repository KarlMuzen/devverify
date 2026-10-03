import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { en, getGuidance, t } from './index.js';
import type { AppStatus } from '../status/types.js';

const cases = [
  ['registered', 'apk'],
  ['registered', 'fdroid'],
  ['registered_other_key', 'apk'],
  ['registered_other_key', 'fdroid'],
  ['not_registered', 'apk'],
  ['not_registered', 'fdroid'],
  ['unknown', 'apk'],
  ['unknown', 'fdroid'],
] as const satisfies readonly [AppStatus, 'apk' | 'fdroid'][];

describe('guidance', () => {
  it.each(cases)('snapshots %s/%s', async (status, origin) => {
    const guidance = getGuidance(status, {
      package: 'com.example.test',
      fingerprint: 'AA:BB',
      origin,
    });
    const snapshotPath = fileURLToPath(
      new URL(`./snapshots/${status}-${origin}.json`, import.meta.url),
    );
    await expect(`${JSON.stringify(guidance, null, 2)}\n`).toMatchFileSnapshot(snapshotPath);
  });

  it.each(cases)('does not require a fingerprint %s/%s', (status, origin) => {
    const guidance = getGuidance(status, {
      package: 'com.example.test',
      origin,
    });
    const serialized = JSON.stringify(guidance);
    expect(serialized).not.toContain('{fingerprint}');
    expect(guidance.links.every((item) => item.url.startsWith('https://'))).toBe(true);
  });

  it('substitutes parameters without changing unrelated text', () => {
    expect(t('guidance.registered.apk.summary', { package: 'com.example.test' })).toBe(
      'The checked signing key is registered for com.example.test.',
    );
    expect(t('guidance.registered.apk.step.verify', { fingerprint: 'AA:BB' })).toContain(
      'AA:BB',
    );
    expect(t('guidance.registered.apk.step.verify', {})).toContain('{fingerprint}');
  });

  it('contains no prohibited phrases', () => {
    const banned = [/will be blocked/i, /\bADC\b/, /claim a package name/i];
    for (const value of Object.values(en)) {
      for (const pattern of banned) {
        expect(value).not.toMatch(pattern);
      }
    }
  });

  it('uses only official Android developer verification links', () => {
    const urls = Object.entries(en)
      .filter(([key]) => key.endsWith('.url'))
      .map(([, value]) => value);
    expect(urls).toHaveLength(6);
    for (const url of urls) {
      expect(url).toMatch(
        /^https:\/\/developer\.android\.com\/developer-verification(?:\/|$)/,
      );
    }
  });
});
