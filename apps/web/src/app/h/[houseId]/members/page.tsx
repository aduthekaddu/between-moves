import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { getConfig } from '../../../../config';
import { getHouseRoster, getPendingInvitations } from '../../../../modules/houses/roster';
import { getHouseHome } from '../../../../server/house-home';
import { MembersView } from './members-view';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Members | Between Moves',
  robots: { index: false, follow: false },
};

interface MembersPageProps {
  readonly params: Promise<{ readonly houseId: string }>;
}

const houseIdSchema = z.string().uuid();

/** [BM-014] [BM-015] Who is in the House, and for its Owner and Stewards, who can join next. */
export default async function MembersPage({ params }: MembersPageProps) {
  const { houseId } = await params;
  if (!houseIdSchema.safeParse(houseId).success) notFound();

  const url = new URL(`/h/${encodeURIComponent(houseId)}/members`, getConfig().appOrigin);
  const request = new Request(url, { headers: await headers() });
  const [home, roster] = await Promise.all([
    getHouseHome(request, houseId),
    getHouseRoster(request, houseId),
  ]);
  if (home === null || roster === null) notFound();
  const invitations =
    roster.viewerRole === 'member' ? [] : await getPendingInvitations(request, houseId);

  return (
    <MembersView home={home} roster={roster} invitations={invitations} viewedAt={new Date()} />
  );
}
