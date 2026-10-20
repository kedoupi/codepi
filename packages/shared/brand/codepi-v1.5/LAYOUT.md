# Layout & Responsive

4px base grid; allowed spacing: 4, 8, 12, 16, 24, 32, 48, 64px. Breakpoints (starting points, not device assumptions): 0 / 768 / 1024 / 1440px. Test at 320, 375, 768, 1024, 1440px and zoomed layouts.

- Mobile: one column, 16px outer padding, 44px minimum interactive targets where feasible.
- Tablet: 24px outer padding, content-driven 1–2 columns.
- Desktop: 32px outer padding, max readable text width ~72ch, content max width ~1200px.
- Prefer fluid containers, grid and flexbox; no fixed width causing horizontal scrolling.
- Navigation: visible current state and keyboard operability. Do not rely on color alone.
