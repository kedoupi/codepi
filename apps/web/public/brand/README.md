# CodePi brand images

The public assets in this directory are exported from the approved image master
in `packages/shared/brand/codepi-production/`. The sole visual authority is the
user-provided `source-reference.png`; do not trace or reconstruct it as SVG.

Use only the PNG/WebP outputs through `<img>` or `<picture>`. SVG files are
editable source masters and are not runtime assets. Keep the lockup's `1288 x
316` canvas and the existing `srcset` widths in sync when exporting revisions.

Canonical names:

- `codepi-logo.png` / `.webp`: light lockup, 1288 x 316
- `codepi-logo-450w.png`, `codepi-logo-900w.png`: responsive PNG copies
- `codepi-logo-dark.png`: dark-background lockup
- `codepi-symbol.png` / `.webp`: symbol, 348 x 316
- `codepi-symbol-512.png`: square symbol for app/avatar slots

`wordmark-light.png` and `wordmark-dark.png` remain source-named aliases for
existing external references. Favicon exports are direct proportional symbol
reductions, matching the approved preview without changing the artwork.

Project, Me, GZH, GU and Health keep byte-identical copies of the symbol and
favicon exports under their own `public/brand/` and `public/` directories.
Their Worker allowlists must expose those PNG/WebP files; SVG masters are not
part of the runtime contract.
