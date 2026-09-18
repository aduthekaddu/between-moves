import { z } from 'zod';
import { signedNightPresenceSchema } from './night-presence';

const isoInstant = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
const sequence = z.string().regex(/^\d+$/);
const player = z
  .object({
    membershipId: z.string().uuid(),
    name: z.string().min(1).max(60),
  })
  .strict();

const board = z
  .object({
    gameId: z.string().uuid(),
    sequence,
    currentFen: z.string().min(1),
    currentPly: z.number().int().nonnegative(),
    sideToMove: z.enum(['white', 'black']),
    lastSan: z.string().min(1).max(32).nullable(),
    white: player,
    black: player,
  })
  .strict();

const result = z
  .object({
    gameId: z.string().uuid(),
    sequence,
    result: z.enum(['white_win', 'black_win', 'draw', 'aborted']),
    resultReason: z.string().min(1).nullable(),
    completedAt: isoInstant,
    white: player,
    black: player,
  })
  .strict();

/** [BM-038] [BM-039] Night rail snapshot with ephemeral signed presence. */
export const nightRailSnapshotSchema = z
  .object({
    houseId: z.string().uuid(),
    nightId: z.string().uuid(),
    seasonId: z.string().uuid(),
    state: z.enum(['scheduled', 'live', 'ended']),
    scheduledStart: isoInstant,
    scheduledEnd: isoInstant,
    startedAt: isoInstant.nullable(),
    endedAt: isoInstant.nullable(),
    nightSequence: sequence,
    presence: z.array(signedNightPresenceSchema),
    presenceCount: z.number().int().nonnegative(),
    activeBoards: z.array(board),
    recentResults: z.array(result),
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

export type NightRailSnapshotResponse = z.infer<typeof nightRailSnapshotSchema>;
