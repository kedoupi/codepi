import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('isolated www-build installs cross-product fixture dependencies before Desk tests', async () => {
  const workflow = await readFile(new URL('../../.github/workflows/deploy-platform.yml', import.meta.url), 'utf8');
  const job = workflow.split('\n  www-build:')[1]?.split('\n  gu-build:')[0];
  assert.ok(job, 'www-build must exist');
  const beforeTests = job.split('      - run: npm test')[0];
  assert.match(job, /- run: npm test/);
  for (const app of ['auth', 'gu', 'gzh']) {
    assert.ok(beforeTests.includes(`npm --prefix ../${app} ci`), `${app} fixture dependencies are installed in this job`);
  }
  assert.match(beforeTests, /uses: pnpm\/action-setup@v4/);
  assert.match(beforeTests, /pnpm --dir \.\.\/oura install --frozen-lockfile/);
});

test('Pages deployment smoke includes private endpoints and SSO, not just homepage status', async () => {
  const workflow = await readFile(new URL('../../.github/workflows/deploy-platform.yml', import.meta.url), 'utf8');
  for (const app of ['web', 'gu', 'gzh']) for (const target of ['production', 'staging']) {
    const name = app === 'web' ? 'www' : app;
    const job = workflow.split(`\n  ${name}-deploy-${target}:`)[1]?.split(/\n  [a-z][a-z-]+:/)[0];
    assert.ok(job?.includes(`node ../scripts/cloudflare/check-pages.mjs ${app} ${target}`));
  }
});
