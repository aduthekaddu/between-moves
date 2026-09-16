import type { AuthorizedUseCase } from '../shared/use-case';

/** [BM-005] House Story contract; behavior arrives with its owning ticket. */
export type StoriesUseCase<Command, Result> = AuthorizedUseCase<Command, Result>;
export { readCurrentGameReaction, setGameReaction } from './reactions';
export { readGameNotes, saveGameNote } from './notes';
