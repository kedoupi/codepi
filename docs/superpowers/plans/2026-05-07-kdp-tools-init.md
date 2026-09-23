# kdp-tools Monorepo + calc.kdp.cool Mortgage Calculator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap monorepo at `<workspace>/Coding/kedoupi/kdp-tools` with the first sub-site `calc/` (Astro + Tailwind + sitemap) and ship a US mortgage calculator at `/mortgage-calculator/` deployable to Cloudflare Pages.

**Architecture:** Static Astro site (`output: 'static'`). No backend. Calculator logic in a single pure JS module shared by client-side script and the unit test. Pie chart rendered as inline SVG (no chart library). `shared/` directory created as a placeholder for future cross-site components — v1 keeps everything in `calc/` to avoid premature abstraction.

**Tech Stack:** Astro 5 (minimal template, strict TS), `@astrojs/tailwind`, `@astrojs/sitemap`, Tailwind CSS, vanilla JS + inline SVG, `node:test` for unit tests (zero new deps).

**Verification policy:** No git commits or pushes. After each major task, run `npm run build` (and `npm run preview` at the end). Mark final summary as **Verified** only if the user can hit `/` and `/mortgage-calculator/` in a browser.

---

### Task 1: Create monorepo skeleton

**Files:**
- Create: `<workspace>/Coding/kedoupi/kdp-tools/shared/components/.gitkeep`
- Create: `<workspace>/Coding/kedoupi/kdp-tools/shared/layouts/.gitkeep`
- Create: `<workspace>/Coding/kedoupi/kdp-tools/.gitignore`

- [ ] **Step 1: Create shared placeholder directories**

```bash
mkdir -p <workspace>/Coding/kedoupi/kdp-tools/shared/components
mkdir -p <workspace>/Coding/kedoupi/kdp-tools/shared/layouts
touch <workspace>/Coding/kedoupi/kdp-tools/shared/components/.gitkeep
touch <workspace>/Coding/kedoupi/kdp-tools/shared/layouts/.gitkeep
```

- [ ] **Step 2: Create root .gitignore**

Path: `<workspace>/Coding/kedoupi/kdp-tools/.gitignore`

```
# deps
node_modules/

# build
dist/
.astro/

# logs
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*

# env
.env
.env.production
.env.local

# editors / OS
.DS_Store
.vscode/
.idea/

# Cloudflare
.wrangler/
```

- [ ] **Step 3: Verify**

```bash
ls <workspace>/Coding/kedoupi/kdp-tools
ls <workspace>/Coding/kedoupi/kdp-tools/shared
```

Expected: `shared/`, `.gitignore` at root; `components/ layouts/` under `shared/`.

---

### Task 2: Scaffold Astro project in `calc/`

**Files:**
- Create: `calc/` (via Astro CLI)

- [ ] **Step 1: Run non-interactive Astro init**

```bash
cd <workspace>/Coding/kedoupi/kdp-tools && npm create astro@latest calc -- --template minimal --install --no-git --typescript strict --skip-houston --yes
```

Expected: directory `calc/` created with `package.json`, `astro.config.mjs`, `tsconfig.json`, `src/pages/index.astro`, `node_modules/`. No git init.

- [ ] **Step 2: Sanity build**

```bash
cd <workspace>/Coding/kedoupi/kdp-tools/calc && npm run build
```

Expected: `dist/` generated, exit code 0.

- [ ] **Step 3: Remove the default starter page so it doesn't interfere with Task 9**

```bash
rm -f <workspace>/Coding/kedoupi/kdp-tools/calc/src/pages/index.astro
```

(The starter `index.astro` will be replaced by our custom homepage in Task 9.)

---

### Task 3: Add Tailwind + Sitemap integrations

**Files:**
- Modify: `calc/package.json` (deps added by CLI)
- Modify: `calc/astro.config.mjs`
- Modify: `calc/tailwind.config.mjs` (created by add command)
- Modify: `calc/src/styles/global.css` (created)

- [ ] **Step 1: Add Tailwind**

```bash
cd <workspace>/Coding/kedoupi/kdp-tools/calc && npx astro add tailwind --yes
```

Expected: `@astrojs/tailwind` and `tailwindcss` in `package.json`; `tailwind.config.mjs` created; `astro.config.mjs` updated with `tailwind()` integration.

- [ ] **Step 2: Add Sitemap**

```bash
cd <workspace>/Coding/kedoupi/kdp-tools/calc && npx astro add sitemap --yes
```

