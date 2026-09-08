# Cloud Fleet settings: offline browser evidence

All account names, IDs and states here are synthetic fixtures rendered by the
real `renderFleetSettings` function. No Port Daddy service, production account,
paid model or automation was started. The fixture notice remains visible.

- [Administrator, light desktop](admin-light-1280.png)
- [Administrator, dark desktop](admin-dark-1280.png)
- [Account, light desktop](account-light-1280.png)
- [Account, dark mobile](account-dark-390.png)
- [Global override, light mobile](stopped-light-390.png)
- [Unavailable controls, dark mobile](unavailable-dark-390.png)
- [Refreshed headless-browser interaction recording](motion/9ed0fba9c446f39d88162516005cf1ef.webm)
- [Adversarial review and fixes](adversarial-review.md)

The recording shows navigation between rendered fixtures, keyboard focus, hover
and scrolling. It does not simulate a successful production mutation. Handler
and SQLite tests separately prove saved state and authorization.

The geometry checker passed all four fixtures at 1280, 860, 390 and 320 pixels
in both themes (32 configurations). Reports are `layout-*.json`. The browser
capture also doubled every text size at 1280/390 pixels across both themes and
all four states: 16 checks passed without horizontal overflow (`text-scale.json`).

Reproduce using `apps/relay/scripts/render-fleet-settings.ts`, followed by
`apps/relay/scripts/capture-fleet-settings.py` with this artifact directory.
The capture requires Python Playwright and Chromium. Use the
`layout-overflow-guard` checker on each HTML file with the width/theme matrix
above. All tools must use an owned directory and remain offline fixtures.
