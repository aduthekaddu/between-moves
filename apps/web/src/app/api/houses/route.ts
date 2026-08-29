import { SystemClock } from '@between-moves/adapters';
import { getConfig } from '../../../config';
import { createHouse } from '../../../server/houses';
import { getLogger } from '../../../server/logger';
import { requireViewer } from '../../../server/viewer';
import { createHouseRequestHandler } from './handler';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function POST(request: Request): Promise<Response> {
  return createHouseRequestHandler({
    expectedOrigin: getConfig().appOrigin.origin,
    requireViewer,
    createHouse,
    logger: getLogger(),
    clock: new SystemClock(),
  })(request);
}
