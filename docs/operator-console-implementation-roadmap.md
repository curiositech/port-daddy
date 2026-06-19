# pd-console: Operator Console Implementation Roadmap

**Document version:** 1.0  
**Status:** Authoritative design reference  
**ADR anchor:** ADR-0046 — "The Operator TUI — a conversation multiplexer, not a file browser"  
**Covers:** All phases from ratatui shell to avatar autonomy loop  

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [ADR Dependency Map](#2-adr-dependency-map)
3. [Panel Inventory](#3-panel-inventory)
4. [Information Architecture Diagram](#4-information-architecture-diagram)
5. [Phase Plan](#5-phase-plan)
   - [Phase 0 — ratatui Shell](#phase-0--ratatui-shell)
   - [Phase 1 — Avatar Dispatch Loop](#phase-1--avatar-dispatch-loop)
   - [Phase 2 — pd-peek + Claim Tree](#phase-2--pd-peek--claim-tree)
   - [Phase 3 — ADR Browser + Suggestibility](#phase-3--adr-browser--suggestibility)
   - [Phase 4 — Token Mirror + Visual Diff](#phase-4--token-mirror--visual-diff)
   - [Phase 5 — Claims + Suggestibility Full](#phase-5--claims--suggestibility-full)
   - [Phase 6 — ADR Browser + Sessions + Commitments](#phase-6--adr-browser--sessions--commitments)
   - [Phase 7 — Avatar Autonomy Loop + PR Panel](#phase-7--avatar-autonomy-loop--pr-panel)
   - [Ongoing](#ongoing-panels)
6. [Key Bindings Reference](#6-key-bindings-reference)
7. [pd-peek Detailed Design](#7-pd-peek-detailed-design)
8. [Maritime Flags Reference](#8-maritime-flags-reference)
9. [Suggestibility Panel Detailed Design](#9-suggestibility-panel-detailed-design)
10. [Design System](#10-design-system)
11. [Open Questions](#11-open-questions)

---

## 1. Executive Summary

### What pd-console Is

pd-console is a full-terminal operator cockpit for the Port Daddy multi-agent coordination daemon. It is not a file browser, not a log viewer, and not a status dashboard that you glance at between context switches. It is a **conversation multiplexer** — the primary surface through which an operator runs a fleet of AI agents, reviews their work, and makes go/no-go decisions in real time.

Think of it as the bridge of a vessel: all critical information surfaces on one screen, every action is a keystroke away, and the operator never leaves to consult a separate tool. Agents appear as maritime call signs with ICS signal flags. The HITL top bar lights mayday-red when any agent needs a human decision. The cockpit pane holds live chat with every agent simultaneously. The claim tree shows who owns what code. The suggestibility panel shows whether agents are paying rent.

### What It Replaces and Complements

pd-console **replaces**:
- Switching between multiple terminal windows to tail agent output
- Manually running `pd status`, `pd sessions`, `pd salvage` in separate shells to understand fleet state
- Checking GitHub in a browser to see PR status and Copilot review comments
- Hunting through `~/.port-daddy/` directories for transcript logs

pd-console **complements** (does not replace):
- The `pd` CLI — still the right tool for scripted/CI usage, hooks, and subagent commands
- The Port Daddy daemon — pd-console is a read/write client of the daemon over HTTP; all coordination authority stays in the daemon
- The FleetBar menu bar app — FleetBar is a lightweight glanceable; pd-console is the full cockpit

### Why It Matters

Port Daddy's value proposition is **observable, governable multi-agent coordination**. That proposition is only realized when the operator can actually see what is happening. Right now, the operator must maintain a mental model across terminal windows, notes files, and browser tabs. pd-console closes that gap: one window, one coherent picture, all actions a keystroke away.

The ADR-0046 design decision: build this as a **Rust TUI with ratatui**, not as an Electron app, a web dashboard, or a Swift menu bar extension. The terminal is where operators already live. The terminal starts in 200ms, runs over SSH, and works when Electron is broken. ratatui gives us 60fps rendering, sixel image support for the Peek panel, and a single Rust binary with no runtime dependency.

### Design Principles

1. **The HITL bar is sacred.** `--voice-mayday` (solid red) is reserved exclusively for the HITL top bar. No other element in the entire TUI uses that exact color. An operator who sees red knows an agent is waiting.

2. **Maritime flags are the coordination language.** Every agent carries an ICS flag. Operators learn 14 states by learning 14 letters. The flag meanings are real ICS meanings — not invented mnemonics — which grounds the system in a pre-existing shared vocabulary.

3. **The token mirror is not optional.** All colors in pd-console are OKLCH tokens resolved from `website-v2/src/styles/tokens.semantic.css`. CI fails if the Rust token mirror diverges. No color is invented; no color is hard-coded.

4. **Minimum legibility is 14px terminal-cell equivalent.** Never shrink to gain density. Use pane splits instead.

5. **Vim motion is the navigation model.** `j/k` everywhere, `Ctrl-W` for pane management, `:command` for named operations. The console must be comfortable to operators who live in Neovim.

---

## 2. ADR Dependency Map

| ADR | Title | Status | Console Role | Ships In |
|-----|-------|--------|-------------|----------|
| ADR-0029 | User Accounts and Merkle Audit Forest | Proposed | Account device pairings + OIDC status in Memory panel | Phase 7 / Ongoing |
| ADR-0030 | Talent Phonebook — Coordination Router | Proposed | Whois search overlay (`/` key), `POST /whois` pre-fills Inbox compose | Ongoing |
| ADR-0031 | Spider — The Surface-Finder | Proposed | Spider draft queue in Roadmap panel, distinguished from operator-authored items | Phase 6 |
| ADR-0032 | unSpider — The Contradiction-Finder | Proposed | unSpider alerts in ADR browser; escalations badged in Inbox | Phase 6 |
| ADR-0033 | Roadmap Pop — Atomic Claim from the Curated Pile | Accepted | Roadmap panel Pop+Begin action; `pd roadmap pop --begin` wired to `o` key | Phase 3 |
| ADR-0034 | Link Roadmap Claims to Sessions and Agents | Accepted | Session roadmap slug in status bar; roadmap_claims FK shown in Claims detail | Phase 3 |
| ADR-0035 | Three-Tier Memory Vocabulary — Core/Recall/Archival | Accepted | Memory panel three-tier display; salvage resurrection with memory tier labels | Phase 6 |
| ADR-0036 | pd-bosun — Minimalist Daemon Supervisor | Accepted | Health panel: bosun heartbeat freshness + daemon restart history | Ongoing |
| ADR-0037a | Git Access Control + pd feature Verbs | Proposed | Activity panel: git verb invocations per session; shim-broadcast overlap warnings | Phase 3 |
| ADR-0037b | pd backup / pd restore — Durable Snapshots | Proposed | Health panel: last-backup timestamp, snapshot count, manual-snapshot trigger | Ongoing |
| ADR-0040a | Non-Forgeable Actor Identity | Proposed | Fleet roster: `[NEW]` badge + Quebec flag until first completed sortie | Phase 3 |
| ADR-0040b | PD-Encompassing Shell — PATH Shims | Proposed | Activity panel: tool.invoked events from shim-broadcast | Phase 3 |
| ADR-0041 | Durable Commitments and Obligation Monitoring | Proposed | Commitments panel: open obligations, due-at countdown, overdue status-bar alert | Phase 6 |
| ADR-0046 | The Operator TUI | Accepted | **This document — the entire pd-console project** | All phases |
| ADR-0047 | Harbor Envelope Enforcement — fail-closed boundary | Accepted | Sorties dispatch: dry-run `POST /harbors/:name/check`; Peek: boundary violations at approval | Phase 1–2 |
| ADR-0048 | What Port Daddy Is — the North Star | Accepted | Philosophical anchor; console must express "building department" not "log viewer" | Architecture |
| ADR-0050 | The Coast Guard — agentic safety on the operator's machine | Accepted | Fleet roster: `[🔒 confined]` indicator; Suggestibility: compulsion evaluator + rent ledger | Phase 5 |

**ADR-0049 and ADR-0051** are not present in `/docs/adr/` as of this writing; no console features depend on them.

---

## 3. Panel Inventory

| # | Shortcut | Glyph | Panel Name | Priority | ADRs | Data Sources | Notes |
|---|----------|-------|------------|----------|------|--------------|-------|
| 1 | `1` | ⚓ | Fleet | P0 | 0040a, 0047, 0050 | `GET /agents`, `GET /sessions`, `GET /attention`, `SIGNAL_FOR_STATE` | ICS flag cards; grid and list views |
| 2 | `2` | 🧭 | Cockpit | P0 | 0046 | `lib/transcripts.ts`, `lib/tube-spawner-router.ts`, `POST /pheromone/spray` | Conversation multiplexer; avatar + agent panes |
| 3 | `3` | 🗺 | Roadmap | P0 | 0033, 0034, 0031 | `GET /roadmap/items`, `roadmap_claims`, `cartographer_drafts` | Pop+Begin action; Spider drafts distinguished |
| 4 | `4` | 👁 | Peek | P0 | 0046, 0047 | Sortie metadata, `POST /harbors/:name/check`, GitHub App API | HITL visual review; before/after screenshots |
| 5 | `5` | 📌 | Claims | P0 | 0034, 0047, 0050 | `GET /sessions/:id`, `lib/symbol-index.ts`, `POST /advisor` | Conflict tree; Uniform flag highlights |
| 6 | `6` | 🚀 | Sorties | P0 | 0046, 0047 | `POST /sorties`, `GET /sorties`, `lib/spawner.ts`, `lib/coast-guard/*` | Dispatch form + live tail; spend gauge |
| 7 | `7` | 📐 | ADRs | P1 | 0031, 0032, 0033 | `docs/adr/` filesystem, `lib/ideas-trove.ts`, `GET /advisor`, unSpider feed | Browser + inline editor; contradiction alerts |
| 8 | `8` | 📡 | Activity | P1 | 0037a, 0040b | `GET /attention`, `lib/maritime.ts`, shim events, SSE feed | Real-time event stream; overlap warnings |
| 9 | `9` | 🪝 | Sessions | P1 | 0034, 0035 | `GET /sessions`, `GET /salvage`, `GET /resurrection/pending` | Sessions + Salvage; memory tier labels |
| 10 | `0` | 📬 | Inbox | P1 | 0030, 0032 | `GET /inbox`, `POST /tube`, `GET /channels`, `POST /whois` | Actor messages + tube + unSpider escalations |
| 11 | `s` | 🧲 | Suggestibility | P1 | 0050 | `POST /advisor`, `lib/coast-guard/compulsion.ts`, `lib/coast-guard/compulsion-facts.ts` | Per-agent scores + rent ledger + voice cards |
| 12 | `m` | 🧠 | Memory | P1 | 0029, 0035 | `GET /briefing`, pd memory tiers, `lib/episodic-memory`, ADR-0029 | Three-tier display; briefing assembler |
| 13 | `p` | 🔀 | PRs | P2 | — | GitHub App API, `gh pr list/status`, `fleet_transcripts.pr_number` | CI status; Copilot review comments; one-keystroke merge |
| 14 | `h` | 🩺 | Health | P2 | 0036, 0037b | `lib/coast-guard/*`, bosun heartbeat file, `GET /health`, `GET /status` | Bosun freshness; backup status; spend caps |
| 15 | `c` | 🤝 | Commitments | P2 | 0041 | `commitments` table, ADR-0041 Cohen-Levesque goal model | Obligation countdown; overdue alerts |
| 16 | `/` | 🔭 | Whois | P2 | 0030 | `POST /whois`, `lib/advisor.ts`, `lib/episodic-memory` | Fuzzy overlay; pre-fills DM commands |
| 17 | `t` | 📜 | Transcripts | P3 | — | `lib/transcripts.ts`, `lib/transcript-store.ts` | Cost rollup by ship and day; secret-redacted view |

---

## 4. Information Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         pd-console LAYOUT                                    │
├──────┬──────────────────────────────────────────────────────┬────────────────┤
│ HITL │  HITL TOP BAR (--voice-mayday; RESERVED color)       │  STATUS BAR    │
│ GATE │  [F] harbor:api:main awaiting input  [APPROVE] [REJ] │  clock $budget │
├──────┴──────────────────────────────────────────────────────┴────────────────┤
│      │                                                                        │
│ SIDE │            MAIN PANE AREA                                              │
│ BAR  │   ┌─────────────────────────┬──────────────────────────┐              │
│      │   │   PANE A                │   PANE B                 │              │
│  1   │   │   (any panel)           │   (any panel)            │              │
│  ⚓  │   │                         │                          │              │
│  2   │   │   Up to 2x2 grid        │                          │              │
│  🧭  │   │   Ctrl-W v/s to split   │                          │              │
│  3   │   │   Ctrl-W w to cycle     │                          │              │
│  🗺  │   │   Ctrl-W c to close     │                          │              │
│  4   │   └─────────────────────────┴──────────────────────────┘              │
│  👁  │                                                                        │
│  5   │                                                                        │
│  📌  ├────────────────────────────────────────────────────────────────────────┤
│  6   │   COMMAND BAR / MINIBUFFER                                             │
│  🚀  │   :pd <cmd> | :note <text> | :spray <msg> | :reload | :split <panel>  │
│  7   │                                                                        │
│  📐  └────────────────────────────────────────────────────────────────────────┘
│  8
│  📡       SIDEBAR: 6 cols wide (or 4 cols glyph-only with \)
│  9        Current panel = --accent-primary OKLCH highlight
│  🪝        Unread/alert count badges per panel
│  0
│  📬
│  s
│  🧲
│  m
│  🧠
│  p
│  🔀
│  h
│  🩺
│  c
│  🤝
│  /
│  🔭
│  t
│  📜
└──────
```

### Cockpit Pane Detail

```
┌─ COCKPIT ───────────────────────────────────────────────────────────────────┐
│ AVATAR PANE │ [H] harbor:api  │ [Y] nightshift  │ [A] cartographer          │
│ (leftmost)  │ chat pane       │ chat pane       │ chat pane                 │
│             │                 │                 │                           │
│ pd system   │ [ROLE] callsign │ ...             │ ...                       │
│ messages    │ Agent: msg text │                 │                           │
│ --brand-sec │ tinted bg       │                 │                           │
│ italic      │ (hashed color)  │                 │                           │
│             │                 │                 │                           │
│             │ PD:║ advisory   │                 │                           │
│             │    ║ message    │                 │                           │
├─────────────┴─────────────────┴─────────────────┴───────────────────────────┤
│ > _   (input bar; i to enter, Esc to leave)                                 │
└─────────────────────────────────────────────────────────────────────────────┘
Tab cycles between agent panes. x closes a pane without killing the agent.
PD system messages: --brand-secondary left border + italic. Agent messages: hashed callsign tint.
```

---

## 5. Phase Plan

### Phase 0 — ratatui Shell

**Goal:** Multi-pane TUI multiplexer that boots, displays live agent chats, and exits cleanly.

**Ships:**
- `pd-console` binary (Rust crate at `apps/pd-console/`)
- Sidebar navigation with shortcut keys 1–9, 0, s, m, p, h, c, /, t
- `Ctrl-W v/s/w/c` pane management (up to 4 panes, 2×2)
- Fleet panel — roster only, ICS flag per agent, no actions yet
- Cockpit panel — transcript read-only, SSE subscribe to `lib/transcripts.ts` feed
- HITL top bar — renders in `--voice-mayday` red when any agent is in `awaiting-human` state; F1 focuses it
- Status bar — panel name, session identity, fleet summary (N agents, spend today $X.XX), clock
- 60fps render loop via ratatui `crossterm` backend
- Panic recovery: SIGINT and `Ctrl-C`/`Ctrl-Q` restore terminal state (alternate screen, cursor)
- `NO_COLOR` and `TERM_ANIMATIONS=0` environment flag support
- Daemon connectivity: configurable base URL, health check on startup with clear error if daemon is down

**Acceptance Criteria (ADR-0046 Phase 0 done-when):**
- [ ] Binary boots in < 200ms on cold macOS start
- [ ] Multiplexes ≥ 2 live agent chats simultaneously in split panes
- [ ] ICS flag renders as ANSI color block for each agent state
- [ ] HITL bar appears within 3s of any agent entering `awaiting-human` state
- [ ] Terminal state fully restored after quit or panic
- [ ] `NO_COLOR` produces monochrome output; all information still legible

**Key Rust Files to Create:**

```
apps/pd-console/
  src/
    main.rs                   — CLI args, terminal setup, event loop
    app.rs                    — App struct: state, panel routing, pane manager
    daemon/
      client.rs               — HTTP client wrapper (reqwest), base URL config
      sse.rs                  — SSE subscriber: /attention, transcript feeds
      models.rs               — Rust types mirroring daemon JSON shapes
    ui/
      layout.rs               — Three-column layout: sidebar + main panes + bars
      sidebar.rs              — Panel list with shortcut badges + count badges
      hitl_bar.rs             — Top bar rendered in --voice-mayday
      status_bar.rs           — Bottom bar: breadcrumb, session slug, fleet summary
      pane_manager.rs         — Split/tab/fullscreen logic, up to 2x2
    panels/
      fleet.rs                — Agent card grid + list view
      cockpit.rs              — Conversation multiplexer + input bar
    tokens.rs                 — OKLCH token constants (generated from CSS in Phase 4)
    maritime.rs               — ICS flag rendering: ANSI block + tooltip
  Cargo.toml
```

---

### Phase 1 — Avatar Dispatch Loop

**Goal:** Typed instruction in the Cockpit input bar spawns a new agent via tube→spawner router; the new agent chat pane appears automatically.

**Ships:**
- Cockpit panel: input mode (`i` to enter, `Esc` to leave), submit sends message via `POST /tube` to spawner router
- Avatar pane: always occupies leftmost slot when Cockpit is active; shows PD system messages with `--brand-secondary` double-border
- New agent pane auto-appears when `lib/tube-spawner-router.ts` spawns a new agent
- Sorties panel: dispatch form (recipe, task, backend, approvalMode, harbor, budget) + DRY RUN via `POST /harbors/:name/check` before actual dispatch
- Live tail of agent output in Sorties: reads from `lib/transcripts.ts subscribe()` SSE; flag transition banners
- Kill/pause controls per sortie; spend gauge showing costUsd vs harbourEnvelope.budgetUsd
- Fleet roster actions: MSG (pre-fills Inbox), KILL (with confirmation), WAKE (tube resume signal)
- Harbor envelope boundary violations surfaced inline in Sorties live tail

**Acceptance Criteria (ADR-0046 Phase 1 done-when):**
- [ ] Typing an instruction in the Cockpit avatar pane and pressing Enter spawns a new agent
- [ ] New agent chat pane appears in Cockpit within 5s without manual refresh
- [ ] DRY RUN in Sorties dispatch shows admit/deny from harbor check before actual dispatch
- [ ] Spend gauge updates as agent burns tokens
- [ ] Harbor boundary violations appear as inline annotations in the live tail

**Key Rust Files to Create:**

```
apps/pd-console/src/
  panels/
    sorties.rs              — Dispatch form + live tail + spend gauge
  daemon/
    tube.rs                 — POST /tube client
    sorties.rs              — POST/GET /sorties client
    harbors.rs              — POST /harbors/:name/check client
```

---

### Phase 2 — pd-peek + Claim Tree

**Goal:** Operators can review before/after screenshots, annotate, and approve/reject with GitHub App wiring. Claims panel shows full conflict tree.

**Ships:**
- Peek panel: contact sheet layout, BEFORE/AFTER columns, thumbnail strip, diff overlay (`d`), zoom/pan (`z`, arrows, +/-)
- Peek note sidebar: `n` to activate, `@mention` autocomplete, prior notes chronological
- Peek approve/reject flow: harbor check → GitHub App approve/request-changes → tube rejection message → agent receives F flag
- HITL bar integration: `before-apply` approvalMode lights bar; `F1` jumps to Peek pre-loaded; `[` / `]` navigate pending items
- Claims panel: directory tree, per-file owner bars with hashed callsign colors, ICS flag badges
- Claims conflict highlighting: Uniform flag semantic (`--signal-uniform` background tint) for ≥2 claimants
- Claims detail pane: full claim record, session link, roadmap slug, symbol info, advisor suggestions
- Claims actions: Refine (symbol picker via `lib/symbol-index.ts`), Message owner, Force-release (confirmation required)
- Sixel image rendering for Peek (when terminal supports it; character-art fallback otherwise)

**Acceptance Criteria:**
- [ ] Screenshot thumbnails render in contact sheet (sixel or character-art)
- [ ] Diff overlay highlights changed regions between before/after
- [ ] Approve action: publishes note, calls harbor check, calls GitHub App, updates sortie metadata
- [ ] Reject action: requires non-empty note, sends tube message to agent, agent enters F state
- [ ] Claims tree shows all claimed files with owner color bars
- [ ] Conflict files highlighted in Uniform red with ⚠ prefix
- [ ] Detail pane shows advisor suggestions with action pre-fills

**Key Rust Files to Create:**

```
apps/pd-console/src/
  panels/
    peek.rs                 — Contact sheet, zoom, note sidebar, approve/reject
    claims.rs               — Directory tree, conflict highlighting, detail pane
  daemon/
    github.rs               — GitHub App API client (approve, request-changes)
    notes.rs                — POST /notes client
    symbol_index.rs         — lib/symbol-index.ts HTTP wrapper
```

---

### Phase 3 — HITL Top Bar + Roadmap Strip + Activity Feed

**Goal:** Roadmap panel is fully interactive. Activity stream shows real-time coordination events. Fleet roster shows newcomer badges per ADR-0040a.

**Ships:**
- Roadmap panel: phase-filtered list, Pop+Begin action (`o` key, calls `pd roadmap pop --begin`), Spider drafts queue, session/claim linkage column
- Activity panel: SSE feed with `formatRadioMessage()` formatting, git verb invocations, harbor boundary crossings, shim tool invocations per session (ADR-0040b), overlap warnings (ADR-0037a)
- Fleet newcomer badge: `[NEW]` + Quebec flag (Q) on non-forgeable ULID actors with no history (ADR-0040a)
- HITL bar: multiple simultaneous items scroll horizontally; mayday-pulse animation (TERM_ANIMATIONS=0 respected)
- Sessions panel (read-only): active sessions list with roadmap claim slug, salvageable sessions, resurrection workflow
- Health panel (basic): daemon uptime, bosun heartbeat freshness, spend-cap status

**Acceptance Criteria (ADR-0046 Phase 3 done-when):**
- [ ] Blocked agent (awaiting-human) lights HITL bar within 3s
- [ ] Roadmap panel Pop+Begin action creates a session and links it to the roadmap item
- [ ] Activity feed shows git verb events from shim-broadcast in real time
- [ ] Newcomer Q badge visible on new actors in Fleet roster

**Key Rust Files to Create:**

```
apps/pd-console/src/
  panels/
    roadmap.rs              — Phase filter, Pop+Begin, Spider drafts section
    activity.rs             — SSE feed, formatRadioMessage render, event type coloring
    sessions.rs             — Sessions list, salvage section, resurrection workflow
    health.rs               — Daemon/bosun/backup status
```

---

### Phase 4 — Canonical Token Mirror + Contrast Audit

**Goal:** Zero invented color names in pd-console. All OKLCH values generated from `website-v2/src/styles/tokens.semantic.css`. CI fails on divergence.

**Ships:**
- Token extraction script: parses `tokens.semantic.css`, generates `apps/pd-console/src/tokens.rs` with all `--name` → OKLCH constants  <!-- cite-exempt: proposed pd-console file, not yet built -->
- ANSI color mapping: OKLCH → truecolor (`\x1b[38;2;R;G;Bm`) → 256-color fallback → 16-color fallback (single-hue ramp)
- CI check: `scripts/check-token-mirror.sh` — runs extractor, diffs against committed `tokens.rs`, fails if diff  <!-- cite-exempt: proposed pd-console file, not yet built -->
- Contrast audit: all foreground/background pairs verified ≥ WCAG AA (4.5:1 normal text, 3:1 large) using OKLCH L channel arithmetic
- Typography: IBM Plex Mono for code/transcripts/command bar; General Sans for UI labels (terminal fallback: system sans); Commit Mono for ICS flag letters

**Acceptance Criteria (ADR-0046 Phase 4 done-when):**
- [ ] `grep -r 'oklch\|#[0-9a-f]\{3,6\}\|rgb(' apps/pd-console/src/` returns zero results outside `tokens.rs`
- [ ] `scripts/check-token-mirror.sh` runs in CI; zero diff against current CSS  <!-- cite-exempt: proposed pd-console file, not yet built -->
- [ ] All text/background pairs pass WCAG AA contrast check (automated)
- [ ] Truecolor → 256 → 16 fallback chain exercised in CI with `COLORTERM=` and `TERM=xterm` overrides

**Key Rust Files to Create:**

```
apps/pd-console/
  scripts/
    extract-tokens.py       — CSS parser → tokens.rs generator
  src/
    tokens.rs               — AUTO-GENERATED: do not hand-edit
  tests/
    contrast_audit.rs       — WCAG contrast arithmetic for all token pairs
scripts/
  check-token-mirror.sh     — CI divergence check
```

---

### Phase 5 — Claims + Suggestibility Full

**Goal:** Claims panel has full advisor integration and symbol-level refinement. Suggestibility panel has compulsion evaluator, rent ledger, and voice cards per ADR-0050.

**Ships:**
- Claims panel: full `POST /advisor` integration for `claims.conflicting-active-claims` and `claims.refine-whole-file`; Enter-on-advice pre-fills command bar
- Claims: dead claim rendering (`--signal-ghost` OKLCH, crossed-out owner); stale claim Yankee flag; reclaim action
- Suggestibility panel: per-agent score cards (accepted/rejected suggestion count, recency-weighted score)
- Compulsion state machine display: all facts from `lib/coast-guard/compulsion-facts.ts` live, warning icons on contributing facts
- Rent ledger timeline: `pd note` events for session, commit gaps highlighted amber
- Recent advice strip: top 5 advice items from `POST /advisor`, severity-color-coded, Enter pre-fills action
- Voice cards: agent last 2 messages vs PD system voice, distinct visual treatment
- Cockpit inline code+heat: `Ctrl-H` toggles per-line pheromone heat overlay (ADR-0046 Phase 5)

**Acceptance Criteria:**
- [ ] Suggestibility score updates within 10s of suggestion accept/reject event
- [ ] Rent verdict PAID/RENT-DUE/STALE/IDLE reflects live compulsion-facts values
- [ ] block-commit events visible as red entries in rent ledger
- [ ] Voice cards visually distinct: agent = hashed-tint bg; PD = double-border box
- [ ] Cockpit `Ctrl-H` shows pheromone heat colors per source line

**Key Rust Files to Create:**

```
apps/pd-console/src/
  panels/
    suggestibility.rs       — Score cards, compulsion state, rent ledger, voice cards
  daemon/
    advisor.rs              — POST /advisor client with full CoordinationAdvice model
    compulsion.rs           — lib/coast-guard/compulsion-facts.ts HTTP wrapper
```

---

### Phase 6 — ADR Browser + Sessions/Salvage + Commitments

**Goal:** ADRs browsable and editable in-TUI. Sessions/Salvage panel has memory tier labels (ADR-0035). Commitments panel tracks open obligations (ADR-0041).

**Ships:**
- ADR browser: list panel (number, truncated title, status badge, roadmap-linked dot, unSpider alert badge), detail panel (markdown rendered with syntax highlighting)
- Inline ADR editor: vim modes (i/a/Esc/`:w`/`:wq`), `:wq` creates draft PR via `gh pr create --draft`
- unSpider alerts: inline callout blocks with `--voice-pan-pan` border in ADR detail; `n` key navigates between alerts
- Implementation Matrix: rendered as table with live phase status from roadmap
- Sessions/Salvage panel: active sessions list with roadmap claim slug, salvage queue with project grouping, resurrection-with-memory workflow, memory tier labels (Core/Recall/Archival)
- Commitments panel: open obligations table with due-at countdown, state machine (open/done/abandoned), drill-down to roadmap claim + session, overdue entries trigger status-bar alert badge
- Memory/Briefing panel: three-tier display, briefing assembler output, fleet quota consumption, account device pairings stub (ADR-0029)

**Acceptance Criteria:**
- [ ] All ADRs in `docs/adr/` renderable without crash
- [ ] Edited ADR saves to disk; `pd note` fires confirming edit
- [ ] `:wq` in ADR editor creates a draft PR (requires `gh` in PATH)
- [ ] unSpider alerts surfaced as inline callouts; `n` navigates between them
- [ ] Commitments overdue badge appears in status bar within 5s of due-at passing
- [ ] Sessions panel shows memory tier label for each salvageable session

**Key Rust Files to Create:**

```
apps/pd-console/src/
  panels/
    adrs.rs                 — Browser list, markdown renderer, inline editor
    commitments.rs          — Obligation table, countdown timer, drill-down
    memory.rs               — Three-tier display, briefing output
  editor/
    vim_mode.rs             — Embedded editor: insert/normal/command modes, :w/:q/:wq
  markdown/
    renderer.rs             — Terminal markdown: headers, tables, code blocks, callouts
```

---

### Phase 7 — Avatar Autonomy Loop + PR Panel

**Goal:** End-to-end autonomous roadmap item completion: worktree → PR → adversarial test → review → CI → merge → prune → done, each step pd-attest-gated. PR panel with GitHub App integration and Copilot comment response.

**Ships:**
- PR panel: PR list with CI status badges, Copilot review comment display, approval state, draft/non-draft gate, one-keystroke merge (`m` on green non-draft only)
- PR commits sub-view: `c` key within PR panel
- Copilot comment response: every inline comment addressable from within the PR panel; fix+reply or dismiss-with-reason; cannot merge with unaddressed comments
- Avatar autonomy loop: operator selects a roadmap item in Roadmap panel, `o` key initiates full loop, each attest gate visible in HITL bar or Cockpit
- Feel pass: panel transitions ≤ 400ms; `TERM_ANIMATIONS=0` respected; all animations tested with reduced-motion
- 15-persona blind-test QC: human-gate mechanism (HITL bar) findable in < 3s by testers who have not used the console before

**Acceptance Criteria (ADR-0046 Phase 7 done-when):**
- [ ] PR panel shows CI status from GitHub App within 10s of check completion
- [ ] Merge action disabled on draft PRs and on PRs with unaddressed Copilot comments
- [ ] Avatar autonomy loop: `pd attest` visible as status-bar event at each gate
- [ ] Panel transition latency ≤ 400ms measured with `time`
- [ ] Blind panel test: 15 testers find the HITL bar in < 3s mean time

**Key Rust Files to Create:**

```
apps/pd-console/src/
  panels/
    prs.rs                  — PR list, CI badges, Copilot comments, merge action
  daemon/
    webhooks.rs             — GET /webhooks client for CI event stream
  autonomy/
    loop.rs                 — Avatar autonomy state machine, attest gate wiring
  tests/
    feel_pass.rs            — Latency benchmarks, animation flag tests
```

---

### Ongoing Panels

These panels can be wired in parallel with Phases 3–7 as daemon routes stabilize. No hard phase dependency.

| Panel | Shortcut | Key Work | Daemon Dependency |
|-------|----------|----------|-------------------|
| Inbox | `0` | Actor messages + tube steering + DM composer with whois-prefill; unSpider escalations badged | `GET /inbox`, `POST /tube`, `GET /channels`, `POST /whois` |
| Health | `h` | Bosun heartbeat freshness + restart history; last-backup timestamp; manual snapshot trigger; spend-cap status | `GET /health`, `GET /status`, bosun heartbeat file, `pd backup metadata` |
| Whois | `/` | Full-width fuzzy overlay; one-enter to compose message or hand off | `POST /whois`, `lib/advisor.ts`, `lib/episodic-memory` |
| Transcripts | `t` | fleet_transcripts header list, cost rollup by ship and day, full message drill-down | `lib/transcripts.ts listTranscripts/getTranscript/costRollup` |
| Memory | `m` | Three-tier (Core/Recall/Archival), briefing assembler output, account device pairings (ADR-0029 stub) | `GET /briefing`, memory tiers |

---

## 6. Key Bindings Reference

### Global (any context)

| Key | Action |
|-----|--------|
| `1`–`9`, `0` | Switch to panel by number (Fleet, Cockpit, Roadmap, Peek, Claims, Sorties, ADRs, Activity, Sessions, Inbox) |
| `s` | Suggestibility panel |
| `m` | Memory / Briefing panel |
| `p` | PRs panel |
| `h` | Health panel |
| `c` | Commitments panel |
| `/` | Whois search overlay |
| `?` | Keybindings help overlay |
| `Ctrl-P` | Pheromone spray mini-prompt |
| `F1` | Jump to HITL top bar (if active); Esc to return |
| `Esc` | Return to previous pane / exit modal / exit zoom |
| `q` | Close current overlay/modal (NOT quit) |
| `Ctrl-C`, `Ctrl-Q` | Quit pd-console (confirmation required) |
| `\` | Toggle sidebar collapse (full 6 cols ↔ glyph-only 4 cols) |

### Pane Management (vim Ctrl-W prefix)

| Key | Action |
|-----|--------|
| `Ctrl-W v` | Vertical split |
| `Ctrl-W s` | Horizontal split |
| `Ctrl-W w` | Cycle focus between panes |
| `Ctrl-W c` | Close focused pane |
| `Ctrl-W h/j/k/l` | Move focus left/down/up/right |
| `Ctrl-W =` | Equalize pane sizes |
| `Ctrl-W z` | Zoom focused pane to fullscreen (toggle) |

### Navigation (list/tree mode, all panels)

| Key | Action |
|-----|--------|
| `j` / `k` | Move down / up |
| `g g` | Jump to top |
| `G` | Jump to bottom |
| `Ctrl-D` / `Ctrl-U` | Page down / up |
| `l` / `Enter` | Expand / drill into item |
| `h` | Collapse / go up one level |
| `Tab` | Cycle between sub-sections within panel |

### Fleet Panel (`1`)

| Key | Action |
|-----|--------|
| `n` | Spawn new agent (opens Sorties dispatch form) |
| `d` | Dispatch sortie for focused agent |
| `Enter` | Open agent detail / jump to Cockpit pane for agent |
| `x` | Kill focused agent (confirmation required) |
| `r` | Refresh fleet from daemon |
| `v` | Toggle grid / list view |
| `f` | Filter cycle: all → active → blocked → idle |

### Cockpit Panel (`2`)

| Key | Action |
|-----|--------|
| `Tab` | Cycle between agent chat panes |
| `i` | Enter input mode (type message to focused agent) |
| `Ctrl-H` | Toggle per-line pheromone heat overlay |
| `x` | Close focused agent pane (does NOT kill agent) |
| `a` | Open avatar pane |
| `r` | Refresh transcript |

### Roadmap Panel (`3`)

| Key | Action |
|-----|--------|
| `o` | Pop + Begin roadmap item (`pd roadmap pop --begin`) |
| `d` | View Spider drafts queue |
| `Enter` | Open roadmap item detail |
| `f` | Filter: now / backlog / done / spider-draft |
| `l` | Link current item to a note |

### Peek Panel (`4`)

| Key | Action |
|-----|--------|
| `1`–`9` | Jump to screenshot index |
| `Tab` | Shift focus between BEFORE and AFTER columns |
| `d` | Toggle pixel-diff overlay |
| `z` | Enter zoom mode |
| `f` | Fit-to-pane (reset zoom) |
| `n` | Activate note input |
| `a` | Approve (HITL) |
| `r` | Reject (HITL) |
| `[` / `]` | Navigate between pending HITL items |
| Arrow keys | Pan when zoomed / navigate thumbnails |
| `+` / `-` | Zoom in / out |

### Claims Panel (`5`)

| Key | Action |
|-----|--------|
| `f` | Filter to conflicts only |
| `u` | Filter to unclaimed files |
| `Enter` | Expand detail for focused claim |
| `Ctrl-R` | Release focused claim (confirmation required) |
| `m` | Message claim owner (pre-fills Inbox) |
| `r` | Refine whole-file claim to symbol |

### Sorties Panel (`6`)

| Key | Action |
|-----|--------|
| `n` | New dispatch form |
| `Enter` | Open live tail for focused sortie |
| `k` | Kill focused sortie |
| `p` | Pause / resume focused sortie |
| `o` | Open in Cockpit pane |
| `Ctrl-P` | Spray pheromone to focused agent |

### ADRs Panel (`7`)

| Key | Action |
|-----|--------|
| `/` | Fuzzy search ADRs by title or number |
| `p` | Filter: proposed only |
| `a` | Filter: accepted only |
| `e` | Open inline editor for focused ADR |
| `o` | Jump to roadmap items for focused ADR |
| `n` | Jump to next unSpider alert in document |
| `:w` | Save (editor mode) |
| `:wq` | Save + create draft PR (editor mode) |

### Suggestibility Panel (`s`)

| Key | Action |
|-----|--------|
| `Tab` | Cycle between agent score cards |
| `Enter` | Expand detail for focused agent |
| `n` | Jump to next non-'paid' agent |
| `f` | Filter to agents with active advice items |

### Command Bar / Minibuffer

| Key | Action |
|-----|--------|
| `:` | Open command mode |
| `Ctrl-G` | Cancel / clear command bar |
| `Up` / `Down` | History in command bar |
| `:pd <cmd>` | Run any pd CLI command; output in overlay |
| `:reload` | Reload current panel data |
| `:split <panel>` | Open named panel in split |
| `:spray <msg>` | Spray pheromone with message |
| `:note <text>` | Publish pd note immediately |
| `:backup` | Trigger manual snapshot (ADR-0037b) |

---

## 7. pd-peek Detailed Design

### Purpose

pd-peek is the visual HITL review surface. When a sortie runs with `approvalMode: before-apply`, the operator must visually inspect before/after screenshots and either approve (triggering the GitHub App to un-draft and approve the PR) or reject (triggering a tube message to the agent and entering the F/Foxtrot state).

This is not a nice-to-have. It is the primary mechanism by which the operator maintains authority over what gets committed. Harbor envelope enforcement (ADR-0047) prevents violations; pd-peek enables informed consent.

### Layout

```
┌─ PEEK ────────────────────────────────────────────────────────────────────────┐
│ Sortie: fix-auth-bug  Agent: harbor:api:main  PR #312  [DRAFT]               │
│ approvalMode: before-apply                          1 of 3 pending HITL items │
├──────────────────────────────────────┬───────────────────────────────────────┤
│              BEFORE                  │               AFTER                   │
│  ┌────────────────────────────────┐  │  ┌────────────────────────────────┐  │
│  │                                │  │  │                                │  │
│  │   screenshot / frame (main)    │  │  │   screenshot / frame (main)    │  │
│  │                                │  │  │                                │  │
│  │  (sixel or character-art)      │  │  │  (sixel or character-art)      │  │
│  │                                │  │  │                                │  │
│  └────────────────────────────────┘  │  └────────────────────────────────┘  │
│  [1] [2] [3] thumbnails              │  [1] [2] [3] thumbnails              │
├──────────────────────────────────────┴───────────────────────────────────────┤
│ NOTES ──────────────────────────────────────────────────────────────────────  │
│  > auth flow looks good, but check the JWT expiry in frame 2_                │
│  • [14:22] harbor:api:main: "began auth fix sortie"                          │
│  • [14:35] harbor:api:main: "all tests passing"                              │
│                                                                               │
│  [APPROVE ✓]    [REJECT ✗]    Harbor check: ✅ admit (filesystem boundary)   │
└───────────────────────────────────────────────────────────────────────────────┘
```

### Contact Sheet Mode (default)

- Each column (BEFORE, AFTER) shows the current screenshot in the main pane
- Thumbnail strip at the bottom of each column shows all screenshots in the sortie
- `1`–`9` jump to screenshot index in the focused column
- Arrow keys navigate thumbnails; `Enter` promotes to main view
- `Tab` shifts focus between BEFORE and AFTER columns
- When both columns show the same index, `d` toggles pixel-diff overlay
  - Diff rendered as `--signal-delta` OKLCH color ramp (amber hue, single-hue, no red/green to avoid colorblind conflicts)
  - If no visual diff available (text-only sortie): shows raw text before/after side by side

### Diff Overlay Details

The diff overlay is critical for rapid visual review. It must:
- Show only pixels that changed, not the full image
- Use a single-hue ramp (amber) so it reads cleanly against both light and dark terminal themes
- Show a legend: "X pixels changed (Y%)" in the bottom-left of the overlay
- Degrade gracefully when screenshots are not available (shows "diff not available: no images")

### Zoom / Pan Mode

- `z` enters zoom mode on the focused screenshot
- If the terminal supports sixel (detected via `TERM` and `COLORTERM` env vars), upscale to sixel
- Otherwise: block-character upscale (`▀▄` 2x zoom using Unicode half-block)
- Arrow keys pan when zoomed; `+` / `-` adjust zoom level (1x, 2x, 4x, 8x)
- `Esc` exits zoom back to contact sheet
- `f` fit-to-pane resets zoom and center

### Note Sidebar

- Bottom strip, always visible, single-line input by default
- `n` activates note input mode (cursor jumps to note field)
- Note text supports `@callsign` mentions (auto-completed from active session agents)
- Typed note is attached to the current sortie/PR via `POST /notes` (same `pd note` storage)
- Prior notes shown as chronological list above input, newest at bottom
- Max display: 5 prior notes, scrollable with `Ctrl-D/U`

### Approve Flow

`a` or clicking `[APPROVE ✓]`:

1. If note field is non-empty, publish note via `POST /notes` with sortie context
2. Call `POST /harbors/:name/check` in dry-run mode to verify action is admitted
   - If denied: show boundary label inline (filesystem / tools / skills / budget), require operator acknowledgment (press `A` again to override after reading)
   - If admitted: proceed
3. Call GitHub App to un-draft PR: `PATCH /repos/:owner/:repo/pulls/:number` `{draft: false}`
4. Call GitHub App to submit approving review: `POST /repos/:owner/:repo/pulls/:number/reviews` `{event: "APPROVE"}`
5. Update sortie metadata `approvalMode` status to `'approved'`
6. Status bar confirmation: `✦ PR #312 approved — harbor:api:main` (flashes in `--signal-charlie` green for 3s)
7. HITL bar item for this sortie clears

### Reject Flow

`r` or clicking `[REJECT ✗]`:

1. If note field is empty: focus note field and show warning "Rejection requires a reason — type your note first"
2. Publish note as rejection reason via `POST /notes`
3. Call GitHub App to submit request-changes review: `POST /repos/:owner/:repo/pulls/:number/reviews` `{event: "REQUEST_CHANGES", body: <rejection note>}`
4. Send tube message to agent via `POST /tube` with rejection reason and instructed next action
5. Update sortie status to `'blocked'`
6. Agent receives F (Foxtrot) flag state → HITL bar remains lit for this agent awaiting further instruction
7. Status bar: `✦ PR #312 rejected — harbor:api:main blocked, awaiting instruction` (in `--voice-mayday` red for 3s, then normal)

### HITL Bar Integration

The HITL top bar is the sentinel. When any sortie enters `approvalMode: before-apply`:
- HITL bar lights in `--voice-mayday` solid red (reserved exclusively for this)
- Bar shows: ICS F flag glyph, agent callsign, brief reason ("awaiting approval: fix-auth-bug"), `[APPROVE]` and `[REJECT]` keyboard hints
- Multiple simultaneous pending approvals scroll horizontally with `[1/3]` count indicator
- `F1` from any pane jumps focus to HITL bar; `Enter` on a HITL item opens Peek pre-loaded
- `[` and `]` navigate between pending items within the Peek panel

---

## 8. Maritime Flags Reference

### The Two Maritime Modules

Port Daddy uses two maritime modules with distinct roles:

- **`lib/maritime.ts`** — original module; renders six flags as ANSI colored blocks, formats radio messages (SignalType), provides `signalToFlag()` for voice signals. Used in status output and message formatting.
- **`lib/maritime-signals.ts`** — canonical signals module; defines `SIGNAL_FOR_STATE` (agent state → flag letter), full ICS single-letter meanings, ANSI color assignments per flag letter, hoist multi-flag combos.

pd-console uses both. Fleet roster and agent cards use `SIGNAL_FOR_STATE` from `maritime-signals.ts`. Message formatting in the Cockpit uses `formatRadioMessage()` from `maritime.ts`.

### SIGNAL_FOR_STATE — Agent State to Flag Mapping

| Agent State | Flag | Letter | Full ICS Meaning | OKLCH Token |
|-------------|------|--------|-----------------|-------------|
| `claim-active` | Hotel | H | I have a pilot on board | `--signal-active` (green) |
| `claim-stale` | Yankee | Y | I am dragging my anchor | `--signal-stale` (amber) |
| `awaiting-human` | Foxtrot | F | I am disabled; communicate with me | `--voice-mayday` (red) |
| `burning-cash` | Bravo | B | I am taking in/carrying dangerous cargo | `--signal-bravo` (magenta) |
| `conflict` | Victor | V | I require assistance | `--signal-conflict` (red-orange) |
| `blocked` | Delta | D | Keep clear; I am maneuvering with difficulty | `--signal-warning` (amber) |
| `idle` | Mike | M | My vessel is stopped and making no way | `--signal-idle` (gray) |
| `spawning` | Alpha | A | I have a diver down; keep well clear | `--signal-alpha` (muted blue) |
| `fleet-healthy` | Papa | P | Blue Peter — about to put to sea | `--signal-healthy` (green) |
| `mayday` | Juliett | J | I am on fire with dangerous cargo; keep well clear | `--voice-mayday` (red, pulsing) |
| `inform` | Romeo | R | The way is off my ship; you may feel your way past me | `--signal-info` (blue) |
| `request` | Kilo | K | I wish to communicate with you | `--signal-kilo` (yellow) |
| `refuse` | November | N | Negative / no | `--signal-error` (red) |
| `affirmative` | Charlie | C | Affirmative / yes | `--signal-charlie` (green) |

**Newcomer (ADR-0040a):** Actors with non-forgeable ULID and no completed sortie history show `Q` (Quebec: My vessel is healthy and I request free pratique) with a `[NEW]` badge until first sortie completion.

### Full ICS Single-Letter Flag Reference

All 26 flags, as defined in `lib/maritime-signals.ts`, with their ANSI color assignment and any pd-console usage:

| Letter | Flag Name | Full ICS Meaning | ANSI Group | pd-console Usage |
|--------|-----------|-----------------|------------|-----------------|
| A | Alpha | I have a diver down; keep well clear at slow speed | gray | `spawning` agent state |
| B | Bravo | I am taking in, discharging, or carrying dangerous cargo | gray | `burning-cash` agent state |
| C | Charlie | Affirmative / yes | green | `affirmative`; success messages; approved state |
| D | Delta | Keep clear of me; I am maneuvering with difficulty | red | `blocked` agent state |
| E | Echo | I am altering my course to starboard | blue | Not currently mapped to agent state |
| F | Foxtrot | I am disabled; communicate with me | red | `awaiting-human` — **HITL trigger** |
| G | Golf | I require a pilot | magenta | Not currently mapped; possible future `needs-orchestrator` |
| H | Hotel | I have a pilot on board | green | `claim-active` — actively engaged |
| I | India | I am altering my course to port | blue | Not currently mapped |
| J | Juliett | I am on fire and have dangerous cargo on board; keep well clear | magenta | `mayday` — operational disaster, pulsing |
| K | Kilo | I wish to communicate with you | yellow | `request` state; standby/ready |
| L | Lima | You should stop your vessel instantly | gray | `block` guard action in `lib/maritime.ts` |
| M | Mike | My vessel is stopped and making no way through the water | yellow | `idle` agent state |
| N | November | Negative / no | red | `refuse` state; errors |
| O | Oscar | Man overboard | red | Not mapped; reserved for future agent-crash escalation |
| P | Papa | Blue Peter — about to put to sea | green | `fleet-healthy` state |
| Q | Quebec | My vessel is healthy and I request free pratique | green | Newcomer badge (ADR-0040a) |
| R | Romeo | The way is off my ship; you may feel your way past me | blue | `inform` state |
| S | Sierra | I am operating astern propulsion | blue | Not currently mapped |
| T | Tango | Keep clear of me; I am engaged in pair trawling | gray | Not currently mapped |
| U | Uniform | You are running into danger | yellow | Conflict/warning in `lib/maritime.ts`; Claims conflict highlight |
| V | Victor | I require assistance | red | `conflict` agent state |
| W | Whiskey | I require medical assistance | red | Not mapped; reserved for severe agent failure |
| X | X-ray | Stop carrying out your intentions and watch for my signals | red | Not mapped; possible future use for guard interception |
| Y | Yankee | I am dragging my anchor | yellow | `claim-stale` agent state |
| Z | Zulu | I require a tug | gray | Not mapped; possible future `needs-reboot` |

### ANSI Color Assignments (from SIGNAL_ANSI in maritime-signals.ts)

| Color Group | Flags | Notes |
|-------------|-------|-------|
| Green | C, H, P, Q | Affirmative, active, healthy, newcomer |
| Yellow | K, M, U, Y | Request, idle, danger-ahead, dragging-anchor |
| Red | D, F, N, O, V, W, X | Blocked, disabled, negative, overboard, assist, medical, stop |
| Blue | E, I, R, S | Course changes, inform, astern |
| Magenta | G, J | Needs-pilot, on-fire |
| Gray | A, B, L, T, Z | Diver-down, dangerous-cargo, stop-instantly, trawling, needs-tug |

### Hoist Multi-Flag Combos

Hoists (multi-flag sequences) from `lib/maritime-signals.ts` appear as combined badge displays:

| Hoist | Meaning | pd Context |
|-------|---------|------------|
| K-1 | Ask with topic | `pd ask --topic` invocation |
| U-Y | Danger + dragging anchor | Conflict AND claim-stale simultaneously |
| P-Q | Blue Peter + free pratique | Fleet startup sequence: all healthy |
| D-V | Maneuvering difficulty + assistance needed | Conflict requiring human arbitration |
| F-G | Disabled + needs pilot | Blocked + auto-spawn-fix triggered |
| O-W | Man overboard + medical | Agent crashed + mayday state |

### Flag Rendering in pd-console

ICS flags render as 3-column × 2-row ANSI blocks with the letter centered in Commit Mono:

```
╔═══╗    Example: Hotel (H) — claim-active
║ H ║    Background: --signal-active (green ANSI)
╚═══╝    Letter: white, centered, Commit Mono bold
```

The block is exactly 3 cells wide and 2 cells tall. Adjacent states (multiple flags) render as inline hoists with a thin separator. `?` on a focused agent card opens a tooltip with the full ICS single-sentence meaning.

`NO_COLOR` env var and non-TTY stdout: COLOR_ENABLED check from `lib/maritime.ts` is mirrored in the Rust `maritime.rs` module. When disabled: flags render as `[H]`, `[F]`, etc. in plain brackets. All information remains legible.

---

## 9. Suggestibility Panel Detailed Design

### Purpose

The Suggestibility panel provides the operator a single place to answer the question: **"Which agents are behaving well, which are drifting, and which are about to get blocked?"**

It surfaces three interlocking systems from ADR-0050 (The Coast Guard):
1. **Suggestibility score** — how often this agent accepts coordination advice
2. **Compulsion state machine** — the rent evaluator's live facts and current verdict
3. **Voice cards** — the qualitative difference between agent voice and PD system voice

### Per-Agent Score Card Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ⚓ SUGGESTIBILITY           Sort: [score ▼ | name]    Filter: [all | non-paid]│
├──────────────────────┬──────────────────────┬──────────────────────────────┤
│ harbor:api:main      │ nightshift:fix        │ cartographer:roadmap          │
│ Score:  0.87  ████▓░ │ Score:  0.34  ██░░░░ │ Score:  0.91  █████░          │
│ ✅ PAYING RENT        │ ⚠️  RENT DUE          │ ✅ PAYING RENT                │
│ accepted:  3         │ accepted:  0          │ accepted:  5                  │
│ rejected:  1         │ rejected:  2          │ rejected:  0                  │
│ session:   7f3a      │ session:   2c91       │ session:   a44b               │
└──────────────────────┴──────────────────────┴──────────────────────────────┘
```

Score bar colors:
- ≥ 0.8: `--rent-paid` (green)
- 0.5–0.79: `--voice-pan-pan` (amber)
- < 0.5: `--signal-error` (red)

### Compulsion State Machine Detail (left column)

When an agent card is focused and expanded, the detail pane shows:

```
COMPULSION FACTS — nightshift:fix  session 2c91
────────────────────────────────────────────────
commitsSinceLastNote:   3   ⚠  (threshold: 1)
claimsTotal:            1
commitsTotal:           5
commitsBehindBase:      0
ageMs:                  47m 23s
lastSignalAgeMs:        47m 23s  ⚠  (threshold: 30m)
idleGraceRemaining:     0m       ⚠  (expired)
isMainWorktree:         false

VERDICT:  RENT-DUE
ACTION:   block-commit
```

Each fact renders on one line. Facts that contribute to a non-PAID verdict show `⚠` in `--voice-pan-pan` amber. The VERDICT line is bolded and colored:
- `PAID`: `--rent-paid` (green)
- `RENT-DUE`: `--rent-due` (amber)
- `STALE`: `--rent-stale` (amber)
- `IDLE`: `--rent-idle` (red)

The LeaseAction line (`allow | block-commit | reclaim`) follows the verdict.

`isMainWorktree: true` shows a lock icon with "reclaim gate: main checkout is not reclaimable" — this is a safety invariant that the console displays prominently to prevent operator confusion.

### Rent Ledger (right column)

```
RENT LEDGER — nightshift:fix
─────────────────────────────────────────────────────
14:00  pd note: "began auth investigation"
14:22  pd note: (none since — 47 min gap)
       ↓ 3 commits without note ← amber highlight
       commit abc1234: "fix auth.ts"
       commit def5678: "add test"
       commit ghi9012: "update lock"
       ← block-commit triggered at commit 3   RED entry
─────────────────────────────────────────────────────
```

The ledger shows:
- All `pd note` events for the agent's current session (timestamp + text)
- Commits that fall between notes (chronologically)
- Gap spans highlighted amber if commits-without-note ≥ 1
- `block-commit` events as red entries
- The oldest entry at top, newest at bottom

Ledger entries are read-only. The operator cannot delete notes (immutable per Port Daddy invariants). Scrollable with `Ctrl-D/U`.

### Recent Advice Strip (middle)

```
RECENT ADVICE from /advisor — nightshift:fix
─────────────────────────────────────────────────────
🔴 [critical] context.session-missing — session 2c91 not found in active DB
🟡 [warning]  claims.conflicting-active-claims — sugar.ts also claimed by harbor:api:main
🔵 [info]     claims.refine-whole-file — narrow from whole-file to symbol range  [→ act]
🔵 [info]     context.note-gap — 47 minutes since last note; consider pd note
```

Severity icons and colors:
- `🔴 [critical]`: `--signal-error` red
- `🟡 [warning]`: `--voice-pan-pan` amber
- `🔵 [info]`: `--signal-info` blue

`Enter` on any advice item copies the suggested action to the command bar pre-filled (e.g., `:pd claims refine --session 2c91 --file sugar.ts`).

### Voice Cards

Voice cards make the distinction between agent voice and PD system voice visually unmistakable:

```
┌──────────────────────────────┬──────────────────────────────────────┐
│ nightshift:fix  (AGENT)      │ PD SYSTEM VOICE                      │
│ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │ ╔════════════════════════════════╗   │
│ "I analyzed auth.ts and      │ ║ [K] KILO                        ║   │
│  found a missing JWT check.  │ ║ advisoryMode: active             ║   │
│  Shall I proceed with the    │ ║ harbor:api:main session open     ║   │
│  patch strategy?"            │ ║ → coordinate before proceeding  ║   │
│                              │ ╚════════════════════════════════╝   │
│ Signal: OVER   (gray text)   │                                      │
└──────────────────────────────┴──────────────────────────────────────┘
```

Left column (agent):
- Background: soft tint derived from callsign color hash × `--surface-agent-tint`
- Font: normal weight, not italic
- Signal type shown in its canonical color (OVER = gray, MAYDAY = red, etc.)
- Last 2 messages from this agent's transcript

Right column (PD system):
- Background: `--surface-pd-system` (distinct from any agent tint)
- Double-line box border: `╔══╗` style in `--brand-secondary` OKLCH
- Font: italic — always italic for PD system voice
- Signal type shown with flag letter + flag name

The visual distinction is deliberate: agents are peers communicating via radio; PD is the infrastructure itself. The double-border box is a visual sigil for "this is the coordination substrate speaking, not an agent peer."

---

## 10. Design System

### Framework: ratatui + crossterm

pd-console is a Rust TUI application using:
- **ratatui** (0.26+): widget composition, layout, drawing backend
- **crossterm**: terminal I/O, event handling, ANSI escape codes
- **tokio**: async runtime for concurrent SSE streams and HTTP client

No GPUI. No Electron. No web renderer. The terminal is the renderer.

### Color System: OKLCH Tokens

All colors in pd-console are OKLCH values resolved from `website-v2/src/styles/tokens.semantic.css`. The Rust token mirror (`apps/pd-console/src/tokens.rs`) is generated by `scripts/extract-tokens.py` and must not be hand-edited.  <!-- cite-exempt: proposed pd-console file, not yet built -->

OKLCH to ANSI mapping:
- **Truecolor** (`COLORTERM=truecolor`): `\x1b[38;2;R;G;Bm` — exact OKLCH → sRGB conversion
- **256-color** fallback: nearest color in `xterm-256color` palette by OKLCH L/C distance
- **16-color** fallback: semantic category mapping (e.g., all red-family tokens → `\x1b[31m`)
- **No color** (`NO_COLOR`): no ANSI codes; all information conveyed by content only

CI enforces that every color used in pd-console maps through a named token. Grepping `apps/pd-console/src/` for bare `oklch(`, `#[0-9a-f]`, or `rgb(` outside `tokens.rs` is a CI failure.

### Typography

| Context | Font | Minimum Size | Notes |
|---------|------|-------------|-------|
| Body / UI labels | General Sans (terminal fallback: system sans) | 14px terminal-cell equivalent | Never shrink below this |
| Captions / metadata | General Sans Light | 13px equivalent | Only for timestamps and footnotes |
| Eyebrow labels | General Sans Bold Uppercase | 12px equivalent | Only if uppercase + weight ≥600 + letter-spacing ≥0.1em |
| Code / transcripts / command bar | IBM Plex Mono | 14px | Monospace for all code-like content |
| Agent callsigns | IBM Plex Mono Bold | 14px | Callsign-hashed color |
| ICS flag letters | Commit Mono | 14px | Centered in ANSI block |

**The 14px rule is an accessibility line, not a preference.** pd-console never uses `text-xs` equivalent density without compensating size increase. Density is achieved by split panes, not by shrinking text.

### Contrast and Accessibility

- All foreground/background pairs must meet WCAG AA: 4.5:1 for body text, 3:1 for large text (≥18pt or ≥14pt bold)
- OKLCH L channel ensures perceptual uniformity: hue shifts don't secretly reduce apparent contrast
- Automated contrast audit runs in CI via `tests/contrast_audit.rs`  <!-- cite-exempt: proposed pd-console file, not yet built -->
- `TERM_ANIMATIONS=0` stops all animated elements (mayday pulse, flag transitions, spend gauge animation)
- `NO_COLOR` produces monochrome output with all information preserved via content (not just color)
- Zoom: the TUI respects terminal window resize events; operators can `Ctrl-+` in their terminal to zoom the entire TUI

### Sixel Image Support (Peek Panel)

Sixel support is detected at runtime:

```rust
fn sixel_supported() -> bool {
    env::var("TERM").map(|t| t.contains("sixel")).unwrap_or(false)
        || env::var("COLORTERM").map(|c| c == "truecolor").unwrap_or(false)
            && env::var("TERM_PROGRAM").map(|p| p == "iTerm.app" || p == "WezTerm").unwrap_or(false)
}
```

When sixel is available: screenshots render as pixel-accurate sixel images in the Peek contact sheet.  
When sixel is not available: block character upscale using `▀▄` Unicode half-blocks (2x zoom, color-mapped to 256-color).  
When no color: ASCII art fallback using `.`, `#`, `+`, `@` luminance mapping.

### Design Tokens: Key Entries

| Token | Role | Never |
|-------|------|-------|
| `--voice-mayday` | HITL top bar ONLY | Never used for any other element |
| `--voice-pan-pan` | Urgent warnings | Not life-threatening urgency |
| `--brand-secondary` | PD system message box border | Not agent messages |
| `--signal-uniform` | Claims conflict background tint | Not general warnings |
| `--surface-agent-tint` | Agent message bg (hashed per callsign) | Not PD system messages |
| `--text-primary` | Body text | Minimum 14px equivalent; never go below |

---

## 11. Open Questions

The following questions require operator decision or further design work before the relevant phases can finalize:

### Q1: Sixel vs Kitty protocol for Peek images
Phase 2 uses sixel for screenshot rendering. Some modern terminals (WezTerm, Kitty) support the Kitty graphics protocol which offers better performance and positioning. Should pd-console support Kitty protocol as a first-tier option with sixel as fallback, or sixel-first?  
**Affects:** Phase 2 `peek.rs`  
**Decision needed by:** Phase 2 kickoff

### Q2: Inline ADR editor scope
Phase 6 ships a vim-mode inline editor for ADRs. The question is how minimal to make it: (a) basic insert/normal/`:w`/`:wq`, or (b) full vim motions (word, paragraph, search/replace)? Full vim is more work but the editor is used by operators who live in vim and a partial implementation will feel broken.  
**Affects:** Phase 6 `vim_mode.rs`  
**Decision needed by:** Phase 6 kickoff

### Q3: Avatar autonomy loop scope for Phase 7
ADR-0046 Phase 6 (our Phase 7) describes the full worktree→PR→adversarial test→review→CI→merge→prune→done loop. How much of this is automated vs. HITL-gated? The current design gates each step with `pd attest` and requires operator approval at `before-apply`. Does the operator want a "fully automated" mode for trusted roadmap items?  
**Affects:** Phase 7 `autonomy/loop.rs`  
**Decision needed by:** Phase 7 kickoff

### Q4: Transcript secret redaction
The Transcripts panel shows `lib/transcripts.ts` output. Transcripts may contain secrets passed to agents (API keys in tool args, etc.). What is the redaction policy? Options: (a) truncate all tool args over N chars, (b) redact patterns matching `PD_*` env var names, (c) operator-configurable regex, (d) require daemon-side redaction before storage.  
**Affects:** `panels/transcripts.rs`, possibly daemon storage layer  
**Decision needed by:** Before Transcripts panel ships (Ongoing)

### Q5: ADR-0029 account OIDC in Memory panel
The Memory panel includes a stub for ADR-0029 account device pairings + OIDC status. ADR-0029 is Proposed (not Accepted). Should the Memory panel render a placeholder "account features not yet available" view, or should the account section be omitted entirely until ADR-0029 is accepted?  
**Affects:** `panels/memory.rs`  
**Decision needed by:** Ongoing memory panel implementation

### Q6: Pheromone spray path derivation
`Ctrl-P` from any pane fires pheromone spray with "path derived from current pane context." What is the derivation rule? Options: (a) the focused file in Claims tree, (b) the currently-live sortie's working directory, (c) the last `git_sha_at_annotation` target, (d) always prompt operator for path. A consistent derivation rule reduces friction but requires agreeing on semantics per-panel.  
**Affects:** `panels/*.rs` (all panels that expose Ctrl-P)  
**Decision needed by:** Phase 2 (Ctrl-P ships in Phase 1 with basic derivation)

### Q7: 15-persona blind test logistics
Phase 7 acceptance includes a "15-persona blind panel test: find the HITL bar in < 3s." Who are the testers? How is the test administered? This requires actual human testers who have not seen the console. Plan for how to recruit and run this test should be established before Phase 7 ships.  
**Affects:** Phase 7 acceptance criteria  
**Decision needed by:** Phase 5 (to allow lead time for recruiting)

### Q8: Conflict between pd-console and FleetBar
FleetBar is a SwiftUI menu bar app showing fleet state. pd-console is a terminal TUI showing the same state plus much more. Is FleetBar still actively maintained once pd-console ships? Or does pd-console's Fleet panel supersede FleetBar? The answer affects whether the FleetBar codebase needs updates to stay in sync as new agent states are added.  
**Affects:** `apps/FleetBar/`, prioritization  
**Decision needed by:** Phase 3 (when Fleet roster is fully functional)

---

*End of pd-console Operator Console Implementation Roadmap v1.0*

*Last updated: 2026-06-10*  
*Author: Port Daddy technical documentation*  
*Source of truth: ADR-0046, `lib/maritime-signals.ts`, `lib/coast-guard/compulsion.ts`, `website-v2/src/styles/tokens.semantic.css`*
