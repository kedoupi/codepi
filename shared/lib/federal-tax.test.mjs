import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcFederalIncomeTax, TAX_DATA_2026 } from './federal-tax.js';

test('zero income → zero tax', () => {
  const r = calcFederalIncomeTax({ taxableIncome: 0, filingStatus: 'single' });
  assert.equal(r.tax, 0);
  assert.equal(r.effectiveRate, 0);
  assert.equal(r.marginalRate, 0.10);
});

test('single $33,900 taxable (entirely in 10% + 12% brackets)', () => {
  // 12,400 × 10% = 1,240; (33,900 − 12,400) × 12% = 2,580; total = 3,820
  const r = calcFederalIncomeTax({ taxableIncome: 33900, filingStatus: 'single' });
  assert.equal(Math.round(r.tax), 3820);
  assert.equal(r.marginalRate, 0.12);
  assert.ok(Math.abs(r.effectiveRate - (3820 / 33900)) < 1e-6);
  // 2 active brackets in breakdown
  assert.equal(r.bracketBreakdown.filter((b) => b.taxFromBracket > 0).length, 2);
});

test('single $200,000 taxable straddles 24% bracket', () => {
  // 10%×12400 + 12%×38000 + 22%×55300 + 24%×(200000-105700)
  // = 1240 + 4560 + 12166 + 22632 = 40598
  const r = calcFederalIncomeTax({ taxableIncome: 200000, filingStatus: 'single' });
  assert.equal(Math.round(r.tax), 40598);
  assert.equal(r.marginalRate, 0.24);
});

test('MFJ $167,800 taxable in 22% bracket', () => {
  // 10%×24800 + 12%×76000 + 22%×(167800-100800)
  // = 2480 + 9120 + 14740 = 26340
  const r = calcFederalIncomeTax({ taxableIncome: 167800, filingStatus: 'mfj' });
  assert.equal(Math.round(r.tax), 26340);
  assert.equal(r.marginalRate, 0.22);
});

test('top-bracket marginal rate', () => {
  const r = calcFederalIncomeTax({ taxableIncome: 1000000, filingStatus: 'single' });
  assert.equal(r.marginalRate, 0.37);
});

test('TAX_DATA_2026 has all four filing statuses', () => {
  assert.ok(TAX_DATA_2026.brackets.single.length >= 7);
  assert.ok(TAX_DATA_2026.brackets.mfj.length >= 7);
  assert.ok(TAX_DATA_2026.brackets.mfs.length >= 7);
  assert.ok(TAX_DATA_2026.brackets.hoh.length >= 7);
  assert.equal(TAX_DATA_2026.standardDeduction.single, 16100);
  assert.equal(TAX_DATA_2026.standardDeduction.mfj, 32200);
  assert.equal(TAX_DATA_2026.ssWageBase, 184500);
});
