import type { AuthorizedUseCase } from '../shared/use-case';

/** [BM-020] Between Moves Night application contract. */
export type NightsUseCase<Command, Result> = AuthorizedUseCase<Command, Result>;

export { changeNightSchedule, readScheduledNights } from './schedule';
