import type { UseCase } from '../shared/use-case';

/** [BM-005] Delivery application contract; behavior arrives with its owning ticket. */
export type DeliveryUseCase<Command, Result> = UseCase<Command, Result>;
