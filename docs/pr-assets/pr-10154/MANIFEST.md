# Visual Proof — PR #10154 (`claude/swiss-design-system-lift`)

Provenance manifest for the **web-surface** artifacts, per the
`agent-visual-evidence-manifest` skill. Every artifact carries the six required
fields and an honest `sourceLabel`.

> **Two SHAs, on purpose.** The `commit` field on every artifact is the pair of
> commits actually rendered — `c92efaa5c` (this PR's merge-base with `main`, the
> **before**) and `66a0859e5` (PR head at capture time, the **after**). The image
> bytes are hosted in `ae820d39f` (a commit that adds nothing but
> `docs/pr-assets/pr-10154/`), so the raw URLs in the PR body pin to that commit —
> the commit where the files exist.

## What these artifacts show

Two `vite` dev servers, one per commit, rendered by headless Chromium and
photographed at the same routes, themes and viewports:

| | |
|---|---|
| Routes | `/` (the `LibraryBanner` strip), `/whitepaper`, `/research`, `/whitepaper?panel=limits` |
| Themes | `light` and `dark` (set via `localStorage['pd-theme']`, the site's own switch, plus a matching `prefers-color-scheme`) |
| Viewports | desktop `1440×900` @1x, phone `400×860` @2x |
| Phases | `before` = `c92efaa5c`, `after` = `66a0859e5` |

Animation is frozen before capture (`animation-duration:0s`,
`transition-duration:0s`, `reducedMotion: 'reduce'`) so the site header's animated
logo cannot be mistaken for a diff.

## HONEST caveat — these are NOT pixel-identical

The PR body's Test Plan states this is a refactor whose bar is that *"nothing
moves"*, and the `visual-exempt` note claims the change is *"pixel-identical by
construction."* **The captures below refute that at the current head.** They are
published here precisely because they disagree with the claim:

- `/whitepaper` no longer has the five-signal deck. The `Contents / The spine /
  The proofs / Limits / Read it` tab row is gone, and with it the `SpinePanel`,
  `ProofsPanel`, `LimitsPanel` and `ReadPanel` components — `git grep` finds no
  definition of any of them on this branch. The page is now a single scrolling
  Swiss contents view.
- `/whitepaper?panel=spine|proofs|limits|read` therefore no longer selects
  anything: all four render the contents view, with no redirect and no notice.
  `panel-limits-desktop-light-{before,after}.png` is that one link, before and
  after.
- `/research`'s headline and standfirst are rewritten, and the blue hero band is
  ~70px shorter as a result.
- `/` gains a Swiss book-cover thumbnail in place of the watercolour jacket and
  the strip loses ~170px of height on desktop (`11917px` → `11748px` document
  height) and ~130px on phone — this part is exactly what the PR's own
  `LibraryBanner` comment claims, and the captures confirm it.

## Reproduce

```bash
# one worktree per commit; never `git checkout` in a shared checkout
git worktree add --detach wt-before c92efaa5c
git worktree add --detach wt-after  66a0859e5
(cd wt-before/website-v2 && npx vite --port 4180 --strictPort) &
(cd wt-after/website-v2  && npx vite --port 4181 --strictPort) &
# headless Chromium, per (origin, theme, viewport) context, networkidle + fonts.ready
```

Capture harness: Playwright 1.58.2 driving the **pre-installed** Chromium at
`/opt/pw-browsers/chromium-1234/chrome-linux64/chrome`
(`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; no `playwright install` was run —
this Playwright wants revision 1208, which is not present, so the executable is
pinned explicitly).

## Artifacts

26 PNGs, named `<route>-<viewport>-<theme>-<phase>.png`:

| Route | Files |
|---|---|
| `/` | `home-{desktop,phone}-{light,dark}-{before,after}.png` |
| `/whitepaper` | `whitepaper-{desktop,phone}-{light,dark}-{before,after}.png` |
| `/research` | `research-{desktop,phone}-{light,dark}-{before,after}.png` |
| `/whitepaper?panel=limits` | `panel-limits-desktop-light-{before,after}.png` |

Required fields, identical for all 26 (stated once rather than repeated 26 times,
because every one is the same run):

- **Daemon port:** `none` — no `pd` daemon is started and no socket is opened.
  Two `vite` dev servers on `127.0.0.1:4180` (before) and `127.0.0.1:4181`
  (after); nothing else listens.
- **Run id:** `n/a (render)` — there is no agent run. Each artifact is a
  deterministic render of a committed tree at a fixed route, theme and viewport.
- **Transcript head hash:** `n/a (render)` — no transcript, no event stream.
- **Agent node id:** `n/a (render)` — no agent participates in the captured
  surface; the page is static site code with no live data.
- **Commit:** `c92efaa5cf5557c2ab23c862af24333adf0dd8f4` for every `-before`
  file; `66a0859e54ad9d273b75625044ca314e3f4d7a82` for every `-after` file.
  Asset-hosting commit: `ae820d39f0f93b11f8f3b5c9dfbb25a81ae6da73`.
- **Source:** `live-render` — a real browser painting the real route off the real
  committed source. Not a fixture, not a mock, not a design comp. The only thing
  standing in for production is `vite dev` rather than `vite build`, so
  production-only transforms (minification, asset hashing) are not exercised.

## What the capture also measured

Every shot recorded `documentElement.scrollWidth` vs `clientWidth` and listed any
element crossing the viewport edge. Findings, all reproducible from
`_report`-style output in the harness log:

- **No new horizontal overflow at 400px.** On `/whitepaper` the *before* tree
  overflows at phone width — the deck's tab row (`The proofs`, `Limits`,
  `Read it`) runs to `662px` in a `400px` viewport, as a deliberate horizontal
  scroller. The *after* tree has no overflowing element on that route at all,
  because the tab row no longer exists.
- `/research` overflows identically before and after (its own deck tab row,
  `Prior art` / `The estate`, to `555px`) — pre-existing, untouched by this PR.
- `/`'s marquee (`wd-marquee__item`) and hero wordmark SVG overflow identically
  before and after at both widths — also pre-existing.
