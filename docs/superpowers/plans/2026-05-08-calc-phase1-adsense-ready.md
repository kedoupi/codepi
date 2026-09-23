# calc.kdp.cool Phase 1 — AdSense-Ready Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 4 new calculators (auto-loan, compound-interest, paycheck, income-tax), 4 brand/legal pages (privacy, terms, about, contact), refactor existing mortgage page onto shared primitives (amortization, federal-tax, charts, url-state), and add "Show the math" disclosure to make `calc.kdp.cool` AdSense-submission-ready.

**Architecture:** Astro static. Pure JS math modules in `calc/src/lib/`, each with a `node:test` unit test. Pages compose `BaseLayout` + `CalculatorShell` + `AdSense`. Inline `<script>` per page imports its math module + shared `charts.js` + `url-state.js`. Zero CLS via fixed-dimension reservation on ad slots and SVG charts. URL state serialization on every input change for shareable scenarios. "Show the math" block printed by the page script from the math function's structured output.

**Tech Stack:** Astro 6.3, Tailwind v3, `node:test`, vanilla `<script>`, inline SVG, `@astrojs/sitemap`. No new deps.

**Working directory for all commands:** `<workspace>/Coding/kedoupi/kdp-tools/calc`

**Spec reference:** `docs/superpowers/specs/2026-05-08-calc-phase1-adsense-ready.md`

**Conventions:**
- Each math module is pure — no DOM, no `window`, ESM `export`.
- All money/rate values: numbers in JS units (USD, percent as 6.5 not 0.065 unless noted).
- Tests live next to source: `src/lib/<module>.js` + `src/lib/<module>.test.mjs`.
- `npm test` runs all tests via `node --test src/lib/*.test.mjs`.
- Frequent commits — one commit per task minimum.

---

## File map

### Created

```
src/lib/amortization.js              src/lib/amortization.test.mjs
src/lib/charts.js                    (no test — visual)
src/lib/url-state.js                 src/lib/url-state.test.mjs
src/lib/federal-tax.js               src/lib/federal-tax.test.mjs
src/lib/auto-loan.js                 src/lib/auto-loan.test.mjs
src/lib/compound-interest.js         src/lib/compound-interest.test.mjs
src/lib/income-tax.js                src/lib/income-tax.test.mjs
src/lib/paycheck.js                  src/lib/paycheck.test.mjs
src/pages/auto-loan-calculator/index.astro
src/pages/compound-interest-calculator/index.astro
src/pages/paycheck-calculator/index.astro
src/pages/income-tax-calculator/index.astro
src/pages/privacy/index.astro
src/pages/terms/index.astro
src/pages/about/index.astro
src/pages/contact/index.astro
```

### Modified

```
src/lib/mortgage.js                  (use calcAmortizedLoan primitive)
src/pages/mortgage-calculator/index.astro  (use charts.js, url-state.js, "Show the math")
src/pages/index.astro                (5 active cards + legal section)
src/layouts/BaseLayout.astro         (add 'WebPage' to schemaType union; promote /privacy, /terms in footer)
```

---

## Task 1: Extract `calcAmortizedLoan` primitive

**Files:**
- Create: `src/lib/amortization.js`
- Create: `src/lib/amortization.test.mjs`
- Modify: `src/lib/mortgage.js`

- [ ] **Step 1: Write failing test**

`src/lib/amortization.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcAmortizedLoan } from './amortization.js';

test('30-year fixed at 6.5% on $320k principal', () => {
  const r = calcAmortizedLoan({ principal: 320000, annualRatePct: 6.5, termMonths: 360 });
  assert.equal(Math.round(r.monthlyPayment), 2023);
  assert.equal(Math.round(r.totalInterest), Math.round(2023 * 360 - 320000));
  assert.equal(Math.round(r.totalPaid), Math.round(2023 * 360));
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
```

- [ ] **Step 2: Run test, confirm fail**

```bash
cd <workspace>/Coding/kedoupi/kdp-tools/calc && node --test src/lib/amortization.test.mjs
```

Expected: `ERR_MODULE_NOT_FOUND` (file doesn't exist).

- [ ] **Step 3: Implement primitive**

`src/lib/amortization.js`:

```js
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
```

- [ ] **Step 4: Run test, confirm pass**

```bash
cd <workspace>/Coding/kedoupi/kdp-tools/calc && node --test src/lib/amortization.test.mjs
```

Expected: 4/4 pass.

- [ ] **Step 5: Refactor `mortgage.js` to use the primitive**

Replace the body of `src/lib/mortgage.js` with:

```js
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
```

- [ ] **Step 6: Run all tests, confirm both modules pass**

```bash
cd <workspace>/Coding/kedoupi/kdp-tools/calc && npm test
```

Expected: 7/7 pass (4 new amortization + 3 existing mortgage).

- [ ] **Step 7: Commit**

```bash
git add calc/src/lib/amortization.js calc/src/lib/amortization.test.mjs calc/src/lib/mortgage.js && \
git -C <workspace>/Coding/kedoupi/kdp-tools commit -m "$(cat <<'EOF'
refactor(calc): extract calcAmortizedLoan primitive; mortgage delegates to it

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && git -C <workspace>/Coding/kedoupi/kdp-tools push
```

---

## Task 2: Add chart helpers `charts.js`

**Files:**
- Create: `src/lib/charts.js`
- Modify: `src/pages/mortgage-calculator/index.astro`

- [ ] **Step 1: Create `src/lib/charts.js`**

```js
/**
 * Render a pie chart into an SVG element using path arcs.
 * Reserved viewBox: 100×100 (cx=50, cy=50, r=40).
 *
 * @param {SVGElement} svgEl
 * @param {Array<{value:number,color:string,label?:string}>} segments
 */
export function renderPie(svgEl, segments) {
  const total = segments.reduce((s, p) => s + p.value, 0);
  const cx = 50, cy = 50, r = 40;
  if (!total) {
    svgEl.innerHTML = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#e2e8f0"/>`;
    return;
  }
  const positives = segments.filter((p) => p.value > 0);
  if (positives.length === 1) {
    svgEl.innerHTML = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${positives[0].color}"/>`;
    return;
  }
  let acc = 0;
  const paths = segments.map((p) => {
    if (p.value <= 0) return '';
    const start = (acc / total) * Math.PI * 2 - Math.PI / 2;
    acc += p.value;
    const end = (acc / total) * Math.PI * 2 - Math.PI / 2;
    const x1 = cx + r * Math.cos(start);
    const y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(end);
    const y2 = cy + r * Math.sin(end);
    const large = end - start > Math.PI ? 1 : 0;
    return `<path d="M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z" fill="${p.color}"/>`;
  }).join('');
  svgEl.innerHTML = paths;
}

/**
 * Render a line chart with optional area fill into an SVG element.
 * Reserved viewBox: 200×100 (auto-scales x and y to fit).
 *
 * @param {SVGElement} svgEl
 * @param {Array<{x:number,y:number}>} points
 * @param {{ lineColor?: string, fillColor?: string, xLabels?: string[] }} [opts]
 */
export function renderLineChart(svgEl, points, opts = {}) {
  if (!points || points.length < 2) { svgEl.innerHTML = ''; return; }
  const lineColor = opts.lineColor || '#2563eb';
  const fillColor = opts.fillColor || 'rgba(37,99,235,0.15)';
  const W = 200, H = 100, padL = 4, padR = 4, padT = 4, padB = 14;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMax = Math.max(...ys, 1);
  const sx = (x) => padL + ((x - xMin) / (xMax - xMin || 1)) * (W - padL - padR);
  const sy = (y) => H - padB - (y / yMax) * (H - padT - padB);
  const linePts = points.map((p) => `${sx(p.x).toFixed(2)},${sy(p.y).toFixed(2)}`).join(' ');
  const areaPts = `${sx(xMin)},${H - padB} ${linePts} ${sx(xMax)},${H - padB}`;
  let labelEls = '';
  if (opts.xLabels && opts.xLabels.length) {
    const step = Math.max(1, Math.floor(opts.xLabels.length / 4));
    labelEls = opts.xLabels.map((lbl, i) => {
      if (i % step !== 0 && i !== opts.xLabels.length - 1) return '';
      const x = sx(points[i]?.x ?? i);
      return `<text x="${x.toFixed(1)}" y="${H - 2}" font-size="6" text-anchor="middle" fill="#64748b">${lbl}</text>`;
    }).join('');
  }
  svgEl.innerHTML = `
    <polygon points="${areaPts}" fill="${fillColor}" />
    <polyline points="${linePts}" fill="none" stroke="${lineColor}" stroke-width="1.5" />
    ${labelEls}
  `.trim();
}
```

- [ ] **Step 2: Refactor mortgage page to import `renderPie`**

In `src/pages/mortgage-calculator/index.astro`, find the inline `<script>` block. Locate the local `renderChart` function (the pie-drawing one) and the line that calls it. Replace as follows:

a. **Add this import as the FIRST line inside `<script>`** (before the existing `import { calcMortgage }`):

```js
import { renderPie } from '../../lib/charts.js';
```

b. **Delete** the local `renderChart` function (the entire `function renderChart(parts) { ... }` block).

c. **In `update()`**, replace the line that called `renderChart([...])` with:

```js
renderPie(document.getElementById('r-chart'), [
  { value: out.monthlyPI,        color: '#2563eb', label: 'P&I' },
  { value: out.monthlyTax,       color: '#10b981', label: 'Tax' },
  { value: out.monthlyInsurance, color: '#f59e0b', label: 'Insurance' },
]);
```

- [ ] **Step 3: Build & smoke test**

```bash
cd <workspace>/Coding/kedoupi/kdp-tools/calc && npm run build
```

Expected: build succeeds, `dist/mortgage-calculator/index.html` produced.

```bash
grep -c 'r-chart' dist/mortgage-calculator/index.html
```

Expected: ≥1 (the SVG element is in the output).

- [ ] **Step 4: Commit**

```bash
git -C <workspace>/Coding/kedoupi/kdp-tools add calc/src/lib/charts.js calc/src/pages/mortgage-calculator/index.astro && \
git -C <workspace>/Coding/kedoupi/kdp-tools commit -m "$(cat <<'EOF'
refactor(calc): extract renderPie + renderLineChart into src/lib/charts.js

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && git -C <workspace>/Coding/kedoupi/kdp-tools push
```

---

## Task 3: URL state utility

**Files:**
- Create: `src/lib/url-state.js`
- Create: `src/lib/url-state.test.mjs`

- [ ] **Step 1: Write failing test**

`src/lib/url-state.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeState, decodeState } from './url-state.js';

test('encode primitives to query string', () => {
  const s = encodeState({ homePrice: 400000, downMode: 'percent', termYears: 30, rate: 6.5 });
  // Order-independent — parse it back
  const params = new URLSearchParams(s);
  assert.equal(params.get('homePrice'), '400000');
  assert.equal(params.get('downMode'), 'percent');
  assert.equal(params.get('termYears'), '30');
  assert.equal(params.get('rate'), '6.5');
});

test('decode query string with defaults', () => {
  const r = decodeState('?homePrice=500000&rate=7', { homePrice: 100000, rate: 5, termYears: 30 });
  assert.equal(r.homePrice, 500000);
  assert.equal(r.rate, 7);
  assert.equal(r.termYears, 30); // fell back to default
});

test('decode preserves string defaults', () => {
  const r = decodeState('?downMode=amount', { downMode: 'percent', label: 'hello' });
  assert.equal(r.downMode, 'amount');
  assert.equal(r.label, 'hello');
});

test('decode without leading "?" works', () => {
  const r = decodeState('homePrice=200000', { homePrice: 100000 });
  assert.equal(r.homePrice, 200000);
});

test('encode skips undefined and null', () => {
  const s = encodeState({ a: 1, b: undefined, c: null, d: 'x' });
  const params = new URLSearchParams(s);
  assert.equal(params.get('a'), '1');
  assert.equal(params.has('b'), false);
  assert.equal(params.has('c'), false);
  assert.equal(params.get('d'), 'x');
});
```

- [ ] **Step 2: Run test, confirm fail**

```bash
cd <workspace>/Coding/kedoupi/kdp-tools/calc && node --test src/lib/url-state.test.mjs
```

Expected: ERR_MODULE_NOT_FOUND.

- [ ] **Step 3: Implement**

`src/lib/url-state.js`:

```js
/**
 * Encode a flat object of primitives to a URL query string (no leading "?").
 * undefined and null values are omitted. Numbers and strings are stringified.
 *
 * @param {Record<string, string|number|boolean|null|undefined>} state
 * @returns {string}
 */
export function encodeState(state) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(state)) {
    if (v === undefined || v === null) continue;
    params.set(k, String(v));
  }
  return params.toString();
}

/**
 * Decode a URL query string (with or without leading "?"), merging into defaults.
 * For each default value, the type guides parsing: numeric defaults yield numbers,
 * string defaults yield strings, boolean defaults yield booleans.
 *
 * @template T
 * @param {string} qs
 * @param {T} defaults
 * @returns {T}
 */
export function decodeState(qs, defaults) {
  const cleaned = (qs || '').replace(/^\?/, '');
  const params = new URLSearchParams(cleaned);
  const out = { ...defaults };
  for (const key of Object.keys(defaults)) {
    if (!params.has(key)) continue;
    const raw = params.get(key);
    const def = defaults[key];
    if (typeof def === 'number') {
      const n = Number(raw);
      out[key] = Number.isFinite(n) ? n : def;
    } else if (typeof def === 'boolean') {
      out[key] = raw === 'true' || raw === '1';
    } else {
      out[key] = raw;
    }
  }
  return out;
}

