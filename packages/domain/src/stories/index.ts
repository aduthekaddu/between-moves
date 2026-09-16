/** [BM-005] Logical House Story boundary; concrete ports arrive with owning tickets. */
export interface StoriesPorts {
  readonly module: 'stories';
}

export { GAME_REACTIONS } from './reactions';
export type {
  GameReaction,
  GameReactionRepository,
  GameReactionValue,
  ReadCurrentGameReactionRequest,
  ReadGameReactionDependencies,
  SetGameReactionDependencies,
  SetGameReactionInput,
  SetGameReactionRequest,
} from './reactions';
