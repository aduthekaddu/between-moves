export type {
  AppliedMove,
  ChessMoveProposal,
  ChessSquare,
  IllegalMove,
  MoveTerminalReason,
  MoveTerminalState,
  RulesAdapter,
  RulesAdapterResult,
  SideToMove,
} from './rules-adapter';
export type { ClockPolicy, CorrespondenceClockPolicy, LiveClockPolicy } from './clock-policy';
export { nextMoveDueAt } from './deadlines';
export type {
  AcceptGameSeatRequest,
  GameSeatAcceptanceDependencies,
  GameSeatAcceptanceInput,
  GameSeatAcceptanceRepository,
  GameSeatAcceptanceResult,
} from './accept';
export { creatorColorForOffer, OPEN_SEAT_LIFETIME_MS } from './seats';
export type {
  CreateGameSeatRequest,
  GameColor,
  GameSeatColorChooser,
  GameSeatCreationDependencies,
  GameSeatCreationInput,
  GameSeatCreationRepository,
  GameSeatCreationResult,
  OfferedGameColor,
} from './seats';
export { MoveConflictError } from './submit-move';
export type {
  AcceptedMoveClock,
  MoveConflictSnapshot,
  SubmitMoveDependencies,
  SubmitMoveInput,
  SubmitMoveRepository,
  SubmitMoveRequest,
  SubmitMoveResult,
} from './submit-move';
export type {
  MoveShelf,
  MoveShelfActiveGame,
  MoveShelfCompletedGame,
  MoveShelfReadRepository,
  MoveShelfResult,
  MoveShelfYourMoveGame,
  ReadMoveShelfDependencies,
  ReadMoveShelfQuery,
} from './move-shelf';

/** [BM-005] Logical Game module boundary; concrete ports are wired at composition roots. */
export interface GamesPorts {
  readonly module: 'games';
}
