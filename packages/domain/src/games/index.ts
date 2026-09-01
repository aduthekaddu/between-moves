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

/** [BM-005] Logical Game module boundary; concrete ports are wired at composition roots. */
export interface GamesPorts {
  readonly module: 'games';
}
