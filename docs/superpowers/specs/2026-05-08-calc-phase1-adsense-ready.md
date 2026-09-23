# calc.kdp.cool Phase 1 — AdSense-Ready Design Spec

**Date:** 2026-05-08
**Scope:** Get `calc.kdp.cool` to AdSense submission–ready content thickness while maintaining a competitive UX edge over NerdWallet / Bankrate / SmartAsset.
**Out of scope:** `convert/dev/text` subdomains (Phase 3), shared component library extraction (Phase 2), `kdp.cool` portal site (Phase 4).

## 1. Goal & Success Criteria

**Primary goal:** Earn AdSense approval and start generating ad revenue from US search traffic on financial calculator queries.

**Success metrics, in order:**
1. AdSense approval on first submission. Property submitted: `calc.kdp.cool`.
2. Core Web Vitals all green (LCP <2.5s, INP <200ms, **CLS = 0**).
3. Each calculator page indexable, with unique title/description/canonical/JSON-LD.
4. Build size <100KB JS per page (no framework overhead — Astro static + tiny vanilla `<script>`).

**Definition of done:**
- 5 calculator pages live: `/mortgage-calculator/`, `/auto-loan-calculator/`, `/compound-interest-calculator/`, `/paycheck-calculator/`, `/income-tax-calculator/`
- 4 brand/legal pages: `/privacy/`, `/terms/`, `/about/`, `/contact/`
- Homepage updated with all 5 calculator cards (no "coming soon")
- Sitemap auto-includes all 9 pages
- All math has unit tests (TDD); test count ≥25
- `npm run build` clean; `npm run preview` works; both pages return 200 from `https://calc.kdp.cool/<slug>/`
- AdSense application submitted to Google

## 2. Differentiation Strategy

Competitors are slow, ad-laden, and force submits. Our wedge:

| Differentiator | Effort | Phase |
| --- | --- | --- |
| **Instant-update inputs** (no submit button) | Already in code | P1 ✅ |
| **Zero-CLS ad placeholders** (fixed `min-height` reserves space) | Tiny | P1 ✅ |
| **URL state serialization** — every input change pushes a query-string snapshot; users can bookmark/share scenarios | Small (~30 lines util shared across pages) | P1 ✅ |
| **"Show the math" disclosure** — collapsible block on each result that prints the full step-by-step calculation (e.g., "$50,400 × 12% = $6,048 + $12,400 × 10% = $1,240 → $7,288 federal tax"). Massive SEO content depth + builds user trust. | Per-calc, ~30 min each | P1 ✅ |
| **Mobile-first** — input keyboards typed correctly, sticky bottom result bar so user sees output without scrolling | Tailwind only | P1 ✅ |
| **Scenario compare** (side-by-side: 60/72/84 mo loan, 15/30 yr mortgage, "$X cross 3 states") | Medium per calc | **P1.5** (post-AdSense) |
| **CSV / PDF export** of amortization schedules | Medium | P1.5 |
| **Cross-calculator profile** (localStorage shared income/state) | Medium | P1.5 |

**P1.5 = a follow-up sprint after AdSense submission** so we don't bloat the AdSense-ready scope. Submit AdSense as soon as P1 lands.

## 3. Pure Math Modules (`src/lib/`)

Every calculator's math is a pure function — same code is imported by the page's client `<script>` and by `node:test` test files. No framework hooks, no DOM. This is the existing pattern (`mortgage.js` + `mortgage.test.mjs`).

### 3.1 Primitives (DRY extraction)

**`amortization.js`** — etalon amortizing-loan math used by mortgage and auto loan.

```js
export function calcAmortizedLoan({ principal, annualRatePct, termMonths })
// returns { monthlyPayment, totalInterest, totalPaid }
```

**`federal-tax.js`** — 2026 IRS-published brackets and standard deductions (Rev. Proc. 2025-32). Used by income tax and paycheck calculators.

```js
export const TAX_DATA_2026 = {
  brackets: { single: [...], mfj: [...], mfs: [...], hoh: [...] },
  standardDeduction: { single: 16100, mfj: 32200, mfs: 16100, hoh: 24150 },
  ssWageBase: 184500,
  additionalMedicareThreshold: { single: 200000, hoh: 200000, mfj: 250000, mfs: 125000 },
};

export function calcFederalIncomeTax({ taxableIncome, filingStatus })
// returns { tax, effectiveRate, marginalRate, bracketBreakdown: [{rate, taxableInBracket, taxFromBracket}] }
```

`bracketBreakdown` is what the "Show the math" block consumes.

