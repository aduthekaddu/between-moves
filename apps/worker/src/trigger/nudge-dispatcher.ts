import { schedules } from '@trigger.dev/sdk/v3';
import { runNudgeDispatcher } from '../composition';

/** [BM-029] One bounded, retry-safe deadline scan every fifteen minutes. */
export const scheduledNudgeDispatcherTask = schedules.task({
  id: 'nudge-dispatcher-schedule',
  cron: '*/15 * * * *',
  queue: { name: 'nudge-dispatcher', concurrencyLimit: 1 },
  retry: { maxAttempts: 3 },
  run: runNudgeDispatcher,
});
