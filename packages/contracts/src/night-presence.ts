import { z } from 'zod';

export const signedNightPresenceSchema = z
  .object({
    clientId: z.string().uuid(),
    displayName: z.string().min(1).max(60),
    signature: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict();

/** [BM-039] One signed, short-lived presence enter or leave command. */
export const nightPresenceCommandSchema = z
  .object({
    kind: z.enum(['enter', 'leave']),
    token: z.string().min(32),
    presence: signedNightPresenceSchema,
  })
  .strict();

/** [BM-039] Public rail presence. Signatures prove display data came from the server. */
export const nightPresenceResponseSchema = z
  .object({
    presence: z.array(signedNightPresenceSchema),
    presenceCount: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.presenceCount !== value.presence.length) {
      context.addIssue({
        code: 'custom',
        message: 'Presence count must match the signed identity list',
        path: ['presenceCount'],
      });
    }
  });

export type NightPresenceCommandBody = z.infer<typeof nightPresenceCommandSchema>;
export type NightPresenceResponse = z.infer<typeof nightPresenceResponseSchema>;
