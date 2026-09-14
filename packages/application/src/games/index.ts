import type { AuthorizedUseCase } from '../shared/use-case';

/** [BM-005] Game application contract; behavior arrives with its owning ticket. */
export type GamesUseCase<Command, Result> = AuthorizedUseCase<Command, Result>;
export { acceptGameSeat } from './accept';
export { handleDraw, resignGame } from './complete';
export { createGameSeat } from './seats';
export { submitMove } from './submit-move';
export { readMoveShelf } from './read-move-shelf';
export { readGamePosition } from './read-game-position';
