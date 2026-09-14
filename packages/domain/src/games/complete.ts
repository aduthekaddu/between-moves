import type { AuthenticatedViewer } from '../identity';
import type { AuthorizeHouseAction, IdGenerator } from '../houses';
import type { AuthorizationContext } from '../shared/authorization-context';
import type { Clock } from '../shared/clock';

export type CompletedGameResult = 'white_win' | 'black_win' | 'draw';
export type GameCompletionReason =
  | 'checkmate'
  | 'stalemate'
  | 'insufficient_material'
  | 'repetition'
  | 'fifty_move'
  | 'flag'
  | 'resign'
  | 'agreement'
  | 'timeout';

export interface PendingDrawOffer {
  readonly offeringMembershipId: string;
  readonly ply: number;
}

export interface GameLifecycleResult {
  readonly gameId: string;
  readonly houseId: string;
  readonly state: 'active' | 'completed';
  readonly result: CompletedGameResult | null;
  readonly resultReason: GameCompletionReason | null;
  readonly completedAt: Date | null;
  readonly pendingDrawOffer: PendingDrawOffer | null;
  readonly completedNow: boolean;
  readonly replayed: boolean;
}

interface GameLifecycleRequest {
  readonly houseId: string;
  readonly gameId: string;
  readonly clientCommandId: string;
  readonly viewer: AuthenticatedViewer;
}

export type ResignGameRequest = GameLifecycleRequest;

export interface DrawGameRequest extends GameLifecycleRequest {
  readonly action: 'offer' | 'accept';
}

export interface GameCompletionInput {
  readonly gameId: string;
  readonly clientCommandId: string;
  readonly completedAt: Date;
  readonly completedEventId: string;
  readonly analysisEventId: string;
}

export interface DrawGameInput extends GameCompletionInput {
  readonly action: 'offer' | 'accept';
}

export interface GameCompletionRepository {
  resign(context: AuthorizationContext, input: GameCompletionInput): Promise<GameLifecycleResult>;
  draw(context: AuthorizationContext, input: DrawGameInput): Promise<GameLifecycleResult>;
}

export interface GameCompletionDependencies {
  readonly authorizeHouseAction: AuthorizeHouseAction;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly completions: GameCompletionRepository;
}
