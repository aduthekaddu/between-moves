import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { getConfig } from '../../../../../config';
import { getNightRail, serializeNightRailSnapshot } from '../../../../../modules/nights/rail';
import { NightRailView } from './night-rail-view';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Night rail | Between Moves',
  robots: { index: false, follow: false },
};

interface NightRailPageProps {
  readonly params: Promise<{ readonly houseId: string; readonly nightId: string }>;
}

const identifierSchema = z.string().uuid();

/** [BM-038] [UX-IA-01] Server-render the durable Night rail before realtime attaches. */
export default async function NightRailPage({ params }: NightRailPageProps) {
  const { houseId, nightId } = await params;
  if (
    !identifierSchema.safeParse(houseId).success ||
    !identifierSchema.safeParse(nightId).success
  ) {
    notFound();
  }

  const requestHeaders = await headers();
  const url = new URL(
    `/h/${encodeURIComponent(houseId)}/nights/${encodeURIComponent(nightId)}`,
    getConfig().appOrigin,
  );
  const request = new Request(url, { headers: requestHeaders });
  const snapshot = await getNightRail(request, houseId, nightId);
  if (snapshot === null) return notFound();
  return <NightRailView houseId={houseId} initial={serializeNightRailSnapshot(snapshot)} />;
}
