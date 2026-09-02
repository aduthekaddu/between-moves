type ChessFile = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h';
type ChessRank = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8';

export type ChessSquare = `${ChessFile}${ChessRank}`;
export type SideToMove = 'white' | 'black';
export type MoveTerminalState = 'ongoing' | 'checkmate' | 'stalemate' | 'draw';
export type MoveTerminalReason =
  'checkmate' | 'stalemate' | 'insufficient_material' | 'repetition' | 'fifty_move';

/** The only chess truth accepted from an untrusted client. */
export interface ChessMoveProposal {
  readonly from: ChessSquare;
  readonly to: ChessSquare;
  readonly promotion?: 'q' | 'r' | 'b' | 'n';
}

export interface AppliedMove {
  readonly legal: true;
  readonly uci: string;
  readonly san: string;
  readonly fen: string;
  readonly sideToMove: SideToMove;
  readonly ply: number;
  readonly terminalState: MoveTerminalState;
  readonly terminalReason: MoveTerminalReason | null;
}

export interface IllegalMove {
  readonly legal: false;
  readonly reason: 'illegal_move' | 'invalid_fen';
}

export type RulesAdapterResult = AppliedMove | IllegalMove;

/** [BM-021] [DR-GAME-04] Server-side legality authority over canonical FEN. */
export interface RulesAdapter {
  applyMove(
    fen: string,
    move: ChessMoveProposal,
    /** Canonical initial/resulting FENs before this Move, used for repetition detection. */
    positionHistory: readonly string[],
  ): RulesAdapterResult;
}
