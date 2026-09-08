# Media Capture Runbook — macOS-only assets

This runbook exists because a Linux build agent cannot open a GPUI/Metal
window (`core/pd-console --features gpui`) or a macOS menu-bar app
(`apps/FleetBar`). Everything in this file must be run on a real Mac, by the
operator, following the [visual-evidence doctrine](../skills/port-daddy-agent-skill/references/visual-evidence.md)
— since the operator is capturing their **own** deliberately-launched dev-lane
bundle, clicking through the app to reach a pane is fine (the doctrine's
"don't steal focus" rule is about *agents* touching the operator's live prod
instance, not the operator driving their own throwaway build).

Every command below is copy-pasteable as-is from a Terminal with **Screen
Recording** permission granted (System Settings → Privacy & Security →
Screen & System Audio Recording — grant it to Terminal/iTerm once; TCC denies
`screencapture` silently otherwise and prints `could not create image from
window/display`).

Do not build these against the operator's running prod/dev-latest FleetBar or
pd-console — use the dev-lane / offscreen paths below so a live session is
never disturbed.

## 0. Why this file exists — the concrete gap found in the 2026-08-04 audit

Three FleetBar "Fleet Control Center" screenshots on the marketing site are
**byte-identical** despite depicting three different panes:

```
sha256  1edfa51685db9ef03f14024dbbfbe2f87f877da88b0e3199ecb1629498a68ede
  website-v2/public/img/app-screens/fleet-flow-light.webp
  website-v2/public/img/app-screens/resources-light.webp
  website-v2/public/img/app-screens/sorties-light.webp

sha256  d5a17effa0c0e5977aefcdb74458414d1d168d31225bcf8dd99ce172f8f5ef41
  website-v2/public/img/app-screens/fleet-flow-dark.webp
  website-v2/public/img/app-screens/resources-dark.webp
  website-v2/public/img/app-screens/sorties-dark.webp
```

The "Fleet Flow" panel used across the landing page, `AgentsPage`, and
`MacPreviewPage` is showing whatever "Resources" or "Sorties" happened to
render at capture time — none of the three is provably showing what its own
caption claims. **§1 below is the highest-priority item in this file.**

A second, smaller gap: `website-v2/src/pages/HarnessPage.tsx` referenced
`/demos/harness/harness-fleetbar-repair-live.gif`, a file that does not exist
in the repo (a live 404 on the shipped site). This session repointed that
`<img>` at the real, existing `harness-fleetbar-live.png` still frame as an
honest interim fix — **§3 below captures the real animated repair→live GIF**
that should replace it.

## 1. FleetBar "Fleet Control Center" panes (Flow, Resources, Sorties, Shipwright ×3, Agents)

