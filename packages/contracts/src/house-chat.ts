import { z } from 'zod';

const isoInstant = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
const sequence = z.string().regex(/^\d+$/);

/** [BM-040] [DR-CHAT-02] Bounded plain-text House chat wire input. */
export const houseChatBodySchema = z
  .object({
    body: z
      .string()
      .min(1)
      .refine((value) => [...value].length <= 2_000),
  })
  .strict();

export type HouseChatBody = z.infer<typeof houseChatBodySchema>;

export const houseChatMessageSchema = z
  .object({
    id: z.string().uuid(),
    membershipId: z.string().uuid(),
    authorDisplayName: z.string().min(1).max(60),
    body: z.string().min(1),
    sequence,
    createdAt: isoInstant,
  })
  .strict();

/** [BM-040] Recent durable House chat snapshot used before realtime attach. */
export const houseChatSnapshotSchema = z
  .object({
    houseId: z.string().uuid(),
    nightId: z.string().uuid(),
    chatSequence: sequence,
    currentMembershipId: z.string().uuid(),
    canModerate: z.boolean(),
    messages: z.array(houseChatMessageSchema),
  })
  .strict();

export type HouseChatSnapshotResponse = z.infer<typeof houseChatSnapshotSchema>;
