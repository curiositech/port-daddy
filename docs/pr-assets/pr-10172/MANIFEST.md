# Visual Proof — PR #10172 (`claude/retire-chapter-pdfs`)

Provenance manifest for the web-surface artifacts, per the
`agent-visual-evidence-manifest` skill.

> **Two SHAs, on purpose.** Each artifact's `commit` is the commit actually
> rendered — `c92efaa5c` (this PR's merge-base with `main`, the **before**) or
> `ddcbe932c` (PR head at capture time, the **after**). The bytes are hosted in
> `73509a423` (a commit that adds nothing but `docs/pr-assets/pr-10172/`), so the
> raw URLs in the PR body pin to that commit.

## Why these replace the pair already on the branch

`https://media.portdaddy.dev/sha256/c5/c521572bc53e953f541b50b17a66918ba79e3ac9736d249e9b0673f5a0239b27.png` and
`https://media.portdaddy.dev/sha256/d0/d02e296c9c594210f5affa5fc31fe6ff7f3a0104c6c395dbf58f072472b80096.png` are one
route, one theme, one viewport, and the PR body links to them rather than
embedding them. These 24 cover every surface the diff re-renders, in both themes
and at both widths, and are embedded as images.

## What these artifacts show

Two `vite` dev servers, one per commit, photographed at the same routes, themes
and viewports by headless Chromium:

| | |
|---|---|
| Routes | `/whitepaper/single-writer-kernel` (`PaperDetailPage`), `/` scrolled to the closing CTA cards (`CTABanner`), `/manifesto` scrolled to the shipped-paper cards (`ManifestoPage`) |
| Themes | `light` and `dark` (set via `localStorage['pd-theme']`, plus a matching `prefers-color-scheme`) |
| Viewports | desktop `1440×900` @1x, phone `400×860` @2x |
| Phases | `before` = `c92efaa5c`, `after` = `ddcbe932c` |

Animation is frozen before capture (`animation-duration:0s`,
`transition-duration:0s`, `reducedMotion: 'reduce'`).

The change they show, in the pixels:

- **Chapter aside** — `THE PDF · 58 pages · 793 KB` with `Download` +
  `Open in tab` becomes `THE BOOK · 551 pages · 9512 KB` with one
  `Open the whole Book`, above an explicit sentence that the chapter publishes no
  PDF of its own. The aside grows ~100px, which pushes the chapter title down by
  the same amount; the document grows `5416px` → `5518px` on desktop.
- **Closing CTA cards** — the second button on each of the three cards reads
  `PDF` before and `THE BOOK` after. Document height is unchanged (`11917px`),
  so nothing reflowed.
- **Manifesto shipped-paper cards** — the per-card meta loses its page count
  (`45 pp · Version 1.1 (textbook edition)` → `Version 1.1 (textbook edition)`),
  and the `PDF` link becomes `THE BOOK`. Desktop height is unchanged at
  `18273px`, so nothing reflowed.

## Reproduce

```bash
git worktree add --detach wt-before c92efaa5c
git worktree add --detach wt-after  ddcbe932c
(cd wt-before/website-v2 && npx vite --port 4180 --strictPort) &
(cd wt-after/website-v2  && npx vite --port 4181 --strictPort) &
```

Capture harness: Playwright 1.58.2 driving the **pre-installed** Chromium at
`/opt/pw-browsers/chromium-1234/chrome-linux64/chrome`
(`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; no `playwright install` was run).

## Artifacts

24 PNGs, `<surface>-<viewport>-<theme>-<phase>.png`:

| Surface | Files |
|---|---|
| `/whitepaper/single-writer-kernel` | `chapter-{desktop,phone}-{light,dark}-{before,after}.png` |
| `/` closing CTA | `home-cta-{desktop,phone}-{light,dark}-{before,after}.png` |
| `/manifesto` | `manifesto-{desktop,phone}-{light,dark}-{before,after}.png` |

Required fields, identical for all 24:

- **Daemon port:** `none` — no `pd` daemon, no socket. Two `vite` dev servers on
  `127.0.0.1:4180` (before) and `127.0.0.1:4181` (after).
- **Run id:** `n/a (render)` — no agent run; each artifact is a deterministic
  render of a committed tree at a fixed route, theme and viewport.
- **Transcript head hash:** `n/a (render)` — no transcript, no event stream.
- **Agent node id:** `n/a (render)` — no agent participates in the surface.
- **Commit:** `c92efaa5cf5557c2ab23c862af24333adf0dd8f4` for every `-before`;
  `ddcbe932ccf561d8c3a2fed286a2a1b7ec623521` for every `-after`. Asset-hosting
  commit: `73509a4234c4cb905baf141a5aec7786bc8a0c02`.
- **Source:** `live-render` — a real browser painting the real route off the real
  committed source. Not a fixture, not a mock. The only stand-in for production
  is `vite dev` rather than `vite build`.

## What the capture also measured

- **No horizontal overflow at 400px on any of the three routes, before or
  after.** The chapter aside's widest new row (`FORMAT · PDF, EMBEDDED BELOW`)
  reaches the inner edge of a 400px viewport without crossing it.
- **The new muted caption passes AA in both themes.** `All 551 pages of it, in a
  new tab…` uses `--text-muted`, which is `6.50:1` on `--surface-raised` in dark
  and `9.00:1` in light.
- No broken images on any capture (`img.complete && naturalWidth === 0` was
  checked on every shot and was empty every time).
