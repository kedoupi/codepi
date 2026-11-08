import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLatestResponse } from '../src/scripts/home/latest.ts';

const post = (slug, title) => ({ slug, title, summary: `${title} 摘要`, category: '生活', published_at: '2026-11-07T00:00:00Z', body_chars: 800 });

test('homepage latest parser returns two public posts and normalizes metadata', () => {
  const latest = parseLatestResponse(200, true, JSON.stringify({ posts: [post('first', '第一篇'), post('second', '第二篇')] }));
  assert.equal(latest.primary.slug, 'first');
  assert.equal(latest.secondary.slug, 'second');
  assert.equal(latest.primary.category, '生活');
});

test('homepage latest parser returns one public post with no secondary item', () => {
  const latest = parseLatestResponse(200, true, JSON.stringify({ posts: [post('only', '唯一一篇')] }));
  assert.equal(latest.primary.slug, 'only');
  assert.equal(latest.secondary, null);
});

test('homepage latest parser hides an empty public response', () => {
  assert.equal(parseLatestResponse(200, true, JSON.stringify({ posts: [] })), null);
});

test('homepage latest parser hides non-200 and invalid JSON responses', () => {
  assert.equal(parseLatestResponse(503, false, JSON.stringify({ posts: [post('offline', '不应显示')] })), null);
  assert.equal(parseLatestResponse(200, true, '{not-json'), null);
});