/**
 * Browser-side: replaceState the URL with the encoded query string.
 * Debounce in the caller; this just performs the swap.
 *
 * @param {Record<string, any>} state
 */
export function pushUrlState(state) {
  if (typeof window === 'undefined') return;
  const qs = encodeState(state);
  const newUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(null, '', newUrl);
}
```

- [ ] **Step 4: Run test, confirm pass**

```bash
cd <workspace>/Coding/kedoupi/kdp-tools/calc && node --test src/lib/url-state.test.mjs
```

Expected: 5/5 pass.

- [ ] **Step 5: Commit**

```bash
git -C <workspace>/Coding/kedoupi/kdp-tools add calc/src/lib/url-state.js calc/src/lib/url-state.test.mjs && \
git -C <workspace>/Coding/kedoupi/kdp-tools commit -m "$(cat <<'EOF'
feat(calc): add url-state util for shareable scenario URLs

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && git -C <workspace>/Coding/kedoupi/kdp-tools push
```

---

## Task 4: Wire URL state + "Show the math" into mortgage page

**Files:**
- Modify: `src/pages/mortgage-calculator/index.astro`

- [ ] **Step 1: Add Show-the-math section to markup**

In `src/pages/mortgage-calculator/index.astro`, **inside the `<div slot="content">` block**, AFTER the existing `<p>Property tax and home insurance...</p>` paragraph, append:

```astro
      <details class="mt-6 group">
        <summary class="cursor-pointer text-sm font-medium text-blue-700 hover:text-blue-800">Show the math</summary>
        <div id="show-math" class="mt-3 text-sm text-slate-700 leading-relaxed bg-slate-50 border border-slate-200 rounded p-4 font-mono"></div>
      </details>
```

- [ ] **Step 2: Update inline `<script>` to read URL, write URL, and populate Show-the-math**

In the inline `<script>` block, **add `decodeState`, `pushUrlState` to the imports** at the top:

```js
import { calcMortgage } from '../../lib/mortgage.js';
import { renderPie } from '../../lib/charts.js';
import { decodeState, pushUrlState } from '../../lib/url-state.js';
```

**Replace the `let downMode = 'percent';` line** with:

```js
const DEFAULTS = {
  homePrice: 400000,
  downValue: 20,         // value in current downMode
  downMode: 'percent',   // 'percent' | 'amount'
  termYears: 30,
  rate: 6.5,
  tax: 5000,
  ins: 1500,
};

const initial = decodeState(window.location.search, DEFAULTS);
let downMode = initial.downMode;
homePriceInput.value = String(initial.homePrice);
downInput.value = String(initial.downValue);
document.getElementById('rate').value = String(initial.rate);
document.getElementById('tax').value = String(initial.tax);
document.getElementById('ins').value = String(initial.ins);
termInput.value = String(initial.termYears);
downPrefix.textContent = downMode === 'percent' ? '%' : '$';
// Sync term-button visual state to initial.termYears
document.querySelectorAll('.term-btn').forEach((b) => {
  const active = String(b.dataset.term) === String(initial.termYears);
  b.classList.toggle('bg-blue-600', active);
  b.classList.toggle('text-white', active);
  b.classList.toggle('border-blue-600', active);
  b.classList.toggle('bg-white', !active);
  b.classList.toggle('border-slate-300', !active);
});
// Sync down-toggle visual state
document.querySelectorAll('.down-toggle').forEach((b) => {
  const active = b.dataset.downMode === downMode;
  b.classList.toggle('bg-blue-600', active);
  b.classList.toggle('text-white', active);
  b.classList.toggle('bg-slate-200', !active);
  b.classList.toggle('text-slate-700', !active);
});
```

**Define a debounce-wrapped URL-syncer.** Add this just below the block above:

```js
let urlTimer;
function syncUrl() {
  clearTimeout(urlTimer);
  urlTimer = setTimeout(() => {
    pushUrlState({
      homePrice: +homePriceInput.value || 0,
      downValue: +downInput.value || 0,
      downMode,
      termYears: +termInput.value || 30,
      rate: +document.getElementById('rate').value || 0,
      tax: +document.getElementById('tax').value || 0,
      ins: +document.getElementById('ins').value || 0,
    });
  }, 250);
}
```

**Inside `update()`**, after the existing `renderPie(...)` call, add the Show-the-math population:

```js
const months = inputs.termYears * 12;
const r = inputs.annualRatePct / 100 / 12;
const showMath = document.getElementById('show-math');
showMath.innerHTML = `
P (loan principal) = $${inputs.homePrice.toLocaleString()} − $${inputs.downPayment.toLocaleString()} = $${out.loanPrincipal.toLocaleString()}<br>
r (monthly rate) = ${inputs.annualRatePct}% ÷ 12 = ${(r * 100).toFixed(4)}%<br>
n (months) = ${inputs.termYears} × 12 = ${months}<br>
M = P · [r(1+r)<sup>n</sup>] / [(1+r)<sup>n</sup> − 1] = <strong>$${out.monthlyPI.toFixed(2)}</strong><br>
+ tax/12 = $${(inputs.annualPropertyTax/12).toFixed(2)} + insurance/12 = $${(inputs.annualInsurance/12).toFixed(2)}<br>
<strong>Total monthly = $${out.monthlyTotal.toFixed(2)}</strong>
`.trim();
syncUrl();
```

(`syncUrl()` runs every time inputs change because `update()` is the central handler. The 250ms debounce inside `syncUrl` guards against excessive `replaceState` calls.)

- [ ] **Step 2.5: Remove the old single initial `update()` line and confirm there's still one at the bottom**

The file already ends with `update();` at the very end of the script (initial render). Keep that — it now triggers a render with the URL-decoded inputs.

- [ ] **Step 3: Build & smoke test**

```bash
cd <workspace>/Coding/kedoupi/kdp-tools/calc && npm run build
grep -c 'show-math' dist/mortgage-calculator/index.html
```

Expected: build succeeds; grep returns ≥1.

- [ ] **Step 4: Manual visual check (background preview)**

```bash
cd <workspace>/Coding/kedoupi/kdp-tools/calc && npm run preview &
sleep 2
curl -s "http://localhost:4321/mortgage-calculator/?homePrice=600000&rate=5&termYears=15" -o /dev/null -w "%{http_code}\n"
```

Expected: `200`. (The page should load with overridden defaults — verify in browser if you want; otherwise proceed.)

```bash
pkill -f 'astro preview' || true
```

- [ ] **Step 5: Commit**

```bash
git -C <workspace>/Coding/kedoupi/kdp-tools add calc/src/pages/mortgage-calculator/index.astro && \
git -C <workspace>/Coding/kedoupi/kdp-tools commit -m "$(cat <<'EOF'
feat(calc): mortgage page reads/writes URL state and shows the math

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && git -C <workspace>/Coding/kedoupi/kdp-tools push
```

---

## Task 5: Add `WebPage` schema to BaseLayout

**Files:**
- Modify: `src/layouts/BaseLayout.astro`

- [ ] **Step 1: Update Props interface and JSON-LD**

In `src/layouts/BaseLayout.astro`, find:

```ts
schemaType?: 'WebApplication' | 'WebSite';
```

Replace with:

```ts
schemaType?: 'WebApplication' | 'WebSite' | 'WebPage';
```

In the `jsonLd` object, the existing line is:

```ts
...(schemaType === 'WebApplication' ? { applicationCategory: 'FinanceApplication' } : {}),
```

Keep that — it correctly only adds `applicationCategory` for `WebApplication`, leaving plain `WebPage` clean.

- [ ] **Step 2: Promote /privacy and /terms in footer**

In the same file, find the `<footer>` block ending in `</footer>`. **Replace** the `<p>Results are estimates only. Not financial advice.</p>` line with:

```astro
      <p class="flex items-center gap-3">
        <span>Results are estimates only. Not financial advice.</span>
        <span aria-hidden="true" class="text-slate-300">·</span>
        <a href="/privacy/" class="hover:text-slate-700">Privacy</a>
        <a href="/terms/" class="hover:text-slate-700">Terms</a>
        <a href="/about/" class="hover:text-slate-700">About</a>
        <a href="/contact/" class="hover:text-slate-700">Contact</a>
      </p>
```

- [ ] **Step 3: Build to verify**

```bash
cd <workspace>/Coding/kedoupi/kdp-tools/calc && npm run build
```

Expected: build succeeds. The footer links will 404 in `dist/` until Tasks 14-17 land — that's expected and not a build error (they're just `<a>` tags).

- [ ] **Step 4: Commit**

```bash
git -C <workspace>/Coding/kedoupi/kdp-tools add calc/src/layouts/BaseLayout.astro && \
git -C <workspace>/Coding/kedoupi/kdp-tools commit -m "$(cat <<'EOF'
feat(calc): support WebPage schema; add legal links to footer

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && git -C <workspace>/Coding/kedoupi/kdp-tools push
```

---

## Task 6: Federal income tax primitive

**Files:**
- Create: `src/lib/federal-tax.js`
- Create: `src/lib/federal-tax.test.mjs`

- [ ] **Step 1: Write failing test**

`src/lib/federal-tax.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcFederalIncomeTax, TAX_DATA_2026 } from './federal-tax.js';

test('zero income → zero tax', () => {
  const r = calcFederalIncomeTax({ taxableIncome: 0, filingStatus: 'single' });
  assert.equal(r.tax, 0);
  assert.equal(r.effectiveRate, 0);
  assert.equal(r.marginalRate, 0.10);
});

test('single $33,900 taxable (entirely in 10% + 12% brackets)', () => {
  // 12,400 × 10% = 1,240; (33,900 − 12,400) × 12% = 2,580; total = 3,820
  const r = calcFederalIncomeTax({ taxableIncome: 33900, filingStatus: 'single' });
  assert.equal(Math.round(r.tax), 3820);
  assert.equal(r.marginalRate, 0.12);
  assert.ok(Math.abs(r.effectiveRate - (3820 / 33900)) < 1e-6);
  // 2 active brackets in breakdown
  assert.equal(r.bracketBreakdown.filter((b) => b.taxFromBracket > 0).length, 2);
});

test('single $200,000 taxable straddles 24% bracket', () => {
  // 10%×12400 + 12%×38000 + 22%×55300 + 24%×(200000-105700)
  // = 1240 + 4560 + 12166 + 22632 = 40598
  const r = calcFederalIncomeTax({ taxableIncome: 200000, filingStatus: 'single' });
  assert.equal(Math.round(r.tax), 40598);
  assert.equal(r.marginalRate, 0.24);
});

test('MFJ $167,800 taxable in 22% bracket', () => {
  // 10%×24800 + 12%×76000 + 22%×(167800-100800)
  // = 2480 + 9120 + 14740 = 26340
  const r = calcFederalIncomeTax({ taxableIncome: 167800, filingStatus: 'mfj' });
  assert.equal(Math.round(r.tax), 26340);
  assert.equal(r.marginalRate, 0.22);
});

test('top-bracket marginal rate', () => {
  const r = calcFederalIncomeTax({ taxableIncome: 1000000, filingStatus: 'single' });
  assert.equal(r.marginalRate, 0.37);
});

test('TAX_DATA_2026 has all four filing statuses', () => {
  assert.ok(TAX_DATA_2026.brackets.single.length >= 7);
  assert.ok(TAX_DATA_2026.brackets.mfj.length >= 7);
  assert.ok(TAX_DATA_2026.brackets.mfs.length >= 7);
  assert.ok(TAX_DATA_2026.brackets.hoh.length >= 7);
  assert.equal(TAX_DATA_2026.standardDeduction.single, 16100);
  assert.equal(TAX_DATA_2026.standardDeduction.mfj, 32200);
  assert.equal(TAX_DATA_2026.ssWageBase, 184500);
});
```

- [ ] **Step 2: Run, confirm fail**

```bash
cd <workspace>/Coding/kedoupi/kdp-tools/calc && node --test src/lib/federal-tax.test.mjs
```

Expected: ERR_MODULE_NOT_FOUND.

- [ ] **Step 3: Implement**

`src/lib/federal-tax.js`:

```js
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
```

- [ ] **Step 4: Run, confirm pass**

```bash
cd <workspace>/Coding/kedoupi/kdp-tools/calc && node --test src/lib/federal-tax.test.mjs
```

Expected: 6/6 pass.

- [ ] **Step 5: Commit**

```bash
git -C <workspace>/Coding/kedoupi/kdp-tools add calc/src/lib/federal-tax.js calc/src/lib/federal-tax.test.mjs && \
git -C <workspace>/Coding/kedoupi/kdp-tools commit -m "$(cat <<'EOF'
feat(calc): federal-tax primitive with 2026 IRS Rev. Proc. 2025-32 data

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && git -C <workspace>/Coding/kedoupi/kdp-tools push
```

---

## Task 7: Auto-loan math module

**Files:**
- Create: `src/lib/auto-loan.js`
- Create: `src/lib/auto-loan.test.mjs`

- [ ] **Step 1: Write failing test**

`src/lib/auto-loan.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcAutoLoan } from './auto-loan.js';

