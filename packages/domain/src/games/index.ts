export type {
  AppliedMove,
  ChessMoveProposal,
  ChessSquare,
  IllegalMove,
  MoveTerminalState,
  RulesAdapter,
  RulesAdapterResult,
  SideToMove,
} from './rules-adapter';
export type { ClockPolicy, CorrespondenceClockPolicy, LiveClockPolicy } from './clock-policy';
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

/** [BM-005] Logical Game module boundary; concrete ports are wired at composition roots. */
export interface GamesPorts {
  readonly module: 'games';
}
