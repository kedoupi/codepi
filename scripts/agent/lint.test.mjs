import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { githubSlug, lintMarkdown } from './lint.mjs';

function fixture(t, files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'kdp-agent-lint-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [name, contents] of Object.entries(files)) {
    const target = path.join(dir, name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
  return dir;
}

test('uses GitHub-compatible heading slugs and duplicate suffixes', (t) => {
  assert.equal(githubSlug('Hello, World!'), 'hello-world');
  assert.equal(githubSlug('中文 Heading'), '中文-heading');
  const dir = fixture(t, { 'README.md': '# Repeat\n\n# Repeat\n' });
  writeFileSync(path.join(dir, 'check.md'), '[first](README.md#repeat) [second](README.md#repeat-1)');
  assert.deepEqual(lintMarkdown(path.join(dir, 'check.md')), []);
});

test('checks relative files and local anchors while ignoring external links and fences', (t) => {
  const dir = fixture(t, {
    'README.md': '# Start Here\n\n[local](#start-here) [other](docs/guide.md#details)\n\n```md\n[ignored](missing.md#nope)\n```\n[external](https://example.com/missing.md#nope)\n',
    'docs/guide.md': '# Details\n',
  });
  assert.deepEqual(lintMarkdown(path.join(dir, 'README.md')), []);
});

test('reports missing relative paths and anchors', (t) => {
  const dir = fixture(t, { 'README.md': '[missing](nope.md) [bad](#not-here)' });
  assert.deepEqual(lintMarkdown(path.join(dir, 'README.md')), [
    'missing path nope.md',
    'missing anchor #not-here',
  ]);
});
