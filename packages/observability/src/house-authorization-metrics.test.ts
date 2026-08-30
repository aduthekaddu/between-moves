import { describe, expect, it } from 'vitest';
import { createHouseAuthorizationMetricStubs } from './house-authorization-metrics';

describe('House authorization metrics', () => {
  it('[BM-012] records authorization denials with the cross_house label', () => {
    const metrics = createHouseAuthorizationMetricStubs();

    metrics.incrementAuthorizationDenied(false);
    metrics.incrementAuthorizationDenied(true);
    metrics.incrementAuthorizationDenied(true);

    expect(metrics.snapshot()).toEqual({
      authz_denied_total: { false: 1, true: 2 },
    });
  });
});