test('$30k vehicle, $5k down, 7.5% APR, 60 months, 7% sales tax, no trade', () => {
  const r = calcAutoLoan({
    vehiclePrice: 30000, downPayment: 5000, tradeIn: 0,
    salesTaxPct: 7, annualRatePct: 7.5, termMonths: 60,
  });
  // salesTax = 30000 × 7% = 2100
  // principal = 30000 - 5000 - 0 + 2100 = 27100
  assert.equal(r.salesTax, 2100);
  assert.equal(r.principal, 27100);
  // monthlyPayment ≈ amortization on $27,100 @ 7.5% / 60mo ≈ $543.03
  assert.ok(Math.abs(r.monthlyPayment - 543.03) < 1);
});

test('trade-in reduces principal', () => {
  const r = calcAutoLoan({
    vehiclePrice: 40000, downPayment: 0, tradeIn: 8000,
    salesTaxPct: 0, annualRatePct: 6, termMonths: 60,
  });
  assert.equal(r.principal, 32000);
});

test('zero APR → straight-line', () => {
  const r = calcAutoLoan({
    vehiclePrice: 24000, downPayment: 4000, tradeIn: 0,
    salesTaxPct: 0, annualRatePct: 0, termMonths: 60,
  });
  // principal = 20000; monthlyPayment = 20000 / 60 ≈ 333.33
  assert.ok(Math.abs(r.monthlyPayment - 333.33) < 0.01);
  assert.equal(r.totalInterest, 0);
});

test('output object has expected shape', () => {
  const r = calcAutoLoan({
    vehiclePrice: 30000, downPayment: 5000, tradeIn: 0,
    salesTaxPct: 7, annualRatePct: 7.5, termMonths: 60,
  });
  assert.ok('principal' in r && 'salesTax' in r && 'monthlyPayment' in r && 'totalInterest' in r && 'totalPaid' in r && 'totalCost' in r);
});
```

- [ ] **Step 2: Run, confirm fail**

```bash
cd <workspace>/Coding/kedoupi/kdp-tools/calc && node --test src/lib/auto-loan.test.mjs
```

Expected: ERR_MODULE_NOT_FOUND.

- [ ] **Step 3: Implement**

`src/lib/auto-loan.js`:

```js
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
```

- [ ] **Step 4: Run, confirm pass**

```bash
cd <workspace>/Coding/kedoupi/kdp-tools/calc && node --test src/lib/auto-loan.test.mjs
```

Expected: 4/4 pass.

- [ ] **Step 5: Commit**

```bash
git -C <workspace>/Coding/kedoupi/kdp-tools add calc/src/lib/auto-loan.js calc/src/lib/auto-loan.test.mjs && \
git -C <workspace>/Coding/kedoupi/kdp-tools commit -m "$(cat <<'EOF'
feat(calc): auto-loan math (delegates to amortization primitive)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && git -C <workspace>/Coding/kedoupi/kdp-tools push
```

---

## Task 8: Auto-loan calculator page

**Files:**
- Create: `src/pages/auto-loan-calculator/index.astro`

- [ ] **Step 1: Create the page**

`src/pages/auto-loan-calculator/index.astro`:

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
import CalculatorShell from '../../components/CalculatorShell.astro';
import AdSense from '../../components/AdSense.astro';

const title = 'Auto Loan Calculator - Free Car Payment Estimator 2026';
const description = 'Calculate your auto loan monthly payment instantly. Enter vehicle price, down payment, trade-in, sales tax, APR and term. Free car loan calculator for US buyers.';
---
<BaseLayout title={title} description={description} pathname="/auto-loan-calculator/">
  <CalculatorShell
    title="Auto Loan Calculator"
    intro="Estimate your monthly car payment, total interest, and out-the-door cost. Includes sales tax on the vehicle price."
  >
    <AdSense slot="top-ad" adSlot="autoloan-top" style="min-height:90px" />

    <form id="al-form" class="space-y-5" slot="inputs" autocomplete="off">
      <div>
        <label for="al-price" class="block text-sm font-medium text-slate-700 mb-1">Vehicle Price</label>
        <div class="relative">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
          <input id="al-price" name="vehiclePrice" type="number" min="0" step="500" value="35000"
                 class="w-full pl-7 pr-3 py-2 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      <div class="grid grid-cols-2 gap-4">
        <div>
          <label for="al-down" class="block text-sm font-medium text-slate-700 mb-1">Down Payment</label>
          <div class="relative">
            <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
            <input id="al-down" type="number" min="0" step="500" value="5000"
                   class="w-full pl-7 pr-3 py-2 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
        <div>
          <label for="al-trade" class="block text-sm font-medium text-slate-700 mb-1">Trade-in Value</label>
          <div class="relative">
            <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
            <input id="al-trade" type="number" min="0" step="500" value="0"
                   class="w-full pl-7 pr-3 py-2 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
      </div>

      <div>
        <span class="block text-sm font-medium text-slate-700 mb-1">Loan Term</span>
        <div class="grid grid-cols-5 gap-2">
          <button type="button" data-term="36" class="al-term-btn py-2 rounded border border-slate-300 bg-white text-sm">36 mo</button>
          <button type="button" data-term="48" class="al-term-btn py-2 rounded border border-slate-300 bg-white text-sm">48 mo</button>
          <button type="button" data-term="60" class="al-term-btn py-2 rounded border-blue-600 bg-blue-600 text-white text-sm">60 mo</button>
          <button type="button" data-term="72" class="al-term-btn py-2 rounded border border-slate-300 bg-white text-sm">72 mo</button>
          <button type="button" data-term="84" class="al-term-btn py-2 rounded border border-slate-300 bg-white text-sm">84 mo</button>
        </div>
        <input type="hidden" id="al-term" value="60" />
      </div>

      <div class="grid grid-cols-2 gap-4">
        <div>
          <label for="al-rate" class="block text-sm font-medium text-slate-700 mb-1">APR</label>
          <div class="relative">
            <input id="al-rate" type="number" min="0" step="0.01" value="7.5"
                   class="w-full pr-7 pl-3 py-2 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <span class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">%</span>
          </div>
        </div>
        <div>
          <label for="al-tax" class="block text-sm font-medium text-slate-700 mb-1">Sales Tax</label>
          <div class="relative">
            <input id="al-tax" type="number" min="0" step="0.1" value="7"
                   class="w-full pr-7 pl-3 py-2 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <span class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">%</span>
          </div>
        </div>
      </div>
    </form>

    <div slot="results" class="space-y-5">
      <div>
        <p class="text-sm uppercase tracking-wider text-slate-500">Monthly Payment</p>
        <p id="al-r-monthly" class="text-4xl sm:text-5xl font-bold text-slate-900 tabular-nums">$0</p>
      </div>

      <div class="flex items-center gap-5">
        <svg id="al-chart" viewBox="0 0 100 100" class="w-32 h-32 shrink-0" aria-label="Cost breakdown"></svg>
        <ul class="text-sm space-y-1.5 flex-1">
          <li class="flex items-center justify-between gap-3">
            <span class="flex items-center gap-2"><i class="w-3 h-3 rounded-sm bg-blue-600 inline-block"></i>Principal</span>
            <span id="al-r-principal" class="tabular-nums font-medium">$0</span>
          </li>
          <li class="flex items-center justify-between gap-3">
            <span class="flex items-center gap-2"><i class="w-3 h-3 rounded-sm bg-amber-500 inline-block"></i>Total Interest</span>
            <span id="al-r-interest" class="tabular-nums font-medium">$0</span>
          </li>
          <li class="flex items-center justify-between gap-3">
            <span class="flex items-center gap-2"><i class="w-3 h-3 rounded-sm bg-emerald-500 inline-block"></i>Sales Tax</span>
            <span id="al-r-tax" class="tabular-nums font-medium">$0</span>
          </li>
          <li class="flex items-center justify-between gap-3 border-t border-slate-200 pt-2 mt-2">
            <span class="font-semibold">Total Cost (price + interest + tax)</span>
            <span id="al-r-total" class="tabular-nums font-semibold">$0</span>
          </li>
        </ul>
      </div>
    </div>

    <AdSense slot="middle-ad" adSlot="autoloan-middle" format="rectangle" style="min-height:250px;max-width:300px;margin-left:auto;margin-right:auto" />

    <div slot="content">
      <h2 class="text-2xl font-bold mb-3">How this auto loan calculator works</h2>
      <p class="mb-3">This tool computes your monthly payment using the standard amortizing-loan formula. The loan principal is:</p>
      <p class="mb-3 font-mono text-sm bg-slate-100 inline-block px-3 py-1.5 rounded">Principal = Vehicle Price − Down Payment − Trade-in + (Vehicle Price × Sales Tax %)</p>
      <p class="mb-3">Note: this is a simple sales-tax model — it taxes the full vehicle price. Some states (e.g. CA, NY) reduce the taxable basis by the trade-in value, while others tax the difference. For a state-accurate quote, check your DMV's worksheet.</p>
      <p>For a 60-month loan, longer terms (72, 84 months) lower the monthly but cost much more in total interest. Compare with the term buttons above.</p>

      <details class="mt-6 group">
        <summary class="cursor-pointer text-sm font-medium text-blue-700 hover:text-blue-800">Show the math</summary>
        <div id="al-show-math" class="mt-3 text-sm text-slate-700 leading-relaxed bg-slate-50 border border-slate-200 rounded p-4 font-mono"></div>
      </details>
    </div>

    <AdSense slot="bottom-ad" adSlot="autoloan-bottom" style="min-height:90px" />
  </CalculatorShell>

  <script>
    import { calcAutoLoan } from '../../lib/auto-loan.js';
    import { renderPie } from '../../lib/charts.js';
    import { decodeState, pushUrlState } from '../../lib/url-state.js';

    const fmt = (n) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

    const DEFAULTS = { price: 35000, down: 5000, trade: 0, term: 60, rate: 7.5, tax: 7 };
    const init = decodeState(window.location.search, DEFAULTS);

    const $price = document.getElementById('al-price');
    const $down  = document.getElementById('al-down');
    const $trade = document.getElementById('al-trade');
    const $rate  = document.getElementById('al-rate');
    const $tax   = document.getElementById('al-tax');
    const $term  = document.getElementById('al-term');

    $price.value = String(init.price);
    $down.value  = String(init.down);
    $trade.value = String(init.trade);
    $rate.value  = String(init.rate);
    $tax.value   = String(init.tax);
    $term.value  = String(init.term);

    document.querySelectorAll('.al-term-btn').forEach((b) => {
      const active = String(b.dataset.term) === String(init.term);
      b.classList.toggle('bg-blue-600', active);
      b.classList.toggle('text-white', active);
      b.classList.toggle('border-blue-600', active);
      b.classList.toggle('bg-white', !active);
      b.classList.toggle('border-slate-300', !active);
      b.addEventListener('click', () => {
        document.querySelectorAll('.al-term-btn').forEach((x) => {
          x.classList.remove('bg-blue-600', 'text-white', 'border-blue-600');
          x.classList.add('bg-white', 'border-slate-300');
        });
        b.classList.remove('bg-white', 'border-slate-300');
        b.classList.add('bg-blue-600', 'text-white', 'border-blue-600');
        $term.value = b.dataset.term;
        update();
      });
    });

    let urlTimer;
    function syncUrl() {
      clearTimeout(urlTimer);
      urlTimer = setTimeout(() => pushUrlState({
        price: +$price.value || 0, down: +$down.value || 0, trade: +$trade.value || 0,
        term: +$term.value || 60, rate: +$rate.value || 0, tax: +$tax.value || 0,
      }), 250);
    }

    function update() {
      const inputs = {
        vehiclePrice: +$price.value || 0,
        downPayment:  +$down.value  || 0,
        tradeIn:      +$trade.value || 0,
        salesTaxPct:  +$tax.value   || 0,
        annualRatePct: +$rate.value || 0,
        termMonths:   +$term.value  || 60,
      };
      const r = calcAutoLoan(inputs);
      document.getElementById('al-r-monthly').textContent = fmt(r.monthlyPayment);
      document.getElementById('al-r-principal').textContent = fmt(r.principal);
      document.getElementById('al-r-interest').textContent = fmt(r.totalInterest);
      document.getElementById('al-r-tax').textContent = fmt(r.salesTax);
      document.getElementById('al-r-total').textContent = fmt(r.totalCost);
      renderPie(document.getElementById('al-chart'), [
        { value: r.principal,     color: '#2563eb', label: 'Principal' },
        { value: r.totalInterest, color: '#f59e0b', label: 'Interest' },
        { value: r.salesTax,      color: '#10b981', label: 'Sales Tax' },
      ]);
      const monthlyR = inputs.annualRatePct / 100 / 12;
      document.getElementById('al-show-math').innerHTML = `
