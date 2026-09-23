import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcIncomeTax } from './income-tax.js';

test('single $90k with standard deduction', () => {
  // taxable = 90000 - 16100 = 73900
  // tax = 10%×12400 + 12%×38000 + 22%×(73900-50400)
  //     = 1240 + 4560 + 22%×23500 = 1240 + 4560 + 5170 = 10970
  const r = calcIncomeTax({ income: 90000, filingStatus: 'single', deductionType: 'standard' });
  assert.equal(r.taxableIncome, 73900);
  assert.equal(Math.round(r.federalTax), 10970);
  assert.equal(r.marginalRate, 0.22);
});

test('MFJ $200k standard', () => {
  // taxable = 200000 - 32200 = 167800; tax = 26340 (verified in federal-tax test)
  const r = calcIncomeTax({ income: 200000, filingStatus: 'mfj', deductionType: 'standard' });
  assert.equal(r.taxableIncome, 167800);
  assert.equal(Math.round(r.federalTax), 26340);
});

test('itemized deduction overrides standard', () => {
  const r = calcIncomeTax({ income: 100000, filingStatus: 'single', deductionType: 'itemized', itemizedDeduction: 25000 });
  assert.equal(r.taxableIncome, 75000);
});

test('itemized with missing amount falls back to 0', () => {
  const r = calcIncomeTax({ income: 50000, filingStatus: 'single', deductionType: 'itemized' });
  assert.equal(r.taxableIncome, 50000);
});

test('income below standard deduction → zero tax', () => {
  const r = calcIncomeTax({ income: 10000, filingStatus: 'single', deductionType: 'standard' });
  assert.equal(r.taxableIncome, 0);
  assert.equal(r.federalTax, 0);
});
