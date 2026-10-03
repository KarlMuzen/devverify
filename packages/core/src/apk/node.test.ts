import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileSource } from '../node.js';

describe('fileSource', () => {
  it('reads bounded ranges and closes its handle', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'devverify-apk-'));
    const path = join(directory, 'test.apk');
    await writeFile(path, new Uint8Array([0, 1, 2, 3, 4]));
    const source = await fileSource(path);
    try {
      expect(source.size).toBe(5);
      await expect(source.read(1, 3)).resolves.toEqual(new Uint8Array([1, 2, 3]));
      await expect(source.read(4, 2)).rejects.toThrow(RangeError);
    } finally {
      await source.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