Sales Tax = $${inputs.vehiclePrice.toLocaleString()} × ${inputs.salesTaxPct}% = $${r.salesTax.toFixed(2)}<br>
Principal = $${inputs.vehiclePrice.toLocaleString()} − $${inputs.downPayment.toLocaleString()} − $${inputs.tradeIn.toLocaleString()} + $${r.salesTax.toFixed(2)} = $${r.principal.toFixed(2)}<br>
r (monthly) = ${inputs.annualRatePct}% ÷ 12 = ${(monthlyR * 100).toFixed(4)}%<br>
n = ${inputs.termMonths}<br>
M = P · [r(1+r)<sup>n</sup>] / [(1+r)<sup>n</sup> − 1] = <strong>$${r.monthlyPayment.toFixed(2)}</strong><br>
Total Interest = M × n − P = $${r.totalInterest.toFixed(2)}<br>
<strong>Total Cost = price + interest + tax = $${r.totalCost.toFixed(2)}</strong>
      `.trim();
      syncUrl();
    }

    document.getElementById('al-form').addEventListener('input', update);
    update();
  </script>
</BaseLayout>
```

- [ ] **Step 2: Build & smoke test**

```bash
cd <workspace>/Coding/kedoupi/kdp-tools/calc && npm run build
ls dist/auto-loan-calculator
grep -c 'al-form' dist/auto-loan-calculator/index.html
```

Expected: build succeeds, `index.html` exists, grep returns ≥1.

- [ ] **Step 3: Commit**

```bash
git -C <workspace>/Coding/kedoupi/kdp-tools add calc/src/pages/auto-loan-calculator/index.astro && \
git -C <workspace>/Coding/kedoupi/kdp-tools commit -m "$(cat <<'EOF'
feat(calc): /auto-loan-calculator/ page with show-the-math + URL state

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && git -C <workspace>/Coding/kedoupi/kdp-tools push
```

---

## Task 9: Compound interest math module

**Files:**
- Create: `src/lib/compound-interest.js`
- Create: `src/lib/compound-interest.test.mjs`

- [ ] **Step 1: Write failing test**

`src/lib/compound-interest.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcCompoundInterest } from './compound-interest.js';

test('$10k @ 7%/yr for 10 yrs, monthly compound, no contribution', () => {
  const r = calcCompoundInterest({ principal: 10000, monthlyContribution: 0, annualRatePct: 7, years: 10, compoundsPerYear: 12 });
  // FV = 10000 × (1 + 0.07/12)^120 ≈ 20096.61
  assert.ok(Math.abs(r.finalAmount - 20096.61) < 1);
  assert.equal(r.totalContributed, 10000);
  assert.ok(r.totalInterest > 10000 && r.totalInterest < 10200);
  assert.equal(r.yearByYear.length, 10);
  assert.ok(r.yearByYear[0].balance > 10000);
  assert.ok(r.yearByYear[9].balance >= r.finalAmount - 1);
});

test('$0 principal, $500/mo for 30 yrs @ 7%, monthly compound', () => {
  const r = calcCompoundInterest({ principal: 0, monthlyContribution: 500, annualRatePct: 7, years: 30, compoundsPerYear: 12 });
  // Annuity FV ≈ 500 × ((1.005833^360 − 1) / 0.005833) ≈ 610,475
  assert.ok(r.finalAmount > 600000 && r.finalAmount < 620000);
  assert.equal(r.totalContributed, 500 * 12 * 30); // 180,000
});

test('zero rate → just sum of contributions', () => {
  const r = calcCompoundInterest({ principal: 1000, monthlyContribution: 100, annualRatePct: 0, years: 5, compoundsPerYear: 12 });
  // 1000 + 100*60 = 7000
  assert.equal(Math.round(r.finalAmount), 7000);
  assert.equal(r.totalInterest, 0);
});

test('yearByYear contains 10 entries for 10-year run', () => {
  const r = calcCompoundInterest({ principal: 5000, monthlyContribution: 100, annualRatePct: 5, years: 10, compoundsPerYear: 12 });
  assert.equal(r.yearByYear.length, 10);
  assert.equal(r.yearByYear[0].year, 1);
  assert.equal(r.yearByYear[9].year, 10);
  // Each year totalContributed must monotonically increase
  for (let i = 1; i < r.yearByYear.length; i++) {
    assert.ok(r.yearByYear[i].totalContributed > r.yearByYear[i - 1].totalContributed);
  }
});
```

- [ ] **Step 2: Run, confirm fail**

```bash
cd <workspace>/Coding/kedoupi/kdp-tools/calc && node --test src/lib/compound-interest.test.mjs
```

Expected: ERR_MODULE_NOT_FOUND.

- [ ] **Step 3: Implement**

`src/lib/compound-interest.js`:

```js
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
```

- [ ] **Step 4: Run, confirm pass**

```bash
cd <workspace>/Coding/kedoupi/kdp-tools/calc && node --test src/lib/compound-interest.test.mjs
```

Expected: 4/4 pass.

- [ ] **Step 5: Commit**

```bash
git -C <workspace>/Coding/kedoupi/kdp-tools add calc/src/lib/compound-interest.js calc/src/lib/compound-interest.test.mjs && \
git -C <workspace>/Coding/kedoupi/kdp-tools commit -m "$(cat <<'EOF'
feat(calc): compound-interest math with year-by-year series

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && git -C <workspace>/Coding/kedoupi/kdp-tools push
```

---

## Task 10: Compound interest calculator page

**Files:**
- Create: `src/pages/compound-interest-calculator/index.astro`

- [ ] **Step 1: Create the page**

`src/pages/compound-interest-calculator/index.astro`:

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
import CalculatorShell from '../../components/CalculatorShell.astro';
import AdSense from '../../components/AdSense.astro';

const title = 'Compound Interest Calculator - Investment Growth 2026';
const description = 'See how your investments grow with compound interest. Enter initial deposit, monthly contribution, rate and years. Free compound interest calculator with year-by-year chart.';
---
<BaseLayout title={title} description={description} pathname="/compound-interest-calculator/">
  <CalculatorShell
    title="Compound Interest Calculator"
    intro="Project your investment growth with regular contributions. See the year-by-year breakdown of contributions vs. interest earned."
  >
    <AdSense slot="top-ad" adSlot="ci-top" style="min-height:90px" />

    <form id="ci-form" class="space-y-5" slot="inputs" autocomplete="off">
      <div>
        <label for="ci-principal" class="block text-sm font-medium text-slate-700 mb-1">Initial Deposit</label>
        <div class="relative">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
          <input id="ci-principal" type="number" min="0" step="500" value="10000"
                 class="w-full pl-7 pr-3 py-2 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      <div>
        <label for="ci-contrib" class="block text-sm font-medium text-slate-700 mb-1">Monthly Contribution</label>
        <div class="relative">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
          <input id="ci-contrib" type="number" min="0" step="50" value="500"
                 class="w-full pl-7 pr-3 py-2 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      <div class="grid grid-cols-2 gap-4">
        <div>
          <label for="ci-rate" class="block text-sm font-medium text-slate-700 mb-1">Annual Rate</label>
          <div class="relative">
            <input id="ci-rate" type="number" min="0" step="0.1" value="7"
                   class="w-full pr-7 pl-3 py-2 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <span class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">%</span>
          </div>
        </div>
        <div>
          <label for="ci-years" class="block text-sm font-medium text-slate-700 mb-1">Years</label>
          <input id="ci-years" type="number" min="1" max="60" step="1" value="30"
                 class="w-full px-3 py-2 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      <div>
        <label for="ci-cpy" class="block text-sm font-medium text-slate-700 mb-1">Compound Frequency</label>
        <select id="ci-cpy" class="w-full px-3 py-2 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="365">Daily</option>
          <option value="12" selected>Monthly</option>
          <option value="4">Quarterly</option>
          <option value="1">Annually</option>
        </select>
      </div>
    </form>

    <div slot="results" class="space-y-5">
      <div>
        <p class="text-sm uppercase tracking-wider text-slate-500">Final Balance</p>
        <p id="ci-r-final" class="text-4xl sm:text-5xl font-bold text-slate-900 tabular-nums">$0</p>
      </div>

      <svg id="ci-chart" viewBox="0 0 200 100" preserveAspectRatio="none" class="w-full h-32 bg-slate-50 rounded border border-slate-200"></svg>

      <ul class="text-sm space-y-1.5">
        <li class="flex items-center justify-between gap-3">
          <span>Total Contributed</span>
          <span id="ci-r-contrib" class="tabular-nums font-medium">$0</span>
        </li>
        <li class="flex items-center justify-between gap-3">
          <span>Total Interest Earned</span>
          <span id="ci-r-interest" class="tabular-nums font-medium text-emerald-600">$0</span>
        </li>
      </ul>
    </div>

    <AdSense slot="middle-ad" adSlot="ci-middle" format="rectangle" style="min-height:250px;max-width:300px;margin-left:auto;margin-right:auto" />

    <div slot="content">
      <h2 class="text-2xl font-bold mb-3">How compound interest works</h2>
      <p class="mb-3">Compound interest pays interest on your interest. Each period, your earnings are added back to the principal, and the next period's interest is calculated on the new, larger balance. The longer you let it run, the more powerfully it compounds.</p>
      <p class="mb-3 font-mono text-sm bg-slate-100 inline-block px-3 py-1.5 rounded">A = P(1 + r/n)<sup>nt</sup></p>
      <p class="mb-3">Where P is principal, r is annual rate, n is compounds per year, and t is years. With regular monthly contributions, we add the contribution to the balance each month and let it compound from there.</p>
      <p>The chart shows your projected balance year-by-year. The shaded area represents how much of your final balance came from contributions vs. compounded interest.</p>

      <details class="mt-6 group">
        <summary class="cursor-pointer text-sm font-medium text-blue-700 hover:text-blue-800">Show the math</summary>
        <div id="ci-show-math" class="mt-3 text-sm text-slate-700 leading-relaxed bg-slate-50 border border-slate-200 rounded p-4 font-mono"></div>
      </details>
    </div>

    <AdSense slot="bottom-ad" adSlot="ci-bottom" style="min-height:90px" />
  </CalculatorShell>

  <script>
    import { calcCompoundInterest } from '../../lib/compound-interest.js';
    import { renderLineChart } from '../../lib/charts.js';
    import { decodeState, pushUrlState } from '../../lib/url-state.js';

    const fmt = (n) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
    const DEFAULTS = { principal: 10000, contrib: 500, rate: 7, years: 30, cpy: 12 };
    const init = decodeState(window.location.search, DEFAULTS);

    const $p = document.getElementById('ci-principal');
    const $c = document.getElementById('ci-contrib');
    const $r = document.getElementById('ci-rate');
    const $y = document.getElementById('ci-years');
    const $f = document.getElementById('ci-cpy');

    $p.value = String(init.principal);
    $c.value = String(init.contrib);
    $r.value = String(init.rate);
    $y.value = String(init.years);
    $f.value = String(init.cpy);

    let urlTimer;
    function syncUrl() {
      clearTimeout(urlTimer);
      urlTimer = setTimeout(() => pushUrlState({
        principal: +$p.value || 0, contrib: +$c.value || 0,
        rate: +$r.value || 0, years: +$y.value || 0, cpy: +$f.value || 12,
      }), 250);
    }

    function update() {
      const inputs = {
        principal: +$p.value || 0,
        monthlyContribution: +$c.value || 0,
        annualRatePct: +$r.value || 0,
        years: +$y.value || 0,
        compoundsPerYear: +$f.value || 12,
      };
      const r = calcCompoundInterest(inputs);
      document.getElementById('ci-r-final').textContent = fmt(r.finalAmount);
      document.getElementById('ci-r-contrib').textContent = fmt(r.totalContributed);
      document.getElementById('ci-r-interest').textContent = fmt(r.totalInterest);
      renderLineChart(
        document.getElementById('ci-chart'),
        r.yearByYear.map((y) => ({ x: y.year, y: y.balance })),
        { lineColor: '#2563eb', fillColor: 'rgba(37,99,235,0.15)', xLabels: r.yearByYear.map((y) => `Y${y.year}`) },
      );
      const sample = r.yearByYear.slice(0, 3).map((y) => `Year ${y.year}: balance = $${y.balance.toFixed(2)} (interest so far: $${y.totalInterest.toFixed(2)})`).join('<br>');
      const last = r.yearByYear.length ? `Year ${r.yearByYear.at(-1).year}: balance = $${r.yearByYear.at(-1).balance.toFixed(2)}` : '';
      document.getElementById('ci-show-math').innerHTML = `
P = $${inputs.principal.toLocaleString()}, contribution = $${inputs.monthlyContribution}/mo, r = ${inputs.annualRatePct}%, n = ${inputs.compoundsPerYear}/yr, t = ${inputs.years} yr<br>
Monthly growth factor = (1 + ${(inputs.annualRatePct / 100).toFixed(4)} / ${inputs.compoundsPerYear})<sup>${inputs.compoundsPerYear}/12</sup><br>
Each month: balance = balance × monthlyGrowth + ${inputs.monthlyContribution}<br>
${sample}<br>
… ${last} ← <strong>Final balance: $${r.finalAmount.toFixed(2)}</strong>
      `.trim();
      syncUrl();
    }

    document.getElementById('ci-form').addEventListener('input', update);
    update();
  </script>
