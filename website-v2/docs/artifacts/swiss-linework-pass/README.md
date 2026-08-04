# Swiss-modern fractional-linework pass — visual proof

Provenance: every PNG here was captured from a REAL production build
(`npm run build` → `vite preview` on :4173) by `capture.mjs` in this
directory, on 2026-08-04, using the pre-installed Playwright chromium
(`/opt/pw-browsers/chromium-1194`). No mocks, no fixtures. The relay
`/auth/status` probe is route-aborted, so the header shows the real
signed-out graceful-degrade state.

The capture run *asserts* before it shoots:

- pairwise bounding-box collision checks over every header control
  (nav, account chip, search, GitHub link, theme toggle, mobile menu) —
  the same assertion style as `../login-state/capture.mjs`, guarding the
  recently-fixed header (search overlap, duplicate octocat, chip
  collisions);
- no horizontal document overflow (the mobile clipped-layout tell).

A failed assertion fails the run; these images exist because all
12 route x theme x width combinations passed.

## Matrix

Routes: `/` (home), `/docs` (docs overview), `/docs/features/fleet`
(fleet feature — the page carrying the deepest pass). Themes: light,
dark. Widths: 1440 and 390. All full-page.

## What the pass changed (binder ch. 20 "Story Linework", §04 ports)

- `--lw-*` fractional linework tokens (1px texture / 1.5px linework /
  2px enclosure / 3px stripe) added to `tokens.source.css`.
- `--error/--success/--warning/--info` role aliases added — 14 docs
  pages were already consuming them while they were undefined (the
  Purser's red stripe on the fleet page used to render transparent).
- `--surface-card` well (ch. 20 rule 5: strong well in light, raised in
  dark, mandatory hairline edge).
- `.lw-stripe-card`, `.lw-midline`, `.lw-sect-head` grammar in
  `index.css`.
- Hero: "Port Daddy is" panel → stripe card; "Runs on" heavy 2px rule →
  left-anchored midline.
- FleetFeature: mono eyebrow, numbered section heads with
  centered-third division rules, stripe cards, lawful 3px stripes,
  ink hairline (not cobalt chrome) on the wash CTA, mobile wrap fix.
