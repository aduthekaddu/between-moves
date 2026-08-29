export interface HouseAuthorizationMetricSnapshot {
  readonly authz_denied_total: Readonly<Record<'false' | 'true', number>>;
}

export interface HouseAuthorizationMetricStubs {
  incrementAuthorizationDenied(crossHouse: boolean): void;
  snapshot(): HouseAuthorizationMetricSnapshot;
}

/** [BM-012] Operations section 4.2 counter with its required cross_house label. */
export function createHouseAuthorizationMetricStubs(): HouseAuthorizationMetricStubs {
  const denied = { false: 0, true: 0 };

  return {
    incrementAuthorizationDenied(crossHouse) {
      denied[crossHouse ? 'true' : 'false'] += 1;
    },
    snapshot() {
      return { authz_denied_total: { ...denied } };
    },
  };
}
