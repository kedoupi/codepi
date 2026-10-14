# Oura overview and sleep, first release

Scope: retain the existing cream/orange identity and header; replace the dense
dashboard with a latest-day overview, one score trend, sleep entry and archive
status. Add a dedicated sleep page. Leave activity/stress expansion for later.

Production audit on October 14: health_records and health_sync_windows have no
rows. Detailed pages must explain unsynced data, never invent measurements.
Real-account validation remains pending until the owner starts backfill.

Design tokens: canvas #fffaf5, surface #ffffff, ink #0f172a, muted #64748b,
accent #f97316, dividers #edd5c4. Retain existing Chinese typography. Use a
larger, left-aligned title and three official scores as the overview's anchor.
Give the sleep page one large duration and a proportional stage composition
bar; do not present aggregate durations as a chronological hypnogram.

Data rules:
- Read archived sleep using all response pages, within the selected 7/30-day range.
- Separate multiple sleep periods and retain Oura's assigned date.
- Main sleep is explicitly identified only by type=long_sleep.
- Missing values remain missing; scores never stand in for physiological data.
- Compare latest scores with preceding seven calendar days only with >=3 values.
- Refresh of summary scores and detailed sleep have separate, explicit controls.
- Do not claim full interval coverage based on a collection's latest attempt.

Validation: pure data-transform tests, existing Worker integration suite,
typecheck/build, browser journeys with pagination, empty and partial records,
failed requests, expired login, language switch and 390px layout. Publish only
after verification and confirm the complete production workflow.
