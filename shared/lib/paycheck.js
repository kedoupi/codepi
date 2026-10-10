import { calcFederalIncomeTax, TAX_DATA_2026 } from './federal-tax.js';

const PERIODS = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 };

/**
 * Compute US take-home pay.
 *
 * Federal taxable income = gross − 401(k) pretax − pretax other (HSA/health) − std deduction.
 * FICA: SS 6.2% on gross up to ssWageBase; Medicare 1.45% on full gross; Additional 0.9%
 * Medicare on wages above filingStatus threshold (employee-side reconciliation).
 * State: simple flat % of (gross − 401k pretax).
 *
 * @param {object} input
 * @param {number} input.annualGross
 * @param {'single'|'mfj'|'mfs'|'hoh'} input.filingStatus
 * @param {'weekly'|'biweekly'|'semimonthly'|'monthly'} input.payFrequency
 * @param {number} [input.statePct=0]
 * @param {number} [input.deductions401kPct=0]
 * @param {number} [input.deductionsPretaxAmt=0]   Annual additional pretax (HSA/health)
 * @returns {{ perPeriod: object, annual: object, monthlyPretaxOther: number }}
 */
export function calcPaycheck({
  annualGross,
  filingStatus,
  payFrequency,
  statePct = 0,
  deductions401kPct = 0,
  deductionsPretaxAmt = 0,
}) {
  const periods = PERIODS[payFrequency] || 26;
  const k401 = annualGross * (deductions401kPct / 100);
  const pretaxOther = Math.max(0, deductionsPretaxAmt);
  const stdDed = TAX_DATA_2026.standardDeduction[filingStatus] || 0;
  const taxableForFederal = Math.max(0, annualGross - k401 - pretaxOther - stdDed);
  const federal = calcFederalIncomeTax({ taxableIncome: taxableForFederal, filingStatus }).tax;

  const ssWages = Math.min(annualGross, TAX_DATA_2026.ssWageBase);
  const ss = ssWages * TAX_DATA_2026.ssRateEmployee;
  const medicare = annualGross * TAX_DATA_2026.medicareRate;
  const addlThreshold = TAX_DATA_2026.additionalMedicareThreshold[filingStatus] ?? 200000;
  const addlMedicare = Math.max(0, annualGross - addlThreshold) * TAX_DATA_2026.additionalMedicareRate;

  const stateBasis = Math.max(0, annualGross - k401 - pretaxOther);
  const state = stateBasis * (statePct / 100);

  const annual = {
    gross: annualGross,
    pretax401k: k401,
    pretaxOther,
    federal,
    ss,
    medicare,
    addlMedicare,
    state,
    net: annualGross - k401 - pretaxOther - federal - ss - medicare - addlMedicare - state,
  };

  const perPeriod = Object.fromEntries(
    Object.entries(annual).map(([k, v]) => [k, v / periods]),
  );

  return { perPeriod, annual, monthlyPretaxOther: pretaxOther / 12 };
}
