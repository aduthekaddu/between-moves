import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { getConfig } from '../../../config';
import { invitationReturnPath } from '../../../kernel/invitation-return-path';
import { getViewer } from '../../../server/viewer';
import { InvitationRedemptionClient } from './invitation-redemption-client';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'House Invitation | Between Moves',
  robots: { index: false, follow: false },
};

interface InvitationPageProps {
  readonly params: Promise<{ readonly token: string }>;
}

/** [BM-016] Anonymous and signed-in entry point for one private House Invitation. */
export default async function InvitationPage({ params }: InvitationPageProps) {
  const { token } = await params;
  const path = `/invitations/${token}`;
  const validToken = invitationReturnPath(path) !== null;
  const requestHeaders = await headers();
  const hasCookies = requestHeaders.has('cookie');
  const authenticated = hasCookies
    ? (
        await getViewer(
          new Request(new URL(path, getConfig().appOrigin), { headers: requestHeaders }),
        )
      ).kind === 'authenticated'
    : false;

  return (
    <InvitationRedemptionClient
      token={token}
      authenticated={authenticated}
      validToken={validToken}
    />
  );
}
