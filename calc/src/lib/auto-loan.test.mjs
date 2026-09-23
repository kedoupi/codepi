import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcAutoLoan } from './auto-loan.js';

test('$30k vehicle, $5k down, 7.5% APR, 60 months, 7% sales tax, no trade', () => {
  const r = calcAutoLoan({
    vehiclePrice: 30000, downPayment: 5000, tradeIn: 0,
    salesTaxPct: 7, annualRatePct: 7.5, termMonths: 60,
  });
  // salesTax = 30000 × 7% = 2100
  // principal = 30000 - 5000 - 0 + 2100 = 27100
  assert.equal(r.salesTax, 2100);
  assert.equal(r.principal, 27100);
  // monthlyPayment ≈ amortization on $27,100 @ 7.5% / 60mo ≈ $543.03
  assert.ok(Math.abs(r.monthlyPayment - 543.03) < 1);
});

test('trade-in reduces principal', () => {
  const r = calcAutoLoan({
    vehiclePrice: 40000, downPayment: 0, tradeIn: 8000,
    salesTaxPct: 0, annualRatePct: 6, termMonths: 60,
  });
  assert.equal(r.principal, 32000);
});

test('zero APR → straight-line', () => {
  const r = calcAutoLoan({
    vehiclePrice: 24000, downPayment: 4000, tradeIn: 0,
    salesTaxPct: 0, annualRatePct: 0, termMonths: 60,
  });
  // principal = 20000; monthlyPayment = 20000 / 60 ≈ 333.33
  assert.ok(Math.abs(r.monthlyPayment - 333.33) < 0.01);
  assert.equal(r.totalInterest, 0);
});

test('output object has expected shape', () => {
  const r = calcAutoLoan({
    vehiclePrice: 30000, downPayment: 5000, tradeIn: 0,
    salesTaxPct: 7, annualRatePct: 7.5, termMonths: 60,
  });
  assert.ok('principal' in r && 'salesTax' in r && 'monthlyPayment' in r && 'totalInterest' in r && 'totalPaid' in r && 'totalCost' in r);
});
