import type { AuthorizedUseCase } from '../shared/use-case';

/** [BM-005] Between Moves Night contract; behavior arrives with its owning ticket. */
export type NightsUseCase<Command, Result> = AuthorizedUseCase<Command, Result>;