**Source comment in file header (mandatory):**
> Data: IRS Rev. Proc. 2025-32 (2025-10) — https://www.irs.gov/pub/irs-drop/rp-25-32.pdf
> Verified vs. Tax Foundation 2026 table — https://taxfoundation.org/data/all/federal/2026-tax-brackets/

### 3.2 Per-calculator modules

| Module | Depends on | Public function |
| --- | --- | --- |
| `mortgage.js` (refactor existing) | amortization | `calcMortgage(input)` — signature unchanged from current |
| `auto-loan.js` | amortization | `calcAutoLoan({ vehiclePrice, downPayment, tradeIn, salesTaxPct, annualRatePct, termMonths })` |
| `compound-interest.js` | — | `calcCompoundInterest({ principal, monthlyContribution, annualRatePct, years, compoundsPerYear })` returns `{ finalAmount, totalContributed, totalInterest, yearByYear: [{year, balance, totalContributed, totalInterest}] }` |
| `income-tax.js` | federal-tax | `calcIncomeTax({ income, filingStatus, deductionType, itemizedDeduction? })` returns `{ taxableIncome, federalTax, effectiveRate, marginalRate, bracketBreakdown, refundOrOwed?: number }` |
| `paycheck.js` | federal-tax | `calcPaycheck({ annualGross, filingStatus, payFrequency, statePct, deductions401kPct, deductionsPretaxAmt })` returns `{ perPeriod: { gross, federal, ss, medicare, addlMedicare, state, pretax, net }, annual: {...} }` |

### 3.3 Test plan (TDD, all `node:test`)

≥3 tests per module — happy path, boundary, edge case (zero rate, max bracket, etc.). For tax modules, include known IRS published example outcomes if possible.

Total expected ≥25 tests. `npm test` runs all of them via `node --test src/lib/*.test.mjs`.

## 4. Calculator Pages (`src/pages/<slug>/index.astro`)

### 4.1 Common page structure

All 5 pages use the same scaffold (already established by mortgage):

```
BaseLayout (title, description, canonical, JSON-LD WebApplication)
  CalculatorShell (title, intro)
    AdSense slot=top-ad     ← reserved 90px height, zero CLS
    [form]    slot=inputs
    [results] slot=results
    AdSense slot=middle-ad  ← reserved 250px height
    "How it works" + "Show the math" content slot
    AdSense slot=bottom-ad  ← reserved 90px height
  inline <script> wires inputs → math fn → DOM updates + URL state
```

**Zero-CLS contract:** every `<AdSense ... style="min-height:Npx" />` reserves vertical space matching the eventual ad. No layout shift when ads (or, currently, placeholder text) load.

**Mobile sticky result bar:** `<aside>` fixed-bottom on `<lg` viewports showing the primary metric (e.g., "Monthly: $2,565") so the user always sees their answer while scrolling inputs. Hidden on desktop (results are right-side anyway).

### 4.2 URL state util

Single shared utility used by all 5 page scripts:

```js
// src/lib/url-state.js
export function readState(defaults) { /* parse window.location.search merged with defaults */ }
export function writeState(state, opts = { replace: true }) { /* push/replace history.state w/ encoded query */ }
```

Behavior:
- On page load, read URL params and seed input values (overrides hard-coded defaults)
- On every `input` event, debounced 250ms, replaceState the URL with the current input snapshot
- Result: a user can copy-paste their tab URL to share a scenario

### 4.3 "Show the math" block

Collapsible `<details>` element after the result block. Pre-populated by the page script with a string built from the calc function's structured output (e.g., `bracketBreakdown` for tax). Native HTML disclosure — zero JS framework, zero CLS, works without JS as a degraded view.

For mortgage/auto loan: shows the formula `M = P · [r(1+r)^n] / [(1+r)^n − 1]` filled with actual numbers.
For compound interest: prints first 3 + last year of the year-by-year array.
For tax: prints each bracket: "First $24,800 × 10% = $2,480 → next ..."
For paycheck: prints the federal-tax breakdown plus FICA: "SS: $X × 6.2% = $Y (capped at wage base $184,500)".

This is **the content that converts AdSense from "thin" to "valuable"**. Each block contributes 200-400 words of dynamic, calculation-grounded content.

### 4.4 Charts

Inline SVG, no chart lib. Rendered into reserved-dimension SVG placeholders (zero CLS). All chart helpers in `src/lib/charts.js`:

```js
export function renderPie(svgEl, segments)        // segments: [{value, color, label}]
export function renderLineChart(svgEl, points, opts)  // points: [{x, y}], opts: {lineColor, fillColor, xLabels?}
```

