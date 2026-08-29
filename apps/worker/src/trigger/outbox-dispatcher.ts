import { schedules, task, wait } from '@trigger.dev/sdk/v3';
import { runOutboxDispatcher } from '../composition';

const queue = { name: 'outbox-dispatcher', concurrencyLimit: 1 };

/** Event-hook entry point for low-latency dispatch after committed writes. */
export const outboxDispatcherTask = task({
  id: 'outbox-dispatcher',
  queue,
  retry: { maxAttempts: 1 },
  run: runOutboxDispatcher,
});

/** Cron is minute-granular, so each run polls every ~5 seconds for one minute. */
export const scheduledOutboxDispatcherTask = schedules.task({
  id: 'outbox-dispatcher-schedule',
  cron: '* * * * *',
  queue,
  retry: { maxAttempts: 1 },
  run: async () => {
    for (let iteration = 0; iteration < 12; iteration += 1) {
      await runOutboxDispatcher();
      if (iteration < 11) await wait.for({ seconds: 5 });
    }
  },
});
