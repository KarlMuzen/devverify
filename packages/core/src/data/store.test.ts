import { describe, expect, it } from 'vitest';
import { createDataStore, type FsAdapter } from './store.js';
import type { DataSet } from './schemas.js';

class MemoryFs {
  readonly files = new Map<string, string>();
  failWriteAt: number | undefined;
  private writeCount = 0;

  readonly adapter: FsAdapter = {
    mkdir: async () => {},
    readFile: (path) => {
      const value = this.files.get(path);
      if (value === undefined) {
        const error = new Error('missing');
        Object.assign(error, { code: 'ENOENT' });
        throw error;
      }
      return Promise.resolve(value);
    },
    writeFile: (path, data) => {
      this.writeCount += 1;
      if (this.failWriteAt === this.writeCount) {
        throw new Error('simulated write failure');
      }
      this.files.set(path, data);
      return Promise.resolve();
    },
    rename: (from, to) => {
      const value = this.files.get(from);
      if (value === undefined) {
        throw new Error('missing temp file');
      }
      this.files.set(to, value);
      this.files.delete(from);
      return Promise.resolve();
    },
    unlink: (path) => {
      this.files.delete(path);
      return Promise.resolve();
    },
  };
}

function sample(): DataSet {
  return {
    apps: [
      {
        package: 'com.example.one',
        source: 'fdroid',
        fingerprints: ['AA'],
        checkedFingerprints: ['AA'],
        status: 'registered',
        firstSeenAt: '2026-10-01T00:00:00Z',
        checkedAt: '2026-10-01T00:00:00Z',
        firstRegisteredAt: '2026-10-01T00:00:00Z',
        errorCount: 0,
      },
    ],
    events: [
      {
        at: '2026-10-01T01:00:00Z',
        package: 'com.example.one',
        from: null,
        to: 'registered',
      },
    ],
    timeseries: [
      {
        date: '2026-10-01',
        total: 1,
        registered: 1,
        registered_other_key: 0,
        not_registered: 0,
        unknown: 0,
      },
    ],
    meta: {
      schemaVersion: 1,
      sources: {
        fdroid: {
          fetchedAt: '2026-10-01T00:00:00Z',
          packageCount: 1,
          etag: '"one"',
        },
      },
    },
  };
}

describe('DataStore', () => {
  it('creates missing files and preserves byte-stable round trips', async () => {
    const memory = new MemoryFs();
    const store = createDataStore('/dataset', memory.adapter);
    const initial = sample();
    await store.save(initial);
    const before = new Map(memory.files);
    const loaded = await store.load();
    await store.save(loaded);
    expect([...memory.files.entries()]).toEqual([...before.entries()]);
    expect([...memory.files.keys()].sort()).toEqual([
      '/dataset/apps.ndjson',
      '/dataset/events.ndjson',
      '/dataset/meta.json',
      '/dataset/timeseries.csv',
    ]);
  });

  it('leaves existing files intact when staging fails', async () => {
    const memory = new MemoryFs();
    const store = createDataStore('/dataset', memory.adapter);
    const initial = sample();
    await store.save(initial);
    const before = new Map(memory.files);
    memory.failWriteAt = 5;
    await expect(store.save(initial)).rejects.toMatchObject({
      code: 'DATASET_WRITE',
    });
    expect([...memory.files.entries()]).toEqual([...before.entries()]);
  });

  it('rejects a newer schema and supports an explicit migration hook', async () => {
    const memory = new MemoryFs();
    const store = createDataStore('/dataset', memory.adapter);
    await store.save(sample());
    memory.files.set('/dataset/meta.json', '{"schemaVersion":2,"sources":{}}');
    await expect(store.load()).rejects.toMatchObject({ code: 'DATASET_SCHEMA_NEWER' });

    memory.files.set('/dataset/meta.json', '{"schemaVersion":0,"sources":{}}');
    const migrated = createDataStore('/dataset', memory.adapter, {
      0: () => ({ schemaVersion: 1, sources: { fdroid: { packageCount: 0 } } }),
    });
    await expect(migrated.load()).resolves.toMatchObject({
      meta: { schemaVersion: 1 },
    });
  });
});
