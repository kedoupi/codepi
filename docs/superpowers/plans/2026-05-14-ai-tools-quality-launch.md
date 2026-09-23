# AI Tools Quality Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strengthen the existing kdp.cool tool family for people-first SEO and AdSense review, then launch a new static `ai.kdp.cool` family with practical browser-only AI utility pages.

**Architecture:** Keep the existing multi-Astro-project pattern. Existing sites receive targeted content/title/advertising-density improvements. The new `ai/` project mirrors sibling projects, imports shared layout/components, and ships four client-side tools with explicit sources, limitations, privacy notes, FAQ schema, robots, ads.txt, and llms.txt.

**Tech Stack:** Astro 6, Tailwind, static output, shared `BaseLayout`, shared `AdSense`, browser JavaScript, Node test/build verification.

---

### Task 1: Existing Site Quality Pass

**Files:**
- Modify: `text/src/pages/word-counter/index.astro`
- Modify: `text/src/pages/lorem-ipsum-generator/index.astro`
- Modify: `dev/src/pages/json-formatter/index.astro`
- Modify: `dev/src/pages/base64-encoder/index.astro`
- Modify: `convert/src/pages/temperature-converter/index.astro`
- Modify: `web/src/pages/about/index.astro`

- [ ] Remove unnecessary year keywords from evergreen page titles.
- [ ] Add or strengthen How it works, Limitations, Privacy, Last reviewed, Sources, and FAQ sections where thin.
- [ ] Reduce ad density on the thinnest `lorem-ipsum-generator` page by removing the middle ad.
- [ ] Add JSON-LD FAQ schema where new FAQs are introduced.

### Task 2: AI Subdomain Static Project

**Files:**
- Create: `ai/package.json`
- Create: `ai/package-lock.json`
- Create: `ai/.npmrc`
- Create: `ai/astro.config.mjs`
- Create: `ai/tailwind.config.mjs`
- Create: `ai/tsconfig.json`
- Create: `ai/src/site.config.js`
- Create: `ai/public/ads.txt`
- Create: `ai/public/_headers`
- Create: `ai/public/favicon.svg`
- Create: `ai/public/robots.txt`
- Create: `ai/public/llms.txt`
- Create: `ai/src/pages/index.astro`
- Create: `ai/src/pages/about/index.astro`
- Create: `ai/src/pages/privacy/index.astro`
- Create: `ai/src/pages/terms/index.astro`
- Create: `ai/src/pages/contact/index.astro`

- [ ] Mirror the existing static project structure.
- [ ] Set `site` to `https://ai.kdp.cool`.
- [ ] Use AI-specific site name, copy, favicon, robots, and llms summaries.

### Task 3: AI MVP Tools

**Files:**
- Create: `ai/src/pages/token-cost-calculator/index.astro`
- Create: `ai/src/pages/prompt-builder/index.astro`
- Create: `ai/src/pages/prompt-cleaner/index.astro`
- Create: `ai/src/pages/privacy-checker/index.astro`

- [ ] Build Token & Cost Calculator with provider/model selection, text input, output token estimate, scenario count, and cost math.
- [ ] Build Prompt Builder as a structured form that outputs a reusable prompt.
- [ ] Build Prompt Cleaner as local template-based restructuring.
- [ ] Build Privacy Checker with local pattern detection for emails, phone-like strings, SSN-like IDs, credit-card-like numbers, and common API key/token patterns.
- [ ] Add FAQ, sources, limitations, privacy, and last-reviewed content to every AI tool page.

### Task 4: Repo Metadata and Portal

**Files:**
- Modify: `README.md`
- Modify: `web/src/pages/index.astro`

- [ ] Add `ai/` to the domain family table and deployment reference.
- [ ] Add AI Tools card to the portal.
- [ ] Document Cloudflare Pages settings for `kdp-ai`.

### Task 5: Verification and Deploy

**Commands:**
- `cd calc && npm test`
- `cd web && npm run build`
- `cd calc && npm run build`
- `cd convert && npm run build`
- `cd text && npm run build`
- `cd dev && npm run build`
- `cd ai && npm install --package-lock-only --legacy-peer-deps --registry=https://registry.npmjs.org/`
- `cd ai && npm run build`

- [ ] Fix build or test errors.
- [ ] Review `git diff`.
- [ ] Commit changes.
- [ ] Push changes to GitHub so Cloudflare Pages can build configured projects.
