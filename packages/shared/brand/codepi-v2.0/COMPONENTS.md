> CodePi Design System v2.0.0 — legacy specification maintained for compatibility. For current entry see README.md.

# Component Contracts

Each interactive component must specify: anatomy, variants, sizes, keyboard interaction, accessible name, validation, and states **default / hover / focus-visible / active / disabled / loading / error where applicable**.

| Component | Required variants | Key requirements |
|---|---|---|
| Button | primary, secondary, ghost, destructive | focus ring, disabled not clickable, loading announcement, no double submit |
| Input/Textarea | normal, error, disabled | persistent label, helper/error association, focus and autofill |
| Select | default, error, disabled | keyboard navigation, visible selected value |
| Card | static, actionable | only actionable cards get hover/focus affordance |
| Tabs | default, selected, disabled | arrow-key behavior and tab-panel associations |
| Navigation/Sidebar | compact, expanded | current-page semantics, responsive collapse |
| Dialog | confirmation, form | focus trap, return focus, Escape behavior, explicit title |
| Toast/Alert | info, success, warning, error | live region appropriate to urgency; dismissible where needed |

Example Button: `--color-action` background and `--color-action-text` foreground; hover `--color-action-hover`; focus `--color-focus` 2px visible outline plus offset. Avoid using `#FF713D` with small white text without testing.

For disabled controls, ensure state is conveyed non-color-only; for error use icon/text and `aria-describedby`. Do not overuse orange in every card.


## Loading components

Four variants: brand, global, inline, ai. See [LOADING_SYSTEM.md](LOADING_SYSTEM.md). Do not display fictitious progress.
