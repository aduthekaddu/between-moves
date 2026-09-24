import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { getConfig } from '../../../../../config';
import { getGamePosition } from '../../../../../modules/games/game-position';
import { getCurrentGameReaction } from '../../../../../modules/stories/reactions';
import { getGameNotes } from '../../../../../modules/stories/notes';
import { GameView } from './game-view';

interface GamePageProps {
  readonly params: Promise<{ readonly houseId: string; readonly gameId: string }>;
}

const identifierSchema = z.string().uuid();

/** [BM-027] [UX-IA-01/04] Render a route- and Member-scoped canonical Game board. */
export async function renderGamePage({ params }: GamePageProps, liveOnly = false) {
  const { houseId, gameId } = await params;
  if (!identifierSchema.safeParse(houseId).success || !identifierSchema.safeParse(gameId).success) {
    notFound();
  }

  const requestHeaders = await headers();
  const url = new URL(
    `/h/${encodeURIComponent(houseId)}/games/${encodeURIComponent(gameId)}`,
    getConfig().appOrigin,
  );
  const request = new Request(url, { headers: requestHeaders });
  const position = await getGamePosition(request, houseId, gameId);
  if (position === null || (liveOnly && position.mode !== 'live')) return notFound();
  const currentReaction =
    position.state === 'completed' ? await getCurrentGameReaction(request, houseId, gameId) : null;
  const gameNotes =
    position.state === 'completed' ? await getGameNotes(request, houseId, gameId) : null;
  return (
    <GameView
      houseId={houseId}
      position={position}
      currentReaction={currentReaction}
      gameNotes={gameNotes}
    />
  );
}
