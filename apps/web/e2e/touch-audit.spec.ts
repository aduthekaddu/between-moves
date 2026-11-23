import { expect, test, type Page } from '@playwright/test';
import { auditTouch } from './support/touch-audit';

/**
 * The touch audit on small fixed pages, so each kind of mistake it must catch is shown
 * failing once. Nothing here needs the app or the database.
 */
test.use({ viewport: { width: 320, height: 640 }, hasTouch: true, isMobile: true });

const reset =
  '<meta name="viewport" content="width=device-width"><style>body{margin:0;font:16px/1.2 sans-serif}button{padding:0;border:0}</style>';

async function problems(page: Page, body: string): Promise<readonly string[]> {
  await page.setContent(`${reset}${body}`);
  return (await auditTouch(page)).problems;
}

test('a control under 24px fails, even by a fraction of a pixel', async ({ page }) => {
  const found = await problems(
    page,
    '<button style="position:absolute;left:10px;top:10px;width:22.1px;height:22.1px">x</button>',
  );
  expect(found).toHaveLength(1);
  expect(found[0]).toMatch(/is 22x22px; the minimum is 24x24px/);
});

test('a control of exactly 24px passes', async ({ page }) => {
  expect(
    await problems(
      page,
      '<button style="position:absolute;left:10.5px;top:10.5px;width:24px;height:24px">x</button>',
    ),
  ).toEqual([]);
});

test('a large control under a caption fails', async ({ page }) => {
  const found = await problems(
    page,
    `<button style="width:200px;height:44px">Sound</button>
     <p style="position:absolute;left:0;top:0;width:320px;height:40px;margin:0;background:#fff">caption</p>`,
  );
  expect(found).toHaveLength(1);
  expect(found[0]).toMatch(/button "Sound" has no clear 24x24px area; p "caption" covers it/);
});

test('a control under a fixed bar at the foot of the page fails', async ({ page }) => {
  const found = await problems(
    page,
    `<div style="height:1200px"></div><button style="width:120px;height:32px">Last</button>
     <div style="position:fixed;left:0;right:0;bottom:0;height:60px;background:#fff">bar</div>`,
  );
  expect(found).toHaveLength(1);
  expect(found[0]).toMatch(/button "Last" has no clear 24x24px area; div "bar" covers it/);
});

test('a control with a clear 24px area beside a cover passes', async ({ page }) => {
  expect(
    await problems(
      page,
      `<button style="width:200px;height:44px">Wide</button>
       <span style="position:absolute;left:0;top:0;width:100px;height:44px;pointer-events:none">see-through</span>
       <span style="position:absolute;left:0;top:0;width:60px;height:44px;background:#fff">badge</span>`,
    ),
  ).toEqual([]);
});

test('a link with padding offset by a negative margin passes (d02ad2c)', async ({ page }) => {
  expect(
    await problems(
      page,
      '<p style="margin:40px 0"><a href="/" style="padding-block:12px;margin-block:-12px">Back to the House</a></p>',
    ),
  ).toEqual([]);
  const found = await problems(
    page,
    '<p style="margin:40px 0"><a href="/">Back to the House</a></p>',
  );
  expect(found).toHaveLength(1);
  expect(found[0]).toMatch(/a "Back to the House" is \d+x\d+px; the minimum is 24x24px/);
});

test('a checkbox is measured by its label, and a link inside a sentence is exempt', async ({
  page,
}) => {
  expect(
    await problems(
      page,
      `<label style="display:block;padding:8px 0"><input type="checkbox"> Remember me</label>
       <p>Read the <a href="/rules">house rules</a> before the first Night.</p>`,
    ),
  ).toEqual([]);
});
