# Operator TUI v8 — Treatment (The console that fits all fifteen)

**The buildable spec behind [`operator-tui-v8.html`](./operator-tui-v8.html).** v8
builds directly on **v7** (the nine-view "whole console") and answers the one gap the
15-persona blind-test ([`iteration-synthesis.html`](./iteration-synthesis.html)) kept
surfacing: *Simple vs Power vs Org vs phone is a per-human cut, not a global one.* It
does **not** clobber v1–v7 — it ADDs two files (`operator-tui-v8.html`, this
treatment). Palette, type scale, the sound engine, the bubble register, the live-data
layer, and the nine v7 views are all inherited; this doc covers only what is **new in
v8**.

## The seam: the same console, reconfigured per human

v7 proved the console can hold the whole autonomy machine. The blind-test proved that
no single layout is right for fifteen different humans — *what is beautiful for one is
invisible or presumptuous for another, and the gaps stack.* v8's answer is a **persona
preset picker** (`⌘K`, or the always-present mast chip) plus **four new surfaces** the
blind-test asked for and never got. A preset is a real config over the *existing*
console — it changes which doors open first and how much air, never the design
language:

```
PRESET reconfigures →  default view · density · visible rail subset · hotkey profile
```

No new colors, no new type sizes — only the `data-density` attribute on `<html>`
(driving the `--spN` + `--t-cap` tokens every surface already uses) and the `hidden`
attribute on rail buttons (collapse, never reorder — object permanence). The whole map
is always one `⌥0` away; a preset just decides which doors open first.

### The fifteen presets (1:1 with the blind-test cohort)

| Cluster | Preset | Serves (blind-test persona) | Reconfig |
|---|---|---|---|
| Newcomers | **First vibe** | Maya just-installed · Devon student · anyone's first 60s | sphere home · cozy · 3 doors · progressive disclosure |
| Newcomers | **AI-curious** | never wired an agent · setup-first, no jargon | secrets home · cozy · setup-first |
| Solo devs | **The switcher** | Maya — parallel sessions colliding | co-vibe home · balanced · claims front-and-centre |
| Solo devs | **Power user** | Sam — nvim+tmux, loves YAML | recipes home · DENSE · keyboard-first |
| Solo devs | **AI dev pro** | many backends · MCP + key hygiene | secrets home · DENSE · backends first |
| Solo devs | **Subscription-only** | flat Claude Max / ChatGPT plan | secrets home · CLI-backend setup |
| Teams & orgs | **The buyer (EM)** | Jordan — $8k/mo, owns budget | spend home · DENSE · cost attribution |
| Teams & orgs | **Post-incident EM** | Ngozi — needs the audit trail | spend home · DENSE · counters + audit |
| Teams & orgs | **VP / compliance** | Priya / Tomas — policy is authority | spend home · DENSE · enforcement + audit |
| Teams & orgs | **The skeptic** | Casey — "infrastructure or toy?" | dispatch home · DENSE · honest readiness |
| Teams & orgs | **OSS maintainer** | Hiro — ceremony-allergic, auto-detect | recipes home · balanced · low-ceremony |
| Showcase | **Hiring manager** | evaluating the operator's portfolio | roadmap home · balanced · outcomes + cost |
| Showcase | **DevRel / demo** | Riley — demoing live, full rail | sphere home · balanced · demo-ready |
| On the move | **Phone** | check-in + approve + offload | sphere home · cozy · **TWO doors** |
| On the move | **Co-vibe (2 humans)** | Alice + Bob in one repo | co-vibe home · presence + shared claims + group |

