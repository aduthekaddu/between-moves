import { z } from 'zod';

const opaqueChannel = z
  .string()
  .min(16)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/)
  .refine(
    (value) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
  );

/** [BM-038] Sequenced realtime publish envelope; channels stay opaque. */
export const realtimePublishEnvelopeSchema = z
  .object({
    id: z.string().uuid(),
    channel: opaqueChannel,
    name: z.string().min(1),
    sequence: z.string().regex(/^\d+$/),
    data: z.record(z.string(), z.unknown()),
    occurredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
  })
  .strict();

export type RealtimePublishEnvelope = z.infer<typeof realtimePublishEnvelopeSchema>;
