import { describe, expect, it } from 'vitest';
import {
  ApkParseError,
  createBufferSource,
  createCountingSource,
  createVirtualSource,
} from './source.js';

describe('APK random-access sources', () => {
  it('reads a copied buffer and enforces bounds', async () => {
    const input = new Uint8Array([1, 2, 3]);
    const source = createBufferSource(input);
    input[0] = 9;

    await expect(source.read(0, 3)).resolves.toEqual(new Uint8Array([1, 2, 3]));
    await expect(source.read(2, 2)).rejects.toBeInstanceOf(ApkParseError);
  });

  it('counts bytes and read calls', async () => {
    const counting = createCountingSource(createBufferSource(new Uint8Array(8)));
    await counting.read(0, 3);
    await counting.read(3, 2);
    expect(counting.bytesRead).toBe(5);
    expect(counting.readCalls).toBe(2);
  });

  it('returns zero-filled virtual bytes except for patches', async () => {
    const source = createVirtualSource(10, [
      { offset: 3, data: new Uint8Array([7, 8]) },
    ]);
    await expect(source.read(1, 5)).resolves.toEqual(
      new Uint8Array([0, 0, 7, 8, 0]),
    );
  });

  it('rejects overlapping virtual patches', () => {
    expect(() =>
      createVirtualSource(10, [
        { offset: 2, data: new Uint8Array([1, 2, 3]) },
        { offset: 4, data: new Uint8Array([4]) },
      ]),
    ).toThrowError(ApkParseError);
  });
});
