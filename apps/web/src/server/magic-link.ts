import { AesGcmMagicLinkDeliveryCodec, generateUuidV7 } from '@between-moves/adapters';
import { createMagicLinkDeliveryQueue } from '@between-moves/application';
import { PgMagicLinkOutboxWriter } from '@between-moves/db';
import { getConfig } from '../config';
import { getDatabase } from './database';

const globalMagicLink = globalThis as typeof globalThis & {
  betweenMovesMagicLinkQueue?: ReturnType<typeof createMagicLinkDeliveryQueue>;
};

export function getMagicLinkDeliveryQueue(): ReturnType<typeof createMagicLinkDeliveryQueue> {
  globalMagicLink.betweenMovesMagicLinkQueue ??= createMagicLinkDeliveryQueue({
    clock: { now: () => new Date() },
    generateId: generateUuidV7,
    codec: new AesGcmMagicLinkDeliveryCodec(getConfig().betterAuthSecret),
    writer: new PgMagicLinkOutboxWriter(getDatabase().pool),
  });
  return globalMagicLink.betweenMovesMagicLinkQueue;
}
