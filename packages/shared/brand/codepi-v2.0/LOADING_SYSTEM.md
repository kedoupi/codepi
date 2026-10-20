> CodePi Design System v2.0.0 — legacy specification maintained for compatibility. For current entry see README.md.

# CodePi Loading System v1.6

Status: **approved design direction; animated Logo path remains a candidate until vector master is approved.**

## Variants

| Variant | Purpose | Visual | Default copy |
|---|---|---|---|
| `brand` | App launch / initial experience | CodePi wordmark + orange ring placeholder | 正在加载… |
| `global` | Global data initialization | Centered orange ring + text | 正在获取数据… |
| `inline` | Button or bounded section | 16–32px spinner or skeleton | 正在处理… |
| `ai` | AI reasoning / streaming wait | Three pulsing orange dots | AI 正在思考中… |

The orange ring is a **temporary implementation**. Do not label it as the final CodePi logo-path animation. A future path animation must reference the approved vector master rather than tracing the concept image by eye.

## Timing and behavior

- <300ms: suppress the indicator when practical, to avoid flashing; never delay completion solely to show animation.
- 300ms–2s: inline spinner/skeleton; maintain existing content where possible.
- >2s: show a concise, task-specific, accessible status message.
- >10s: for cancellable/retryable tasks provide Cancel/Retry or background continuation when supported; do not promise cancellation if it is impossible.
- Unknown progress: indeterminate animation only; never fabricate a percentage.
- Long-running AI tasks: show meaningful stage/status only when actually known; streaming output replaces spinner once available.
- Errors: stop the animation, show actionable error feedback; success: remove loading state.
- Avoid stacking nested global overlays. Global overlay must not obscure critical errors.

## Visual tokens

- Brand orange `#FF713D`, graphite `#5E5A56`, warm white `#FAF8F4`.
- Spinner 16 / 24 / 32 / 48 / 64px; ring stroke proportional to size, round ends where possible.
- Ring rotation 1200ms linear; dot pulse 1200ms ease-in-out, staggered by 150ms.
- Motion uses only transform/opacity, not layout shifts; support light/dark surfaces.
- Respect `prefers-reduced-motion: reduce`: use a static mark and visible text, never remove the status itself.

## Accessibility

- Apply `role="status"` and `aria-live="polite"` to nonblocking updates; announce changes, not every animation frame.
- For a loading region use `aria-busy="true"` until settled, and reset on completion/error.
- Decorative rings and dots use `aria-hidden="true"`.
- For blocking overlays, manage focus and keyboard navigation deliberately; do not trap focus unless using a real modal interaction.
- Do not rely on color or motion alone; keep text or a programmatic accessible name.

## Integration

Use `loading/loading.css` and `loading/demo.html` as reference assets. UI components should use semantic tokens from the design system. `loading/demo.html` is a static prototype for visual review, not a framework production component.
