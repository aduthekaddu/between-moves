import type { AuthorizedUseCase } from '../shared/use-case';

/** [BM-005] Season application contract; behavior arrives with its owning ticket. */
export type SeasonsUseCase<Command, Result> = AuthorizedUseCase<Command, Result>;
