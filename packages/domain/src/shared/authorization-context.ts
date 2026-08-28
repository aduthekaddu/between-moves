declare const authorizationContextBrand: unique symbol;

/** [BM-005] DR-SEC-01: House repositories accept viewer + route-derived House scope. */
export interface AuthorizationContext {
  readonly viewerId: string;
  readonly houseId: string;
  readonly [authorizationContextBrand]: true;
}

export interface AuthorizationContextInput {
  readonly viewerId: string;
  readonly houseId: string;
}
