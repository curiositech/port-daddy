# Visual artifacts — Porthole light-mode ANSI theme fix

Captured headless via Playwright (`capture.mjs`, same pattern as
`website-v2/docs/artifacts/login-state/capture.mjs`) against a local `vite preview
--port 4173` production build served from this PR's own branch
(`claude/porthole-light-mode-theme`, commit `5e7deaea7`), with theme set
via `localStorage['pd-theme']` through `page.addInitScript` — the real
persistence key `website-v2/src/lib/theme.tsx` reads, same as the prior
porthole-player capture in `docs/pr-artifacts/porthole-player/`.

| File | Shows |
|---|---|
| `demos-section-light.png` | The `#demos` section, light theme, mid-playback. Terminal chrome renders cream (`--surface-raised`/`--surface-strong`) with dark, readable text — this is the fix; before it, this screenshot would have shown the same near-black chrome as the dark screenshot. |
| `demos-section-dark.png` | Same section, dark theme, same scroll position. Confirms dark mode is visually unchanged — `--ph-*` aliases straight back to the pre-existing `--code-*` dark values. |

Both captured back-to-back in the same run against the same build; only
`localStorage['pd-theme']` differs between them.

| `demos-section-theme-toggle.webm` | Live motion proof: page loads in dark mode, the real site theme toggle (`button[aria-label="Toggle color theme"]`) is clicked, and the `#demos` terminal chrome visibly flips from near-black to cream in place — no reload. Playwright's `recordVideo` captures the whole context lifetime (page load + network-idle wait included), so the original capture ran ~30s; trimmed to the last 6s (the actual load-complete-through-toggle window) with `ffmpeg -sseof -6 -c:v libvpx` re-encode, since the initial ~25s was static pre-interaction wait with nothing to see. |
