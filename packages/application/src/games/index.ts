import type { AuthorizedUseCase } from '../shared/use-case';

/** [BM-005] Game application contract; behavior arrives with its owning ticket. */
export type GamesUseCase<Command, Result> = AuthorizedUseCase<Command, Result>;
