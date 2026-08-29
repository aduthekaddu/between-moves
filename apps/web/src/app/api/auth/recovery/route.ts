import { getConfig } from '../../../../config';
import { requestAccountRecovery } from '../../../../server/identity-recovery';
import { getIdentityMetrics } from '../../../../server/identity-metrics';
import { getRecoveryRateLimit } from '../../../../server/rate-limit';
import { createRecoveryRequestHandler } from './handler';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function POST(request: Request): Promise<Response> {
  return createRecoveryRequestHandler({
    expectedOrigin: getConfig().appOrigin.origin,
    metrics: getIdentityMetrics(),
    rateLimit: getRecoveryRateLimit(),
    requestRecovery: requestAccountRecovery,
  })(request);
}
