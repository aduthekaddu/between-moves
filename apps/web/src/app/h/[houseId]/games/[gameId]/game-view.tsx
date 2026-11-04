import type { GameNotesView, GamePosition, GameReactionValue } from '@between-moves/domain';
import { AppMasthead } from '../../../../_components/app-masthead';
import type { RematchOffer } from './game-end';
import { GameNotes } from './game-notes';
import { MoveEntry } from './move-entry';
import { ReactionControl } from './reaction-control';

/** House-scoped Game page for both modes with server-anchored live clocks. */
export function GameView({
  houseId,
  position,
  currentReaction = null,
  gameNotes = null,
  afterGame,
}: {
  readonly houseId: string;
  readonly position: GamePosition;
  readonly currentReaction?: GameReactionValue | null;
  readonly gameNotes?: GameNotesView | null;
  readonly afterGame?: {
    readonly perMoveHours: number | null;
    readonly incomingRematch: RematchOffer | null;
  };
}) {
  return (
    <div className={position.mode === 'live' ? 'game-shell game-shell--live' : 'game-shell'}>
      <AppMasthead
        houseId={houseId}
        current="game"
        tone={position.mode === 'live' ? 'night' : 'day'}
      />
      <main className="game-main">
        <header className="game-title">
          <p className="house-home__eyebrow">
            {position.mode === 'live' ? 'Live board' : 'Correspondence board'}
          </p>
          <h1>
            <span className="game-title__player" data-side="white">
              {position.white.name}
            </span>{' '}
            <span className="game-title__versus" aria-hidden="true">
              v
            </span>
            <span className="visually-hidden">versus </span>
            <span className="game-title__player" data-side="black">
              {position.black.name}
            </span>
          </h1>
          <p className="game-title__seats visually-hidden">
            {position.white.name} plays White. {position.black.name} plays Black.
          </p>
          <p className="game-title__mode" data-mode={position.mode}>
            {position.mode === 'live' ? 'Live Game' : 'Correspondence Game'}
          </p>
        </header>
        <MoveEntry
          houseId={houseId}
          gameId={position.gameId}
          {...(afterGame === undefined ? {} : { afterGame })}
          initial={{
            ...position,
            ...(position.mode === 'live' ? { serverNow: new Date().toISOString() } : {}),
          }}
        />
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
