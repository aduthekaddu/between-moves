import {
  accountDataRightsHandlerDependencies,
  createAccountDeletionHandler,
} from '../../../../modules/identity/dataRights';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** [BM-050] Irreversible self-service account deletion. */
export function POST(request: Request): Promise<Response> {
  return createAccountDeletionHandler(accountDataRightsHandlerDependencies())(request);
}
