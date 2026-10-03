import { assertPackageName } from '../package-name.js';
import { normalizeFingerprint } from '../fingerprint.js';
import type { ApiState } from './types.js';

export interface FakeStatusClient {
  check(
    packageName: string,
    fingerprint?: string,
  ): Promise<{
    package: string;
    fingerprint?: string;
    state: ApiState;
    rawState: string;
  }>;
}

function hashSeed(input: string): number {
  let hash = 0x811c9dc5;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}

function stateFor(seed: string, packageName: string): ApiState {
  const bucket = hashSeed(seed + '\u0000' + packageName) % 100;

  if (bucket < 25) {
    return 'REGISTERED';
  }
  if (bucket < 35) {
    return 'REGISTERED_WITH_ANOTHER_CERTIFICATE_FINGERPRINT';
  }
  return 'NOT_REGISTERED';
}

export function createFakeStatusClient({ seed }: { seed: string }): FakeStatusClient {
  return {
    check(packageName, fingerprint) {
      const pkg = assertPackageName(packageName);
      const normalizedFingerprint =
        fingerprint === undefined ? undefined : normalizeFingerprint(fingerprint);
      const state = stateFor(seed, pkg);

      return Promise.resolve({
        package: pkg,
        ...(normalizedFingerprint === undefined
          ? {}
          : { fingerprint: normalizedFingerprint }),
        state,
        rawState: state,
      };
    },
  };
}
