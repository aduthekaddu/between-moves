import type {
  ChessMoveProposal,
  MoveTerminalReason,
  MoveTerminalState,
  RulesAdapter,
  RulesAdapterResult,
  SideToMove,
} from '@between-moves/domain';
import { Chess, type Move } from 'chess.js';

/** [BM-021] [DR-GAME-04] Pinned chess.js implementation of the trusted rules port. */
export class ChessJsRulesAdapter implements RulesAdapter {
  applyMove(
    fen: string,
    proposal: ChessMoveProposal,
    positionHistory: readonly string[],
  ): RulesAdapterResult {
    let chess: Chess;
    try {
      chess = new Chess(fen);
    } catch {
      return { legal: false, reason: 'invalid_fen' };
    }

    let move: Move;
    try {
      move = chess.move(toChessJsMove(proposal));
    } catch {
      return { legal: false, reason: 'illegal_move' };
    }

    const resultingFen = chess.fen();
    const terminalReason = terminalReasonFor(chess, resultingFen, positionHistory);
    return {
      legal: true,
      uci: `${move.from}${move.to}${move.promotion ?? ''}`,
      san: move.san,
      fen: resultingFen,
      sideToMove: sideToMove(chess),
      ply: plyFromFen(resultingFen),
      terminalState: terminalState(terminalReason),
      terminalReason,
    };
  }
}

function toChessJsMove(proposal: ChessMoveProposal) {
  return proposal.promotion === undefined
    ? { from: proposal.from, to: proposal.to }
    : { from: proposal.from, to: proposal.to, promotion: proposal.promotion };
}

function sideToMove(chess: Chess): SideToMove {
  return chess.turn() === 'w' ? 'white' : 'black';
}

function terminalReasonFor(
  chess: Chess,
  resultingFen: string,
  positionHistory: readonly string[],
): MoveTerminalReason | null {
  if (chess.isCheckmate()) return 'checkmate';
  if (chess.isStalemate()) return 'stalemate';
  if (occurrenceCount(resultingFen, positionHistory) >= 3 || chess.isThreefoldRepetition()) {
    return 'repetition';
  }
  if (chess.isInsufficientMaterial()) return 'insufficient_material';
  if (chess.isDrawByFiftyMoves()) return 'fifty_move';
  return null;
}

function terminalState(reason: MoveTerminalReason | null): MoveTerminalState {
  if (reason === 'checkmate' || reason === 'stalemate') return reason;
  if (reason !== null) return 'draw';
  return 'ongoing';
}

function occurrenceCount(resultingFen: string, positionHistory: readonly string[]): number {
  const resultingPosition = positionKey(resultingFen);
  return (
    1 +
    positionHistory.filter((historicalFen) => positionKey(historicalFen) === resultingPosition)
      .length
  );
}

/** FIDE repetition identity: placement, turn, castling rights, and legal en-passant square. */
function positionKey(fen: string): string {
  return fen.split(' ', 4).join(' ');
}

function plyFromFen(fen: string): number {
  const [, turn, , , , fullmove] = fen.split(' ');
  const completedMoves = Number(fullmove) - 1;
  return completedMoves * 2 + (turn === 'b' ? 1 : 0);
}
