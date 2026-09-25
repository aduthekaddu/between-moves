import { HmacRealtimeTokenIssuer, SystemClock } from '@between-moves/adapters';
import { getConfig } from '../../config';
import { getGamePosition } from './game-position';
import { getRealtimeNightFanout } from '../../server/realtime-fanout';
import { getRealtimeMetrics, getRealtimeTokenRateLimit } from '../../server/rate-limit';
import { requireViewer } from '../../server/viewer';
import type { GameRealtimeDependencies } from '../../server/game-realtime-handler';

const clock = new SystemClock();

export function gameRealtimeDependencies(): GameRealtimeDependencies {
  const config = getConfig();
  const issuer = new HmacRealtimeTokenIssuer({
    appId: config.realtimeAppId,
    serverKey: config.realtimeServerKey,
    publicKey: config.realtimePublicKey,
  });
  return {
    expectedOrigin: config.appOrigin.origin,
    serverKey: config.realtimeServerKey,
    requireViewer,
    readPosition: getGamePosition,
    limitToken: getRealtimeTokenRateLimit(),
    issueToken: (input) => issuer.issueGame(input),
    fanout: getRealtimeNightFanout(),
    metrics: getRealtimeMetrics(),
    clock,
  };
}
