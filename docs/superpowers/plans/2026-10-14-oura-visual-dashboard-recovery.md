# Oura visual dashboard recovery

Status: revised proposal following the owner's feedback on October 14, 2026.

## Confirmed direction

- Keep the public landing page and its purpose. Personal use is not a reason
  to remove it. No landing-page redesign is included in this plan.
- Improve the authenticated experience around understanding personal data,
  with meaningful graphics and a clear progression from overview to detail.
- Preserve the cream/orange identity, working authentication, archived history,
  automatic synchronization, manual synchronization and connector access.
- Do not delete unused historical visualization components before evaluating
  their value for this recovery.

## Evidence and correction to the previous plan

Commit a4f5cf9 replaced the previous dashboard with latest-day scores, one score
trend, a sleep entry and archive status. The previous dashboard also displayed
score sparklines, a readiness gauge, step distribution, daily step bars,
readiness contributor radar, readiness heatmap, period comparisons and
sleep/readiness contributor bars.

The previous overview/sleep plan explicitly reduced visualization density.
This scope no longer reflects the owner's preference. The owner wants richer
visual exploration, not a pared-down overview dominated by numbers and status.

The historical plan's observation that the production archive was empty is
dated evidence, not a current premise. Check actual availability per collection
when implementing new detailed views. An empty collection is not necessarily
a synchronization failure.

## Page responsibilities

| Area | User question | Proposed presentation |
| --- | --- | --- |
| Overview | How am I doing, and what changed? | Latest official scores with small trends; score history; sleep duration history; step history; readiness calendar; concise observations linked to evidence |
| Sleep and recovery | What changed in my sleep and recovery? | Daily duration; recorded stage totals; selected sleep period; HRV and resting-heart-rate trends; sleep/readiness contributors |
| Activity | How has my activity changed? | Daily steps, available activity/calorie measures and recorded workouts; preserve units and missing values |
| Trends and comparison | Is this an isolated day or a sustained change? | Shared date selection; aligned comparison rows and explicit differences; coverage counts; weekly observations |
| Data and connections | Is my data current, and who can access it? | Compact sync summary, manual refresh, advanced collection details, authorization and AI app connections |

These are proposed responsibilities, not a requirement to put every area in
the primary navigation immediately. Combine weekly review and comparison only
with preserved deep links and an explicit migration of current functionality.

## Overview composition

1. Page title, latest data date and a compact freshness indicator. Expand
   operational details on demand instead of placing a large status panel
   ahead of the user's health data.
2. Three official score summaries, each with a short trend and a clearly
   labeled comparison baseline. Date and coverage remain explicit.
3. A prominent score-history chart with a consistent 7/30/90-day selector.
4. Sleep-duration and daily-step charts. Desktop may use two columns;
   mobile uses full-width charts rather than shrinking everything to fit.
5. A readiness calendar for recognizing repeated low/high days. Expose
   numeric values by keyboard and touch, with a textual/table alternative.
6. A few evidence-backed observations that link to the relevant detail.
   Put collection inventories and batch diagnostics in data management.

Chart quantity is not the acceptance criterion. Each graphic must answer a
distinct question. A readiness gauge duplicates the large score unless it
adds meaningful context; contributor bars may communicate individual factors
more clearly than a radar chart. Review these choices during implementation.

## Implementation order

### 1. Restore overview value

- Reuse daily-score data for score sparklines, step history and readiness
  calendar; validate historical transforms before reuse.
- Use saved sleep records for duration history, preserving multiple periods
  and identifying whether each plotted value is main sleep or a daily total.
- Reduce operational status prominence without hiding errors or stale data.
- Introduce shared chart framing, range selection, loading/empty/error states
  and accessible data alternatives alongside these changes.

### 2. Complete detail and comparison workflows

- Add sleep/recovery trends using available archived fields.
- Surface activity details from verified records.
- Compare metrics in aligned rows with both periods, units, differences and
  sample counts. Keep missing values distinct from zero.
- Make date/filter state and navigation consistent across these workflows.
- Add stress and other collection views only after verifying field semantics
  and available records. Do not create empty modules solely to list all types.

### 3. Consolidate presentation and interactions

- Establish reusable page headers, metric summaries, chart sections, buttons,
  segmented controls and status notices with semantic design tokens.
- Correct text contrast, keyboard/focus behavior, drawer accessibility,
  localization and error-code-based recovery as affected components change.
- Move logout out of the main data-navigation sequence; expose collection and
  batch details progressively in data management.
- Remove obsolete components/styles only after the replacement flows are
  accounted for. No new dependencies are required by this proposal.

## Acceptance

- The public landing page remains available before sign-in.
- The authenticated overview exposes useful history beyond a single score
  chart: sleep duration, steps and readiness calendar have distinct purposes.
- Latest-day summaries and selected-period charts clearly label their dates.
- Missing dates, partial coverage and successfully empty datasets are honest.
- Every restored visualization has a keyboard/screen-reader alternative.
- Verify normal, loading, empty, partial, failed and stale states with fixtures.
- Check mobile and desktop at explicit measured viewport sizes. A screenshot
  filename does not establish its actual viewport dimensions.
- Verify changed data transforms with meaningful tests, then typecheck/build
  and browser journeys. Passing build or smoke checks alone is not proof of
  visual quality or overall production data correctness.

This document changes the proposed direction only. No application behavior or
deployment is changed by writing it.
