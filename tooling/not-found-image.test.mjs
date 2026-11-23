import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const web = join(dirname(dirname(fileURLToPath(import.meta.url))), 'apps/web');
const eslint = new ESLint({ cwd: web });

async function messages(filePath, element) {
  const source = `import Image from 'next/image';\nexport default function NotFound() { return <main>${element}</main>; }`;
  const [result] = await eslint.lintText(source, { filePath: join(web, filePath) });
  return result.messages.filter((message) => message.ruleId === 'no-restricted-syntax');
}

const pages = [
  'src/app/not-found.tsx',
  'src/app/h/[houseId]/not-found.tsx',
  'src/app/global-not-found.tsx',
];

describe('a not-found page never preloads an image (fab208b)', () => {
  it('rejects an <img> without loading="lazy" in every not-found page', async () => {
    for (const page of pages) {
      const found = await messages(page, '<img src="/x.webp" alt="" width={1} height={1} />');
      assert.equal(found.length, 1, page);
      assert.match(found[0].message, /loading="lazy"/);
      assert.match(found[0].message, /every route's payload/);
    }
  });

  it('rejects eager loading and next/image priority, preload or fetchPriority', async () => {
    for (const element of [
      '<img src="/x.webp" alt="" loading="eager" />',
      '<img src="/x.webp" alt="" loading={eager} />',
      '<Image src="/x.webp" alt="" width={1} height={1} priority />',
      '<Image src="/x.webp" alt="" width={1} height={1} preload />',
      '<Image src="/x.webp" alt="" width={1} height={1} loading="eager" />',
      '<img src="/x.webp" alt="" loading="lazy" fetchPriority="high" />',
    ]) {
      assert.equal((await messages(pages[1], element)).length, 1, element);
    }
  });

  it('allows lazy images, and leaves other pages alone', async () => {
    for (const element of [
      '<img src="/x.webp" alt="" loading="lazy" />',
      '<img src="/x.webp" alt="" loading={\'lazy\'} />',
      '<Image src="/x.webp" alt="" width={1} height={1} />',
    ]) {
      assert.deepEqual(await messages(pages[0], element), [], element);
    }
    assert.deepEqual(
      await messages('src/app/page.tsx', '<img src="/x.webp" alt="" priority />'),
      [],
    );
  });
});
