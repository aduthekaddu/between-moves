import type { GameNotesView, GamePosition, GameReactionValue } from '@between-moves/domain';
import { GameNotes } from './game-notes';
import { MoveEntry } from './move-entry';
import { ReactionControl } from './reaction-control';

/** House-scoped Game page for both modes; live countdown display follows in BM-042. */
export function GameView({
  houseId,
  position,
  currentReaction = null,
  gameNotes = null,
}: {
  readonly houseId: string;
  readonly position: GamePosition;
  readonly currentReaction?: GameReactionValue | null;
  readonly gameNotes?: GameNotesView | null;
}) {
  return (
    <div className="game-shell">
      <header className="game-masthead">
        <a href={`/h/${encodeURIComponent(houseId)}`}>← Move shelf</a>
        <span>{position.mode === 'live' ? 'Live Game' : 'Correspondence Game'}</span>
      </header>
      <main className="game-main">
        <header className="game-title">
          <p className="house-home__eyebrow">
            {position.mode === 'live' ? 'Live board' : 'Correspondence board'}
          </p>
          <h1>
            {position.white.name} <span aria-hidden="true">—</span>{' '}
            <span className="visually-hidden">versus </span>
            {position.black.name}
          </h1>
          <p>
            {position.white.name} plays White. {position.black.name} plays Black.
          </p>
        </header>
        <MoveEntry houseId={houseId} gameId={position.gameId} initial={position} />
        {position.state === 'completed' ? (
          <>
            <ReactionControl
              houseId={houseId}
              gameId={position.gameId}
              initialReaction={currentReaction}
            />
            {gameNotes === null ? null : (
              <GameNotes
                houseId={houseId}
                gameId={position.gameId}
                initial={{
                  currentMembershipId: gameNotes.currentMembershipId,
                  notes: gameNotes.notes.map((note) => ({
                    ...note,
                    createdAt: note.createdAt.toISOString(),
                    editedAt: note.editedAt?.toISOString() ?? null,
                  })),
                }}
              />
            )}
          </>
        ) : null}
      </main>
    </div>
  );
}
