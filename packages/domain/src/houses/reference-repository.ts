import type { AuthorizationContext } from '../shared/authorization-context';

export interface HouseReference {
  readonly id: string;
  readonly houseId: string;
  readonly label: string;
}

/** [BM-005] DR-SEC-01: no bare-ID read exists on this repository contract. */
export interface HouseReferenceRepository {
  list(context: AuthorizationContext): Promise<readonly HouseReference[]>;
}
