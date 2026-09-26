import { schedules, wait } from '@trigger.dev/sdk/v3';
import { runAnalysisWorker } from '../composition';

export const scheduledAnalysisWorkerTask = schedules.task({
  id: 'analysis-worker-schedule',
  cron: '* * * * *',
  queue: { name: 'analysis-worker', concurrencyLimit: 1 },
  retry: { maxAttempts: 1 },
  run: async () => {
    for (let iteration = 0; iteration < 12; iteration += 1) {
      await runAnalysisWorker();
      if (iteration < 11) await wait.for({ seconds: 5 });
    }
  },
});