| Page | Chart |
| --- | --- |
| mortgage | pie (P&I / Tax / Insurance) — already done; refactor inline → `renderPie` |
| auto loan | pie (Principal / Interest / Sales Tax / Fees) |
| compound interest | line (year-by-year balance) with second optional polyline for inflation-adjusted (deferred to P1.5 if not trivial) |
| paycheck | pie (Federal / FICA / State / Pretax / Net) |
| income tax | pie of effective vs. take-home + horizontal "bracket-stair" SVG: 7 colored segments laid end-to-end, each segment's width proportional to that bracket's $ range, with a vertical marker showing where the user's taxable income falls. Hovering/tapping a segment shows the rate and the dollars taxed in it. |

### 4.5 Per-page input/output details

#### `/mortgage-calculator/` (existing — minimal refactor)
- Inputs: home price, down payment ($/%), term (10/15/20/30), rate, property tax, home insurance
- Output: monthly P&I + tax + insurance, total monthly, loan amount
- Add: "Show the math" block; switch chart helper to shared `renderPie`; add URL state

#### `/auto-loan-calculator/`
- Inputs: vehicle price, down payment, trade-in value (default 0), sales tax % (default 7), term (months: 36/48/60/72/84), APR
- Output: monthly payment, total interest, total cost (price + interest + tax + fees), pie chart
- Math: `principal = vehiclePrice - downPayment - tradeIn + (vehiclePrice * salesTaxPct/100)` (NB: simple — does NOT model state-specific tax rules; document this in "Show the math")
- Defaults: $35,000 vehicle, $5,000 down, 0 trade-in, 7% tax, 60 mo, 7.5% APR

#### `/compound-interest-calculator/`
- Inputs: initial deposit, monthly contribution, annual rate %, years, compounding (monthly default; daily/annually selectable)
- Output: final balance, total contributed, total interest, year-by-year line chart
- Defaults: $10,000, $500/mo, 7%, 30 yr, monthly compounding
- "Show the math": prints the formula and 3 sample-year computations

#### `/paycheck-calculator/`
- Inputs: annual gross OR hourly+hours mode (start with annual gross only; hourly in P1.5), filing status (single/mfj/hoh/mfs), pay frequency (weekly/biweekly/semi-monthly/monthly), state tax % (flat user-entered — full state-by-state tables are P1.5), 401(k) % deferral, pretax deductions $/period (HSA/health)
- Output: per-period breakdown — gross / federal / SS / Medicare (incl. addl 0.9% if applicable) / state / pretax / net; annual totals; pie chart
- "Show the math": each tax line shown with formula and intermediate amounts; flag if Additional Medicare is being applied
- Defaults: $80,000 annual, single, biweekly, 5% state, 6% 401k, $0 pretax

#### `/income-tax-calculator/`
- Inputs: gross income, filing status, deduction (standard / itemized $ amount), W-2 withholding paid (optional, for refund-or-owe estimate)
- Output: taxable income, federal tax, effective rate, marginal rate, refund/owed if withholding entered, bracket-stair SVG with income marker, "Show the math" full bracket breakdown
- Defaults: $90,000, single, standard deduction
- Note: 2026 OBBBA-specific items (senior bonus deduction $6k for 65+, tip exclusion, OT exclusion) — flag in design but **defer to P1.5** to ship faster; mention in "How it works" content

## 5. Brand / Legal Pages (`src/pages/<slug>/index.astro`)

All four use BaseLayout with `schemaType="WebPage"` (extend BaseLayout enum).

### 5.1 `/privacy/` (Privacy Policy)
- Mandatory for AdSense. Must disclose: third-party cookies (Google AdSense), no personal data collection beyond CF Analytics, no email collection, GDPR/CCPA opt-out info.
- Use a simple template (write fresh; do not copy from another site). Length: ~500 words.

### 5.2 `/terms/` (Terms of Service)
- Calculator results are estimates, not financial advice. No warranty. User waives liability for decisions made on outputs. ~400 words.

### 5.3 `/about/`
- 1-screen story: who runs CalcKDP, why these calculators exist, methodology guarantees ("we cite source data"). ~250 words. Adds AdSense legitimacy.

### 5.4 `/contact/`
- Static `mailto:` link to a forwarding address. No form (forms need backend; CF Pages is static). Mention "feedback welcome" — sufficient for AdSense's "contactable" requirement.

## 6. Homepage Update (`src/pages/index.astro`)

