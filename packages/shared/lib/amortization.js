/**
 * Standard amortizing-loan math. Used by mortgage and auto-loan calculators.
 *
 * @param {object} input
 * @param {number} input.principal     Loan principal in USD.
 * @param {number} input.annualRatePct Annual interest rate as a percent (e.g. 6.5).
 * @param {number} input.termMonths    Loan term in months.
 * @returns {{ monthlyPayment: number, totalInterest: number, totalPaid: number }}
 */
export function calcAmortizedLoan({ principal, annualRatePct, termMonths }) {
  if (principal <= 0 || termMonths <= 0) {
    return { monthlyPayment: 0, totalInterest: 0, totalPaid: 0 };
  }
  const r = annualRatePct / 100 / 12;
  let monthlyPayment;
  if (r === 0) {
    monthlyPayment = principal / termMonths;
  } else {
    const pow = Math.pow(1 + r, termMonths);
    monthlyPayment = (principal * r * pow) / (pow - 1);
  }
  const totalPaid = monthlyPayment * termMonths;
  const totalInterest = totalPaid - principal;
  return { monthlyPayment, totalInterest, totalPaid };
}