v8 opens in **First vibe** (the friendliest, least presumptuous default — the
blind-test's #1 Blocker was "HITL fires on first open / no first-run state"). `⌘K`
re-picks at any time; the choice is remembered per machine.

## The four new surfaces

Every new view wears the same **editorial console head** (eyebrow + h1 + mono
provenance line) so thirteen views still read as *one hand*. One restrained accent per
surface; mayday-red still reserved for the human-gate.

| Surface | Rail # | What it is | Live vs Vision |
|---|---|---|---|
| **Secrets & MCP** | 10 | Where keys + MCP servers live; how PD composes with Cursor / Claude Code / Gemini / Codex / Warp. Keys show key/backend/storage/`encryptedAtRest`/`set` with a green/amber lamp — the **value is never shown**. | **LIVE `GET /secrets`** (real key/backend/storage/encryptedAtRest/set — 11 rows, 3 set on this daemon). MCP roster + composition matrix = VISION. |
| **Recipes (pd-tube)** | 11 | IFTTT-for-AI: a `When (trigger) → Then (AI action) → Deliver (output)` author chained vertically, plus a gallery of six example recipes; the "where plugins live" note (`~/.port-daddy/tube/plugins/`, ADR-0019 schema). | VISION — the tube engine (declarative trigger→action→output) is specified in ADR-0019, not yet wired. The author writes a recipe row; it does not fire. |
| **Peek** | 12 | A localhost preview decomposed to a clickable DOM. Click an element → **command back to the owning agent** (`pd note --to …`) + **auto-found at-risk code** it touches + a **generated Playwright stub bound for CI** (`e2e/peek.spec.ts`). | VISION — the `pd peek` bridge (live DOM ↔ source ↔ agent) is the next-build payoff. The preview chrome + inspector are the spec made tangible. |
| **Co-vibe** | 13 | Alice + Bob in one repo: two **presence cursors** riding a shared file, **line-level claims** (alice / bob / shared), and an **ad-hoc group chat** that opened the moment they touched the same function. | Roster is **LIVE-shaped from `/sessions`**; the real-time cursor/shared-claim presence is VISION (real-time-collaboration whitepaper). |

### Harbor v8 — capability filter + the offload flow

Harbor gains a **capability filter** (chips: `image-gen`, `review`, `spawn:agent`, …)
backed by the **real `/harbors[].capabilities`** field. Selecting `image-gen` dims
every berth that can't do it — and the only one that can is **You · desktop**. That
asymmetry sets up the **phone→desktop image-gen offload** card: from a phone (no 12B
model) the operator hands an image-gen job across the harbor to the desktop berth; the
result moors back. The offload hand-off itself is VISION (federated-harbor offload
spec); the capability tags it routes on are live.

## What's LIVE-bound vs VISION-labeled (the honesty contract, carried)

v8 extends `hydrate()`/`hydrateV7()` with `hydrateV8()`: on a reachable daemon the
**Secrets** surface upgrades to real `GET /secrets`. Offline (or `file://` cross-origin)
every surface shows representative sample data and the status pill says
`offline · sample` — **we never pretend sample data is live**. Live values are
untrusted (key names, agent ids, session purposes) and pass through `esc()` before
they touch `innerHTML` (the build-time follow-up is unchanged: a real ratatui/Tauri
surface renders via `textContent`/a sanitizer).

Verified against the running daemon (`:9876`): `/secrets` → 11 real rows (3 set);
`/fleet/models` → 11 backends, **only 1 launchable** (the Dispatch "no fake green"
contract holds); `/harbors` → real capability vocabulary backing the cap-filter;
`/sorties` → 25 rows across `blocked`/`failed`/`completed`.

## The single bounded pixel zone

Unchanged from v7: Swiss restraint governs everywhere except **one bounded pixel
zone** — the Harbor berths (30px Departure-mono sprite tiles). Peek's preview is "real
pixels" but it is a *rendered web page*, not pixel-art chrome, and it is contained
inside the peek canvas; it does not let pixel-art leak into the console.

## Skills folded in (the design lenses)

| Skill | What it changed in v8 |
|---|---|
| **swiss-modern-website-design** | the preset is config-over-tokens (density attr + visible-subset), never new chrome; the picker is one centred card, one accent, generous rhythm |
| **adhd-design-expert** | the rail collapses (object permanence) but never reorders; `1`–`9` always walks the *visible* doors so "press 2" is stable; the first-vibe default refuses to presume |
| **human-gate-designer** | First vibe removes the v1 "HITL fires on first open" blocker; the mayday gate stays reserved for the one real human decision |
| **gestalt-web-design** | one figure per new surface (the set/unset lamp column; the trigger→action→output chain; the selected DOM element; the shared L46) |
| **beautiful-cli-design** | honest state above all — `/secrets` shows real `(not set)` rows; Recipes/Peek/Co-vibe carry calm VISION pills; the offload names exactly what's wired and what isn't |
| **desktop-window-layout-architect** | master/detail on every new surface (Recipes author/gallery; Peek preview/inspector; Co-vibe canvas/chat) |
| **secret-management-expert** | the key value is NEVER rendered; storage (`keychain`/`env`) + `encryptedAtRest` are surfaced; the "why a broker" panel explains the single-resolver hygiene story |

## Honesty + accessibility ledger

- **Real PD shapes:** Secrets = the real `/secrets` row (`key`/`backend`/`storage`/
  `encryptedAtRest`/`set`); Harbor caps = real `/harbors[].capabilities`; the four v7
  surfaces unchanged. Recipes/Peek/Co-vibe-presence/offload/anchor/credits = VISION.
- **WCAG AAA** carried from v5/v7 (same canon `tokens.semantic.css` names), verified in
  **both themes** (light + dark screenshots in `.scratch`).
- **14px floor** on all prose/body/caption; the only sub-14px text is the rail's
  uppercase+700+tracked micro-labels and the eyebrow class v6 already shipped.
  Verified readable at **200% zoom** (phone preset screenshot).
- **Reduced-motion** safe (swoosh-in, the picker entrance, the co-vibe cursor blink,
  the orb breathing all freeze; sound hard-mutes under `reduce`). Opt-in sound. Swoosh
  ≤340ms (< the 400ms budget).
- **No emojis as icons** — maritime/geometric glyphs only.
- **Validation:** headless Chromium, all **13 views** toggle on; all **15 presets**
  reconfigure the rail (first-vibe→3, ai-noob→4, phone→2, full→13); peek pick fills the
  inspector; harbor cap-filter dims 7 non-image-gen berths; the live-binding adapters
  map cleanly against the real daemon; **zero JS console errors** (the only console
  output is the expected cross-origin CORS notice when opened `file://`, which the
  honest-fallback path catches — same-origin binds live).

## What I'd blind-test next

(1) *Does the First-vibe default actually disarm the "presumptuous on first open"
reaction the original mockup triggered?* (2) *On `⌘K`, can a cold operator find "the
one for me" in <10s, or do fifteen cards become their own overload?* (3) *On Peek, does
the generated Playwright stub read as "I could ship this to CI" or as decoration?*
(4) *On Co-vibe, does the auto-opened group read as helpful coordination or as the tool
talking over the two humans?*
