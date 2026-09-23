import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcCompoundInterest } from './compound-interest.js';

test('$10k @ 7%/yr for 10 yrs, monthly compound, no contribution', () => {
  const r = calcCompoundInterest({ principal: 10000, monthlyContribution: 0, annualRatePct: 7, years: 10, compoundsPerYear: 12 });
  // FV = 10000 × (1 + 0.07/12)^120 ≈ 20096.61
  assert.ok(Math.abs(r.finalAmount - 20096.61) < 1);
  assert.equal(r.totalContributed, 10000);
  assert.ok(r.totalInterest > 10000 && r.totalInterest < 10200);
  assert.equal(r.yearByYear.length, 10);
  assert.ok(r.yearByYear[0].balance > 10000);
  assert.ok(r.yearByYear[9].balance >= r.finalAmount - 1);
});

test('$0 principal, $500/mo for 30 yrs @ 7%, monthly compound', () => {
  const r = calcCompoundInterest({ principal: 0, monthlyContribution: 500, annualRatePct: 7, years: 30, compoundsPerYear: 12 });
  // Annuity FV ≈ 500 × ((1.005833^360 − 1) / 0.005833) ≈ 610,475
  assert.ok(r.finalAmount > 600000 && r.finalAmount < 620000);
  assert.equal(r.totalContributed, 500 * 12 * 30); // 180,000
});

test('zero rate → just sum of contributions', () => {
  const r = calcCompoundInterest({ principal: 1000, monthlyContribution: 100, annualRatePct: 0, years: 5, compoundsPerYear: 12 });
  // 1000 + 100*60 = 7000
  assert.equal(Math.round(r.finalAmount), 7000);
  assert.equal(r.totalInterest, 0);
});

test('yearByYear contains 10 entries for 10-year run', () => {
  const r = calcCompoundInterest({ principal: 5000, monthlyContribution: 100, annualRatePct: 5, years: 10, compoundsPerYear: 12 });
  assert.equal(r.yearByYear.length, 10);
  assert.equal(r.yearByYear[0].year, 1);
  assert.equal(r.yearByYear[9].year, 10);
  // Each year totalContributed must monotonically increase
  for (let i = 1; i < r.yearByYear.length; i++) {
    assert.ok(r.yearByYear[i].totalContributed > r.yearByYear[i - 1].totalContributed);
  }
});
