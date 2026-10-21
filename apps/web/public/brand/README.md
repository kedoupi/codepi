# CodePi brand images

The web lockup is derived from the raster exports in the user-provided
CodePi Design System v2.0.0 archive, not from the candidate wordmark SVGs:

- `wordmark-light.png`: warm-white export background
- `wordmark-dark.png`: dark export background

The source canvas is 1800 x 500, but the artwork occupies only 1287 x 316 at
`x=61, y=79`; the remaining 453px on the right is empty. Using the full canvas
as the `<img>` aspect ratio made the visible lockup look small and pushed it to
the left.

The files in this directory are the same artwork cropped to 1288 x 316 and
un-matted onto transparency. The light and dark lockups keep the official
graphite/orange and warm-white/orange colors. `codepi-symbol*.png` contains only
the C + π + `</>` symbol.

Use these PNG/WebP files through `<img>` or `<picture>`. Do not reference the
wordmark SVG, render the wordmark as HTML text, or use the old 1800 x 500
descriptor in `srcset`.

Canonical names:

- `codepi-logo.png` / `.webp`: light lockup, 1288 x 316
- `codepi-logo-450w.png`, `codepi-logo-900w.png`: responsive PNG copies
- `codepi-logo-dark.png`: dark-background lockup
- `codepi-symbol.png` / `.webp`: symbol, 348 x 316
- `codepi-symbol-512.png`: square symbol for app/avatar slots

`wordmark-light.png` and `wordmark-dark.png` remain as source-named aliases so
existing references continue to resolve.

Project, Me, GZH, GU and Health keep byte-identical copies of the symbol and
favicon exports under their own `public/brand/` and `public/` directories.
Their Worker allowlists must expose those PNG/WebP files; the retired
`favicon.svg` / `icon.svg` logo files are not part of the runtime contract.
