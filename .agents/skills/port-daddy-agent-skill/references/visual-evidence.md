# Visual Evidence — capture screenshots/GIFs without interrupting the operator

Every PR that touches a visual surface MUST carry a screenshot + a GIF/recording
(`pr-requirements-guard` enforces it). This reference is the sanctioned way to
produce that evidence **without stealing focus, flashing windows, or otherwise
interrupting the operator's session**. The operator is often live on this
machine while you work — a window you open is a window they feel.

## The decision ladder

Work down this list; stop at the first rung that applies.

### 1. Web surface (public/, fleet-ui/, website-v2/, any HTML) → headless Playwright

Never launch a headed browser. Python Playwright with `headless=True` renders
real pixels with zero desktop footprint, including light/dark and before/after:

```python
from playwright.sync_api import sync_playwright
import pathlib
with sync_playwright() as p:
    b = p.chromium.launch(headless=True)          # CRITICAL: headless
    for scheme in ("dark", "light"):
        ctx = b.new_context(viewport={'width':1280,'height':860}, color_scheme=scheme)
        pg = ctx.new_page()
        pg.goto(pathlib.Path("public/index.html").resolve().as_uri())  # or the daemon URL
        pg.wait_for_load_state('networkidle')      # SPAs need this
        pg.screenshot(path=f"shot-{scheme}.png", full_page=True)
    b.close()
```

For a **before** shot, extract the old file from git (`git show origin/main:path
> before.html`) and render it the same way — before/after from the same
viewport is what reviewers actually want.

### 2. A window that is ALREADY OPEN (pd-console, FleetBar Control Center) → windowed screencapture

`screencapture -x -l <window-id>` captures one window silently, without
raising, focusing, or reordering it — even if it is behind other windows.
Find the id with Quartz (no interaction, read-only):

```bash
python3 -c "
import Quartz
wl = Quartz.CGWindowListCopyWindowInfo(Quartz.kCGWindowListOptionOnScreenOnly | Quartz.kCGWindowListExcludeDesktopElements, Quartz.kCGNullWindowID)
for w in wl:
    o = w.get('kCGWindowOwnerName','')
    if 'FleetBar' in o or 'pd-console' in o:
        print(w.get('kCGWindowNumber'), o, w.get('kCGWindowBounds'))"
screencapture -x -l "$ID" out.png    # -l <id> targets the window (no raise/focus); -x just mutes the shutter sound
```

**TCC gotcha:** `could not create image from window` means your shell's host
app lacks **Screen Recording** permission (System Settings → Privacy &
Security → Screen & System Audio Recording). This is a per-app grant the
operator must toggle once; the host process must be restarted (or the MCP
server reconnected) to pick it up. Ask once, plainly — do not retry in a loop.

### 3. No window open, native app (menu-bar popover, GPUI pane) → purpose-built harness, not clicks

- **pd-console:** `core/pd-console/scripts/capture-gpui.sh` builds and drives
  the console offscreen-ish and writes captures to
  `core/pd-console/docs/artifacts/gpui/` by default (override with an
  explicit `[output-dir]` arg). Prefer it over opening the operator's console
  lanes.
- **FleetBar:** build a named dev-lane bundle
  (`scripts/install-fleetbar-lane.sh dev-<name>`, or
  `scripts/package-fleetbar.sh` for a plain zipped artifact) so you never
  touch the operator's installed stable or unrelated named development daemons. If evidence
  requires its window and none is open, say so in the PR body and fall back to
  the computer-use MCP (rung 4) or an honest partial (rung 5).
- **Never** AppleScript/System-Events click the real menu bar, and never
  `open -a` the operator's own app instances to pose them — both steal focus.

### 4. Computer-use MCP (last interactive resort)

The `computer-use` MCP screenshot is compositor-filtered to the apps the
operator granted, so it never leaks their other windows into a PR. It needs a
one-time Accessibility + Screen Recording grant (an approval dialog — mildly
interruptive, but a durable grant). Screenshots only; do not drive clicks
through the operator's real apps for evidence purposes.

### 5. Honest partial

If a surface genuinely cannot be captured non-interruptively (e.g. a menu-bar
popover on a machine with no grants), attach what you CAN capture headlessly,
state exactly what is and is not shown, and say why. Sparse-but-honest beats
staged-but-disruptive. Never mock up "evidence" in HTML and pass it off as the
app — reviewers treat fabricated evidence as failure.

## Packaging the evidence

- Commit artifacts under `.github/assets/<pr-number>/` on the PR branch.
- Embed with raw URLs **pinned to the commit SHA**, not the branch:
  `https://raw.githubusercontent.com/curiositech/port-daddy/<sha>/.github/assets/<pr>/x.png`
  — branch URLs die when the branch is deleted after squash-merge.
- GIF from two stills (before → crossfade → after) — note both inputs must be
  scaled/padded to identical even dimensions or xfade errors:

```bash
ffmpeg -loop 1 -t 2.2 -i before.png -loop 1 -t 2.2 -i after.png -filter_complex \
 "[0:v]scale=880:592:force_original_aspect_ratio=decrease,pad=880:592:(ow-iw)/2:(oh-ih)/2[v0];\
  [1:v]scale=880:592:force_original_aspect_ratio=decrease,pad=880:592:(ow-iw)/2:(oh-ih)/2[v1];\
  [v0][v1]xfade=transition=fade:duration=0.6:offset=1.6,fps=12,split[a][b];\
  [a]palettegen[p];[b][p]paletteuse" out.gif
```

- Runtime evidence (agent-submitted screenshots, visual-task intake) goes
  through the daemon's blob store — filesystem-backed at `~/.port-daddy/blobs`
  (`lib/blob.ts`, wired by default in `server.ts`). Intake **fails loudly** if
  the store is missing; evidence is never dropped silently.
