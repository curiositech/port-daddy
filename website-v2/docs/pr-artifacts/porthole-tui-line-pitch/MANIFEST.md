# Visual artifacts — Porthole alt-screen (TUI) line pitch fix

Captured headless via Playwright (`capture.mjs`, same pattern as
`website-v2/docs/artifacts/login-state/capture.mjs`), opening
`demos/porthole/porthole.html` directly (`file://` — the prototype is
self-contained, no server needed) and clicking its `btop`/`lazygit` tabs,
which replay the real casts at `demos/porthole/btop.cast` and
`demos/porthole/lazygit.cast`.

| File | Shows |
|---|---|
| `https://media.portdaddy.dev/sha256/ba/ba525448051b41a25206bed82a2d125a29e2e3e1171a6f135de3c4312e5acd5d.png` | btop's box-drawing panel borders **before** the fix — the readable-prose 1.42 line-height leaves a gap between every row, so `─`/`│` glyphs never touch their neighbor above/below and every panel border reads as broken, disconnected dashes instead of a clean rectangle. |
| `https://media.portdaddy.dev/sha256/56/56b774594b02882f06f41b36daee0400d7d66b86698074dcb927b3919232c663.png` | Same cast, same seek point, **after** the fix — `.tui`/`.ph-tui` tightens the line pitch to 1.0 once `VT.sawAlt` (already-tracked alt-screen detection) goes true, and every border is now a continuous line. |
| `https://media.portdaddy.dev/sha256/0b/0b440ef6e0a5df4fbdf911ff838c14b7c0e53f777d4c0d03236f19d0c0898346.png` | lazygit's panel borders before the fix — same disconnection, most visible in the cumulative rightward drift of the right-edge border by row 20+. |
| `https://media.portdaddy.dev/sha256/27/2775d33b7c7e266e592f469f00a05850cebe7eb52ac12b8fee2e06427deb8463.png` | Same cast, after the fix — borders read as clean rectangles, no drift. |
| `btop-live-render.webm` | Live motion proof, fixed build: the btop tab is clicked and `recordVideo` captures the player actually drawing the cast in real time (~4.6s) — the box-drawing borders are continuous throughout, not just at a single settled frame. |

All four screenshots captured against commit `9a4b54e1d` (before/after)
with the same viewport (1200×900) and the same ~1.5s settle wait after
clicking the tab, so the only variable between each before/after pair is
the fix itself. The recording is captured against the fixed build only —
the "before" state only exists in the pre-fix worktree, which isn't
committed, so a before/after motion pair isn't possible; the live-drawing
recording instead proves the fix holds continuously, not just at one
cherry-picked frame.

Root cause: `demos/porthole/porthole.html` and the production
`website-v2/src/components/porthole/porthole.css` both use a line-height
(1.42 / 1.5) tuned for readable scrollback prose. Real terminal box-drawing
glyphs (U+2500 block) are designed to sit edge-to-edge in their cell — an
alt-screen TUI app (vim/tmux/htop/lazygit) draws a real character grid, and
any vertical gap between rows breaks every horizontal/vertical border into
disconnected fragments. The fix reuses the alt-screen detection the
codebase already had for a *different* purpose (`VT.sawAlt` in
`website-v2/src/lib/porthole/vt.ts`, previously used only to force
no-wrap) to also toggle a tight, near-1:1 line pitch — normal scrollback
casts are untouched, confirmed by both a screenshot (`quickstart` tab,
not included above) and `website-v2/src/lib/porthole/player.test.ts`.
