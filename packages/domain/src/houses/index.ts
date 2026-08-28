export type { HouseReference, HouseReferenceRepository } from './reference-repository';

/** [BM-005] Logical House module boundary and future authorization authority. */
export interface HousesPorts {
  readonly module: 'houses';
}
