import { calcAmortizedLoan } from './amortization.js';

/**
 * Compute US auto-loan monthly payment and totals.
 * Sales tax is calculated on the vehicle price (simple model — does NOT
 * apply state-specific rules like trade-in tax credits).
 *
 * @param {object} input
 * @param {number} input.vehiclePrice
 * @param {number} input.downPayment
 * @param {number} [input.tradeIn=0]
 * @param {number} [input.salesTaxPct=0]
 * @param {number} input.annualRatePct
 * @param {number} input.termMonths
 * @returns {{
 *   principal: number, salesTax: number, monthlyPayment: number,
 *   totalInterest: number, totalPaid: number, totalCost: number,
 * }}
 */
export function calcAutoLoan({
  vehiclePrice,
  downPayment,
  tradeIn = 0,
  salesTaxPct = 0,
  annualRatePct,
  termMonths,
}) {
  const salesTax = Math.max(0, vehiclePrice) * (salesTaxPct / 100);
  const principal = Math.max(0, vehiclePrice - downPayment - tradeIn + salesTax);
  const { monthlyPayment, totalInterest, totalPaid } = calcAmortizedLoan({
    principal,
    annualRatePct,
    termMonths,
  });
  // totalCost = vehiclePrice + interest + tax  (you still own the car at the end)
  const totalCost = vehiclePrice + totalInterest + salesTax;
  return { principal, salesTax, monthlyPayment, totalInterest, totalPaid, totalCost };
}
