# CodePi production logo master

This directory contains the image masters approved on 2026-10-22. The sole
visual authority is `source-reference.png`, the image supplied and approved by
the user. Do not trace it into SVG or reinterpret its geometry or typography.

The transparent files preserve the approved composition: a dark open C, the
central `</>` detail, an orange pi, the `CodePi` wordmark, and the optional
`BUILD · THINK · CREATE` tagline. Dark-surface files only map the dark artwork
to warm white; orange remains unchanged.

Public sites consume fixed-canvas PNG and lossless WebP derivatives from their
own `public/brand/` directories. The homepage lockup remains `1288 x 316` and
the shared symbol remains `348 x 316` so existing layout contracts do not
change. Browser icons are direct, proportional symbol reductions; no detail is
silently redrawn or removed.

Run `python3 packages/shared/brand/codepi-production/export_assets.py` from the
repository root to regenerate and synchronize the runtime assets.

Do not alter the read-only v1.5 or v2.0 source archives. A future master change
requires explicit user approval and a complete synchronized export for every
application.
