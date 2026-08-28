import { expect, test } from '@playwright/test';

test('[BM-003] GET /healthz responds with app and build information', async ({ request }) => {
  const response = await request.get('/healthz');

  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toBe('no-store');
  await expect(response.json()).resolves.toMatchObject({
    status: 'ok',
    app: {
      name: 'between-moves',
      version: '0.0.0',
    },
    build: {
      id: expect.any(String),
      environment: expect.any(String),
    },
  });
});