</BaseLayout>
```

- [ ] **Step 2: Build & smoke test**

```bash
cd <workspace>/Coding/kedoupi/kdp-tools/calc && npm run build
ls dist/compound-interest-calculator
grep -c 'ci-form' dist/compound-interest-calculator/index.html
```

Expected: build succeeds, `index.html` exists, grep returns ≥1.

- [ ] **Step 3: Commit**

```bash
git -C <workspace>/Coding/kedoupi/kdp-tools add calc/src/pages/compound-interest-calculator/index.astro && \
git -C <workspace>/Coding/kedoupi/kdp-tools commit -m "$(cat <<'EOF'
feat(calc): /compound-interest-calculator/ page with line chart + show-the-math

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && git -C <workspace>/Coding/kedoupi/kdp-tools push
```

---

## Task 11: Income tax math module

**Files:**
- Create: `src/lib/income-tax.js`
- Create: `src/lib/income-tax.test.mjs`

- [ ] **Step 1: Write failing test**

`src/lib/income-tax.test.mjs`:

```js
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
```

- [ ] **Step 2: Run, confirm fail**

```bash
cd <workspace>/Coding/kedoupi/kdp-tools/calc && node --test src/lib/income-tax.test.mjs
```

Expected: ERR_MODULE_NOT_FOUND.

- [ ] **Step 3: Implement**

`src/lib/income-tax.js`:

```js
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
```

- [ ] **Step 4: Run, confirm pass**

```bash
cd <workspace>/Coding/kedoupi/kdp-tools/calc && node --test src/lib/income-tax.test.mjs
```

Expected: 5/5 pass.

- [ ] **Step 5: Commit**

```bash
git -C <workspace>/Coding/kedoupi/kdp-tools add calc/src/lib/income-tax.js calc/src/lib/income-tax.test.mjs && \
git -C <workspace>/Coding/kedoupi/kdp-tools commit -m "$(cat <<'EOF'
feat(calc): income-tax math (2026, standard/itemized) using federal-tax primitive

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && git -C <workspace>/Coding/kedoupi/kdp-tools push
```

---

## Task 12: Income tax calculator page (with bracket-stair SVG)

**Files:**
- Create: `src/pages/income-tax-calculator/index.astro`

- [ ] **Step 1: Create the page**

`src/pages/income-tax-calculator/index.astro`:

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
import CalculatorShell from '../../components/CalculatorShell.astro';
import AdSense from '../../components/AdSense.astro';

const title = 'Income Tax Calculator - 2026 US Federal Tax Estimator';
const description = 'Estimate your 2026 US federal income tax. Enter income, filing status and deductions. See your marginal rate, effective rate and full bracket breakdown.';
---
<BaseLayout title={title} description={description} pathname="/income-tax-calculator/">
  <CalculatorShell
    title="Income Tax Calculator (2026)"
    intro="Estimate your 2026 US federal income tax. See exactly how each bracket contributes to your total — no email required."
  >
    <AdSense slot="top-ad" adSlot="tax-top" style="min-height:90px" />

    <form id="tax-form" class="space-y-5" slot="inputs" autocomplete="off">
      <div>
        <label for="tax-income" class="block text-sm font-medium text-slate-700 mb-1">Annual Income</label>
        <div class="relative">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
          <input id="tax-income" type="number" min="0" step="1000" value="90000"
                 class="w-full pl-7 pr-3 py-2 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      <div>
        <label for="tax-status" class="block text-sm font-medium text-slate-700 mb-1">Filing Status</label>
        <select id="tax-status" class="w-full px-3 py-2 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="single">Single</option>
          <option value="mfj">Married Filing Jointly</option>
          <option value="mfs">Married Filing Separately</option>
          <option value="hoh">Head of Household</option>
        </select>
      </div>

      <div>
        <span class="block text-sm font-medium text-slate-700 mb-1">Deduction</span>
        <div class="grid grid-cols-2 gap-2">
          <button type="button" data-deduction="standard" class="ded-btn py-2 rounded border border-blue-600 bg-blue-600 text-white text-sm">Standard</button>
          <button type="button" data-deduction="itemized" class="ded-btn py-2 rounded border border-slate-300 bg-white text-sm">Itemized</button>
        </div>
        <input type="hidden" id="tax-deduction" value="standard" />
      </div>

      <div id="tax-itemized-row" class="hidden">
        <label for="tax-itemized" class="block text-sm font-medium text-slate-700 mb-1">Itemized Amount</label>
        <div class="relative">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
          <input id="tax-itemized" type="number" min="0" step="500" value="20000"
                 class="w-full pl-7 pr-3 py-2 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>
    </form>

    <div slot="results" class="space-y-5">
      <div>
        <p class="text-sm uppercase tracking-wider text-slate-500">Federal Tax Owed</p>
        <p id="tax-r-total" class="text-4xl sm:text-5xl font-bold text-slate-900 tabular-nums">$0</p>
      </div>

      <ul class="text-sm space-y-1.5">
        <li class="flex justify-between"><span>Taxable Income</span><span id="tax-r-taxable" class="tabular-nums font-medium">$0</span></li>
        <li class="flex justify-between"><span>Effective Rate</span><span id="tax-r-eff" class="tabular-nums font-medium">0%</span></li>
        <li class="flex justify-between"><span>Marginal Rate</span><span id="tax-r-marg" class="tabular-nums font-medium">0%</span></li>
      </ul>

      <div>
        <p class="text-xs uppercase tracking-wider text-slate-500 mb-2">Your bracket position</p>
        <svg id="tax-stair" viewBox="0 0 200 28" preserveAspectRatio="none" class="w-full h-7 rounded overflow-hidden"></svg>
        <p class="text-xs text-slate-500 mt-1" id="tax-stair-caption"></p>
      </div>
    </div>

    <AdSense slot="middle-ad" adSlot="tax-middle" format="rectangle" style="min-height:250px;max-width:300px;margin-left:auto;margin-right:auto" />

    <div slot="content">
      <h2 class="text-2xl font-bold mb-3">How US federal income tax brackets work</h2>
      <p class="mb-3">The US uses a marginal-bracket system. Your last dollar of income is taxed at your highest (marginal) rate, but most of your income is taxed at lower rates. Your effective rate is your total tax divided by your total income — always lower than your marginal rate.</p>
      <p class="mb-3">For 2026, the IRS published seven federal brackets via Rev. Proc. 2025-32. Standard deductions for tax year 2026 are: Single $16,100; MFJ $32,200; MFS $16,100; HoH $24,150.</p>
      <p class="mb-3">This calculator covers <em>federal</em> tax only. State income tax (if any) and credits (CTC, EITC, etc.) are not yet modeled — see the paycheck calculator for FICA and a flat state-tax estimate.</p>
      <p>Tax data source: IRS Rev. Proc. 2025-32 (October 2025).</p>

      <details class="mt-6 group" open>
        <summary class="cursor-pointer text-sm font-medium text-blue-700 hover:text-blue-800">Show the math (full bracket breakdown)</summary>
        <div id="tax-show-math" class="mt-3 text-sm text-slate-700 leading-relaxed bg-slate-50 border border-slate-200 rounded p-4 font-mono"></div>
      </details>
    </div>

    <AdSense slot="bottom-ad" adSlot="tax-bottom" style="min-height:90px" />
  </CalculatorShell>

  <script>
    import { calcIncomeTax } from '../../lib/income-tax.js';
    import { TAX_DATA_2026 } from '../../lib/federal-tax.js';
    import { decodeState, pushUrlState } from '../../lib/url-state.js';

    const fmt = (n) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
    const pct = (n) => `${(n * 100).toFixed(2)}%`;

    const DEFAULTS = { income: 90000, status: 'single', deduction: 'standard', itemized: 20000 };
    const init = decodeState(window.location.search, DEFAULTS);

    const $income    = document.getElementById('tax-income');
    const $status    = document.getElementById('tax-status');
    const $deduction = document.getElementById('tax-deduction');
    const $itemized  = document.getElementById('tax-itemized');
    const $itemizedRow = document.getElementById('tax-itemized-row');

    $income.value = String(init.income);
    $status.value = init.status;
    $deduction.value = init.deduction;
    $itemized.value = String(init.itemized);
    $itemizedRow.classList.toggle('hidden', init.deduction !== 'itemized');

    document.querySelectorAll('.ded-btn').forEach((b) => {
      const active = b.dataset.deduction === init.deduction;
      b.classList.toggle('bg-blue-600', active);
      b.classList.toggle('text-white', active);
      b.classList.toggle('border-blue-600', active);
      b.classList.toggle('bg-white', !active);
      b.classList.toggle('border-slate-300', !active);
      b.addEventListener('click', () => {
        document.querySelectorAll('.ded-btn').forEach((x) => {
          x.classList.remove('bg-blue-600', 'text-white', 'border-blue-600');
          x.classList.add('bg-white', 'border-slate-300');
        });
        b.classList.remove('bg-white', 'border-slate-300');
        b.classList.add('bg-blue-600', 'text-white', 'border-blue-600');
        $deduction.value = b.dataset.deduction;
        $itemizedRow.classList.toggle('hidden', $deduction.value !== 'itemized');
        update();
      });
    });

    let urlTimer;
    function syncUrl() {
      clearTimeout(urlTimer);
      urlTimer = setTimeout(() => pushUrlState({
        income: +$income.value || 0, status: $status.value,
        deduction: $deduction.value, itemized: +$itemized.value || 0,
      }), 250);
    }

    const STAIR_COLORS = ['#dbeafe', '#bfdbfe', '#93c5fd', '#60a5fa', '#3b82f6', '#2563eb', '#1d4ed8'];

    function renderStair(svgEl, brackets, taxableIncome) {
      // Build a 0..maxStair segment showing brackets with widths proportional to bracket span.
      // Cap maxStair so the user's marker isn't lost; use 1.25 × max(taxableIncome, top of penultimate bracket).
      const top = brackets.at(-1)[1];
      const maxStair = Math.max(top * 1.25, taxableIncome * 1.1, top + 1);
      const W = 200, H = 28;
      const sx = (v) => (v / maxStair) * W;
      let segs = '';
      for (let i = 0; i < brackets.length; i++) {
        const [rate, lower] = brackets[i];
        const upper = i + 1 < brackets.length ? brackets[i + 1][1] : maxStair;
        const x = sx(lower);
        const w = Math.max(0.5, sx(upper) - x);
        segs += `<rect x="${x.toFixed(2)}" y="0" width="${w.toFixed(2)}" height="${H}" fill="${STAIR_COLORS[i]}"></rect>`;
        segs += `<text x="${(x + 1).toFixed(2)}" y="9" font-size="6" fill="#0f172a">${(rate * 100).toFixed(0)}%</text>`;
      }
      const markerX = sx(Math.min(taxableIncome, maxStair));
      segs += `<line x1="${markerX.toFixed(2)}" y1="0" x2="${markerX.toFixed(2)}" y2="${H}" stroke="#0f172a" stroke-width="1.2"></line>`;
      segs += `<circle cx="${markerX.toFixed(2)}" cy="${H - 4}" r="2.4" fill="#0f172a"></circle>`;
      svgEl.innerHTML = segs;
    }

    function update() {
      const inputs = {
        income: +$income.value || 0,
        filingStatus: $status.value,
        deductionType: $deduction.value,
        itemizedDeduction: +$itemized.value || 0,
      };
      const r = calcIncomeTax(inputs);
      document.getElementById('tax-r-total').textContent = fmt(r.federalTax);
      document.getElementById('tax-r-taxable').textContent = fmt(r.taxableIncome);
      document.getElementById('tax-r-eff').textContent = pct(r.effectiveRate);
      document.getElementById('tax-r-marg').textContent = pct(r.marginalRate);

      const brackets = TAX_DATA_2026.brackets[inputs.filingStatus];
      renderStair(document.getElementById('tax-stair'), brackets, r.taxableIncome);
      document.getElementById('tax-stair-caption').textContent =
        `Taxable income $${r.taxableIncome.toLocaleString()} → marginal ${pct(r.marginalRate)}, effective ${pct(r.effectiveRate)}`;

      const lines = r.bracketBreakdown
        .filter((b) => b.taxableInBracket > 0)
        .map((b) => `${(b.rate * 100).toFixed(0)}% × $${b.taxableInBracket.toLocaleString(undefined,{maximumFractionDigits:0})} = <strong>$${b.taxFromBracket.toFixed(2)}</strong>`)
        .join('<br>');
      document.getElementById('tax-show-math').innerHTML = `
Income = $${inputs.income.toLocaleString()}<br>
− Deduction (${inputs.deductionType === 'itemized' ? 'Itemized' : `${inputs.filingStatus.toUpperCase()} Standard`}) = $${r.deductionAmount.toLocaleString()}<br>
Taxable income = $${r.taxableIncome.toLocaleString()}<br>
<br>
${lines}<br>
<br>
Total federal tax = <strong>$${r.federalTax.toFixed(2)}</strong><br>
Effective rate = ${pct(r.effectiveRate)} · Marginal rate = ${pct(r.marginalRate)}
      `.trim();
      syncUrl();
    }

    document.getElementById('tax-form').addEventListener('input', update);
    update();
  </script>
</BaseLayout>
```

- [ ] **Step 2: Build & smoke test**

```bash
cd <workspace>/Coding/kedoupi/kdp-tools/calc && npm run build
ls dist/income-tax-calculator
grep -c 'tax-stair' dist/income-tax-calculator/index.html
```

Expected: build succeeds, `index.html` exists, grep returns ≥1.

- [ ] **Step 3: Commit**

```bash
git -C <workspace>/Coding/kedoupi/kdp-tools add calc/src/pages/income-tax-calculator/index.astro && \
git -C <workspace>/Coding/kedoupi/kdp-tools commit -m "$(cat <<'EOF'
feat(calc): /income-tax-calculator/ page with bracket-stair + show-the-math

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && git -C <workspace>/Coding/kedoupi/kdp-tools push
```

