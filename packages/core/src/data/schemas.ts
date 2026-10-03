import { z } from 'zod';

export const AppStatusSchema = z.enum([
  'registered',
  'registered_other_key',
  'not_registered',
  'unknown',
]);

const IsoDateTimeSchema = z.string().datetime({ offset: true });
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const LastErrorSchema = z.object({
  at: IsoDateTimeSchema,
  code: z.string().min(1),
  message: z.string(),
});

export const AppRecordSchema = z.object({
  package: z.string().min(1),
  source: z.literal('fdroid'),
  fingerprints: z.array(z.string()),
  checkedFingerprints: z.array(z.string()),
  status: AppStatusSchema,
  firstSeenAt: IsoDateTimeSchema,
  checkedAt: IsoDateTimeSchema.optional(),
  statusChangedAt: IsoDateTimeSchema.optional(),
  firstRegisteredAt: IsoDateTimeSchema.optional(),
  errorCount: z.number().int().nonnegative().default(0),
  lastError: LastErrorSchema.optional(),
  removedAt: IsoDateTimeSchema.optional(),
});

export const EventRecordSchema = z.object({
  at: IsoDateTimeSchema,
  package: z.string().min(1),
  from: AppStatusSchema.nullable(),
  to: AppStatusSchema,
});

export const TimeseriesRowSchema = z.object({
  date: DateSchema,
  total: z.number().int().nonnegative(),
  registered: z.number().int().nonnegative(),
  registered_other_key: z.number().int().nonnegative(),
  not_registered: z.number().int().nonnegative(),
  unknown: z.number().int().nonnegative(),
});

export const SourceMetaSchema = z.object({
  etag: z.string().optional(),
  lastModified: z.string().optional(),
  fetchedAt: IsoDateTimeSchema.optional(),
  packageCount: z.number().int().nonnegative().optional(),
});

export const LastRunSchema = z.object({
  startedAt: IsoDateTimeSchema,
  finishedAt: IsoDateTimeSchema,
  requestsUsed: z.number().int().nonnegative(),
  budget: z.number().int().nonnegative(),
  exitReason: z.string().min(1),
  counts: z.record(z.string(), z.number().int().nonnegative()),
});

export const MetaSchema = z.object({
  schemaVersion: z.literal(1),
  sources: z.record(z.string().min(1), SourceMetaSchema),
  lastRun: LastRunSchema.optional(),
});

export type AppRecord = z.infer<typeof AppRecordSchema>;
export type EventRecord = z.infer<typeof EventRecordSchema>;
export type TimeseriesRow = z.infer<typeof TimeseriesRowSchema>;
export type SourceMeta = z.infer<typeof SourceMetaSchema>;
export type LastRun = z.infer<typeof LastRunSchema>;
export type Meta = z.infer<typeof MetaSchema>;

export interface DataSet {
  readonly apps: AppRecord[];
  readonly events: EventRecord[];
  readonly timeseries: TimeseriesRow[];
  readonly meta: Meta;
}