Expected: `@astrojs/sitemap` added; `astro.config.mjs` updated with `sitemap()`.

- [ ] **Step 3: Replace `astro.config.mjs` with the canonical config**

Path: `calc/astro.config.mjs`

```js
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://calc.kdp.cool',
  output: 'static',
  trailingSlash: 'always',
  build: {
    format: 'directory',
  },
  integrations: [tailwind(), sitemap()],
});
```

(`trailingSlash: 'always'` + `format: 'directory'` makes `/mortgage-calculator/` a clean URL with `index.html` inside, matching the spec's canonical URL.)

- [ ] **Step 4: Confirm Tailwind config has the right content globs**

Path: `calc/tailwind.config.mjs`

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,ts,tsx,md,mdx}'],
  theme: {
    extend: {},
  },
  plugins: [],
};
```

- [ ] **Step 5: Build to verify integrations wire up**

```bash
cd <workspace>/Coding/kedoupi/kdp-tools/calc && npm run build
```

Expected: build succeeds even though there are no pages yet (Astro will emit a warning about no pages — fine; we'll add pages next).
If Astro hard-errors on zero pages, skip this step — Task 9 will add pages.

---

### Task 4: Pure mortgage math module + unit test

**Files:**
- Create: `calc/src/lib/mortgage.js`
- Create: `calc/src/lib/mortgage.test.mjs`

- [ ] **Step 1: Write the failing test FIRST**

Path: `calc/src/lib/mortgage.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcMortgage } from './mortgage.js';

test('30-year fixed at 6.5% on $400k with 20% down', () => {
  const r = calcMortgage({
    homePrice: 400000,
    downPayment: 80000,
    annualRatePct: 6.5,
    termYears: 30,
    annualPropertyTax: 5000,
    annualInsurance: 1500,
  });
  // P = 320000, monthly r = 0.065/12, n = 360
  // M = 2022.62 (rounded)
  assert.equal(Math.round(r.monthlyPI), 2023);
  assert.equal(Math.round(r.monthlyTax), 417);     // 5000/12
  assert.equal(Math.round(r.monthlyInsurance), 125); // 1500/12
  assert.equal(Math.round(r.monthlyTotal), 2565);  // 2023 + 417 + 125
});

test('zero interest rate falls back to even split', () => {
  const r = calcMortgage({
    homePrice: 120000,
    downPayment: 0,
    annualRatePct: 0,
    termYears: 10,
    annualPropertyTax: 0,
    annualInsurance: 0,
  });
  assert.equal(Math.round(r.monthlyPI), 1000); // 120000 / 120
  assert.equal(r.monthlyTotal, r.monthlyPI);
});