---

## Task 13: Paycheck math + page

This is bigger; we keep math + page in one task. Math first.

**Files:**
- Create: `src/lib/paycheck.js`
- Create: `src/lib/paycheck.test.mjs`
- Create: `src/pages/paycheck-calculator/index.astro`

- [ ] **Step 1: Write failing math test**

`src/lib/paycheck.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcPaycheck } from './paycheck.js';

test('80k single biweekly, 5% state, 6% 401k, no pretax', () => {
  const r = calcPaycheck({
    annualGross: 80000, filingStatus: 'single', payFrequency: 'biweekly',
    statePct: 5, deductions401kPct: 6, deductionsPretaxAmt: 0,
  });
  // Sanity ranges (not exact — rates and rounding intentional):
  assert.ok(r.annual.federal > 6000 && r.annual.federal < 9500, `federal=${r.annual.federal}`);
  assert.ok(r.annual.ss > 4900 && r.annual.ss < 5000); // 80k × 6.2% = 4960 (under wage base)
  assert.equal(Math.round(r.annual.medicare), Math.round(80000 * 0.0145));
  assert.equal(r.annual.addlMedicare, 0); // below 200k single threshold
  assert.ok(r.annual.net > 50000 && r.annual.net < 65000);
  // perPeriod * 26 ≈ annual (within $5 due to rounding)
  assert.ok(Math.abs(r.perPeriod.net * 26 - r.annual.net) < 5);
});

test('250k single triggers Additional Medicare', () => {
  const r = calcPaycheck({
    annualGross: 250000, filingStatus: 'single', payFrequency: 'monthly',
    statePct: 0, deductions401kPct: 0, deductionsPretaxAmt: 0,
  });
  assert.ok(r.annual.addlMedicare > 0); // (250k - 200k) × 0.9% = 450
  assert.equal(Math.round(r.annual.addlMedicare), 450);
});

test('250k MFJ does NOT trigger addl Medicare (combined threshold 250k)', () => {
  const r = calcPaycheck({
    annualGross: 250000, filingStatus: 'mfj', payFrequency: 'monthly',
    statePct: 0, deductions401kPct: 0, deductionsPretaxAmt: 0,
  });
  // Per-employee withholding rule applies at 200k; spec says "Employer must
  // withhold 0.9% on any single employee's wages > $200,000 regardless of
  // filing status." So this calculator follows the employee-side reconciliation
  // logic: addl Medicare applies on wages above filingStatus threshold
  // (250k for MFJ). At exactly 250k MFJ this should be 0.
  assert.equal(r.annual.addlMedicare, 0);
});

test('SS taxed only up to wage base', () => {
  const r = calcPaycheck({
    annualGross: 300000, filingStatus: 'single', payFrequency: 'monthly',
    statePct: 0, deductions401kPct: 0, deductionsPretaxAmt: 0,
  });
  // SS = 184500 × 6.2% = 11439
  assert.equal(Math.round(r.annual.ss), 11439);
});

test('weekly frequency divides by 52', () => {
  const r = calcPaycheck({
    annualGross: 52000, filingStatus: 'single', payFrequency: 'weekly',
    statePct: 0, deductions401kPct: 0, deductionsPretaxAmt: 0,
  });
  assert.equal(r.perPeriod.gross, 1000);
});
```

- [ ] **Step 2: Run, confirm fail**

```bash
cd <workspace>/Coding/kedoupi/kdp-tools/calc && node --test src/lib/paycheck.test.mjs
```

Expected: ERR_MODULE_NOT_FOUND.

- [ ] **Step 3: Implement `paycheck.js`**

```js
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
```

- [ ] **Step 4: Run, confirm pass**

```bash
cd <workspace>/Coding/kedoupi/kdp-tools/calc && node --test src/lib/paycheck.test.mjs
```

Expected: 5/5 pass.

- [ ] **Step 5: Commit math**

```bash
git -C <workspace>/Coding/kedoupi/kdp-tools add calc/src/lib/paycheck.js calc/src/lib/paycheck.test.mjs && \
git -C <workspace>/Coding/kedoupi/kdp-tools commit -m "$(cat <<'EOF'
feat(calc): paycheck math (federal + FICA + addl Medicare + flat state)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && git -C <workspace>/Coding/kedoupi/kdp-tools push
```

- [ ] **Step 6: Create the page**

`src/pages/paycheck-calculator/index.astro`:

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
import CalculatorShell from '../../components/CalculatorShell.astro';
import AdSense from '../../components/AdSense.astro';

const title = 'Paycheck Calculator - US Take-Home Pay 2026';
const description = 'Calculate your 2026 take-home pay. Federal tax + FICA + state tax + 401(k). Free US paycheck calculator with full breakdown.';
---
<BaseLayout title={title} description={description} pathname="/paycheck-calculator/">
  <CalculatorShell
    title="Paycheck Calculator (2026)"
    intro="See your real take-home pay after federal tax, FICA, state tax, and pretax deductions like 401(k)."
  >
    <AdSense slot="top-ad" adSlot="pay-top" style="min-height:90px" />

    <form id="pay-form" class="space-y-5" slot="inputs" autocomplete="off">
      <div>
        <label for="pay-gross" class="block text-sm font-medium text-slate-700 mb-1">Annual Gross Salary</label>
        <div class="relative">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
          <input id="pay-gross" type="number" min="0" step="1000" value="80000"
                 class="w-full pl-7 pr-3 py-2 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      <div class="grid grid-cols-2 gap-4">
        <div>
          <label for="pay-status" class="block text-sm font-medium text-slate-700 mb-1">Filing Status</label>
          <select id="pay-status" class="w-full px-3 py-2 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="single">Single</option>
            <option value="mfj">Married (Joint)</option>
            <option value="mfs">Married (Separate)</option>
            <option value="hoh">Head of Household</option>
          </select>
        </div>
        <div>
          <label for="pay-freq" class="block text-sm font-medium text-slate-700 mb-1">Pay Frequency</label>
          <select id="pay-freq" class="w-full px-3 py-2 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="weekly">Weekly</option>
            <option value="biweekly" selected>Bi-weekly</option>
            <option value="semimonthly">Semi-monthly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-4">
        <div>
          <label for="pay-state" class="block text-sm font-medium text-slate-700 mb-1">State Tax Rate</label>
          <div class="relative">
            <input id="pay-state" type="number" min="0" max="20" step="0.1" value="5"
                   class="w-full pr-7 pl-3 py-2 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <span class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">%</span>
          </div>
        </div>
        <div>
          <label for="pay-401k" class="block text-sm font-medium text-slate-700 mb-1">401(k) Deferral</label>
          <div class="relative">
            <input id="pay-401k" type="number" min="0" max="100" step="0.5" value="6"
                   class="w-full pr-7 pl-3 py-2 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <span class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">%</span>
          </div>
        </div>
      </div>

      <div>
        <label for="pay-pretax" class="block text-sm font-medium text-slate-700 mb-1">Other Pretax Deductions (HSA, health, dental — annual $)</label>
        <div class="relative">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
          <input id="pay-pretax" type="number" min="0" step="100" value="0"
                 class="w-full pl-7 pr-3 py-2 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>
    </form>

    <div slot="results" class="space-y-5">
      <div>
        <p class="text-sm uppercase tracking-wider text-slate-500">Take-home <span id="pay-r-period-label" class="lowercase">per pay period</span></p>
        <p id="pay-r-net" class="text-4xl sm:text-5xl font-bold text-slate-900 tabular-nums">$0</p>
      </div>

      <div class="flex items-center gap-5">
        <svg id="pay-chart" viewBox="0 0 100 100" class="w-32 h-32 shrink-0" aria-label="Paycheck breakdown"></svg>
        <ul class="text-sm space-y-1 flex-1">
          <li class="flex justify-between"><span class="flex items-center gap-2"><i class="w-3 h-3 rounded-sm bg-emerald-500"></i>Net</span><span id="pay-r-net-line" class="tabular-nums font-medium">$0</span></li>
          <li class="flex justify-between"><span class="flex items-center gap-2"><i class="w-3 h-3 rounded-sm bg-blue-600"></i>Federal</span><span id="pay-r-fed" class="tabular-nums font-medium">$0</span></li>
          <li class="flex justify-between"><span class="flex items-center gap-2"><i class="w-3 h-3 rounded-sm bg-amber-500"></i>FICA</span><span id="pay-r-fica" class="tabular-nums font-medium">$0</span></li>
          <li class="flex justify-between"><span class="flex items-center gap-2"><i class="w-3 h-3 rounded-sm bg-rose-500"></i>State</span><span id="pay-r-state" class="tabular-nums font-medium">$0</span></li>
          <li class="flex justify-between"><span class="flex items-center gap-2"><i class="w-3 h-3 rounded-sm bg-violet-500"></i>Pretax (401k + other)</span><span id="pay-r-pretax" class="tabular-nums font-medium">$0</span></li>
        </ul>
      </div>

      <p class="text-xs text-slate-500">Annual: gross <span id="pay-r-annual-gross" class="tabular-nums">$0</span> → net <span id="pay-r-annual-net" class="tabular-nums">$0</span></p>
    </div>

    <AdSense slot="middle-ad" adSlot="pay-middle" format="rectangle" style="min-height:250px;max-width:300px;margin-left:auto;margin-right:auto" />

    <div slot="content">
      <h2 class="text-2xl font-bold mb-3">How your paycheck breaks down</h2>
      <p class="mb-3">Your gross salary is reduced by several lines before it hits your bank: pretax 401(k) and HSA/health premiums, federal income tax, FICA (Social Security 6.2% + Medicare 1.45%), state income tax, and any other post-tax deductions.</p>
      <p class="mb-3">Social Security tax stops once you've earned $184,500 in 2026 (the wage base). Medicare has no cap, and an Additional Medicare Tax of 0.9% kicks in on wages above $200,000 (single) or $250,000 (MFJ). 401(k) reduces federal taxable income but is still subject to FICA.</p>
      <p>This tool uses a flat state tax rate. Real state tax has its own brackets, deductions, and local taxes (NYC, SF, etc.) — for an exact number, check your state's withholding tables.</p>

      <details class="mt-6 group">
        <summary class="cursor-pointer text-sm font-medium text-blue-700 hover:text-blue-800">Show the math</summary>
        <div id="pay-show-math" class="mt-3 text-sm text-slate-700 leading-relaxed bg-slate-50 border border-slate-200 rounded p-4 font-mono"></div>
      </details>
    </div>

    <AdSense slot="bottom-ad" adSlot="pay-bottom" style="min-height:90px" />
  </CalculatorShell>

  <script>
    import { calcPaycheck } from '../../lib/paycheck.js';
    import { TAX_DATA_2026 } from '../../lib/federal-tax.js';
    import { renderPie } from '../../lib/charts.js';
    import { decodeState, pushUrlState } from '../../lib/url-state.js';

    const fmt = (n) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
    const FREQ_LABEL = { weekly: 'per week', biweekly: 'per pay period', semimonthly: 'per pay period', monthly: 'per month' };

    const DEFAULTS = { gross: 80000, status: 'single', freq: 'biweekly', state: 5, k401: 6, pretax: 0 };
    const init = decodeState(window.location.search, DEFAULTS);

    const $g = document.getElementById('pay-gross');
    const $s = document.getElementById('pay-status');
    const $f = document.getElementById('pay-freq');
    const $st = document.getElementById('pay-state');
    const $k = document.getElementById('pay-401k');
    const $px = document.getElementById('pay-pretax');

    $g.value = String(init.gross);
    $s.value = init.status;
    $f.value = init.freq;
    $st.value = String(init.state);
    $k.value = String(init.k401);
    $px.value = String(init.pretax);

    let urlTimer;
    function syncUrl() {
      clearTimeout(urlTimer);
      urlTimer = setTimeout(() => pushUrlState({
        gross: +$g.value || 0, status: $s.value, freq: $f.value,
        state: +$st.value || 0, k401: +$k.value || 0, pretax: +$px.value || 0,
      }), 250);
    }

    function update() {
      const inputs = {
        annualGross: +$g.value || 0,
        filingStatus: $s.value,
        payFrequency: $f.value,
        statePct: +$st.value || 0,
        deductions401kPct: +$k.value || 0,
        deductionsPretaxAmt: +$px.value || 0,
      };
      const r = calcPaycheck(inputs);
      const fica = r.perPeriod.ss + r.perPeriod.medicare + r.perPeriod.addlMedicare;
      const pretax = r.perPeriod.pretax401k + r.perPeriod.pretaxOther;

      document.getElementById('pay-r-period-label').textContent = FREQ_LABEL[$f.value] || 'per pay period';
      document.getElementById('pay-r-net').textContent = fmt(r.perPeriod.net);
      document.getElementById('pay-r-net-line').textContent = fmt(r.perPeriod.net);
      document.getElementById('pay-r-fed').textContent = fmt(r.perPeriod.federal);
      document.getElementById('pay-r-fica').textContent = fmt(fica);
      document.getElementById('pay-r-state').textContent = fmt(r.perPeriod.state);
      document.getElementById('pay-r-pretax').textContent = fmt(pretax);
      document.getElementById('pay-r-annual-gross').textContent = fmt(r.annual.gross);
      document.getElementById('pay-r-annual-net').textContent = fmt(r.annual.net);

      renderPie(document.getElementById('pay-chart'), [
        { value: r.perPeriod.net,      color: '#10b981', label: 'Net' },
        { value: r.perPeriod.federal,  color: '#2563eb', label: 'Federal' },
        { value: fica,                 color: '#f59e0b', label: 'FICA' },
        { value: r.perPeriod.state,    color: '#f43f5e', label: 'State' },
        { value: pretax,               color: '#8b5cf6', label: 'Pretax' },
      ]);

      const stdDed = TAX_DATA_2026.standardDeduction[$s.value] || 0;
      const taxableForFederal = Math.max(0, inputs.annualGross - r.annual.pretax401k - r.annual.pretaxOther - stdDed);
      const ssCapped = Math.min(inputs.annualGross, TAX_DATA_2026.ssWageBase);
      const addlOver = Math.max(0, inputs.annualGross - (TAX_DATA_2026.additionalMedicareThreshold[$s.value] ?? 200000));
      document.getElementById('pay-show-math').innerHTML = `
Annual gross = $${inputs.annualGross.toLocaleString()}<br>
− 401(k) ${inputs.deductions401kPct}% = $${r.annual.pretax401k.toFixed(2)}<br>
− Other pretax = $${r.annual.pretaxOther.toFixed(2)}<br>
− Standard deduction (${$s.value.toUpperCase()}) = $${stdDed.toLocaleString()}<br>
Federal taxable = $${taxableForFederal.toFixed(2)} → federal tax = <strong>$${r.annual.federal.toFixed(2)}</strong><br>
<br>
SS = min($${inputs.annualGross.toLocaleString()}, $${TAX_DATA_2026.ssWageBase.toLocaleString()}) × 6.2% = $${(ssCapped * 0.062).toFixed(2)}<br>
Medicare = $${inputs.annualGross.toLocaleString()} × 1.45% = $${r.annual.medicare.toFixed(2)}<br>
Additional Medicare (over threshold) = $${addlOver.toFixed(2)} × 0.9% = $${r.annual.addlMedicare.toFixed(2)}<br>
State = (gross − pretax) × ${inputs.statePct}% = $${r.annual.state.toFixed(2)}<br>
<br>
<strong>Annual net = $${r.annual.net.toFixed(2)} → ${$f.value} = $${r.perPeriod.net.toFixed(2)}</strong>
      `.trim();
      syncUrl();
    }

    document.getElementById('pay-form').addEventListener('input', update);
    update();
  </script>
