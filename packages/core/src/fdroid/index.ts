import {
  FDROID_SIGNER_INDEX_URL,
  createFdroidSource,
  MAX_SIGNER_INDEX_BYTES,
  SIGNER_INDEX_TIMEOUT_MS,
} from './source.js';
import { parseSignerIndex, type ParsedSignerIndex, type SignerIndexEntry, type SignerIndexShape } from './signer-index.js';

export {
  createFdroidSource,
  FDROID_SIGNER_INDEX_URL,
  MAX_SIGNER_INDEX_BYTES,
  SIGNER_INDEX_TIMEOUT_MS,
};
export {
  parseSignerIndex,
  type ParsedSignerIndex,
  type SignerIndexEntry,
  type SignerIndexShape,
};
