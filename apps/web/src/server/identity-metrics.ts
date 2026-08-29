import { createIdentityMetricStubs, type IdentityMetricStubs } from '@between-moves/observability';

const globalMetrics = globalThis as typeof globalThis & {
  betweenMovesIdentityMetrics?: IdentityMetricStubs;
};

export function getIdentityMetrics(): IdentityMetricStubs {
  globalMetrics.betweenMovesIdentityMetrics ??= createIdentityMetricStubs();
  return globalMetrics.betweenMovesIdentityMetrics;
}
