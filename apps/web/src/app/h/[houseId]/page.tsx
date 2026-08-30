import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getConfig } from '../../../config';
import { getHouseHome } from '../../../server/house-home';
import { HouseHomeView } from './house-home-view';

export const dynamic = 'force-dynamic';

/** [BM-013] [DR-HOUSE-05] Private House pages stay out of search indexes. */
export const metadata: Metadata = {
  title: 'House | Between Moves',
  robots: { index: false, follow: false },
};

interface HousePageProps {
  readonly params: Promise<{ readonly houseId: string }>;
}

/** [BM-013] [UX-IA-01] Server-render one route-scoped House home. */
export default async function HousePage({ params }: HousePageProps) {
  const { houseId } = await params;
  const requestHeaders = await headers();
  const url = new URL(`/h/${encodeURIComponent(houseId)}`, getConfig().appOrigin);
  const home = await getHouseHome(new Request(url, { headers: requestHeaders }), houseId);

  if (home === null) notFound();
  return <HouseHomeView home={home} />;
}
