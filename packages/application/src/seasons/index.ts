import type { AuthorizedUseCase } from '../shared/use-case';

/** [BM-005] Shared authorized use-case shape for the Season module. */
export type SeasonsUseCase<Command, Result> = AuthorizedUseCase<Command, Result>;
export { closeSeason, draftSeason, draftSeasonCharter, publishSeason } from './season-lifecycle';
export { readHouseSeason, readLastClosedSeason } from './read-house-season';
export { createSeasonScoringConsumer, readSeasonStandings } from './scoring';
export type { SeasonScoringConsumerDependencies } from './scoring';