test('100% down payment yields zero P&I', () => {
  const r = calcMortgage({
    homePrice: 300000,
    downPayment: 300000,
    annualRatePct: 7,
    termYears: 30,
    annualPropertyTax: 0,
    annualInsurance: 0,
  });
  assert.equal(r.monthlyPI, 0);
});
```

- [ ] **Step 2: Run test and confirm it fails**

```bash
cd <workspace>/Coding/kedoupi/kdp-tools/calc && node --test src/lib/mortgage.test.mjs
```

Expected: FAIL — module `./mortgage.js` not found.

- [ ] **Step 3: Implement the module**

Path: `calc/src/lib/mortgage.js`

```js
/**
 * Compute US mortgage monthly cost breakdown.
 *
 * @param {object} input
 * @param {number} input.homePrice - Total home price in USD.
 * @param {number} input.downPayment - Down payment in USD.
 * @param {number} input.annualRatePct - Annual interest rate, as a percent (e.g. 6.5).
 * @param {number} input.termYears - Loan term in years (10, 15, 20, 30).
 * @param {number} [input.annualPropertyTax=0] - Annual property tax in USD.
 * @param {number} [input.annualInsurance=0] - Annual home insurance in USD.
 * @returns {{
 *   loanPrincipal: number,
 *   monthlyPI: number,
 *   monthlyTax: number,
 *   monthlyInsurance: number,
 *   monthlyTotal: number,
 * }}
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
  const n = termYears * 12;
  const r = annualRatePct / 100 / 12;

  let monthlyPI;
  if (principal === 0 || n === 0) {
    monthlyPI = 0;
  } else if (r === 0) {
    monthlyPI = principal / n;
  } else {
    const pow = Math.pow(1 + r, n);
    monthlyPI = (principal * r * pow) / (pow - 1);
  }

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

- [ ] **Step 4: Run test and confirm pass**

```bash
cd <workspace>/Coding/kedoupi/kdp-tools/calc && node --test src/lib/mortgage.test.mjs
```

Expected: 3/3 tests pass.

- [ ] **Step 5: Add a `test` script to `package.json`**

Modify `calc/package.json` — add to `scripts`:

```json
"test": "node --test src/lib/*.test.mjs"
```

Verify:

```bash
cd <workspace>/Coding/kedoupi/kdp-tools/calc && npm test
```

Expected: tests pass.

---

### Task 5: AdSense placeholder component

**Files:**
- Create: `calc/src/components/AdSense.astro`

- [ ] **Step 1: Create the component**

Path: `calc/src/components/AdSense.astro`

```astro
---
interface Props {
  slot: string;
  format?: string;
  style?: string;
  label?: string;
}
const { slot, format = 'auto', style = '', label = 'Advertisement' } = Astro.props;
---
<!-- AdSense Placeholder - Replace with real <ins class="adsbygoogle"> after approval -->
<div
  class="adsense-placeholder w-full flex items-center justify-center bg-slate-100 text-slate-400 text-xs uppercase tracking-wider border border-dashed border-slate-300 rounded my-4"
  data-slot={slot}
  data-format={format}
  style={style}
  aria-label={label}
>
  <span class="py-6">{label} ({slot})</span>
</div>
```

(Visible placeholder during dev; later we swap the inner block for the real `<ins class="adsbygoogle">` plus the `adsbygoogle.push({})` script.)

---

### Task 6: BaseLayout with SEO + AdSense head slot

**Files:**
- Create: `calc/src/layouts/BaseLayout.astro`

- [ ] **Step 1: Create layout**

Path: `calc/src/layouts/BaseLayout.astro`

```astro
---
interface Props {
  title: string;
  description: string;
  pathname: string; // e.g. "/mortgage-calculator/"
  schemaType?: 'WebApplication' | 'WebSite';
}
const SITE = 'https://calc.kdp.cool';
const SITE_NAME = 'CalcKDP';
const { title, description, pathname, schemaType = 'WebApplication' } = Astro.props;
const canonicalURL = new URL(pathname, SITE).toString();
const fullTitle = `${title} | ${SITE_NAME}`;

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': schemaType,
  name: title,
  url: canonicalURL,
  description,
  ...(schemaType === 'WebApplication' ? { applicationCategory: 'FinanceApplication' } : {}),
};
---
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{fullTitle}</title>
  <meta name="description" content={description} />
  <meta name="robots" content="index, follow" />
  <link rel="canonical" href={canonicalURL} />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />

  <meta property="og:title" content={title} />
  <meta property="og:description" content={description} />
  <meta property="og:url" content={canonicalURL} />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content={SITE_NAME} />

  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content={title} />
  <meta name="twitter:description" content={description} />

  <script type="application/ld+json" set:html={JSON.stringify(jsonLd)} />

  <!-- AdSense script slot (uncomment + paste your client id after approval) -->
  <!-- <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-XXXXXXXXXXXXXXXX" crossorigin="anonymous"></script> -->
</head>
<body class="min-h-screen bg-white text-slate-900 antialiased">
  <header class="border-b border-slate-200">
    <div class="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
      <a href="/" class="font-bold text-lg tracking-tight">CalcKDP</a>
      <nav class="text-sm text-slate-600">
        <a href="/" class="hover:text-slate-900">Calculators</a>
      </nav>
    </div>
  </header>

  <main class="max-w-5xl mx-auto px-4 py-8">
    <slot />
  </main>

  <footer class="border-t border-slate-200 mt-16">
    <div class="max-w-5xl mx-auto px-4 py-6 text-sm text-slate-500 flex flex-col sm:flex-row gap-2 sm:gap-4 sm:justify-between">
      <p>© {new Date().getFullYear()} CalcKDP. Free financial calculators for US users.</p>
      <p>Results are estimates only. Not financial advice.</p>
    </div>
  </footer>
</body>
</html>
```

---

### Task 7: CalculatorShell wrapper component

**Files:**
- Create: `calc/src/components/CalculatorShell.astro`

- [ ] **Step 1: Create the shell**

Path: `calc/src/components/CalculatorShell.astro`

```astro
---
interface Props {
  title: string;
  intro?: string;
}
const { title, intro } = Astro.props;
---
<section class="space-y-2 mb-6">
  <h1 class="text-3xl sm:text-4xl font-bold tracking-tight">{title}</h1>
  {intro && <p class="text-slate-600 max-w-2xl">{intro}</p>}
</section>

<slot name="top-ad" />

<section class="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
  <div class="bg-white border border-slate-200 rounded-lg p-5">
    <slot name="inputs" />
  </div>
  <div class="bg-slate-50 border border-slate-200 rounded-lg p-5">
    <slot name="results" />
  </div>
</section>

<slot name="middle-ad" />

<section class="prose prose-slate max-w-none mt-10">
  <slot name="content" />
</section>

<slot name="bottom-ad" />
```

---

### Task 8: Mortgage calculator page

**Files:**
- Create: `calc/src/pages/mortgage-calculator/index.astro`

This is the largest task — we build form, results, pie chart, and the inline `<script>` that wires it all together.

- [ ] **Step 1: Create the page file with full markup**

Path: `calc/src/pages/mortgage-calculator/index.astro`

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
import CalculatorShell from '../../components/CalculatorShell.astro';
import AdSense from '../../components/AdSense.astro';

const title = 'Mortgage Calculator - Free Monthly Payment Calculator 2026';
const description = 'Calculate your monthly mortgage payment instantly. Enter home price, down payment, interest rate and loan term. Free mortgage calculator for US home buyers.';
---
<BaseLayout title={title} description={description} pathname="/mortgage-calculator/">
  <CalculatorShell
    title="Mortgage Calculator"
    intro="Estimate your monthly mortgage payment, including principal & interest, property tax, and homeowners insurance."
  >
    <AdSense slot="mortgage-top" style="min-height:90px" slot:="top-ad" />

    <form id="mortgage-form" class="space-y-5" slot="inputs" autocomplete="off">
      <div>
        <label for="home-price" class="block text-sm font-medium text-slate-700 mb-1">Home Price</label>
        <div class="relative">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
          <input id="home-price" name="homePrice" type="number" min="0" step="1000" value="400000"
                 class="w-full pl-7 pr-3 py-2 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      <div>
        <div class="flex items-center justify-between mb-1">
          <label for="down-payment" class="block text-sm font-medium text-slate-700">Down Payment</label>
          <div class="text-xs">
            <button type="button" data-down-mode="percent" class="down-toggle px-2 py-0.5 rounded bg-blue-600 text-white">%</button>
            <button type="button" data-down-mode="amount" class="down-toggle px-2 py-0.5 rounded bg-slate-200 text-slate-700">$</button>
          </div>
        </div>
        <div class="relative">
          <span id="down-prefix" class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">%</span>
          <input id="down-payment" name="downPayment" type="number" min="0" step="0.5" value="20"
                 class="w-full pl-7 pr-3 py-2 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      <div>
        <span class="block text-sm font-medium text-slate-700 mb-1">Loan Term</span>
        <div class="grid grid-cols-4 gap-2">
          <button type="button" data-term="10" class="term-btn py-2 rounded border border-slate-300 bg-white">10 yr</button>
          <button type="button" data-term="15" class="term-btn py-2 rounded border border-slate-300 bg-white">15 yr</button>
          <button type="button" data-term="20" class="term-btn py-2 rounded border border-slate-300 bg-white">20 yr</button>
          <button type="button" data-term="30" class="term-btn py-2 rounded border-blue-600 bg-blue-600 text-white">30 yr</button>
        </div>
        <input type="hidden" id="term-years" name="termYears" value="30" />
      </div>

      <div>
        <label for="rate" class="block text-sm font-medium text-slate-700 mb-1">Interest Rate</label>
        <div class="relative">
          <input id="rate" name="annualRatePct" type="number" min="0" step="0.01" value="6.5"
                 class="w-full pr-7 pl-3 py-2 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <span class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">%</span>
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label for="tax" class="block text-sm font-medium text-slate-700 mb-1">Property Tax / yr</label>
          <div class="relative">
            <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
            <input id="tax" name="annualPropertyTax" type="number" min="0" step="100" value="5000"
                   class="w-full pl-7 pr-3 py-2 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
        <div>
          <label for="ins" class="block text-sm font-medium text-slate-700 mb-1">Home Insurance / yr</label>
          <div class="relative">
            <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
            <input id="ins" name="annualInsurance" type="number" min="0" step="100" value="1500"
                   class="w-full pl-7 pr-3 py-2 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
      </div>
    </form>

    <div slot="results" class="space-y-5">
      <div>
        <p class="text-sm uppercase tracking-wider text-slate-500">Monthly Payment</p>
        <p id="r-total" class="text-4xl sm:text-5xl font-bold text-slate-900 tabular-nums">$0</p>
      </div>

      <div class="flex items-center gap-5">
        <svg id="r-chart" viewBox="0 0 100 100" class="w-32 h-32 shrink-0" aria-label="Monthly cost breakdown">
          <!-- segments injected by JS -->
        </svg>
        <ul class="text-sm space-y-1.5 flex-1">
          <li class="flex items-center justify-between gap-3">
            <span class="flex items-center gap-2"><i class="w-3 h-3 rounded-sm bg-blue-600 inline-block"></i>Principal &amp; Interest</span>
            <span id="r-pi" class="tabular-nums font-medium">$0</span>
          </li>
          <li class="flex items-center justify-between gap-3">
            <span class="flex items-center gap-2"><i class="w-3 h-3 rounded-sm bg-emerald-500 inline-block"></i>Property Tax</span>
            <span id="r-tax" class="tabular-nums font-medium">$0</span>
          </li>
          <li class="flex items-center justify-between gap-3">
            <span class="flex items-center gap-2"><i class="w-3 h-3 rounded-sm bg-amber-500 inline-block"></i>Insurance</span>
            <span id="r-ins" class="tabular-nums font-medium">$0</span>
          </li>
          <li class="flex items-center justify-between gap-3 border-t border-slate-200 pt-2 mt-2">
            <span class="font-semibold">Total Monthly Cost</span>
            <span id="r-total-line" class="tabular-nums font-semibold">$0</span>
          </li>
        </ul>
      </div>

      <p class="text-xs text-slate-500">Loan amount: <span id="r-principal" class="tabular-nums">$0</span></p>
    </div>

    <AdSense slot="mortgage-middle" format="rectangle" style="min-height:250px;max-width:300px;margin-left:auto;margin-right:auto" slot:="middle-ad" />

    <div slot="content">
      <h2>How this mortgage calculator works</h2>
      <p>This tool uses the standard amortizing mortgage formula:</p>
      <p><code>M = P · [r(1+r)<sup>n</sup>] / [(1+r)<sup>n</sup> − 1]</code></p>
      <ul>
        <li><strong>P</strong> — loan principal (home price minus down payment)</li>
        <li><strong>r</strong> — monthly interest rate (annual rate ÷ 12)</li>
        <li><strong>n</strong> — total number of monthly payments (years × 12)</li>
      </ul>
      <p>Property tax and home insurance are divided by 12 and added to the monthly principal &amp; interest to estimate your total monthly housing cost (PITI).</p>
    </div>

    <AdSense slot="mortgage-bottom" style="min-height:90px" slot:="bottom-ad" />
  </CalculatorShell>

  <script type="module" src="/scripts/mortgage.js"></script>
</BaseLayout>
```

**Note:** Astro's named slot syntax is `slot="name"`, not `slot:="name"`. The above uses `slot="..."` for slot fills (top-ad, inputs, results, middle-ad, content, bottom-ad). Verify each `<AdSense ... slot="top-ad" />` etc. uses the correct syntax — fix any typo before saving.

- [ ] **Step 2: Create the client script**

Astro doesn't bundle bare `import` paths from inline `<script>` blocks the same way as inline scripts. Simpler: put the wiring code inline in the page using `<script>` (Astro will bundle it).

Replace the `<script type="module" src="/scripts/mortgage.js"></script>` line in the page above with this inline block at the end of the BaseLayout slot, just before `</BaseLayout>`:

```astro
<script>
  import { calcMortgage } from '../../lib/mortgage.js';

  const fmt = (n) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  const form = document.getElementById('mortgage-form');
  const termInput = document.getElementById('term-years');
  const downInput = document.getElementById('down-payment');
  const downPrefix = document.getElementById('down-prefix');
  const homePriceInput = document.getElementById('home-price');

  let downMode = 'percent'; // 'percent' | 'amount'

  function read() {
    const homePrice = +homePriceInput.value || 0;
    const downRaw = +downInput.value || 0;
    const downPayment = downMode === 'percent' ? (homePrice * downRaw) / 100 : downRaw;
    return {
      homePrice,
      downPayment,
      annualRatePct: +document.getElementById('rate').value || 0,
      termYears: +termInput.value || 30,
      annualPropertyTax: +document.getElementById('tax').value || 0,
      annualInsurance: +document.getElementById('ins').value || 0,
    };
  }

  function renderChart(parts) {
    // parts: [{value, color}, ...]
    const svg = document.getElementById('r-chart');
    const total = parts.reduce((s, p) => s + p.value, 0);
    if (!total) {
      svg.innerHTML = '<circle cx="50" cy="50" r="40" fill="#e2e8f0"/>';
      return;
    }
    const cx = 50, cy = 50, r = 40;
    let acc = 0;
    const paths = parts.map((p) => {
      if (p.value <= 0) return '';
      const start = (acc / total) * Math.PI * 2 - Math.PI / 2;
      acc += p.value;
      const end = (acc / total) * Math.PI * 2 - Math.PI / 2;
      const x1 = cx + r * Math.cos(start);
      const y1 = cy + r * Math.sin(start);
      const x2 = cx + r * Math.cos(end);
      const y2 = cy + r * Math.sin(end);
      const large = end - start > Math.PI ? 1 : 0;
      // single full-circle segment edge case
      if (Math.abs(end - start - Math.PI * 2) < 1e-6) {
        return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${p.color}"/>`;
      }
      return `<path d="M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z" fill="${p.color}"/>`;
    }).join('');
    svg.innerHTML = paths;
  }

  function update() {
    const inputs = read();
    const out = calcMortgage(inputs);
    document.getElementById('r-total').textContent = fmt(out.monthlyTotal);
    document.getElementById('r-total-line').textContent = fmt(out.monthlyTotal);
    document.getElementById('r-pi').textContent = fmt(out.monthlyPI);
    document.getElementById('r-tax').textContent = fmt(out.monthlyTax);
    document.getElementById('r-ins').textContent = fmt(out.monthlyInsurance);
    document.getElementById('r-principal').textContent = fmt(out.loanPrincipal);
    renderChart([
      { value: out.monthlyPI,        color: '#2563eb' }, // blue-600
      { value: out.monthlyTax,       color: '#10b981' }, // emerald-500
      { value: out.monthlyInsurance, color: '#f59e0b' }, // amber-500
    ]);
  }

  // input changes → update
  form.addEventListener('input', update);

  // term buttons
  document.querySelectorAll('.term-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.term-btn').forEach((b) => {
        b.classList.remove('bg-blue-600', 'text-white', 'border-blue-600');
        b.classList.add('bg-white', 'border-slate-300');
      });
      btn.classList.remove('bg-white', 'border-slate-300');
      btn.classList.add('bg-blue-600', 'text-white', 'border-blue-600');
      termInput.value = btn.dataset.term;
      update();
    });
  });

  // down-payment toggle
  document.querySelectorAll('.down-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const newMode = btn.dataset.downMode;
      if (newMode === downMode) return;
      const homePrice = +homePriceInput.value || 0;
      const cur = +downInput.value || 0;
      // convert value
      if (newMode === 'amount') {
        // currently percent → convert to dollars
        downInput.value = String(Math.round((homePrice * cur) / 100));
        downInput.step = '1000';
      } else {
        // amount → percent
        downInput.value = homePrice ? String(Math.round((cur / homePrice) * 1000) / 10) : '0';
        downInput.step = '0.5';
      }
      downMode = newMode;
      downPrefix.textContent = newMode === 'percent' ? '%' : '$';
      document.querySelectorAll('.down-toggle').forEach((b) => {
        const active = b.dataset.downMode === newMode;
        b.classList.toggle('bg-blue-600', active);
        b.classList.toggle('text-white', active);
        b.classList.toggle('bg-slate-200', !active);
        b.classList.toggle('text-slate-700', !active);
      });
      update();
    });
  });

  update(); // initial render
</script>
```

Notes for the implementer:
- Astro will bundle this inline `<script>` and resolve the relative `import` to `mortgage.js`. No `<script type="module" src="/scripts/...">` external file is needed.
- Remove the placeholder `<script type="module" src="/scripts/mortgage.js"></script>` line from Step 1 if you copied it.

- [ ] **Step 3: Build and check for errors**

```bash
cd <workspace>/Coding/kedoupi/kdp-tools/calc && npm run build
```

Expected: `dist/mortgage-calculator/index.html` exists, `dist/sitemap-index.xml` exists.

```bash
ls <workspace>/Coding/kedoupi/kdp-tools/calc/dist
ls <workspace>/Coding/kedoupi/kdp-tools/calc/dist/mortgage-calculator
```

---

### Task 9: Homepage with calculator card list

**Files:**
- Create: `calc/src/pages/index.astro`

- [ ] **Step 1: Create the homepage**

Path: `calc/src/pages/index.astro`

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
import AdSense from '../components/AdSense.astro';

const title = 'Free Financial Calculators for US Home Buyers & Investors';
const description = 'Free, fast, ad-supported financial calculators including a mortgage calculator, with more tools coming soon.';

const calculators = [
  {
    href: '/mortgage-calculator/',
    name: 'Mortgage Calculator',
    blurb: 'Estimate your monthly mortgage payment including principal, interest, property tax, and home insurance.',
    available: true,
  },
  {
    href: '#',
    name: 'Tax Calculator',
    blurb: 'Coming soon — federal income tax estimator for the 2026 tax year.',
    available: false,
  },
  {
    href: '#',
    name: 'Compound Interest Calculator',
    blurb: 'Coming soon — see how your investments grow over time.',
    available: false,
  },
];
---
<BaseLayout title={title} description={description} pathname="/" schemaType="WebSite">
  <section class="space-y-3 mb-10">
    <h1 class="text-3xl sm:text-4xl font-bold tracking-tight">Free Financial Calculators</h1>
    <p class="text-slate-600 max-w-2xl">
      Fast, no-signup financial calculators for US users. Today: mortgage payments. More tools coming soon.
    </p>
  </section>

  <AdSense slot="home-top" style="min-height:90px" />

  <section class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-8">
    {calculators.map((c) => (
      <article class={`rounded-lg border p-5 transition ${c.available ? 'border-slate-200 hover:border-blue-500 hover:shadow' : 'border-slate-200 opacity-60'}`}>
        <h2 class="text-lg font-semibold mb-1">{c.name}</h2>
        <p class="text-sm text-slate-600 mb-4">{c.blurb}</p>
        {c.available ? (
          <a href={c.href} class="inline-block text-sm font-medium text-blue-600 hover:text-blue-700">Use Calculator →</a>
        ) : (
          <span class="inline-block text-sm font-medium text-slate-400">Coming soon</span>
        )}
      </article>
    ))}
  </section>

  <AdSense slot="home-bottom" style="min-height:90px" />
</BaseLayout>
```

- [ ] **Step 2: Build**

```bash
cd <workspace>/Coding/kedoupi/kdp-tools/calc && npm run build
```

Expected: `dist/index.html` exists, `dist/mortgage-calculator/index.html` exists.

---

### Task 10: Static assets — favicon, robots.txt, _headers

**Files:**
- Create: `calc/public/favicon.svg`
- Create: `calc/public/robots.txt`
- Create: `calc/public/_headers`

- [ ] **Step 1: Favicon**

Path: `calc/public/favicon.svg`

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="12" fill="#2563eb"/>
  <text x="50%" y="58%" text-anchor="middle" font-family="ui-sans-serif, system-ui" font-size="32" font-weight="700" fill="white">$</text>
</svg>
```

Remove the default `calc/public/favicon.svg` if Astro shipped one — Write tool will overwrite.

- [ ] **Step 2: robots.txt**

Path: `calc/public/robots.txt`

```
User-agent: *
Allow: /

Sitemap: https://calc.kdp.cool/sitemap-index.xml
```

(Astro's `@astrojs/sitemap` emits `sitemap-index.xml` + `sitemap-0.xml` by default — point robots.txt to the index.)

- [ ] **Step 3: Cloudflare Pages headers**

Path: `calc/public/_headers`

```
/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: interest-cohort=()
```

- [ ] **Step 4: Build and confirm assets land in dist/**

```bash
cd <workspace>/Coding/kedoupi/kdp-tools/calc && npm run build
ls <workspace>/Coding/kedoupi/kdp-tools/calc/dist | grep -E '(robots|_headers|favicon|sitemap)'
```

Expected: `robots.txt`, `_headers`, `favicon.svg`, `sitemap-index.xml`, `sitemap-0.xml` all present.

---

### Task 11: Verification — preview and smoke test

- [ ] **Step 1: Run preview server (background)**

```bash
cd <workspace>/Coding/kedoupi/kdp-tools/calc && npm run preview
```

(Run in background; default port `4321`.)

- [ ] **Step 2: Curl-check the two pages**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4321/
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4321/mortgage-calculator/
```

Expected: `200` for both.

- [ ] **Step 3: Verify SEO output via curl**

```bash
curl -s http://localhost:4321/mortgage-calculator/ | grep -E '(<title>|name="description"|canonical|og:title|application/ld\+json)'
```

Expected:
- `<title>Mortgage Calculator - Free Monthly Payment Calculator 2026 | CalcKDP</title>`
- `<meta name="description" content="Calculate your monthly mortgage payment...">`
- `<link rel="canonical" href="https://calc.kdp.cool/mortgage-calculator/">`
- og tags + JSON-LD present.

- [ ] **Step 4: Manual user check**

Tell the user: open `http://localhost:4321/mortgage-calculator/` in their browser, verify:
- Inputs change → results update live
- Toggle %/$ on down payment works
- Term buttons highlight correctly
- Pie chart renders three colored segments
- Resize to ~375px width: layout stacks (inputs above, results below)

- [ ] **Step 5: Stop preview server**

Kill the background preview process.

---

### Task 12: Root README.md

**Files:**
- Create: `<workspace>/Coding/kedoupi/kdp-tools/README.md`

- [ ] **Step 1: Write README**

Path: `<workspace>/Coding/kedoupi/kdp-tools/README.md`

```markdown
# kdp-tools

Monorepo for the `kdp.cool` family of single-purpose web tools. Each subdirectory is one independent static site, deployed to Cloudflare Pages on its own subdomain.

## Layout

| Path     | Subdomain          | Stack                               | Status |
| -------- | ------------------ | ----------------------------------- | ------ |
| `calc/`  | `calc.kdp.cool`    | Astro + Tailwind, static            | active |
| `shared/`| —                  | Cross-site components / layouts     | placeholder |

## `calc/` — financial calculators

### Local development

```bash
cd calc
npm install
npm run dev       # http://localhost:4321
npm run build     # → calc/dist
npm run preview   # serves dist/
npm test          # runs node:test on src/lib/*.test.mjs
```

### Add a new calculator

1. Create `calc/src/pages/<slug>/index.astro`.
2. Use `BaseLayout` + `CalculatorShell` + `AdSense` like `mortgage-calculator/index.astro` does.
3. Put any pure math in `calc/src/lib/<slug>.js` and add `<slug>.test.mjs` next to it.
4. Add a card to the `calculators` array in `calc/src/pages/index.astro`.
5. `npm run build && npm run preview` to verify, then deploy.

### Cloudflare Pages settings

| Field                    | Value          |
| ------------------------ | -------------- |
| Framework preset         | Astro          |
| Build command            | `npm run build`|
| Build output directory   | `dist`         |
| Root directory           | `calc`         |
| Node.js version          | `20`           |

DNS: point `calc.kdp.cool` to the Pages project (CNAME via Cloudflare).

### AdSense

`<AdSense slot="..." />` renders a placeholder until the AdSense script in `BaseLayout.astro` is uncommented and `ca-pub-XXXXXXXXXXXXXXXX` is replaced with the real client ID. The placeholder block in `AdSense.astro` should then be replaced with the real `<ins class="adsbygoogle">` tag.
```

---

### Task 13: Final verification & summary

- [ ] **Step 1: Re-run full build from clean state**

```bash
cd <workspace>/Coding/kedoupi/kdp-tools/calc && rm -rf dist && npm run build && npm test
```

Expected: build succeeds, all unit tests pass.

- [ ] **Step 2: Cross-check verification list from spec**

| Item | Pass? |
| ---- | ----- |
| `npm run build` no errors | ☐ |
| `npm run preview` serves `/` and `/mortgage-calculator/` | ☐ |
| Calculator updates live | ☐ |
| Mobile (375px) layout OK | ☐ |
| `<title>` + `<meta description>` present | ☐ |
| `sitemap-index.xml` exists in `dist/` | ☐ |
| AdSense placeholders in 3 positions on calculator page | ☐ |

- [ ] **Step 3: Hand off**

Print final summary to user (Chinese, per their preferences):
- structure created
- key commands (`npm run dev`, `npm run build`, `npm run preview`, `npm test`)
- how to add a new calculator (point at README)
- mark **Verified** items vs **Unverified — please run X** items

---

## Self-Review Notes (run by author before handing off)

- Spec coverage: 8 spec sections, mapped to Tasks 1–12. ✅
- "Down payment % vs $" toggle: Task 8 Step 2 client script. ✅
- Pie chart without lib: inline SVG generator in Task 8 Step 2. ✅
- Hidden term input + button selection: Task 8 Step 1 + Step 2. ✅
- All file paths absolute or unambiguous. ✅
- Astro slot syntax warning explicitly called out. ✅
- robots.txt points at `sitemap-index.xml` (not `sitemap.xml`) — actual file emitted by `@astrojs/sitemap`. ✅
- Node version pinned to 20 in CF Pages docs (LTS, supported). ✅
