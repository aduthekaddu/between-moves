import { SystemClock } from '@between-moves/adapters';
import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { getConfig } from '../../../config';
import { getHouseHome } from '../../../server/house-home';
import { getScheduledNights } from '../../../server/nights';
import { getHouseSeason } from '../../../server/seasons';
import { getMoveShelf } from '../../../modules/games/move-shelf';
import { getOpenSeats } from '../../../modules/games/open-seats';
import { getHouseRoster } from '../../../modules/houses/roster';
import { standingRows } from '../../../modules/seasons/standing-rows';
import { getSeasonStandings } from '../../../modules/seasons/standings';
import { welcomeCookieName } from './house-guide';
import { HouseHomeView } from './house-home-view';
import { houseLocalDate } from './season/season-opening';

export const dynamic = 'force-dynamic';

/** [BM-013] [DR-HOUSE-05] Private House pages stay out of search indexes. */
export const metadata: Metadata = {
  title: 'House | Between Moves',
  robots: { index: false, follow: false },
};

interface HousePageProps {
  readonly params: Promise<{ readonly houseId: string }>;
}

const clock = new SystemClock();
const houseIdSchema = z.string().uuid();

/** [BM-013] [UX-IA-01] Server-render one route-scoped House home. */
export default async function HousePage({ params }: HousePageProps) {
  const { houseId } = await params;
  if (!houseIdSchema.safeParse(houseId).success) notFound();

  const requestHeaders = await headers();
  const url = new URL(`/h/${encodeURIComponent(houseId)}`, getConfig().appOrigin);
  const request = new Request(url, { headers: requestHeaders });
  const [home, shelf] = await Promise.all([
    getHouseHome(request, houseId),
    getMoveShelf(request, houseId),
  ]);

  if (home === null || shelf === null) notFound();
  const [openSeats, nights, season, roster, cookieStore] = await Promise.all([
    getOpenSeats(request, houseId),
    getScheduledNights(request, houseId),
    getHouseSeason(request, houseId),
    getHouseRoster(request, houseId),
    cookies(),
  ]);
  if (roster === null) notFound();
  const standings =
    season?.state === 'active' ? await getSeasonStandings(request, houseId, season.seasonId) : null;
  const liveNight = nights.find((night) => night.state === 'live');
  const viewedAt = clock.now();
  return (
    <HouseHomeView
      home={home}
      shelf={shelf}
      viewedAt={viewedAt}
      openSeats={openSeats}
      liveNightId={liveNight?.nightId ?? null}
      roster={roster}
      season={season}
      standings={standings === null ? [] : standingRows(standings.standings, roster)}
      welcomeDismissed={cookieStore.has(welcomeCookieName(houseId))}
      today={houseLocalDate(viewedAt, home.timeZone)}
    />
  );
}
