import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  parseAppsNdjson,
  parseEventsNdjson,
  parseMetaJson,
  parseTimeseriesCsv,
  toMetaJson,
  toNdjson,
  toTimeseriesCsv,
} from './serialize.js';

async function fixture(name: string): Promise<string> {
  return readFile(
    new URL('../../../../fixtures/sample-data/' + name, import.meta.url),
    'utf8',
  );
}

describe('sample dataset fixture', () => {
  it('is complete and serializer-stable', async () => {
    const [appsText, eventsText, timeseriesText, metaText] = await Promise.all([
      fixture('apps.ndjson'),
      fixture('events.ndjson'),
      fixture('timeseries.csv'),
      fixture('meta.json'),
    ]);
    const apps = parseAppsNdjson(appsText);
    const events = parseEventsNdjson(eventsText);
    const timeseries = parseTimeseriesCsv(timeseriesText);
    const meta = parseMetaJson(metaText);

    expect(apps).toHaveLength(80);
    expect(events).toHaveLength(60);
    expect(timeseries).toHaveLength(120);
    expect(apps.some((record) => record.removedAt !== undefined)).toBe(true);
    expect(apps.some((record) => record.lastError !== undefined)).toBe(true);
    expect(new Set(apps.map((record) => record.status)).size).toBe(4);

    expect(toNdjson(apps)).toBe(appsText);
    expect(toNdjson(events)).toBe(eventsText);
    expect(toTimeseriesCsv(timeseries)).toBe(timeseriesText);
    expect(toMetaJson(meta)).toBe(metaText);
  });
});
