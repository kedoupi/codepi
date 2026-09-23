import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcMortgage } from './mortgage.js';

test('30-year fixed at 6.5% on $400k with 20% down', () => {
  const r = calcMortgage({
    homePrice: 400000,
    downPayment: 80000,
    annualRatePct: 6.5,
    termYears: 30,
    annualPropertyTax: 5000,
    annualInsurance: 1500,
  });
  // P = 320000, monthly r = 0.065/12, n = 360
  // M = 2022.62 (rounded)
  assert.equal(Math.round(r.monthlyPI), 2023);
  assert.equal(Math.round(r.monthlyTax), 417);     // 5000/12
  assert.equal(Math.round(r.monthlyInsurance), 125); // 1500/12
  assert.equal(Math.round(r.monthlyTotal), 2564); // round(2022.62 + 416.67 + 125) = 2564
});

test('zero interest rate falls back to even split', () => {
  const r = calcMortgage({
    homePrice: 120000,
    downPayment: 0,
    annualRatePct: 0,
    termYears: 10,
    annualPropertyTax: 0,
    annualInsurance: 0,
  });
  assert.equal(Math.round(r.monthlyPI), 1000); // 120000 / 120
  assert.equal(r.monthlyTotal, r.monthlyPI);
});

test('100% down payment yields zero P&I', () => {
  const r = calcMortgage({
    homePrice: 300000,
    downPayment: 300000,
    annualRatePct: 7,
    termYears: 30,
    annualPropertyTax: 0,
    annualInsurance: 0,
  });
  assert.equal(r.monthlyPI, 0);
});
