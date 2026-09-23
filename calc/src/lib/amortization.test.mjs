import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcAmortizedLoan } from './amortization.js';

test('30-year fixed at 6.5% on $320k principal', () => {
  const r = calcAmortizedLoan({ principal: 320000, annualRatePct: 6.5, termMonths: 360 });
  assert.equal(Math.round(r.monthlyPayment), 2023);
  // totalInterest === totalPaid - principal (exact monthly used internally, not the rounded 2023)
  assert.equal(Math.round(r.totalInterest), Math.round(r.totalPaid - 320000));
  assert.equal(Math.round(r.totalPaid), Math.round(r.monthlyPayment * 360));
});

test('zero rate → straight-line repayment', () => {
  const r = calcAmortizedLoan({ principal: 120000, annualRatePct: 0, termMonths: 120 });
  assert.equal(r.monthlyPayment, 1000);
  assert.equal(r.totalInterest, 0);
  assert.equal(r.totalPaid, 120000);
});

test('zero principal → zero everything', () => {
  const r = calcAmortizedLoan({ principal: 0, annualRatePct: 7, termMonths: 360 });
  assert.equal(r.monthlyPayment, 0);
  assert.equal(r.totalInterest, 0);
  assert.equal(r.totalPaid, 0);
});

test('5-year auto loan at 7.5% on $30k', () => {
  const r = calcAmortizedLoan({ principal: 30000, annualRatePct: 7.5, termMonths: 60 });
  // Standard amortization: ≈ $601.14/mo
  assert.ok(Math.abs(r.monthlyPayment - 601.14) < 1);
});
