import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const web = join(dirname(dirname(fileURLToPath(import.meta.url))), 'apps/web');
const eslint = new ESLint({ cwd: web });

async function messages(filePath, source) {
  const [result] = await eslint.lintText(source, { filePath: join(web, filePath) });
  return result.messages.filter((message) => message.ruleId === 'no-restricted-syntax');
}

const page = (attributes) =>
  `export default function NotFound() { return <main><img src="/x.webp" alt="" ${attributes} /></main>; }`;

describe('the 404 photo is lazy at its source (fab208b)', () => {
  it('rejects an <img> in not-found.tsx without loading="lazy"', async () => {
    const found = await messages('src/app/not-found.tsx', page('width={1} height={1}'));
    assert.equal(found.length, 1);
    assert.match(found[0].message, /loading="lazy"/);
    assert.match(found[0].message, /every route's payload/);
  });

  it('rejects loading="eager"', async () => {
    assert.equal((await messages('src/app/not-found.tsx', page('loading="eager"'))).length, 1);
  });

  it('allows loading="lazy", and leaves other pages alone', async () => {
    assert.deepEqual(await messages('src/app/not-found.tsx', page('loading="lazy"')), []);
    assert.deepEqual(await messages('src/app/page.tsx', page('')), []);
  });
});
