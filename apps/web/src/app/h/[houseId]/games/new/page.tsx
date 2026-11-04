import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { getConfig } from '../../../../../config';
import { getHouseRoster } from '../../../../../modules/houses/roster';
import { getHouseHome } from '../../../../../server/house-home';
import { getScheduledNights } from '../../../../../server/nights';
import { getHouseSeason } from '../../../../../server/seasons';
import { NewGameView } from './new-game-view';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Start a game | Between Moves',
  robots: { index: false, follow: false },
};

interface NewGamePageProps {
  readonly params: Promise<{ readonly houseId: string }>;
  readonly searchParams: Promise<{
    readonly opponent?: string | string[] | undefined;
    readonly mode?: string | string[] | undefined;
  }>;
}

const houseIdSchema = z.string().uuid();

/**
 * [BM-022] Open a seat or challenge one Member. Correspondence takes the active Charter's pace;
 * a live Game needs tonight's Night to be live.
 */
export default async function NewGamePage({ params, searchParams }: NewGamePageProps) {
  const { houseId } = await params;
  const { opponent, mode } = await searchParams;
  if (!houseIdSchema.safeParse(houseId).success) notFound();

  const url = new URL(`/h/${encodeURIComponent(houseId)}/games/new`, getConfig().appOrigin);
  const request = new Request(url, { headers: await headers() });
  const [houseHome, houseRoster] = await Promise.all([
    getHouseHome(request, houseId),
    getHouseRoster(request, houseId),
  ]);
  const home = houseHome ?? notFound();
  const roster = houseRoster ?? notFound();
  const [season, nights] = await Promise.all([
    getHouseSeason(request, houseId),
    getScheduledNights(request, houseId),
  ]);

  const activeSeason = season?.state === 'active' && season.charter !== null ? season : null;
  const liveNight =
    activeSeason === null ? undefined : nights.find((night) => night.state === 'live');
  return (
    <NewGameView
      home={home}
      season={
        activeSeason === null || activeSeason.charter === null
          ? null
          : {
              title: activeSeason.title,
              perMoveHours: activeSeason.charter.correspondencePaceHours,
            }
      }
      liveNightId={liveNight?.nightId ?? null}
      opponents={roster.members
        .filter((member) => member.membershipId !== roster.viewerMembershipId)
        .map((member) => ({ membershipId: member.membershipId, displayName: member.displayName }))}
      canPublishCharter={roster.viewerRole !== 'member'}
      requestedOpponentId={typeof opponent === 'string' ? opponent : undefined}
      requestedLive={mode === 'live'}
    />
  );
}
