import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { unusedPreloads } from './support/unused-preloads';

/** The preload check on small fixed pages served from memory. Nothing here needs the app. */
const origin = 'http://fixture.test';
const src = fileURLToPath(new URL('../src/', import.meta.url));
const files: Record<string, { type: string; body: Buffer }> = {
  '/plex-regular.woff2': {
    type: 'font/woff2',
    body: readFileSync(join(src, 'fonts/plex-mono-regular.woff2')),
  },
  '/plex-semibold.woff2': {
    type: 'font/woff2',
    body: readFileSync(join(src, 'fonts/plex-mono-semibold.woff2')),
  },
  '/a.webp': { type: 'image/webp', body: readFileSync(join(src, 'app/_art/lost-knight.webp')) },
};

async function open(page: Page, head: string, body: string): Promise<string[]> {
  await page.route(`${origin}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    const file = files[path];
    if (file !== undefined) return route.fulfill({ contentType: file.type, body: file.body });
    return route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><head><style>
        @font-face { font-family: Plex; font-weight: 400; src: url(/plex-regular.woff2) format('woff2'); }
        @font-face { font-family: Plex; font-weight: 600; src: url(/plex-semibold.woff2) format('woff2'); }
        body { font-family: Plex, monospace; font-weight: 400; }
      </style>${head}</head><body>${body}</body>`,
    });
  });
  await page.goto(`${origin}/`);
  return unusedPreloads(page);
}

const font = (file: string) =>
  `<link rel="preload" as="font" type="font/woff2" crossorigin href="/${file}">`;

test('a preloaded font weight the page never draws is reported', async ({ page }) => {
  expect(
    await open(page, font('plex-regular.woff2') + font('plex-semibold.woff2'), '<p>e4 e5</p>'),
  ).toEqual([`preload as=font ${origin}/plex-semibold.woff2`]);
});

test('a preloaded font the page draws passes', async ({ page }) => {
  expect(
    await open(page, font('plex-semibold.woff2'), '<p style="font-weight:600">Nf3</p>'),
  ).toEqual([]);
});

test('a responsive image preload with no image is reported, and passes with one', async ({
  page,
}) => {
  const preload = '<link rel="preload" as="image" imagesrcset="/a.webp 1x, /b.webp 2x">';
  expect(await open(page, preload, '<p>404</p>')).toEqual([
    `preload as=image ${origin}/a.webp ${origin}/b.webp`,
  ]);
  expect(
    await open(
      page,
      preload,
      '<img alt="" srcset="/a.webp 1x, /b.webp 2x" width="10" height="10">',
    ),
  ).toEqual([]);
});
