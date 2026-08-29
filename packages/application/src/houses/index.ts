import type { AuthorizedUseCase } from '../shared/use-case';

/** [BM-005] House-scoped application contract; behavior arrives with its owning ticket. */
export type HousesUseCase<Command, Result> = AuthorizedUseCase<Command, Result>;

export { createHouse } from './create-house';
export { createAuthorizeHouseAction } from './authorize-house-action';
