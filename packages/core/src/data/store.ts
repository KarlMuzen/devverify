import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AppRecordSchema,
  EventRecordSchema,
  MetaSchema,
  TimeseriesRowSchema,
  type DataSet,
  type Meta,
} from './schemas.js';
import {
  DATA_FILES,
  DataFormatError,
  parseAppsNdjson,
  parseEventsNdjson,
  parseTimeseriesCsv,
  toMetaJson,
  toNdjson,
  toTimeseriesCsv,
} from './serialize.js';

export interface FsAdapter {
  mkdir(path: string): Promise<void>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, data: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

export type MetaMigration = (value: unknown) => unknown;

export interface DataStore {
  load(): Promise<DataSet>;
  save(data: DataSet): Promise<void>;
}

export interface FilePaths {
  readonly apps: string;
  readonly events: string;
  readonly timeseries: string;
  readonly meta: string;
}

export class DataStoreError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = 'DataStoreError';
    this.code = code;
  }
}

const CURRENT_SCHEMA_VERSION = 1;

function nodeFsAdapter(): FsAdapter {
  return {
    mkdir: async (path) => {
      await mkdir(path, { recursive: true });
    },
    readFile: async (path) => readFile(path, 'utf8'),
    writeFile: async (path, data) => {
      await writeFile(path, data, 'utf8');
    },
    rename: async (from, to) => {
      await rename(from, to);
    },
    unlink: async (path) => {
      await unlink(path);
    },
  };
}

function filePaths(dir: string): FilePaths {
  return {
    apps: join(dir, DATA_FILES.apps),
    events: join(dir, DATA_FILES.events),
    timeseries: join(dir, DATA_FILES.timeseries),
    meta: join(dir, DATA_FILES.meta),
  };
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT';
}

function defaultMeta(): Meta {
  return { schemaVersion: CURRENT_SCHEMA_VERSION, sources: {} };
}

async function readOptional(fs: FsAdapter, path: string): Promise<string | undefined> {
  try {
    return await fs.readFile(path);
  } catch (error) {
    if (isMissing(error)) {
      return undefined;
    }
    throw error;
  }
}

function migrateMeta(
  text: string | undefined,
  migrations: Readonly<Record<number, MetaMigration>>,
): Meta {
  if (text === undefined) {
    return defaultMeta();
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new DataFormatError('meta.json is not valid JSON.');
  }

  if (typeof raw !== 'object' || raw === null || !('schemaVersion' in raw)) {
    throw new DataStoreError('DATASET_SCHEMA', 'meta.json has no schemaVersion.');
  }
  const versionValue = (raw as { schemaVersion?: unknown }).schemaVersion;
  if (typeof versionValue !== 'number' || !Number.isInteger(versionValue)) {
    throw new DataStoreError('DATASET_SCHEMA', 'meta.json schemaVersion is not an integer.');
  }

  let version = versionValue;
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new DataStoreError(
      'DATASET_SCHEMA_NEWER',
      'Dataset schemaVersion ' + version +
        ' is newer than supported version ' + CURRENT_SCHEMA_VERSION + '.',
    );
  }

  while (version < CURRENT_SCHEMA_VERSION) {
    const migrate = migrations[version];
    if (migrate === undefined) {
      throw new DataStoreError(
        'DATASET_SCHEMA_OLD',
        'Dataset schemaVersion ' + version + ' requires a migration.',
      );
    }
    raw = migrate(raw);
    if (typeof raw !== 'object' || raw === null || !('schemaVersion' in raw)) {
      throw new DataStoreError(
        'DATASET_SCHEMA_MIGRATION',
        'Migration from schemaVersion ' + version + ' returned invalid metadata.',
      );
    }
    const next = (raw as { schemaVersion?: unknown }).schemaVersion;
    if (typeof next !== 'number' || !Number.isInteger(next) || next <= version) {
      throw new DataStoreError(
        'DATASET_SCHEMA_MIGRATION',
        'Migration from schemaVersion ' + version + ' did not advance the schema version.',
      );
    }
    version = next;
  }

  return MetaSchema.parse(raw);
}

function validateDataset(data: DataSet): void {
  try {
    AppRecordSchema.array().parse(data.apps);
    EventRecordSchema.array().parse(data.events);
    TimeseriesRowSchema.array().parse(data.timeseries);
    MetaSchema.parse(data.meta);
  } catch (error) {
    throw new DataStoreError('DATASET_SCHEMA', 'Dataset failed schema validation: ' + String(error));
  }
}

async function cleanupTemps(fs: FsAdapter, paths: readonly string[]): Promise<void> {
  await Promise.all(paths.map(async (path) => {
    try {
      await fs.unlink(path);
    } catch {
      // Cleanup is best-effort after the primary failure.
    }
  }));
}

/** Creates a deterministic, filesystem-backed dataset store with injectable I/O. */
export function createDataStore(
  dir: string,
  fs: FsAdapter = nodeFsAdapter(),
  migrations: Readonly<Record<number, MetaMigration>> = {},
): DataStore {
  const paths = filePaths(dir);

  return {
    async load(): Promise<DataSet> {
      await fs.mkdir(dir);
      const [appsText, eventsText, timeseriesText, metaText] = await Promise.all([
        readOptional(fs, paths.apps),
        readOptional(fs, paths.events),
        readOptional(fs, paths.timeseries),
        readOptional(fs, paths.meta),
      ]);
      return {
        apps: appsText === undefined ? [] : parseAppsNdjson(appsText),
        events: eventsText === undefined ? [] : parseEventsNdjson(eventsText),
        timeseries: timeseriesText === undefined ? [] : parseTimeseriesCsv(timeseriesText),
        meta: migrateMeta(metaText, migrations),
      };
    },

    async save(data: DataSet): Promise<void> {
      validateDataset(data);
      await fs.mkdir(dir);
      const output = [
        [paths.apps, toNdjson(data.apps)],
        [paths.events, toNdjson(data.events)],
        [paths.timeseries, toTimeseriesCsv(data.timeseries)],
        [paths.meta, toMetaJson(data.meta)],
      ] as const;
      const temps = output.map(([path]) => path + '.tmp');
      try {
        for (let index = 0; index < output.length; index += 1) {
          const entry = output[index];
          const temp = temps[index];
          if (entry === undefined || temp === undefined) {
            throw new DataStoreError('DATASET_WRITE', 'Internal dataset staging error.');
          }
          await fs.writeFile(temp, entry[1]);
        }
        for (let index = 0; index < output.length; index += 1) {
          const entry = output[index];
          const temp = temps[index];
          if (entry === undefined || temp === undefined) {
            throw new DataStoreError('DATASET_WRITE', 'Internal dataset rename error.');
          }
          await fs.rename(temp, entry[0]);
        }
      } catch (error) {
        await cleanupTemps(fs, temps);
        if (error instanceof DataStoreError) {
          throw error;
        }
        throw new DataStoreError('DATASET_WRITE', String(error));
      }
    },
  };
}