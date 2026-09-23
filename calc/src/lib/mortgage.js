import { calcAmortizedLoan } from './amortization.js';

/**
 * Compute US mortgage monthly cost breakdown.
 *
 * @param {object} input
 * @param {number} input.homePrice
 * @param {number} input.downPayment
 * @param {number} input.annualRatePct
 * @param {number} input.termYears
 * @param {number} [input.annualPropertyTax=0]
 * @param {number} [input.annualInsurance=0]
 * @returns {{ loanPrincipal: number, monthlyPI: number, monthlyTax: number, monthlyInsurance: number, monthlyTotal: number }}
 */
export function calcMortgage(input) {
  const {
    homePrice,
    downPayment,
    annualRatePct,
    termYears,
    annualPropertyTax = 0,
    annualInsurance = 0,
  } = input;

  const principal = Math.max(0, homePrice - downPayment);
  const { monthlyPayment: monthlyPI } = calcAmortizedLoan({
    principal,
    annualRatePct,
    termMonths: termYears * 12,
  });

  const monthlyTax = annualPropertyTax / 12;
  const monthlyInsurance = annualInsurance / 12;
  const monthlyTotal = monthlyPI + monthlyTax + monthlyInsurance;

  return {
    loanPrincipal: principal,
    monthlyPI,
    monthlyTax,
    monthlyInsurance,
    monthlyTotal,
  };
}