Replace the calculators array with all 5 active entries. Add a 4-card secondary section linking to /privacy/, /terms/, /about/, /contact/ (low-prominence footer-ish but in main DOM for crawlability).

Footer (`BaseLayout.astro`) gains links to /privacy/ and /terms/ — already partially present; just promote them visually.

## 7. Refactoring Pass (Existing Code)

Done as the first step of implementation, before adding new calculators:

1. **Extract pie-chart code** out of `mortgage-calculator/index.astro` into `src/lib/charts.js`. Update mortgage page to import.
2. **Extract `calcAmortizedLoan`** primitive from `mortgage.js`; have `calcMortgage` call it. Update `mortgage.test.mjs` if necessary (it shouldn't need to change since `calcMortgage` signature is preserved).
3. **Add URL state util** (`src/lib/url-state.js`) and wire mortgage page to it (proves the pattern before replicating to other 4 calculators).
4. **Add "Show the math" block to mortgage** (proves the pattern).
5. **Add `WebPage` schema type to BaseLayout's `schemaType` prop.**

Treat steps 1-5 as the migration work. Then build the 4 new calculators using the proven shapes.

## 8. SEO Plan

Per-page targets (title / H1 / primary keyword):

| Page | `<title>` | Primary keyword |
| --- | --- | --- |
| / | Free Financial Calculators for US Home Buyers & Investors | financial calculators |
| /mortgage-calculator/ | Mortgage Calculator - Free Monthly Payment Calculator 2026 (existing) | mortgage calculator |
| /auto-loan-calculator/ | Auto Loan Calculator - Free Car Payment Estimator 2026 | auto loan calculator |
| /compound-interest-calculator/ | Compound Interest Calculator - Investment Growth 2026 | compound interest calculator |
| /paycheck-calculator/ | Paycheck Calculator - US Take-Home Pay 2026 | paycheck calculator |
| /income-tax-calculator/ | Income Tax Calculator - 2026 US Federal Tax Estimator | income tax calculator |

Every page already gets canonical, og:*, JSON-LD WebApplication via BaseLayout. No further per-page SEO work needed beyond filling those props correctly.

## 9. Build & Performance Budget

- Per-page JS shipped: <30KB gzipped (each page imports its own math + chart helpers + url-state util — total ~5KB minified each)
- Per-page CSS: shared Tailwind output, ~10KB gzipped after purge
- Images: only inline SVG (favicon, charts, bracket-stair) — no raster
- Fonts: system stack (`ui-sans-serif, system-ui, ...`) — no web-font load, no FOIT
- Core Web Vitals lab budget: LCP <1.5s, CLS = 0, INP <100ms

CF Pages serves the static `dist/` over CF's edge — TTFB <100ms globally.

## 10. AdSense Submission Checklist

After P1 ships:

1. ✅ ≥5 substantive content pages (5 calculators + 4 legal/about = 9 pages)
2. ✅ Privacy Policy live and linked from footer
3. ✅ About page describing site purpose
4. ✅ Contact mechanism present
5. ✅ Original content (no scraped text)
6. ✅ Site loads fast on mobile
7. Submit at https://www.google.com/adsense/start/ with `calc.kdp.cool` as the property
8. Add the `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-XXXXXXXXXXXXXXXX">` tag in `BaseLayout.astro` (line currently commented). Replace placeholder ID.
9. Wait for review (typically 1-14 days)
10. Once approved, replace `AdSense.astro` placeholder body with real `<ins class="adsbygoogle">` block + `(adsbygoogle = window.adsbygoogle || []).push({});` per slot.

## 11. Out of Scope (Phase 2-4)

- **Phase 2** (post AdSense approval): Extract `BaseLayout`, `AdSense`, `CalculatorShell`, `charts.js`, `url-state.js`, math primitives into `shared/` directory with Vite alias `@shared/*`. Each subdomain Astro project imports from `shared/`. Tailwind config in each site adds `../shared/**/*` to its content globs.
- **Phase 3**: Replicate calc-style scaffold to `convert/`, `dev/`, `text/` subdomain projects. 1-2 representative tools each. Deploy to its own CF Pages project + subdomain. Apply existing AdSense account to each.
- **Phase 4**: `kdp.cool` portal site (separate Astro project at root of monorepo). Single homepage cataloging all subdomain tools. Brand presence.
- **P1.5** (between Phase 1 ship and AdSense approval): scenario-compare on mortgage + auto-loan, CSV export of amortization, cross-calculator localStorage profile, OBBBA 2026 tax features (senior bonus, tip/OT exclusion), full state tax tables for paycheck.
