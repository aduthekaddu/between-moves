import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { AppMasthead } from '../../../_components/app-masthead';
import { getConfig } from '../../../../config';
import { getNightHostCandidates } from '../../../../modules/nights/lifecycle';
import { getHouseHome } from '../../../../server/house-home';
import { getHouseSeason, getLastClosedSeason } from '../../../../server/seasons';
import { getScheduledNights } from '../../../../server/nights';
import { SeasonView } from './season-view';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Season | Between Moves',
  robots: { index: false, follow: false },
};

interface SeasonPageProps {
  readonly params: Promise<{ readonly houseId: string }>;
}

/**
 * Render the House Season page, including frozen standings for a closing Season or the last
 * closed Season when none is underway, and [BM-049] a link to that Season's Closing Book once
 * the next Season is active.
 * Show the not-found page when the House is unavailable; other read failures propagate.
 */
export default async function SeasonPage({ params }: SeasonPageProps) {
  const { houseId } = await params;
  const requestHeaders = await headers();
  const url = new URL(`/h/${encodeURIComponent(houseId)}/season`, getConfig().appOrigin);
  const request = new Request(url, { headers: requestHeaders });
  const home = await getHouseHome(request, houseId);
  if (home === null) return notFound();
  const season = await getHouseSeason(request, houseId);
  const lastClosed = await getLastClosedSeason(request, houseId);
  const nights = await getScheduledNights(request, houseId);
  const hostCandidates =
    home.membershipRole === 'member' ? [] : await getNightHostCandidates(request, houseId);
  return (
    <div className="season-shell">
      <AppMasthead houseId={houseId} houseName={home.name} current="season" />
      <main className="season-main">
        <SeasonView
          houseId={houseId}
          membershipRole={home.membershipRole}
          nights={nights}
          hostCandidates={hostCandidates}
          season={season}
          lastClosed={lastClosed}
          timeZone={home.timeZone}
        />
      </main>
    </div>
  );
}
