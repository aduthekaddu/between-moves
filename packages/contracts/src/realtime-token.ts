import { z } from 'zod';

const opaqueChannel = z
  .string()
  .min(16)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/)
  .refine(
    (value) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
  );

/** [BM-037] Client payload: publicKey, opaque channels, and server-signed presence. */
export const realtimeTokenResponseSchema = z
  .object({
    token: z.string().min(32),
    expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    clientId: z.string().uuid(),
    publicKey: z.string().min(1),
    channels: z
      .object({
        night: opaqueChannel,
        games: z.array(
          z
            .object({
              gameId: z.string().uuid(),
              channel: opaqueChannel,
            })
            .strict(),
        ),
      })
      .strict(),
    presence: z
      .object({
        clientId: z.string().uuid(),
        displayName: z.string().min(1),
        signature: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export type RealtimeTokenResponse = z.infer<typeof realtimeTokenResponseSchema>;

const ROOT_KEY_FIELDS = /serverKey|rootKey|REALTIME_SERVER_KEY/i;

/** [BM-037] Client payloads must never mention or embed the provider root key. */
export function realtimeTokenHidesRootKey(payload: unknown, rootKey: string): boolean {
  const serialized = JSON.stringify(payload);
  return !serialized.includes(rootKey) && !ROOT_KEY_FIELDS.test(serialized);
}
