import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLatestResponse } from '../src/scripts/home/latest.mjs';

test('homepage latest parser returns two public posts and normalizes metadata', () => {
  const latest = parseLatestResponse({
    posts: [
      { slug: 'first', title: '第一篇', summary: '摘要', category: '生活', published_at: '2026-11-07T00:00:00Z', body_chars: 800 },
      { slug: 'second', title: '第二篇', summary: '', tag: '随笔', reading_minutes: 4 },
      { slug: '', title: '无效文章' },
    ],
  });
  assert.deepEqual(latest, {
    primary: { slug: 'first', title: '第一篇', summary: '摘要', category: '生活', published_at: '2026-11-07T00:00:00Z', reading_minutes: null, body_chars: 800 },
    secondary: { slug: 'second', title: '第二篇', summary: '', category: '随笔', published_at: null, reading_minutes: 4, body_chars: null },
  });
});

test('homepage latest parser returns null for failed or empty public responses', () => {
  assert.equal(parseLatestResponse(null), null);
  assert.equal(parseLatestResponse({ posts: [] }), null);
  assert.equal(parseLatestResponse({ posts: [{ slug: 'missing-title' }] }), null);
});