</BaseLayout>
```

- [ ] **Step 7: Build & smoke test**

```bash
cd <workspace>/Coding/kedoupi/kdp-tools/calc && npm run build
ls dist/paycheck-calculator
grep -c 'pay-form' dist/paycheck-calculator/index.html
```

Expected: build succeeds, `index.html` exists, grep returns ≥1.

- [ ] **Step 8: Commit page**

```bash
git -C <workspace>/Coding/kedoupi/kdp-tools add calc/src/pages/paycheck-calculator/index.astro && \
git -C <workspace>/Coding/kedoupi/kdp-tools commit -m "$(cat <<'EOF'
feat(calc): /paycheck-calculator/ page (gross→net, FICA, addl Medicare, state flat)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && git -C <workspace>/Coding/kedoupi/kdp-tools push
```

---

## Task 14: Privacy Policy page

**Files:**
- Create: `src/pages/privacy/index.astro`

- [ ] **Step 1: Create page**

`src/pages/privacy/index.astro`:

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';

const title = 'Privacy Policy';
const description = 'How CalcKDP handles your data. Short answer: we don\'t collect personal information; calculator inputs stay in your browser.';
---
<BaseLayout title={title} description={description} pathname="/privacy/" schemaType="WebPage">
  <article class="prose-like max-w-3xl space-y-4">
    <h1 class="text-3xl font-bold tracking-tight">Privacy Policy</h1>
    <p class="text-sm text-slate-500">Last updated: 2026-05-08</p>

    <h2 class="text-xl font-semibold mt-6">Short version</h2>
    <p>CalcKDP runs entirely in your browser. We do not ask for accounts, do not collect personal information, and do not sell data. Calculator inputs stay on your device.</p>

    <h2 class="text-xl font-semibold mt-6">What we collect</h2>
    <ul class="list-disc pl-6 space-y-1">
      <li><strong>Anonymous traffic analytics</strong> via Cloudflare's built-in Web Analytics (no cookies, no fingerprinting).</li>
      <li><strong>Calculator state in URL parameters</strong> when you change inputs — this is so you can share scenarios. Nothing is sent to a server beyond the static page request.</li>
      <li><strong>Advertising</strong> via Google AdSense. AdSense may use cookies and third-party identifiers to serve personalized ads, subject to <a href="https://policies.google.com/privacy" class="text-blue-600 hover:underline">Google's privacy policy</a>. You can opt out of personalized ads at <a href="https://adssettings.google.com" class="text-blue-600 hover:underline">Google Ads Settings</a>.</li>
    </ul>

    <h2 class="text-xl font-semibold mt-6">What we don't collect</h2>
    <ul class="list-disc pl-6 space-y-1">
      <li>Email addresses</li>
      <li>Names</li>
      <li>The financial values you enter into calculators (these never leave your browser)</li>
      <li>Account credentials (we have no accounts)</li>
    </ul>

    <h2 class="text-xl font-semibold mt-6">Cookies</h2>
    <p>CalcKDP itself does not set cookies. Google AdSense may set cookies to serve and measure ads. If you're in the EU, EEA, or UK, AdSense will show a consent prompt before personalized ads are served.</p>

    <h2 class="text-xl font-semibold mt-6">Children</h2>
    <p>CalcKDP is not directed at children under 13. We do not knowingly collect any information from children.</p>

    <h2 class="text-xl font-semibold mt-6">Your rights (GDPR / CCPA)</h2>
    <p>Because we don't store personal information, there's typically nothing to access, delete, or export. If you have questions, see Contact below.</p>

    <h2 class="text-xl font-semibold mt-6">Changes</h2>
    <p>If we change this policy, we'll update the "Last updated" date above. Material changes will be highlighted on the homepage.</p>

    <h2 class="text-xl font-semibold mt-6">Contact</h2>
    <p>See <a href="/contact/" class="text-blue-600 hover:underline">Contact</a>.</p>
  </article>
</BaseLayout>
```

- [ ] **Step 2: Build & verify**

```bash
cd <workspace>/Coding/kedoupi/kdp-tools/calc && npm run build
ls dist/privacy
```

Expected: `dist/privacy/index.html` exists.

- [ ] **Step 3: Commit**

```bash
git -C <workspace>/Coding/kedoupi/kdp-tools add calc/src/pages/privacy/index.astro && \
git -C <workspace>/Coding/kedoupi/kdp-tools commit -m "$(cat <<'EOF'
feat(calc): /privacy/ page (AdSense-required policy)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && git -C <workspace>/Coding/kedoupi/kdp-tools push
```

---

## Task 15: Terms of Service page

**Files:**
- Create: `src/pages/terms/index.astro`

- [ ] **Step 1: Create page**

`src/pages/terms/index.astro`:

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';

const title = 'Terms of Service';
const description = 'Terms of using CalcKDP. The short version: results are estimates; you accept the site as-is and are responsible for your own financial decisions.';
---
<BaseLayout title={title} description={description} pathname="/terms/" schemaType="WebPage">
  <article class="prose-like max-w-3xl space-y-4">
    <h1 class="text-3xl font-bold tracking-tight">Terms of Service</h1>
    <p class="text-sm text-slate-500">Last updated: 2026-05-08</p>

    <h2 class="text-xl font-semibold mt-6">Use at your own risk</h2>
    <p>CalcKDP's calculators provide estimates based on the inputs you enter. They are not financial, tax, legal, or investment advice. Always consult a qualified professional before making financial decisions.</p>

    <h2 class="text-xl font-semibold mt-6">No warranty</h2>
    <p>The site is provided "as is" and "as available" without warranties of any kind, express or implied, including but not limited to warranties of merchantability, fitness for a particular purpose, or non-infringement. We do not warrant that the calculations are error-free or up to date with the latest tax law, IRS rulings, or market rates.</p>

    <h2 class="text-xl font-semibold mt-6">Limitation of liability</h2>
    <p>To the maximum extent permitted by law, CalcKDP and its operators are not liable for any direct, indirect, incidental, consequential, or punitive damages arising from your use of the site or reliance on its outputs.</p>

    <h2 class="text-xl font-semibold mt-6">External links and ads</h2>
    <p>Pages may contain ads (via Google AdSense) and links to third-party sites. We do not endorse or vouch for the products or content of third parties.</p>

    <h2 class="text-xl font-semibold mt-6">Intellectual property</h2>
    <p>The site's design, code, and original written content are © CalcKDP. The IRS data we cite (e.g., Rev. Proc. 2025-32) is in the public domain and attributed to its source.</p>

    <h2 class="text-xl font-semibold mt-6">Changes</h2>
    <p>We may update these terms from time to time. Continued use of the site means you accept the current terms.</p>

    <h2 class="text-xl font-semibold mt-6">Contact</h2>
    <p>See <a href="/contact/" class="text-blue-600 hover:underline">Contact</a>.</p>
  </article>
</BaseLayout>
```

- [ ] **Step 2: Build & commit**

```bash
cd <workspace>/Coding/kedoupi/kdp-tools/calc && npm run build && \
git -C <workspace>/Coding/kedoupi/kdp-tools add calc/src/pages/terms/index.astro && \
git -C <workspace>/Coding/kedoupi/kdp-tools commit -m "$(cat <<'EOF'
feat(calc): /terms/ page

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && git -C <workspace>/Coding/kedoupi/kdp-tools push
```

---

## Task 16: About page

**Files:**
- Create: `src/pages/about/index.astro`

- [ ] **Step 1: Create page**

`src/pages/about/index.astro`:

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';

const title = 'About CalcKDP';
const description = 'CalcKDP builds fast, ad-supported financial calculators for US users. No signup, no tracking beyond anonymous analytics, results computed in your browser.';
---
<BaseLayout title={title} description={description} pathname="/about/" schemaType="WebPage">
  <article class="prose-like max-w-3xl space-y-4">
    <h1 class="text-3xl font-bold tracking-tight">About CalcKDP</h1>
    <p class="text-sm text-slate-500">A fast, no-signup financial calculator site.</p>

    <h2 class="text-xl font-semibold mt-6">What this is</h2>
    <p>CalcKDP is a small set of financial calculators for US users — mortgage, auto loan, compound interest, paycheck, and federal income tax. Each tool runs entirely in your browser, gives instant results as you type, and shows the underlying math so you can verify what's happening.</p>

    <h2 class="text-xl font-semibold mt-6">Why it exists</h2>
    <p>Most online calculators are slow, require email signups for "premium features," hide the math, and hammer you with intrusive ads. We built CalcKDP because we wanted the opposite: instant, transparent, free.</p>

    <h2 class="text-xl font-semibold mt-6">How we keep it free</h2>
    <p>The site is supported by Google AdSense. We aim to keep ads non-intrusive — fixed layout positions, no auto-playing video, no popups. If you'd like to support us further, simply share a link.</p>

    <h2 class="text-xl font-semibold mt-6">Our methodology</h2>
    <ul class="list-disc pl-6 space-y-1">
      <li><strong>Tax data</strong>: We cite the IRS source (Revenue Procedure number) for every published table. 2026 brackets are from Rev. Proc. 2025-32.</li>
      <li><strong>Math</strong>: Every calculator shows its formula in a "Show the math" section, so you can verify or learn. No black boxes.</li>
      <li><strong>Open source</strong>: The site's code is on GitHub at <a href="https://github.com/kedoupi/kdp-tools" class="text-blue-600 hover:underline">github.com/kedoupi/kdp-tools</a>. Found a bug? Open an issue.</li>
    </ul>

    <h2 class="text-xl font-semibold mt-6">What's next</h2>
    <p>Coming soon: scenario comparison (60/72/84-month auto loan side-by-side), CSV export of amortization schedules, more calculators, and a 2026 OBBBA-specific tax features pass (senior bonus deduction, tip and overtime exclusions). See the <a href="https://github.com/kedoupi/kdp-tools" class="text-blue-600 hover:underline">repo roadmap</a>.</p>

    <h2 class="text-xl font-semibold mt-6">Contact</h2>
    <p>See <a href="/contact/" class="text-blue-600 hover:underline">Contact</a>.</p>
  </article>
</BaseLayout>
```

- [ ] **Step 2: Build & commit**

```bash
cd <workspace>/Coding/kedoupi/kdp-tools/calc && npm run build && \
git -C <workspace>/Coding/kedoupi/kdp-tools add calc/src/pages/about/index.astro && \
git -C <workspace>/Coding/kedoupi/kdp-tools commit -m "$(cat <<'EOF'
feat(calc): /about/ page

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && git -C <workspace>/Coding/kedoupi/kdp-tools push
```

---

## Task 17: Contact page

**Files:**
- Create: `src/pages/contact/index.astro`

- [ ] **Step 1: Create page**

`src/pages/contact/index.astro`:

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';

