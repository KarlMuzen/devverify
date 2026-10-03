import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createBufferSource } from './source.js';
import { buildApk, buildSigningBlock } from './build-apk-test-helper.js';
import { findEocd } from './zip.js';
import {
  extractApkSigners,
  readSigningBlock,
  V2_BLOCK_ID,
  V3_BLOCK_ID,
  V31_BLOCK_ID,
} from './signing-block.js';
import { sha256Hex } from '../fingerprint.js';

async function certificate(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(new URL(`../../../../fixtures/certs/${name}.der`, import.meta.url)));
}

describe('APK signing block parser', () => {
  it('extracts v2, v3, and v3.1 signer certificates and fingerprints', async () => {
    const v2 = await certificate('v2');
    const v3 = await certificate('v3');
    const rotated = await certificate('rotated');
    const apk = await buildApk({entries:[{name:'classes.dex',data:new Uint8Array([1])}],signers:[
      {scheme:'v2',certificate:v2},
      {scheme:'v3',certificate:v3,minSdk:24,maxSdk:35},
      {scheme:'v3.1',certificate:rotated,minSdk:34,maxSdk:35,hasRotationLineage:true},
    ]});
    const signers = await extractApkSigners(createBufferSource(apk));
    expect(signers.map(s=>s.scheme)).toEqual(['v2','v3','v3.1']);
    await expect(Promise.all([sha256Hex(v2),sha256Hex(v3),sha256Hex(rotated)])).resolves.toEqual(signers.map(s=>s.fingerprint));
    expect(signers[1]?.minSdk).toBe(24); expect(signers[1]?.maxSdk).toBe(35); expect(signers[2]?.hasRotationLineage).toBe(true);
  });

  it('returns no signers when the APK has no signing block', async () => {
    const apk=await buildApk({entries:[{name:'classes.dex',data:new Uint8Array([1])}]});
    await expect(extractApkSigners(createBufferSource(apk))).resolves.toEqual([]);
  });

  it('rejects a short signing pair before reading an ID', async () => {
    const apk=await buildApk({entries:[{name:'classes.dex',data:new Uint8Array([1])}],signers:[{scheme:'v2',certificate:await certificate('v2')}]});
    const source=createBufferSource(apk); const eocd=await findEocd(source); const block=await readSigningBlock(source,eocd.centralDirectoryOffset);
    const broken=new Uint8Array(apk); const pairOffset=eocd.centralDirectoryOffset-block.byteLength+8;
    new DataView(broken.buffer).setBigUint64(pairOffset,1n,true);
    await expect(extractApkSigners(createBufferSource(broken))).rejects.toMatchObject({code:'APK_SIGNING_PAIR_INVALID'});
  });

  it('rejects the outer signer limit when multiple scheme blocks exceed 32 signers', async () => {
    const cert=await certificate('v2');
    const v2=Array.from({length:20},()=>({scheme:'v2' as const,certificate:cert}));
    const v3=Array.from({length:13},()=>({scheme:'v3' as const,certificate:cert,minSdk:21,maxSdk:35}));
    const apk=await buildApk({entries:[{name:'classes.dex',data:new Uint8Array([1])}],signers:[...v2,...v3]});
    await expect(extractApkSigners(createBufferSource(apk))).rejects.toMatchObject({code:'APK_SIGNER_LIMIT'});
  });

  it('ignores unrecognized signing-block IDs', async () => {
    const apk=await buildApk({entries:[{name:'classes.dex',data:new Uint8Array([1])}],signers:[{scheme:'v2',certificate:await certificate('v2')}]});
    const source=createBufferSource(apk); const eocd=await findEocd(source); const block=await readSigningBlock(source,eocd.centralDirectoryOffset);
    const broken=new Uint8Array(apk); const blockStart=eocd.centralDirectoryOffset-block.byteLength;
    new DataView(broken.buffer).setUint32(blockStart+16,0x12345678,true);
    await expect(extractApkSigners(createBufferSource(broken))).resolves.toEqual([]);
  });

  it('rejects a signing block with mismatched size fields', async () => {
    const apk=await buildApk({entries:[{name:'classes.dex',data:new Uint8Array([1])}],signers:[{scheme:'v2',certificate:await certificate('v2')}]});
    const eocd=await findEocd(createBufferSource(apk)); const broken=new Uint8Array(apk); const block=await readSigningBlock(createBufferSource(apk),eocd.centralDirectoryOffset);
    const offset=eocd.centralDirectoryOffset-block.byteLength; new DataView(broken.buffer).setBigUint64(offset,1n,true);
    await expect(extractApkSigners(createBufferSource(broken))).rejects.toMatchObject({code:'APK_SIGNING_BLOCK_SIZE_MISMATCH'});
  });

  it('rejects a signing block with bad magic', async () => {
    const apk=await buildApk({entries:[{name:'classes.dex',data:new Uint8Array([1])}],signers:[{scheme:'v2',certificate:await certificate('v2')}]});
    const eocd=await findEocd(createBufferSource(apk)); const broken=new Uint8Array(apk); broken[eocd.centralDirectoryOffset-1]=(broken[eocd.centralDirectoryOffset-1]??0)^0xff;
    await expect(extractApkSigners(createBufferSource(broken))).rejects.toMatchObject({code:'APK_SIGNING_BLOCK_MAGIC'});
  });

  it('rejects malformed pair lengths', async () => {
    const apk=await buildApk({entries:[{name:'classes.dex',data:new Uint8Array([1])}],signers:[{scheme:'v2',certificate:await certificate('v2')}]});
    const eocd=await findEocd(createBufferSource(apk)); const broken=new Uint8Array(apk); const block=await readSigningBlock(createBufferSource(apk),eocd.centralDirectoryOffset);
    const offset=eocd.centralDirectoryOffset-block.byteLength+8; new DataView(broken.buffer).setBigUint64(offset,0xffffffffffffffffn,true);
    await expect(extractApkSigners(createBufferSource(broken))).rejects.toMatchObject({code:'APK_SIGNING_BLOCK_U64_OVERFLOW'});
  });

  it('rejects an undersized signing block before reading its body', async () => {
    const apk = await buildApk({ entries: [{ name: 'classes.dex', data: new Uint8Array([1]) }], signers: [{ scheme: 'v2', certificate: await certificate('v2') }] });
    const eocd = await findEocd(createBufferSource(apk));
    const broken = new Uint8Array(apk);
    new DataView(broken.buffer).setBigUint64(eocd.centralDirectoryOffset - 24, 23n, true);
    await expect(readSigningBlock(createBufferSource(broken), eocd.centralDirectoryOffset)).rejects.toMatchObject({ code: 'APK_SIGNING_BLOCK_SIZE' });
  });

  it('detects a signing-block magic mismatch between footer and full-block reads', async () => {
    const apk = await buildApk({ entries: [{ name: 'classes.dex', data: new Uint8Array([1]) }], signers: [{ scheme: 'v2', certificate: await certificate('v2') }] });
    const source = createBufferSource(apk);
    const eocd = await findEocd(source);
    let reads = 0;
    const inconsistent = {
      size: source.size,
      async read(offset: number, length: number) {
        const value = await source.read(offset, length);
        reads += 1;
        if (reads === 2) {
          const copy = new Uint8Array(value);
          copy[copy.length - 1] = (copy[copy.length - 1] ?? 0) ^ 0xff;
          return copy;
        }
        return value;
      },
    };
    await expect(readSigningBlock(inconsistent, eocd.centralDirectoryOffset)).rejects.toMatchObject({ code: 'APK_SIGNING_BLOCK_MAGIC' });
  });

  it('recognizes the v2/v3 block identifiers', () => { expect([V2_BLOCK_ID,V3_BLOCK_ID,V31_BLOCK_ID]).toHaveLength(3); expect(V2_BLOCK_ID).not.toBe(V3_BLOCK_ID); });

  it('readSigningBlock returns the validated block bytes', async () => {
    const apk=await buildApk({entries:[{name:'classes.dex',data:new Uint8Array([1])}],signers:[{scheme:'v2',certificate:new Uint8Array([1,2,3])}]});
    const eocd=await findEocd(createBufferSource(apk)); const block=await readSigningBlock(createBufferSource(apk),eocd.centralDirectoryOffset);
    expect(block.byteLength).toBeGreaterThan(24);
  });

  it('buildSigningBlock emits a valid empty block', () => { expect(buildSigningBlock([]).byteLength).toBe(32); });
});
