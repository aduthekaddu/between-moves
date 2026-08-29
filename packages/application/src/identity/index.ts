import type { UseCase } from '../shared/use-case';

/** [BM-005] Generic Identity application contract. */
export type IdentityUseCase<Command, Result> = UseCase<Command, Result>;

export { createViewerResolver, type ViewerResolver } from './viewer';
