# Design Tokens

## Naming and precedence
Use **semantic** tokens (`--color-background`, `--color-text`, `--color-action`) for UI. Brand tokens are reserved for identity. Do not use raw HEX in component source. Light is the default theme; dark is opt-in via `[data-theme="dark"]`.

## Palette
- Graphite `#5E5A56`, brand orange `#FF713D`, orange for white-text primary actions `#C94F20` (provisional; validate WCAG), warm white `#FAF8F4`.
- Semantic mappings are machine-readable in `tokens/colors.json`, `tokens/light.json`, `tokens/dark.json` and implemented in `tokens.css`.
- Orange is an accent, not a universal background. Success/warning/error are independent semantic colors.
- Always test final contrast of every text/icon pair; do not assume brand orange with white text is accessible.

## Theme QA
Test every component in light/dark, default/hover/focus/disabled, including SVGs and platform assets. Theme switch must not cause layout shift or invisible focus indicators.
