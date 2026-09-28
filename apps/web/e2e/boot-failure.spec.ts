import { spawn } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { e2eEnvironment } from './environment';

test('[BM-003] app boot aborts and names only an invalid configuration key', async () => {
  const environment = { ...e2eEnvironment } as NodeJS.ProcessEnv;
  expect(environment.REALTIME_SERVER_KEY).toBeTruthy();
  // An explicit empty value stays invalid even when Next loads a local .env file.
  environment.REALTIME_SERVER_KEY = '';

  const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn('pnpm', ['exec', 'next', 'start', '--port', '3199'], {
      cwd: process.cwd(),
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Invalid-config app startup did not abort'));
    }, 15_000);

    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.once('error', reject);
    child.once('close', (code) => {
      clearTimeout(timeout);
      resolve({ code, output });
    });
  });

  expect(result.code).not.toBe(0);
  expect(result.output).toContain('REALTIME_SERVER_KEY');

  const secretValues = [
    e2eEnvironment.BETTER_AUTH_SECRET,
    e2eEnvironment.RESEND_API_KEY,
    e2eEnvironment.RESEND_WEBHOOK_SECRET,
    e2eEnvironment.REALTIME_PUBLIC_KEY,
    e2eEnvironment.ANALYSIS_WORKER_SECRET,
  ];
  for (const value of secretValues) {
    expect(result.output).not.toContain(value);
  }
});
