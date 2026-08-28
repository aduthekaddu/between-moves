import type { UseCase } from '../shared/use-case';

/** [BM-005] Identity application contract; behavior arrives with its owning ticket. */
export type IdentityUseCase<Command, Result> = UseCase<Command, Result>;
