import {
  DomainError,
  type AccountDataRightsDependencies,
  type AccountDataRightsRequest,
  type AccountDeletionResult,
  type AccountExport,
  type AccountSummary,
} from '@between-moves/domain';
import { retryTransaction } from '../shared/retry-transaction';

/** [BM-050] The signed-in person's name and active Houses, for the account page. */
export function createReadAccountSummary(
  dependencies: Pick<AccountDataRightsDependencies, 'accounts'>,
): (request: AccountDataRightsRequest) => Promise<AccountSummary | null> {
  return ({ viewer }) => dependencies.accounts.readSummary(viewer.userId);
}

/**
 * [BM-050] Export the signed-in person's own data. The export is keyed only by the viewer's
 * identity, so no request can name another person's account.
 */
export function createExportAccountData(
  dependencies: Pick<AccountDataRightsDependencies, 'clock' | 'accounts'>,
): (request: AccountDataRightsRequest) => Promise<AccountExport> {
  return async ({ viewer }) => {
    const exported = await dependencies.accounts.exportAccount(
      viewer.userId,
      dependencies.clock.now(),
    );
    if (exported === null) throw new DomainError('not_found', 'Account is unavailable');
    return exported;
  };
}

/**
 * [BM-050] Irreversibly delete the signed-in person's account while keeping the House's shared
 * history. The whole deletion commits or none of it does.
 */
export function createDeleteAccount(
  dependencies: AccountDataRightsDependencies,
): (request: AccountDataRightsRequest) => Promise<AccountDeletionResult> {
  return ({ viewer }) => {
    const deletedAt = dependencies.clock.now();
    return retryTransaction(() =>
      dependencies.accounts.deleteAccount({
        userId: viewer.userId,
        deletedAt,
        auditIds: dependencies.ids,
      }),
    );
  };
}
