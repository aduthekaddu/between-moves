import {
  validateGameNoteBody,
  type GameNote,
  type GameNotesView,
  type ReadGameNotesDependencies,
  type ReadGameNotesRequest,
  type SaveGameNoteDependencies,
  type SaveGameNoteRequest,
} from '@between-moves/domain';

/** [BM-032] [DR-NOTE-01] Create or edit one Member's post-Game note. */
export async function saveGameNote(
  request: SaveGameNoteRequest,
  dependencies: SaveGameNoteDependencies,
): Promise<GameNote> {
  const context = await dependencies.authorizeHouseAction(
    { kind: 'write_house_chat_or_game_note' },
    request.houseId,
    request.viewer,
  );
  const body = validateGameNoteBody(request.body);
  return dependencies.notes.save(context, {
    id: dependencies.ids.generate(),
    gameId: request.gameId,
    body,
    savedAt: dependencies.clock.now(),
  });
}

/** [BM-032] Read the House-visible notes attached to a completed Game. */
export async function readGameNotes(
  request: ReadGameNotesRequest,
  dependencies: ReadGameNotesDependencies,
): Promise<GameNotesView | null> {
  const context = await dependencies.authorizeHouseAction(
    { kind: 'view_house_content' },
    request.houseId,
    request.viewer,
  );
  return dependencies.notes.readForGame(context, request.gameId);
}
