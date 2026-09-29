import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getConfig } from '../../config';
import { readAccountSummary } from '../../modules/identity/dataRights';
import { AccountView } from './account-view';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Your account | Between Moves',
  robots: { index: false, follow: false },
};

/** [BM-050] The signed-in person's data rights: download everything, or delete the account. */
export default async function AccountPage() {
  const request = new Request(new URL('/account', getConfig().appOrigin), {
    headers: await headers(),
  });
  const summary = await readAccountSummary(request);
  if (summary === null) redirect('/sign-in');
  return <AccountView summary={summary} />;
}
