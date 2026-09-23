import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeState, decodeState } from './url-state.js';

test('encode primitives to query string', () => {
  const s = encodeState({ homePrice: 400000, downMode: 'percent', termYears: 30, rate: 6.5 });
  // Order-independent — parse it back
  const params = new URLSearchParams(s);
  assert.equal(params.get('homePrice'), '400000');
  assert.equal(params.get('downMode'), 'percent');
  assert.equal(params.get('termYears'), '30');
  assert.equal(params.get('rate'), '6.5');
});

test('decode query string with defaults', () => {
  const r = decodeState('?homePrice=500000&rate=7', { homePrice: 100000, rate: 5, termYears: 30 });
  assert.equal(r.homePrice, 500000);
  assert.equal(r.rate, 7);
  assert.equal(r.termYears, 30); // fell back to default
});

test('decode preserves string defaults', () => {
  const r = decodeState('?downMode=amount', { downMode: 'percent', label: 'hello' });
  assert.equal(r.downMode, 'amount');
  assert.equal(r.label, 'hello');
});

test('decode without leading "?" works', () => {
  const r = decodeState('homePrice=200000', { homePrice: 100000 });
  assert.equal(r.homePrice, 200000);
});

test('encode skips undefined and null', () => {
  const s = encodeState({ a: 1, b: undefined, c: null, d: 'x' });
  const params = new URLSearchParams(s);
  assert.equal(params.get('a'), '1');
  assert.equal(params.has('b'), false);
  assert.equal(params.has('c'), false);
  assert.equal(params.get('d'), 'x');
});
