import type { AuthorizationContext } from '@between-moves/domain';

export interface UseCase<Command, Result> {
  (command: Command): Promise<Result>;
}

/** [BM-005] DR-SEC-01 contract for every future House-scoped application use case. */
export interface AuthorizedUseCase<Command, Result> {
  (command: Command, context: AuthorizationContext): Promise<Result>;
}