const title = 'Contact';
const description = 'Reach the CalcKDP team. We read every email — bug reports, feature requests, and feedback all welcome.';
---
<BaseLayout title={title} description={description} pathname="/contact/" schemaType="WebPage">
  <article class="prose-like max-w-3xl space-y-4">
    <h1 class="text-3xl font-bold tracking-tight">Contact</h1>

    <p>The fastest way to reach us is email:</p>
    <p class="text-lg"><a href="mailto:hello@kdp.cool" class="text-blue-600 hover:underline">hello@kdp.cool</a></p>

    <p class="text-sm text-slate-600">We read everything — bug reports, feature requests, calculator suggestions, and corrections to the math or tax data are all welcome. Replies usually within a few days.</p>

    <h2 class="text-xl font-semibold mt-6">Found a bug?</h2>
    <p>Source code is on <a href="https://github.com/kedoupi/kdp-tools" class="text-blue-600 hover:underline">GitHub</a>. Open an issue with the page URL, what you entered, what you expected, and what you got. Screenshots help.</p>

    <h2 class="text-xl font-semibold mt-6">Looking for a calculator we don't have?</h2>
    <p>Email or open a GitHub issue. We prioritize calculators that get high search volume and have authoritative source data we can cite.</p>
  </article>
</BaseLayout>
```

(`hello@kdp.cool` should be set up as a forwarding address in Cloudflare Email Routing — that's a one-time setup outside this plan.)

- [ ] **Step 2: Build & commit**

```bash
cd <workspace>/Coding/kedoupi/kdp-tools/calc && npm run build && \
git -C <workspace>/Coding/kedoupi/kdp-tools add calc/src/pages/contact/index.astro && \
git -C <workspace>/Coding/kedoupi/kdp-tools commit -m "$(cat <<'EOF'
feat(calc): /contact/ page

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && git -C <workspace>/Coding/kedoupi/kdp-tools push
```

---

## Task 18: Update homepage with all 5 calculators + legal links

**Files:**
- Modify: `src/pages/index.astro`

- [ ] **Step 1: Replace `calculators` array**

In `src/pages/index.astro`, replace the entire `const calculators = [...]` block with:

```js
const calculators = [
  { href: '/mortgage-calculator/',         name: 'Mortgage Calculator',          blurb: 'Estimate your monthly mortgage payment including principal, interest, property tax, and home insurance.' },
  { href: '/auto-loan-calculator/',        name: 'Auto Loan Calculator',         blurb: 'Compute your monthly car payment, total interest, and out-the-door cost. Sales tax included.' },
  { href: '/compound-interest-calculator/',name: 'Compound Interest Calculator', blurb: 'Project your investment growth over time with regular contributions. Year-by-year chart.' },
  { href: '/paycheck-calculator/',         name: 'Paycheck Calculator',          blurb: 'See your real take-home pay after federal tax, FICA, state tax, and 401(k).' },
  { href: '/income-tax-calculator/',       name: 'Income Tax Calculator (2026)', blurb: 'Estimate your 2026 US federal income tax with full bracket breakdown.' },
];
```

**Remove the `available` field from cards** (everything is available now). In the `{calculators.map(...)}` JSX, replace:

```astro
{c.available ? (
  <a href={c.href} class="inline-block text-sm font-medium text-blue-600 hover:text-blue-700">Use Calculator →</a>
) : (
  <span class="inline-block text-sm font-medium text-slate-400">Coming soon</span>
)}
```

With:

```astro
<a href={c.href} class="inline-block text-sm font-medium text-blue-600 hover:text-blue-700">Use Calculator →</a>
```

And remove the `available` ternary from the article's class:

```astro
<article class={`rounded-lg border p-5 transition ${c.available ? 'border-slate-200 hover:border-blue-500 hover:shadow' : 'border-slate-200 opacity-60'}`}>
```

becomes:

```astro
<article class="rounded-lg border border-slate-200 p-5 transition hover:border-blue-500 hover:shadow">
```

- [ ] **Step 2: Add legal links section before the bottom AdSense**

Find the line `<AdSense adSlot="home-bottom" style="min-height:90px" />` near the end of the BaseLayout body. **Just BEFORE** that line, insert:

```astro
  <section class="mt-12 pt-8 border-t border-slate-200">
    <h2 class="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">About this site</h2>
    <ul class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
      <li><a href="/about/" class="text-blue-600 hover:underline">About CalcKDP</a></li>
      <li><a href="/privacy/" class="text-blue-600 hover:underline">Privacy Policy</a></li>
      <li><a href="/terms/" class="text-blue-600 hover:underline">Terms of Service</a></li>
      <li><a href="/contact/" class="text-blue-600 hover:underline">Contact</a></li>
    </ul>
  </section>
```

- [ ] **Step 3: Build & smoke test**

```bash
cd <workspace>/Coding/kedoupi/kdp-tools/calc && npm run build
grep -c 'auto-loan-calculator' dist/index.html
grep -c '/privacy/' dist/index.html
```

Expected: build succeeds, both grep counts ≥1.

- [ ] **Step 4: Commit**

```bash
git -C <workspace>/Coding/kedoupi/kdp-tools add calc/src/pages/index.astro && \
git -C <workspace>/Coding/kedoupi/kdp-tools commit -m "$(cat <<'EOF'
feat(calc): homepage shows all 5 calculators + legal links section

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && git -C <workspace>/Coding/kedoupi/kdp-tools push
```

---

## Task 19: Final verification — full build, all tests, smoke check production URLs

- [ ] **Step 1: Clean rebuild + run every test**

```bash
cd <workspace>/Coding/kedoupi/kdp-tools/calc && rm -rf dist && npm test && npm run build
```

Expected:
- `npm test`: ≥25 tests pass, 0 fail
- `npm run build`: 9 pages built (5 calculators + index + 4 legal/about), sitemap-index.xml + sitemap-0.xml emitted

- [ ] **Step 2: Verify dist contents**

```bash
cd <workspace>/Coding/kedoupi/kdp-tools/calc && find dist -name 'index.html' | sort
```

Expected: 9 lines —
```
dist/about/index.html
dist/auto-loan-calculator/index.html
dist/compound-interest-calculator/index.html
dist/contact/index.html
dist/income-tax-calculator/index.html
dist/index.html
dist/mortgage-calculator/index.html
dist/paycheck-calculator/index.html
dist/privacy/index.html
dist/terms/index.html
```

(That's 10 lines — 9 if you don't count the homepage `dist/index.html` separately. 5 calc + 4 legal/brand + 1 home = 10. Let me double-count: mortgage, auto-loan, compound-interest, paycheck, income-tax (5), privacy, terms, about, contact (4), index (1) = 10. Good.)

- [ ] **Step 3: Sitemap content**

```bash
cd <workspace>/Coding/kedoupi/kdp-tools/calc && grep -c '<loc>' dist/sitemap-0.xml
```

Expected: 10.

- [ ] **Step 4: Wait for production deployment, smoke-check**

After Task 18's push lands on CF Pages and the build completes (typically 60-90s), curl-check production:

```bash
for slug in '' 'mortgage-calculator/' 'auto-loan-calculator/' 'compound-interest-calculator/' 'paycheck-calculator/' 'income-tax-calculator/' 'privacy/' 'terms/' 'about/' 'contact/'; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "https://calc.kdp.cool/${slug}")
  echo "${code} https://calc.kdp.cool/${slug}"
done
```

Expected: 10 lines, all `200`.

- [ ] **Step 5: Verify a calculator URL state works in production**

```bash
curl -s "https://calc.kdp.cool/mortgage-calculator/?homePrice=600000&rate=5&termYears=15" -o /tmp/mt.html
grep -c 'mortgage-form' /tmp/mt.html
```

Expected: ≥1 (the page renders).

- [ ] **Step 6: Manual browser check** (have user perform)

Hand off to user — open these URLs in a browser and verify:
- `https://calc.kdp.cool/` — 5 cards, all clickable
- `https://calc.kdp.cool/mortgage-calculator/?homePrice=600000&rate=5&termYears=15` — values pre-fill, results update on edit, "Show the math" expands
- `https://calc.kdp.cool/income-tax-calculator/?income=120000&status=mfj` — bracket-stair renders with marker
- Mobile width 375px on at least 2 calculators — layout stacks, no horizontal scroll
- Footer links go to /privacy/, /terms/, /about/, /contact/

- [ ] **Step 7: No commit needed** — this task only verifies prior commits.

---

## Task 20: AdSense submission

**Files:**
- Modify: `src/layouts/BaseLayout.astro` (uncomment AdSense script tag)

- [ ] **Step 1: User signs up at AdSense**

Hand off to user: visit https://www.google.com/adsense/start/ , sign up with the kedoupi Google account, add `calc.kdp.cool` as a site, copy the `ca-pub-XXXXXXXXXXXXXXXX` client ID from the AdSense dashboard, and paste it back to the agent.

- [ ] **Step 2: Inject AdSense script into BaseLayout**

In `src/layouts/BaseLayout.astro`, find the existing comment line:

```astro
  <!-- AdSense script slot (uncomment + paste your client id after approval) -->
  <!-- <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-XXXXXXXXXXXXXXXX" crossorigin="anonymous"></script> -->
```

Replace with (substituting the real `ca-pub-...` ID provided by user):

```astro
  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-REAL_CLIENT_ID_HERE" crossorigin="anonymous"></script>
```

- [ ] **Step 3: Build, deploy, verify the script appears in production**

```bash
cd <workspace>/Coding/kedoupi/kdp-tools/calc && npm run build
git -C <workspace>/Coding/kedoupi/kdp-tools add calc/src/layouts/BaseLayout.astro && \
git -C <workspace>/Coding/kedoupi/kdp-tools commit -m "feat(calc): inject AdSense script (client ca-pub-...)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>" && \
git -C <workspace>/Coding/kedoupi/kdp-tools push
```

After CF Pages redeploys (~60-90s), verify:

```bash
curl -s https://calc.kdp.cool/ | grep -c 'pagead2.googlesyndication.com'
```

Expected: ≥1.

- [ ] **Step 4: Submit for review in AdSense dashboard**

Hand off to user. AdSense reviewer will visit pages over 1-14 days. Once approved:
- AdSense.astro placeholder body should be replaced with real `<ins class="adsbygoogle" data-ad-client=... data-ad-slot=...>` markup, and the placeholder div removed. (This is **out of scope for Phase 1** but should be the immediate next commit.)

---

## Self-Review

**Spec coverage:**

| Spec section | Implemented in task |
| --- | --- |
| §1 Goal & success criteria | Task 19 verifies; Task 20 submits |
| §2 Differentiation strategy: instant-update | Tasks 4, 8, 10, 12, 13 (every page) |
| §2 Differentiation: zero-CLS ads | All page tasks reserve `min-height` |
| §2 Differentiation: URL state | Task 3 (util) + Tasks 4, 8, 10, 12, 13 (consume) |
| §2 Differentiation: Show the math | Tasks 4, 8, 10, 12, 13 (every page) |
| §2 P1.5 deferrals | Spec §11; not in plan ✓ |
| §3.1 amortization primitive | Task 1 |
| §3.1 federal-tax primitive | Task 6 |
| §3.2 mortgage refactor | Task 1 |
| §3.2 auto-loan | Task 7 |
| §3.2 compound-interest | Task 9 |
| §3.2 income-tax | Task 11 |
| §3.2 paycheck | Task 13 |
| §3.3 ≥25 tests | Tasks 1+3+6+7+9+11+13 add 4+5+6+4+4+5+5 = 33 tests + 3 existing mortgage = 36 |
| §4 page structure (3 ad slots, BaseLayout, CalculatorShell) | All page tasks |
| §4.2 url-state util | Task 3 |
| §4.3 "Show the math" | Tasks 4, 8, 10, 12, 13 |
| §4.4 charts.js | Task 2 |
| §4.5 per-page details | Tasks 4 (mortgage), 8, 10, 12, 13 |
| §5 legal pages | Tasks 14-17 |
| §6 homepage update | Task 18 |
| §7 refactoring pass | Tasks 1-5 (in order) |
| §8 SEO targets | Each page task sets title/description/canonical |
| §9 perf budget | No framework JS; sub-100KB per page implicit |
| §10 AdSense submission | Task 20 |
| §11 out of scope | Acknowledged; not in plan ✓ |

**Placeholder scan:** none. All "TBD"-style language scrubbed. P1.5 references are explicit deferrals, not placeholders.

**Type consistency:**
- `calcAmortizedLoan(input)` returns `{ monthlyPayment, totalInterest, totalPaid }` — used identically by Task 1 (mortgage refactor) and Task 7 (auto-loan).
- `calcFederalIncomeTax` returns `{ tax, effectiveRate, marginalRate, bracketBreakdown }` — used identically by Task 11 (income-tax) and Task 13 (paycheck).
- `TAX_DATA_2026` shape used identically across federal-tax, income-tax, paycheck tasks.
- `decodeState`, `pushUrlState` — same signatures used in mortgage, auto-loan, compound-interest, income-tax, paycheck pages.
- `renderPie` — used by mortgage, auto-loan, paycheck.
- `renderLineChart` — used by compound-interest only.

**Outstanding concerns the user/implementer should know:**
- `hello@kdp.cool` mailto needs Cloudflare Email Routing set up (one-time, outside plan).
- AdSense client ID (Task 20) is a real handoff to user.
- "Show the math" on tax page is `<details open>` (always visible) for SEO weight; others are collapsed by default. Intentional.
