# CodePi v2.0.0 Validation Report

Date: 2026-10-20

## Local checks
`npm run validate`: PASS

```

> codepi-design-system@2.0.0 validate
> npm run tokens:build && npm test


> codepi-design-system@2.0.0 tokens:build
> node packages/tokens/build.mjs

tokens generated

> codepi-design-system@2.0.0 test
> node --test tests/*.test.mjs

TAP version 13
# Subtest: single token source is versioned
ok 1 - single token source is versioned
  ---
  duration_ms: 1.224124
  type: 'test'
  ...
# Subtest: legacy light token is synchronized
ok 2 - legacy light token is synchronized
  ---
  duration_ms: 2.121048
  type: 'test'
  ...
# Subtest: legacy dark token is synchronized
ok 3 - legacy dark token is synchronized
  ---
  duration_ms: 0.52909
  type: 'test'
  ...
# Subtest: generated css has both themes
ok 4 - generated css has both themes
  ---
  duration_ms: 0.326148
  type: 'test'
  ...
# Subtest: component source files exist
ok 5 - component source files exist
  ---
  duration_ms: 0.755892
  type: 'test'
  ...
# Subtest: stories exist
ok 6 - stories exist
  ---
  duration_ms: 0.356951
  type: 'test'
  ...
# Subtest: version entry and agent rules
ok 7 - version entry and agent rules
  ---
  duration_ms: 0.583827
  type: 'test'
  ...
# Subtest: all semantic colors are hex
ok 8 - all semantic colors are hex
  ---
  duration_ms: 0.438983
  type: 'test'
  ...
1..8
# tests 8
# suites 0
# pass 8
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 89.485672


```

## Scope
- Implemented: 5 React components, 4 Storybook story files, Token generation, 3 HTML templates, offline tests, governance, AI interaction contracts, CI workflow.
- Not executed: npm dependency installation, TypeScript compilation, Storybook production build, browser screenshot comparison, axe, real device testing, store submission.
- Not implemented: full AI React component suite, full production-grade responsive templates, automated visual regression baseline.
- Logo: candidate master pending human approval.

## Historical artifacts
Existing v1.6 validation and QA files are historical and must not be interpreted as v2.0.0 validation.
