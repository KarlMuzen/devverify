import { describe, expect, it } from 'vitest';
import { createBufferSource, createCountingSource, createVirtualSource } from './source.js';
import { findEocd, readCentralDirectory, readEntry } from './zip.js';
import { buildApk } from './build-apk-test-helper.js';

describe('APK ZIP reader', () => {
  it('finds EOCD with a maximum tail scan and reads stored entries', async () => {
    const apk = await buildApk({
      entries: [
        { name: 'classes.dex', data: new Uint8Array([1, 2, 3]) },
      ],
      comment: new TextEncoder().encode('comment'),
    });
    const source = createCountingSource(createBufferSource(apk));
    const eocd = await findEocd(source);
    const entries = await readCentralDirectory(source, eocd);

    expect(entries).toEqual([
      {
        name: 'classes.dex',
        method: 0,
        compressedSize: 3,
        uncompressedSize: 3,
        localHeaderOffset: 0,
      },
    ]);
    await expect(readEntry(source, 'classes.dex', eocd, entries)).resolves.toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(source.readCalls).toBeGreaterThanOrEqual(4);
  });

  it('reads a deflated entry', async () => {
    const apk = await buildApk({
      entries: [
        {
          name: 'AndroidManifest.xml',
          data: new TextEncoder().encode('hello hello hello'),
          method: 8,
        },
      ],
    });
    const source = createBufferSource(apk);
    const entries = await readCentralDirectory(source);
    await expect(readEntry(source, 'AndroidManifest.xml', undefined, entries))
      .resolves.toEqual(new TextEncoder().encode('hello hello hello'));
  });

  it('supports ZIP64 EOCD and central-directory extra fields', async () => {
    const apk = await buildApk({
      zip64: true,
      entries: [{ name: 'classes.dex', data: new Uint8Array([4, 5]) }],
    });
    const source = createBufferSource(apk);
    const eocd = await findEocd(source);
    expect(eocd.zip64).toBe(true);
    const entries = await readCentralDirectory(source, eocd);
    expect(entries[0]).toEqual({
      name: 'classes.dex',
      method: 0,
      compressedSize: 2,
      uncompressedSize: 2,
      localHeaderOffset: 0,
    });
  });

  it('rejects an entry with an impossible local-header offset', async () => {
    const apk = await buildApk({
      entries: [{ name: 'bad', data: new Uint8Array([1]) }],
    });
    const eocd = await findEocd(createBufferSource(apk));
    const broken = new Uint8Array(apk);
    const cd = eocd.centralDirectoryOffset;
    new DataView(broken.buffer).setUint32(cd + 42, 0xffffffff, true);
    const source = createBufferSource(broken);
    const entries = await readCentralDirectory(source);
    await expect(readEntry(source, 'bad', eocd, entries)).rejects.toMatchObject({
      code: 'APK_ZIP_DATA_OUT_OF_BOUNDS',
    });
  });

  it('parses a 600 MiB sparse APK with less than 4 MiB read', async () => {
    const small = await buildApk({
      entries: [{ name: 'classes.dex', data: new Uint8Array([1]) }],
    });
    const smallSource = createBufferSource(small);
    const smallEocd = await findEocd(smallSource);
    const centralDirectory = small.slice(
      smallEocd.centralDirectoryOffset,
      smallEocd.centralDirectoryOffset + smallEocd.centralDirectorySize,
    );

    const size = 600 * 1024 * 1024;
    const eocdOffset = size - 22;
    const centralOffset = eocdOffset - centralDirectory.byteLength;
    const eocd = new Uint8Array(22);
    const eocdView = new DataView(eocd.buffer);
    eocdView.setUint32(0, 0x06054b50, true);
    eocdView.setUint16(8, 1, true);
    eocdView.setUint16(10, 1, true);
    eocdView.setUint32(12, centralDirectory.byteLength, true);
    eocdView.setUint32(16, centralOffset, true);

    const counting = createCountingSource(
      createVirtualSource(size, [
        { offset: centralOffset, data: centralDirectory },
        { offset: eocdOffset, data: eocd },
      ]),
    );

    const entries = await readCentralDirectory(counting);
    expect(entries[0]?.name).toBe('classes.dex');
    expect(counting.bytesRead).toBeLessThan(4 * 1024 * 1024);
  });
});
