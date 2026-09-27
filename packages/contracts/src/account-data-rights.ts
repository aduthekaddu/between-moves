import { z } from 'zod';

/** [BM-050] The phrase a person types to confirm that deleting their account is irreversible. */
export const ACCOUNT_DELETION_CONFIRMATION = 'delete my account';

/** [BM-050] Wire contract for the self-service account deletion command. */
export const accountDeletionBodySchema = z
  .object({ confirmation: z.literal(ACCOUNT_DELETION_CONFIRMATION) })
  .strict();

export type AccountDeletionBody = z.infer<typeof accountDeletionBodySchema>;
