import { calcFederalIncomeTax, TAX_DATA_2026 } from './federal-tax.js';

/**
 * Compute 2026 US federal income tax with standard or itemized deduction.
 *
 * @param {object} input
 * @param {number} input.income
 * @param {'single'|'mfj'|'mfs'|'hoh'} input.filingStatus
 * @param {'standard'|'itemized'} input.deductionType
 * @param {number} [input.itemizedDeduction=0]
 * @returns {{
 *   taxableIncome: number,
 *   deductionAmount: number,
 *   federalTax: number,
 *   effectiveRate: number,
 *   marginalRate: number,
 *   bracketBreakdown: Array<object>,
 * }}
 */
export function calcIncomeTax({ income, filingStatus, deductionType, itemizedDeduction = 0 }) {
  const deductionAmount = deductionType === 'itemized'
    ? Math.max(0, itemizedDeduction)
    : TAX_DATA_2026.standardDeduction[filingStatus] || 0;
  const taxableIncome = Math.max(0, income - deductionAmount);
  const { tax, effectiveRate, marginalRate, bracketBreakdown } = calcFederalIncomeTax({ taxableIncome, filingStatus });
  return { taxableIncome, deductionAmount, federalTax: tax, effectiveRate, marginalRate, bracketBreakdown };
}
