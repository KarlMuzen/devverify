import { describe, expect, it } from 'vitest';
import { createFakeStatusClient } from './fake.js';

const FINGERPRINT = 'AB'.repeat(32);

describe('createFakeStatusClient', () => {
  it('is deterministic for the same seed and package', async () => {
    const first = createFakeStatusClient({ seed: 'seed' });
    const second = createFakeStatusClient({ seed: 'seed' });

    await expect(first.check('com.example.app', FINGERPRINT)).resolves.toEqual(
      await second.check('com.example.app', FINGERPRINT),
    );
  });

  it('normalizes the optional fingerprint and validates package names', async () => {
    const client = createFakeStatusClient({ seed: 'seed' });

    await expect(client.check('com.example.app', FINGERPRINT)).resolves.toMatchObject({
      package: 'com.example.app',
      fingerprint: FINGERPRINT.toLowerCase(),
    });
    await expect(client.check('invalid')).rejects.toMatchObject({
      code: 'INVALID_PACKAGE_NAME',
    });
  });

  it('produces every supported state across a package set', async () => {
    const client = createFakeStatusClient({ seed: 'coverage' });
    const states = new Set<string>();

    for (let index = 0; index < 100; index += 1) {
      const result = await client.check('com.example.app' + index);
      states.add(result.state);
    }

    expect(states).toEqual(
      new Set([
        'REGISTERED',
        'REGISTERED_WITH_ANOTHER_CERTIFICATE_FINGERPRINT',
        'NOT_REGISTERED',
      ]),
    );
  });
});
