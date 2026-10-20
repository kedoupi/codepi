> CodePi Design System v2.0.0 — legacy specification maintained for compatibility. For current entry see README.md.

# Accessibility Acceptance Criteria

Target WCAG 2.2 AA where applicable. Body text contrast >= 4.5:1, large text >= 3:1, meaningful UI boundaries/icons >= 3:1. Keyboard operation, visible focus, proper labels, semantic headings, error descriptions, 200% zoom, reduced-motion support, non-color-only states. Test final rendered pairings in both themes; never infer contrast from palette names. Touch targets should aim for >= 44×44 CSS px unless platform/context requires a documented exception.

**Brand orange `#FF713D` is not automatically an accessible white-text button background.** Use a verified darker action token or dark text after measurement.