**Build a dev-lane bundle** (never the operator's prod/dev-latest instance):

```bash
cd ~/coding/port-daddy   # your main checkout, on the branch you want to shoot
bash apps/FleetBar/scripts/package-fleetbar-lane.sh --devbuild media-capture
# → installs ~/Applications/Port Daddy/FleetBar-dev-<timestamp>-media-capture.app
```

**Launch it** and open the menu-bar icon → click through to the Fleet Control
Center window (the expanded window, not the small popover):

```bash
open "~/Applications/Port Daddy/FleetBar-dev-"*"-media-capture.app"
```

**Seed live state first** — an empty daemon renders empty panes. Before
shooting, make sure the daemon backing this dev-lane has real data: at least
one project with agents claimed/spawned, and (for the Sorties pane) at least
one active sortie. Follow the "Seed live state before the operator looks"
step in `skills/port-daddy-internal-dev/SKILL.md` § Show-Me Runbook if you
need a quick seed script.

**Find the window id and shoot each pane** (window-targeted capture — never
whole-screen, never region-based, so nothing else on the desktop leaks in):

```bash
# Click the Fleet Control Center into the pane named in the left column below,
# then run this block. Re-run the ID lookup before each shot since navigating
# panes can occasionally spawn a new window in this app.
python3 -c "
import Quartz
wl = Quartz.CGWindowListCopyWindowInfo(Quartz.kCGWindowListOptionOnScreenOnly | Quartz.kCGWindowListExcludeDesktopElements, Quartz.kCGNullWindowID)
for w in wl:
    o = w.get('kCGWindowOwnerName','')
    if 'FleetBar' in o:
        print(w.get('kCGWindowNumber'), o, w.get('kCGWindowName'), w.get('kCGWindowBounds'))"
```

For each `(pane, filename)` pair below, click FleetBar's left-nav to that
pane, take the window id from the command above, then:

```bash
screencapture -x -o -l"$WINDOW_ID" /tmp/capture.png
```

Convert to WebP (matches the existing asset format) and place at both the
paired-resolution and canonical-resolution paths already used on the site —
capture in **light** and **dark** system appearance (⌘-toggle in System
Settings → Appearance, or `defaults write -g AppleInterfaceStyle Dark` /
`delete` that key for light, then relaunch the app so it re-reads the
appearance):

| FleetBar pane (left-nav label) | Save as (paired, 1280×800) | Save as (canonical, 1440×1000 or 1280×900) | Must show |
|---|---|---|---|
| **Flow** | `website-v2/public/img/app-screens/fleet-flow-light.webp` + `website-v2/public/img/app-screens/fleet-flow-dark.webp` | `fleet-flow.webp` (1440×1000) | The agent coordination flow graph/timeline — nodes and edges, NOT a table |
| **Resources** | `resources-{light,dark}.webp` | `resources.webp` (1440×1000) | The readiness table: per-backend rows, each with a pass/fail check and an inline fix, per `backend-readiness-is-dependency-truth.md`'s caption |
| **Sorties** | `sorties-{light,dark}.webp` | `sorties.webp` (1440×1000) | The sorties list — one row per active/recent sortie, with status badges |
| **Shipwright → Control** | `shipwright-control-{light,dark}.webp` | `shipwright-control.webp` (1440×1000) | The repo-survey + proposed-plan side-by-side editor (roles, triggers, budgets, file boundaries) — this is also reused for the passkey pairing blog screenshot, so it must show the identity/pairing surface if that's still under this tab |
| **Shipwright → Focus** | `shipwright-focus-{light,dark}.webp` | `shipwright-focus.webp` (1280×900) | One expanded role: trigger, budget ceiling, claimable files, mutate-or-notes-only mode, stop control |
| **Shipwright → Harbor** | `shipwright-harbor-{light,dark}.webp` | `shipwright-harbor.webp` (1280×900) | The harbor surface with a retract affordance visible on a note |

**After capturing, run the duplicate check that caught this bug** before
committing, so this regression can't recur silently:

```bash
shasum -a 256 website-v2/public/img/app-screens/*.webp | sort | uniq -c -w64 | sort -rn | head
# Any count > 1 on a hash means two "different" panes captured the same pixels — retake.
```

## 2. FleetBar native shell (menu-bar popover)

Same dev-lane bundle as §1. Click the menu-bar icon to open the small
popover (not the expanded Fleet Control Center window) and shoot it the same
window-targeted way:

| Save as | Resolution | Must show |
|---|---|---|
| `website-v2/public/img/app-screens/fleetbar-native-shell-light.webp` + `website-v2/public/img/app-screens/fleetbar-native-shell-dark.webp` | 1440×960 | The popover surfacing current project, blocked backends, and the last handoff — this is the site's single most-reused screenshot (landing hero, `MacPreviewPage`, `CTABanner`, blog post `control-plane-is-the-product.md`) |

## 3. FleetBar Squid harness — DEGRADED → LIVE repair, real animated GIF

This replaces the currently-broken `harness-fleetbar-repair-live.gif`
reference (fixed to a static fallback in this session — see §0). You need
a project whose harness is genuinely DEGRADED (fewer than 4/4 agents wired —
e.g. stop one of the wired hook agents) so the Repair action is real, not
staged copy.

```bash
# 1. Get a project into the DEGRADED state (1-3 of 4 agents wired).
# 2. Start a screen recording of just the FleetBar popover/harness card region:
screencapture -v -x -R "$X,$Y,$W,$H" /tmp/harness-repair-live.mov
#    (screencapture -v starts a video capture of a region/window; press Ctrl-C
#    or the on-screen stop control to end it)
# 3. While recording: click Repair, wait for the read-back, confirm the card
#    flips to "GIANT SQUID  LIVE  4/4 agents wired".
# 4. Convert to a web-sized GIF (this step needs ffmpeg — a real Mac has brew):
ffmpeg -i /tmp/harness-repair-live.mov -vf "fps=12,scale=880:-1:flags=lanczos" \
  -loop 0 website-v2/public/demos/harness/harness-fleetbar-repair-live.gif
```

Keep it web-appropriate: target under ~2 MB. Trim the `.mov` first
(`ffmpeg -ss <start> -to <end> -i in.mov trimmed.mov`) if the raw capture runs
long — the GIF only needs to cover DEGRADED → click Repair → LIVE, a few
seconds.

Once this file exists, point `website-v2/src/pages/HarnessPage.tsx`'s
`FleetBar roster` panel back at it and restore the "moving from needs repair
to confirmed live" alt text (the interim fix in this session uses the static
`harness-fleetbar-live.png` with accurate-for-a-still alt text instead).

