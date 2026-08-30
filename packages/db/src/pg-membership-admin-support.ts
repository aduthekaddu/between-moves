import {
  RetryableTransactionError,
  type MembershipRole,
  type PermanentMembershipRole,
} from '@between-moves/domain';
import type { PoolClient } from 'pg';

export function parseMembershipString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid membership ${field}`);
  return value;
}

export function parsePermanentMembershipRole(value: unknown): PermanentMembershipRole {
  if (value === 'member' || value === 'steward') return value;
  throw new Error('Invalid permanent membership role');
}

export function parseMembershipRole(value: unknown): MembershipRole {
  if (value === 'owner' || value === 'steward' || value === 'member') return value;
  throw new Error('Invalid membership role');
}

export async function rollbackMembershipAdminTransaction(client: PoolClient): Promise<void> {
  await client.query('rollback').catch(() => undefined);
}

export function asMembershipAdminTransactionError(error: unknown): unknown {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === '40001' || error.code === '40P01')
  ) {
    return new RetryableTransactionError('Membership administration transaction must be retried', {
      cause: error,
    });
  }
  return error;
}
