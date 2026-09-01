import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getConfig } from '../../../../config';
import { getHouseHome } from '../../../../server/house-home';
import { getHouseSeason } from '../../../../server/seasons';
import { SeasonView } from './season-view';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Season | Between Moves',
  robots: { index: false, follow: false },
};

interface SeasonPageProps {
  readonly params: Promise<{ readonly houseId: string }>;
}

export default async function SeasonPage({ params }: SeasonPageProps) {
  const { houseId } = await params;
  const requestHeaders = await headers();
  const url = new URL(`/h/${encodeURIComponent(houseId)}/season`, getConfig().appOrigin);
  const request = new Request(url, { headers: requestHeaders });
  const home = await getHouseHome(request, houseId);
  if (home === null) notFound();
  const season = await getHouseSeason(request, houseId);
  return (
    <main className="season-shell">
      <nav className="season-nav" aria-label="House navigation">
        <a href={`/h/${encodeURIComponent(houseId)}`}>← {home.name}</a>
        <span>Season</span>
      </nav>
      <SeasonView houseId={houseId} membershipRole={home.membershipRole} season={season} />
    </main>
  );
}
