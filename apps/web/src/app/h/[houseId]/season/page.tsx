import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
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
 * closed Season when none is underway.
 * Show the not-found page when the House is unavailable; other read failures propagate.
 */
export default async function SeasonPage({ params }: SeasonPageProps) {
  const { houseId } = await params;
  const requestHeaders = await headers();
  const url = new URL(`/h/${encodeURIComponent(houseId)}/season`, getConfig().appOrigin);
  const request = new Request(url, { headers: requestHeaders });
  const home = await getHouseHome(request, houseId);
  if (home === null) notFound();
  const season = await getHouseSeason(request, houseId);
  const lastClosed =
    season === null || season.state === 'draft' || season.state === 'closing'
      ? await getLastClosedSeason(request, houseId)
      : null;
  const nights = await getScheduledNights(request, houseId);
  const hostCandidates =
    home.membershipRole === 'member' ? [] : await getNightHostCandidates(request, houseId);
  return (
    <main className="season-shell">
      <nav className="season-nav" aria-label="House navigation">
        <a href={`/h/${encodeURIComponent(houseId)}`}>← {home.name}</a>
        <span>Season</span>
      </nav>
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
  );
}
