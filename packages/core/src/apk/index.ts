export {
  ApkParseError,
  createBufferSource,
  createCountingSource,
  createVirtualSource,
  type CountingRandomAccessSource,
  type RandomAccessSource,
  type VirtualPatch,
} from './source.js';

export {
  findEocd,
  readCentralDirectory,
  readEntry,
  MAX_CENTRAL_DIRECTORY_BYTES,
  MAX_INFLATED_ENTRY_BYTES,
  type CentralDirectoryEntry,
  type EocdInfo,
} from './zip.js';

export {
  parseDer,
  readContextSpecific,
  readInteger,
  readOid,
  readSequence,
  readSet,
  MAX_DER_DEPTH,
  isContextSpecific,
  type DerNode,
} from './der.js';

export {
  extractV1Signers,
  parseV1Signature,
  MAX_V1_SIGNATURE_BYTES,
  type V1Signer,
} from './v1.js';

export {
  combineSigners,
  type CombinedSigner,
  type CombinedSigners,
} from './signers.js';

export {
  extractApkSigners,
  readSigningBlock,
  APK_SIG_BLOCK_MAGIC,
  MAX_CERTIFICATE_BYTES,
  MAX_CERTIFICATES,
  MAX_SIGNERS,
  MAX_SIGNING_BLOCK_BYTES,
  PROOF_OF_ROTATION_ATTRIBUTE_ID,
  V2_BLOCK_ID,
  V3_BLOCK_ID,
  V31_BLOCK_ID,
  type ApkSigner,
  type ApkSignerScheme,
} from './signing-block.js';
