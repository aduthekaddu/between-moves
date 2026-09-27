import {
  accountDataRightsHandlerDependencies,
  createAccountExportHandler,
} from '../../../../modules/identity/dataRights';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** [BM-050] Self-scoped download of the signed-in person's own data. */
export function GET(request: Request): Promise<Response> {
  return createAccountExportHandler(accountDataRightsHandlerDependencies())(request);
}
