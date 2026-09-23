/**
 * Compound interest with regular monthly contributions, compounded N times per year.
 *
 * Implementation uses month-by-month iteration so we can produce a yearByYear
 * series for charting. (Closed-form FV would also work but loses granular history.)
 *
 * @param {object} input
 * @param {number} input.principal
 * @param {number} input.monthlyContribution
 * @param {number} input.annualRatePct
 * @param {number} input.years
 * @param {number} [input.compoundsPerYear=12]   Currently we model contributions as monthly; this controls compound frequency.
 * @returns {{
 *   finalAmount: number,
 *   totalContributed: number,
 *   totalInterest: number,
 *   yearByYear: Array<{year:number,balance:number,totalContributed:number,totalInterest:number}>
 * }}
 */
export function calcCompoundInterest({ principal, monthlyContribution, annualRatePct, years, compoundsPerYear = 12 }) {
  const months = Math.max(0, Math.round(years * 12));
  const r = annualRatePct / 100;
  // Effective per-month growth factor when compounding `compoundsPerYear` times/yr:
  //   (1 + r/n)^(n/12) per month.
  const monthlyGrowth = Math.pow(1 + r / Math.max(1, compoundsPerYear), Math.max(1, compoundsPerYear) / 12);

  let balance = principal;
  let contributed = principal;
  const yearByYear = [];

  for (let m = 1; m <= months; m++) {
    balance = balance * monthlyGrowth + monthlyContribution;
    contributed += monthlyContribution;
    if (m % 12 === 0) {
      const year = m / 12;
      yearByYear.push({
        year,
        balance,
        totalContributed: contributed,
        totalInterest: balance - contributed,
      });
    }
  }

  return {
    finalAmount: balance,
    totalContributed: contributed,
    totalInterest: balance - contributed,
    yearByYear,
  };
}
