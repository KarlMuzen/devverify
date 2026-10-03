export type ApkSignerScheme = 'v2' | 'v3' | 'v3.1';

export interface ApkSigner {
  readonly scheme: ApkSignerScheme;
  readonly certificates: Uint8Array[];
  readonly fingerprint: string;
  readonly minSdk?: number;
  readonly maxSdk?: number;
  readonly hasRotationLineage: boolean;
}
