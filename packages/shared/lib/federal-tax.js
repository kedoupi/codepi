/**
 * 2026 US federal income tax data and bracket math.
 *
 * Data: IRS Rev. Proc. 2025-32 (October 2025)
 *   https://www.irs.gov/pub/irs-drop/rp-25-32.pdf
 * Cross-check: Tax Foundation 2026 brackets
 *   https://taxfoundation.org/data/all/federal/2026-tax-brackets/
 *
 * Brackets are tuples [rate, lowerBound]. For each rate, all taxable income
 * between this lowerBound (inclusive) and the next bracket's lowerBound
 * (exclusive) is taxed at `rate`.
 */

const B = (rate, lower) => [rate, lower];

export const TAX_DATA_2026 = {
  brackets: {
    single: [
      B(0.10, 0),
      B(0.12, 12400),
      B(0.22, 50400),
      B(0.24, 105700),
      B(0.32, 201775),
      B(0.35, 256225),
      B(0.37, 640600),
    ],
    mfj: [
      B(0.10, 0),
      B(0.12, 24800),
      B(0.22, 100800),
      B(0.24, 211400),
      B(0.32, 403550),
      B(0.35, 512450),
      B(0.37, 768700),
    ],
    mfs: [
      B(0.10, 0),
      B(0.12, 12400),
      B(0.22, 50400),
      B(0.24, 105700),
      B(0.32, 201775),
      B(0.35, 256225),
      B(0.37, 384350),
    ],
    hoh: [
      B(0.10, 0),
      B(0.12, 17700),
      B(0.22, 67450),
      B(0.24, 105700),
      B(0.32, 201775),
      B(0.35, 256200),
      B(0.37, 640600),
    ],
  },
  standardDeduction: { single: 16100, mfj: 32200, mfs: 16100, hoh: 24150 },
  ssWageBase: 184500,
  ssRateEmployee: 0.062,
  medicareRate: 0.0145,
  additionalMedicareRate: 0.009,
  additionalMedicareThreshold: { single: 200000, hoh: 200000, mfj: 250000, mfs: 125000 },
};

/**
 * Compute federal income tax for a given taxable income and filing status.
 *
 * @param {object} input
 * @param {number} input.taxableIncome
 * @param {'single'|'mfj'|'mfs'|'hoh'} input.filingStatus
 * @returns {{
 *   tax: number,
 *   effectiveRate: number,
 *   marginalRate: number,
 *   bracketBreakdown: Array<{rate:number, lower:number, upper:number|null, taxableInBracket:number, taxFromBracket:number}>
 * }}
 */
export function calcFederalIncomeTax({ taxableIncome, filingStatus }) {
  const ti = Math.max(0, taxableIncome);
  const brackets = TAX_DATA_2026.brackets[filingStatus];
  if (!brackets) throw new Error(`Unknown filingStatus: ${filingStatus}`);

  let tax = 0;
  let marginalRate = brackets[0][0];
  const breakdown = [];

  for (let i = 0; i < brackets.length; i++) {
    const [rate, lower] = brackets[i];
    const upper = i + 1 < brackets.length ? brackets[i + 1][1] : null;
    if (ti <= lower) {
      breakdown.push({ rate, lower, upper, taxableInBracket: 0, taxFromBracket: 0 });
      continue;
    }
    const top = upper === null ? ti : Math.min(ti, upper);
    const taxableInBracket = top - lower;
    const taxFromBracket = taxableInBracket * rate;
    tax += taxFromBracket;
    breakdown.push({ rate, lower, upper, taxableInBracket, taxFromBracket });
    if (ti > lower) marginalRate = rate;
    if (upper === null || ti <= upper) break;
  }

  // Pad breakdown with remaining empty brackets (so consumers can show full ladder)
  for (let i = breakdown.length; i < brackets.length; i++) {
    const [rate, lower] = brackets[i];
    const upper = i + 1 < brackets.length ? brackets[i + 1][1] : null;
    breakdown.push({ rate, lower, upper, taxableInBracket: 0, taxFromBracket: 0 });
  }

  const effectiveRate = ti > 0 ? tax / ti : 0;
  return { tax, effectiveRate, marginalRate, bracketBreakdown: breakdown };
}
