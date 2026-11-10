import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const template = await readFile(new URL('./notification.ts', import.meta.url), 'utf8');

test('the shared notification template escapes producer text and ships no remote assets', () => {
  assert.match(template, /escapeHtml/);
  assert.equal(/https?:\/\/[^"]*\.(?:png|jpe?g|gif|webp)/i.test(template), false);
  assert.equal(/tracking|pixel/i.test(template), false);
  assert.match(template, /\[严重\]|\[注意\]|\[恢复\]|\[自检\]|severityLabel/);
});