## 4. pd-console (GPUI/Metal window)

Build and capture with the repo's existing harness — extended in this
session to also cover the harness-roster pane used on the marketing site
(`core/pd-console/scripts/capture-gpui.sh` now includes `active-agents`):

```bash
cd core/pd-console
cargo build --release --features gpui --bin pd-console
scripts/capture-gpui.sh docs/artifacts/gpui
```

This builds (if needed), launches the window per-pane via `--pane <id>`
(no clicking, no Accessibility permission needed — Screen Recording is
still required to capture the resulting window), and window-targets the
capture so nothing else on screen leaks in. Output:
`docs/artifacts/gpui/window-<pane>.png` for `fleet`, `sorties`, `dispatch`,
`sessions`, `health`, `lane`, `active-agents`.

For the specific asset on the marketing site:

```bash
cp core/pd-console/docs/artifacts/gpui/window-active-agents.png \
   website-v2/public/img/app-screens/pd-console-gpui/active-agents-harness-roster.png
```

Seed the daemon with a live agent in each of LIVE / READY / PARTIAL /
UNPROTECTED harness-conformance states before shooting — the pane's entire
point (per its `HarnessPage.tsx` caption) is showing all four states with
their scores, missing surfaces, and repair actions at once. A roster with
only one state visible is a weaker (and arguably misleading) capture; seed
multiple agents/backends until at least 2-3 states are represented.

Target resolution: native Retina window capture. The existing reference
asset is 2966×1600px (2x of a ~1483×800 logical window) — do not manually
downscale; commit what `screencapture` produces.

For the truly headless/CI path (no window, no TCC) instead of a Mac with a
display, see `core/pd-console/docs/recording-visual-artifacts.md` — Method A
(offscreen wgpu render + ffmpeg) and Method B (headless virtual display).
Per the "Never create virtual displays" operator rule in
`skills/port-daddy-internal-dev/SKILL.md`, do not use Method B on the
operator's own Mac without explicit per-action consent — it's intended for a
disposable CI runner, not the operator's daily machine.

## 5. FleetBar `landing-live-glory` component screenshots

`website-v2/public/media/landing-live-glory/` holds real screenshots
(`topbar-crop`, `fleetbar-menu-captured`, `live-shipwright-focus`,
`live-roadmap`, `live-sorties`, `live-flow-graph`, `live-resources`,
`live-agents-panel`) that get composited by
`website-v2/tools/landing-live-glory/render.mjs` into an animated hero
video, using **live `pd status`/`pd sessions`/`pd notes` text** layered over
these stills. The stills are the macOS-only half of this pipeline; recapture
them exactly as in §1/§2 (same panes, cropped per `scene.html`'s `<img>`
usage) and save under this directory using the same filenames.

The video/poster regeneration itself (`node
website-v2/tools/landing-live-glory/render.mjs`) is Playwright + ffmpeg and
runs on Linux — **do that part on the build agent**, not here, once new
stills land. This session could not run it (no `ffmpeg` reachable through
the package mirror at capture time); retry `apt-get install ffmpeg` or use a
static binary once stills are refreshed.

## 6. Checklist before shipping any of the above

- [ ] Captured from a **dev-lane** bundle, never the operator's running prod/dev-latest instance.
- [ ] Both light and dark captured wherever the site pairs them (`ThemedImage` / `<picture>` usage — grep the target filename in `website-v2/src` first).
- [ ] Ran the sha256 duplicate check (§1) across the whole `app-screens/` directory, not just the panes you touched.
- [ ] `git log -1 --format=%ad -- <path>` on the new file shows today's date.
- [ ] Read the captured file back (open it) and confirm it shows what its caption/alt text and the table above claim — not a loading spinner, not an empty state, not the wrong pane.
- [ ] File size is web-appropriate: PNG/WebP screenshots a few hundred KB, GIFs under ~2-3 MB. Re-encode if not.
- [ ] Committed with an honest PR description — this is a UI-diff PR, so it needs the screenshot + GIF + recording Test Plan artifacts required by `AGENTS.md` § "Visual artifacts for UI diffs", in addition to *being* those artifacts for the site.
