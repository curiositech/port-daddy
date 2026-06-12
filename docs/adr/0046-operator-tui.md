# 0046. The Operator TUI — a conversation multiplexer, not a file browser

## Status

Accepted

## Context

The operator wants **one place** to run Port Daddy: a TUI where they talk to a
single **operator-avatar** agent that dispenses all the others (sorties, agents,
fleets), and from which they can watch and steer everything. A first design pass
(`design/tui-fleetbar-mockups/operator-tui-mockup.html`) was rejected for the
right reasons:

> "That file browser sucks. I don't want to hop around my vibe repo with that.
> Where's the multiplexing between different agents' chats? Or my ability to
> spray pheromones, or talk to my avatar?"

The lesson, stated plainly: **this is a conversation multiplexer with steering,
not a file explorer.** The centerpiece is *chats* — the avatar's, and every
dispatched agent's — plus the operator's ability to **spray a pheromone / drop a
signal** to guide them. The filetree and heat views are *supporting context*
surfaced on demand, never the thing you navigate.

Two design-system facts constrain the build:

- The first mockup was built on `design/tokens/primitives.json`, a **forked,
  rotted palette** (invented names "cinnabar/kelp/canary" that even get the brand
  color wrong — it calls canary-yellow the brand when canon is blue). The
  canonical source of truth is `website-v2/src/styles/tokens.semantic.css`, which
  already carries a **maritime semantic layer** (`--voice-mayday`/`--status-error`,
  `--signal-charlie`/`--status-success`, `--voice-pan-pan`/`--status-warning`,
  `--brand-primary`). See [[feedback_no_inline_design_specifics]].
- Most of the substrate already exists (PR #231's `cli/commands/attention.ts` +
  `GET /attention`; `lib/pheromone.ts` + `POST /pheromone/spray`; the
  tube→spawner router of PR #225). This ADR wires shipped primitives into one seat.

## Decision Drivers

- **Conversation-first.** The primary surface is the avatar chat + a multiplex of
  agent chats — split/tab/move, role-labeled. Not a filetree.
- **Steering is a first-class verb.** "Spray a pheromone / drop a note" is a
  key-bound action available from any context, not a decoration on a file row.
- **The avatar conducts.** I talk to it; it dispatches; I drop into any agent it
  spawned. Autonomy is gated by `pd attest` (ADR-0045) + an unmistakable HiTL bar.
- **Palette is canon.** The TUI speaks `tokens.semantic.css`; native (Rust)
  tokens are *generated mirrors*, never a hand-named fork.
- **Maritime signals are the coordination vocabulary.** ICS flag assignments are
  not decorative — each flag carries a single-sentence meaning that maps precisely
  onto the agent's operational state. The pre-attentive color + letter renders the
  fleet's status readable at a glance.

## Considered Options

- **A. File-browser-centric cockpit (the rejected v1).** Heat-coded filetree as
  the main view. Rejected: you don't want to hop around the repo; it buries the
  conversation and the steering.
- **B. A separate Tauri/CodeMirror "operator editor" GUI (PR #231 Part 2).**
  Rejected as a *second surface* — it contradicts "one place." Its mechanics
  (per-paragraph heat ribbon, pin spray, agent marginalia, replay) are folded
  INTO the TUI instead. (See Dissenting Appendix.)
- **C. (chosen) A conversation multiplexer:** avatar chat + agent-chat panes +
  pheromone-spray action as the core; roadmap/fleet/HiTL strips around it; code +
  heat as on-demand context, not a browse mode.

## Decision

Build the Operator TUI as a **multi-agent conversation cockpit** in `core/pd-tui`
(Rust/ratatui — the skill tree's pick for >60fps). The surfaces, in priority order:

1. **Avatar conversation** — the seat where I talk to my operator-avatar; it
   dispatches agents (via the tube→spawner router, PR #225) and reports back.
2. **Agent-chat multiplexer** — split/tab/move into any dispatched agent's live
   chat/transcript and converse with it directly. Panes labeled by **role, not
   PID**. tmux-like but more intuitive + colorful.
3. **Pheromone spray (first-class, key-bound)** — from any pane (a chat, a code
   snippet an agent shows, a roadmap item), drop a steering signal: `pheromones
   .spray(path, 'attention:human')`, a `feedback.drop`, or a `file:annotation`
   tuple. "Look here / this is wrong / prioritize this." Persisted with
   `git_sha_at_annotation`; revocable; hover shows lineage.
4. **HiTL top bar** — `--voice-mayday` *only* (reserved; nothing else may use
   solid mayday-red), so the one thing that needs a human always wins the
   pre-attentive race. Roadmap `now` list + my-agents + background-fleet strips.
5. **Code + heat as on-demand context** — when an agent touches code, surface the
   pheromone trail / per-line heat *inline in that pane*. NOT a repo file browser
   you navigate. (PR #231 Part 1, demoted to a context layer.)

**Palette/anti-rot (acceptance criterion):** all color references resolve to
`tokens.semantic.css` semantic/maritime names. `design/tokens/primitives.json` is
reconciled to a *generated mirror* of the semantic layer (matching names) or
deleted; CI fails if the native mirror diverges. No invented color names.

**Autonomy:** the avatar can run the roadmap end to end — worktree → PR-via-agent
→ adversarial test → review → CI-green → merge → prune → mark done — each step
gated by `pd attest` (ADR-0045) and surfaced for HiTL approval. Synthesizes the
in-flight arc: PR #231 (viz/steer), #143 (nightshift autonomy), #99 (dispatch
intent→PR), #141 (harbormaster merge ownership), #229 (Cartographer approver),
#227 (per-turn steering briefing).

---

## Navigation Model

### Layout: Three-Column Cockpit

```
┌──────┬──────────────────────────────────────────┬────────────────┐
│ HITL │            HITL TOP BAR                  │  status-bar    │
│ BAR  │  [F] AGENT_NAME awaiting input  [APPROVE]│  clock/budget  │
├──────┴──────────────────────────────────────────┴────────────────┤
│ SIDE │                                                            │
│ BAR  │           MAIN PANE AREA                                   │
│      │    (split / tabbed / fullscreen)                          │
│ [1]  │                                                            │
│  ⚓  │                                                            │
│      │                                                            │
│ [2]  │                                                            │
│  🧭  │                                                            │
│  ... │                                                            │
│      ├────────────────────────────────────────────────────────────┤
│      │           COMMAND BAR / MINIBUFFER                         │
└──────┴────────────────────────────────────────────────────────────┘
```

### Sidebar (persistent, 6 cols wide)

- Number keys `1`–`9`, `0`, and letter keys navigate panels instantly.
- Current panel highlighted with `--accent-primary` OKLCH token.
- Each entry: glyph + shortcut badge + optional count badge (unread messages,
  alerts).
- Sidebar collapses to glyph-only with `\` key (4 cols).
- Never hidden entirely — always present as navigation anchor.

### Main Pane Area

- Single-pane default (fullscreen content).
- `Ctrl-W v` — vertical split (two panes side by side).
- `Ctrl-W s` — horizontal split (stacked panes).
- `Ctrl-W w` — cycle focus between panes.
- `Ctrl-W c` — close focused pane.
- Up to 4 simultaneous panes (2×2 grid max).
- Each pane independently navigable to any panel.
- Panes labeled by panel name + current context
  (e.g. "Cockpit: avatar" vs "Cockpit: agent-X").

### HITL Top Bar

- Rendered exclusively in `--voice-mayday` OKLCH token — reserved. Nothing else
  in the UI uses solid mayday-red.
- Only appears when ≥1 agent is in F (Foxtrot: disabled, communicate with me) state.
- Shows: flag glyph, agent callsign, brief reason, [APPROVE] and [REJECT] actions.
- Multiple simultaneous HITL items scroll horizontally.
- `F1` jumps focus to HITL bar from anywhere; `Esc` returns to previous pane.

### Status Bar (bottom, 1 line)

- Left: current panel name + breadcrumb.
- Center: active session identity + roadmap claim slug if any.
- Right: fleet summary (N agents, spend today $X.XX), clock.
- Alert badges for overdue commitments, unread inbox, unSpider escalations.

### Modal Overlays

- `/` (Whois search): full-width fuzzy search overlay, Esc to dismiss.
- `?` (help): keybindings cheat-sheet overlay.
- `g d` (ADR detail): inline editor opens in current pane, not modal.
- Peek zoom: `z` enters fullscreen zoom mode within Peek panel; `Esc` exits.

### Pheromone Spray (available from ANY pane)

- `Ctrl-P` opens spray mini-prompt in command bar.
- Prompt: `spray [attention|warn|block|note]: ` with context pre-filled from
  cursor position.
- Fires `POST /pheromone/spray` with path derived from current pane context.
- Confirmation flash in status bar: "✦ pheromone sprayed → agent-X".

### Cockpit Multiplexer Detail

- Avatar pane always occupies leftmost slot when Cockpit is active.
- Agent chat panes labeled `[ROLE] callsign` (not PID).
- PD system messages: left-bordered with `--brand-secondary` OKLCH token, italic.
- Agent messages: background tinted with agent's consistent callsign color hash.
- `Tab` cycles between agent panes within Cockpit panel.
- `x` closes an agent pane (does NOT kill the agent).
- Inline code+heat context: `Ctrl-H` toggles per-line pheromone heat overlay on
  visible code.

---

## Panels

| # | Name | Shortcut | Glyph | Priority | Description |
|---|------|----------|-------|----------|-------------|
| 1 | Fleet | `1` | ⚓ | p0 | Fleet roster — live agent cards with ICS maritime flags, state, cost-cap, confinement status, claim count. One card per agent; flag changes in real time. |
| 2 | Cockpit | `2` | 🧭 | p0 | Conversation multiplexer — avatar pane + per-agent chat panes, split/tab/move. PD system messages visually distinct from agent messages. Pheromone spray key-bound. |
| 3 | Roadmap | `3` | 🗺 | p0 | Roadmap items at current phase — Pop+Begin action (ADR-0033), Spider drafts queue distinguished from operator-authored entries (ADR-0031), per-item session/claim linkage (ADR-0034). |
| 4 | Peek | `4` | 👁 | p0 | Visual HITL panel — contact sheet of before/after screenshots with zoom/pan, note sidebar, approve/reject wired to GitHub App. HITL bar integration: mayday-red reserved. |
| 5 | Claims | `5` | 📌 | p0 | Claim tree — visual tree of file/region ownership by agent+session, conflicts highlighted in `--signal-conflict`, ability to refine whole-file claims to symbol claims. |
| 6 | Sorties | `6` | 🚀 | p0 | Agent dispatch — spawn form with approvalMode, live tail of agent output, kill/pause controls. Harbor boundary violations surface inline. Spend-cap gauge per sortie. |
| 7 | ADRs | `7` | 📐 | p1 | ADR browser + inline editor — list of all ADRs with status badges, full text viewer, inline edit with pd note linking. unSpider contradiction alerts surfaced per ADR (ADR-0032). |
| 8 | Activity | `8` | 📡 | p1 | Real-time activity stream — shim-broadcast overlap warnings (ADR-0037a/0040b), git verb invocations, harbor boundary crossings, tool invocations per session. |
| 9 | Sessions | `9` | 🪝 | p1 | Sessions + Salvage — active sessions with roadmap claim slug inline, salvageable abandoned sessions, resurrection-with-memory workflow, memory tier labels (ADR-0035). |
| 10 | Inbox | `0` | 📬 | p1 | Inbox / Tube / Messaging — actor messages, tube steering channels, DM composer with whois-prefill (ADR-0030), unSpider escalations (ADR-0032) visually badged. |
| 11 | Suggestibility | `s` | 🧲 | p1 | Per-agent scores, rent ledger (compulsion evaluator), voice cards showing agent tone vs PD voice, sandbox status (GREEN/AMBER/RED), compulsion state machine. |
| 12 | Memory | `m` | 🧠 | p1 | Three-tier display (Core/Recall/Archival per ADR-0035), briefing assembler output, account device pairings + OIDC status (ADR-0029), fleet quota consumption. |
| 13 | PRs | `p` | 🔀 | p2 | GitHub PR states — PR list with CI status, Copilot review comments, approval state, draft/non-draft gate, one-keystroke merge (green non-draft only). Commits panel sub-view. |
| 14 | Health | `h` | 🩺 | p2 | Bosun heartbeat freshness + daemon restart history (ADR-0036), last-backup timestamp + snapshot count + manual-snapshot trigger (ADR-0037b), spend-cap status. |
| 15 | Commitments | `c` | 🤝 | p2 | Open agent obligations (ADR-0041) with due-at countdown, state machine (open/done/abandoned), drill-down to roadmap claim + session. Overdue = status-bar alert. |
| 16 | Whois | `/` | 🔭 | p2 | Who-knows-about-X quick search (ADR-0030) — fuzzy query over agents/sessions/skills ranked by relevance, pre-filled DM commands, one-enter to compose or hand off. |
| 17 | Transcripts | `t` | 📜 | p3 | Transcript ledger — fleet_transcripts header list with cost rollup by ship and day, full message+output drill-down, secret-redacted, tool-arg truncated display. |

### Data Sources by Panel

**Fleet (1)**
- `GET /agents`, `GET /sessions`, `GET /attention`
- `lib/maritime-signals.ts SIGNAL_FOR_STATE`, `lib/coast-guard/compulsion.ts`

**Cockpit (2)**
- `lib/transcripts.ts fleet_transcript_messages`
- `lib/tube-spawner-router.ts`, `POST /pheromone/spray`, `GET /spawn transcripts`

**Roadmap (3)**
- `GET /roadmap/items`, `roadmap_claims table`, `cartographer_drafts queue`

**Peek (4)**
- `sortie approvalMode metadata`, `POST /harbors/:name/check`
- `GitHub App API`, `lib/coast-guard/compulsion.ts`

**Claims (5)**
- `GET /sessions/:id (claims)`, `lib/symbol-index.ts`
- `POST /advisor (claims.conflicting-active-claims)`

**Sorties (6)**
- `POST /sorties`, `GET /sorties`, `lib/spawner.ts`
- `lib/coast-guard/compulsion.ts`, `POST /harbors/:name/check`

**ADRs (7)**
- `docs/adr/ filesystem`, `lib/ideas-trove.ts`
- `GET /advisor (tuple hints)`, `unSpider feed`

**Activity (8)**
- `GET /attention`, `lib/maritime.ts formatRadioMessage`
- `pd-shim tool.invoked events`, SSE activity feed

**Sessions (9)**
- `GET /sessions`, `GET /salvage`, `GET /resurrection/pending`
- `roadmap_claims.session_id FK`

**Inbox (0)**
- `GET /inbox`, `POST /tube`, `GET /channels`
- `POST /whois`, `lib/maritime.ts RadioMessage`

**Suggestibility (s)**
- `POST /advisor`, `lib/coast-guard/compulsion.ts`
- `lib/coast-guard/compulsion-facts.ts`, `lib/advisor.ts CoordinationAdvice`

**Memory (m)**
- `GET /briefing`, pd memory tiers, `lib/episodic-memory`
- ADR-0029 account status

**PRs (p)**
- GitHub App API, `gh pr list/status`
- `fleet_transcripts.pr_number`, `GET /webhooks`

**Health (h)**
- `lib/coast-guard/*`, pd-bosun heartbeat file
- `GET /health`, `GET /status`, pd backup metadata

**Commitments (c)**
- `commitments table`, ADR-0041 Cohen-Levesque goal model
- `GET /sessions/:id`

**Whois (/)**
- `POST /whois`, `lib/advisor.ts`, `lib/episodic-memory`

**Transcripts (t)**
- `lib/transcripts.ts listTranscripts/getTranscript/costRollup`
- `lib/transcript-store.ts query/stats`

---

## pd peek Panel Spec

### Purpose

Visual HITL review surface — operators inspect before/after screenshots from
sortie runs, zoom/pan, annotate, and approve or reject, with approval wired to
GitHub App.

### Layout (full pane)

```
┌─ PEEK ──────────────────────────────────────────────────────────┐
│ Sortie: fix-auth-bug  Agent: harbor:api:main  PR #312  [DRAFT]  │
│ approvalMode: before-apply                                       │
├──────────────────────────────────┬──────────────────────────────┤
│         BEFORE                   │         AFTER                │
│  ┌────────────────────────┐      │  ┌────────────────────────┐  │
│  │                        │      │  │                        │  │
│  │    screenshot/frame    │      │  │    screenshot/frame    │  │
│  │    (contact-sheet)     │      │  │    (contact-sheet)     │  │
│  │                        │      │  │                        │  │
│  └────────────────────────┘      │  └────────────────────────┘  │
│  [1] [2] [3] ... thumbnails      │  [1] [2] [3] ... thumbnails  │
├──────────────────────────────────┴──────────────────────────────┤
│ NOTES ──────────────────────────────────────────────────────────│
│  > _                              [APPROVE ✓]  [REJECT ✗]       │
│  • Prior note: "check auth flow" — harbor:api:main, 14:22       │
└─────────────────────────────────────────────────────────────────┘
```

### Contact Sheet Mode (default)

- Thumbnails in a horizontal strip at bottom of each before/after column.
- Number keys `1`–`9` jump to screenshot index in focused column.
- Arrow keys navigate thumbnails; `Enter` promotes to main view.
- `Tab` shifts focus between BEFORE and AFTER columns.
- Diff overlay: `d` toggles a pixel-diff highlight between before/after for
  current index. Diff rendered as OKLCH `--signal-delta` color ramp (amber hue,
  single-hue). No diff available (text-only sortie) → shows raw text
  before/after instead.

### Zoom / Pan

- `z` enters zoom mode on focused screenshot (character-art upscale or sixel if
  terminal supports).
- Arrow keys pan when zoomed; `+`/`-` adjust zoom level.
- `Esc` exits zoom back to contact sheet.
- `f` fit-to-pane (reset zoom).

### Note Sidebar

- Bottom strip, always visible, single-line input by default.
- `n` activates note input mode (cursor jumps to note field).
- Typed note is attached to the current sortie/PR as a `pd note` via
  `POST /notes`.
- Prior notes from this sortie shown as chronological list above input.
- Note text supports inline `@agent-callsign` mentions (auto-completed from
  active agents).

### Approve / Reject Flow

`a` or `[APPROVE]` fires in sequence:
1. Publishes the typed note (if non-empty) via `POST /notes`.
2. Calls `POST /harbors/:name/check` dry-run to verify action is admitted.
3. If admitted: calls GitHub App to un-draft PR + approve review via
   `POST /github/prs/:number/approve`.
4. Updates sortie metadata approvalMode status to 'approved'.
5. Status bar confirmation: "✦ PR #312 approved — harbor:api:main".

`r` or `[REJECT]` fires:
1. Publishes note as rejection reason (required — prompts if empty).
2. Calls GitHub App to request-changes review.
3. Sends `pd tube` message to agent with rejection reason.
4. Sortie status → 'blocked', agent receives F (Foxtrot) flag.

Harbor boundary violation at approval time: shown inline in note area with
boundary label (filesystem/tools/skills/budget); operator must acknowledge
before approve goes through.

### HITL Bar Integration

- When a sortie reaches `approvalMode: before-apply`, the HITL top bar lights
  in `--voice-mayday`.
- `F1` from anywhere jumps to Peek panel pre-loaded with that sortie.
- Multiple pending approvals: `[` and `]` navigate between them within Peek.

---

## Fleet Roster + Agent Dispatch Spec

### Fleet Roster (Fleet panel, shortcut 1)

Each agent occupies one card in a grid or list (toggle with `v`):

```
┌─────────────────────────────────────────────────────────────────────┐
│ ⚓ FLEET  [grid | list]  Filter: [all | active | blocked | idle]    │
├──────────────┬──────────────┬──────────────┬────────────────────────┤
│ harbor:api   │ nightshift   │ cartograph   │  + SPAWN NEW AGENT     │
│              │              │              │                        │
│  [H] HOTEL   │  [Y] YANKEE  │  [A] ALPHA   │                        │
│ "pilot aboard│ "dragging    │ "diver down; │                        │
│  claim-activ"│  anchor"     │  keep clear" │                        │
│              │              │              │                        │
│ ████░░ $0.12 │ ░░░░░░ $2.47 │ ████░░ $0.08 │                        │
│ spend 3h     │ stale 47m    │ deep focus   │                        │
│ 3 claims     │ 1 claim (!)  │ 2 claims     │                        │
│ [MSG] [KILL] │ [MSG] [WAKE] │ [MSG] [PEEK] │                        │
└──────────────┴──────────────┴──────────────┘                        │
```

### ICS Maritime Flag Assignments

The maritime flag system is not cosmetic. Each ICS single-letter flag carries a
specific official single-sentence meaning. Every flag chosen for Port Daddy was
selected because that meaning maps precisely onto the agent's operational state.
A flag that merely "looks right" is disqualifying — the meaning must hold, so
that the pre-attentive color+letter conveys accurate semantics, not just vibe.

| State | Flag | Letter | Full ICS Meaning | Display Token |
|---|---|---|---|---|
| claim-active | H | Hotel | I have a pilot on board — actively engaged | `--signal-active` (green) |
| claim-stale | Y | Yankee | I am dragging my anchor — drifting off-task | `--signal-stale` (amber) |
| awaiting-human | F | Foxtrot | I am disabled; communicate with me — HITL needed | `--voice-mayday` (red) |
| burning-cash | B | Bravo | Taking in dangerous cargo — elevated spend risk | `--signal-bravo` (magenta) |
| conflict | V | Victor | I require assistance — needs arbitration | `--signal-conflict` (red-orange) |
| blocked | D | Delta | Keep clear of me; maneuvering with difficulty | `--signal-warning` (amber) |
| idle | M | Mike | My vessel is stopped, making no way | `--signal-idle` (gray) |
| spawning | A | Alpha | I have a diver down; keep well clear — vulnerable boot | `--signal-alpha` (muted blue) |
| fleet-healthy | P | Papa | All persons report on board; about to put to sea | `--signal-healthy` (green) |
| mayday | J | Juliet | I am on fire with dangerous cargo; keep well clear | `--voice-mayday` (red, pulsing) |
| inform | R | Romeo | Way is off my ship; you may feel your way past me | `--signal-info` (blue) |
| request | K | Kilo | I wish to communicate with you | `--signal-kilo` (yellow) |
| refuse | N | November | Negative / no | `--signal-error` (red) |
| affirmative | C | Charlie | Affirmative / yes | `--signal-charlie` (green) |

**Why ICS flags and not a custom icon set:** A custom icon set requires every
operator to learn its conventions from scratch. ICS flags are a real coordination
vocabulary from maritime operations, with decades of field use. Every flag
renders as a 3-char ASCII art block (letter centered, ANSI background matching
ICS flag color conventions). Hover tooltip — or `?` on focused card — displays
the full single-sentence official meaning. The semantics are loaded onto a
pre-existing international vocabulary, not invented.

**Newcomer badge (ADR-0040a):** New actors (non-forgeable ULID, no history)
display a small `[NEW]` badge and Q (Quebec: "vessel healthy, request free
pratique") until first completed sortie.

**Flag rendering detail:** 3×2 ANSI block, letter centered. Background color
matches the ICS color conventions for that flag. Animated pulse for
`--voice-mayday` states only; `TERM_ANIMATIONS=0` disables it.

### Agent Card Detail

- Callsign: bold, consistent hashed color per `lib/maritime.ts`
- Flag: large 3×2 ANSI block, letter centered
- Spend bar: horizontal gauge showing costUsd vs harbourEnvelope.budgetUsd cap
- Age + claim count
- Confinement indicator: `[🔒 confined]` if pd-cutter sandbox active (ADR-0050)
- Actions: MSG (opens Inbox compose), KILL (sigterm with confirmation), PEEK
  (jumps to Sorties pane for this agent), WAKE (if stale/idle — sends `pd tube`
  resume signal)

### Agent Dispatch (Sorties panel, shortcut 6)

```
┌─ DISPATCH ──────────────────────────────────────────────────────────┐
│ Recipe:  [investigate | fix | review | creative | custom]           │
│ Task:    > ________________________________________                 │
│ Backend: [claude | ollama | gemini | aider]                        │
│ Approval:[none | before-build | before-apply | before-close]       │
│ Harbor:  [default | strict | custom: ___________]                  │
│ Budget:  $_____ / run                                              │
│                                        [DRY RUN]  [DISPATCH]       │
├─────────────────────────────────────────────────────────────────────┤
│ LIVE TAIL — harbor:api:main  [A→H transition at 14:23:07]          │
│ ──────────────────────────────────────────────────────────────────  │
│ [14:23:07] HAIL harbor:api:main: Starting fix-auth-bug sortie      │
│ [14:23:09] REPORT: Analyzed auth.ts — found missing JWT check      │
│ [14:23:15] OVER: Awaiting operator input on test strategy          │
│                                                                     │
│ Spend: $0.12 / $5.00 cap  ████░░░░░░░░░░░░░░░░░░░░               │
│ [PAUSE]  [KILL]  [SPRAY PHEROMONE]  [OPEN IN COCKPIT]              │
└─────────────────────────────────────────────────────────────────────┘
```

- Live tail reads from `lib/transcripts.ts subscribe()` SSE feed.
- Message lines formatted via `lib/maritime.ts formatRadioMessage()`.
- SignalType rendered in its canonical color
  (mayday=red, report=white, hail=green, etc.).
- Flag transition events shown as banner lines: `[A→H transition at 14:23:07]`.
- `[DRY RUN]` calls `POST /harbors/:name/check` before actual dispatch — shows
  admit/deny result.
- `[SPRAY PHEROMONE]` opens pheromone mini-prompt pre-filled with agent's
  current working path.
- `[OPEN IN COCKPIT]` opens this agent's chat in the Cockpit multiplexer.

---

## Suggestibility Panel Spec

### Layout

```
┌─ SUGGESTIBILITY ────────────────────────────────────────────────────┐
│ Agent Score Board                              Sort: [score | name] │
├───────────────────┬─────────────────┬──────────────────────────────┤
│ harbor:api:main   │ nightshift:fix  │ cartographer:roadmap          │
│ Score: 0.87 ████  │ Score: 0.34 ██░ │ Score: 0.91 ████             │
│ PAYING RENT       │ RENT DUE        │ PAYING RENT                  │
│ 3 accepted        │ 0 accepted      │ 5 accepted                   │
│ 1 rejected        │ 2 rejected      │ 0 rejected                   │
└───────────────────┴─────────────────┴──────────────────────────────┘
│ DETAIL: nightshift:fix                                              │
├─────────────────────────────────────────────────────────────────────┤
│ COMPULSION STATE                      RENT LEDGER                  │
│ commitsSinceLastNote: 3               ┌──────────────────────────┐ │
│ claimsTotal: 1                        │ 14:00 note: "began fix"  │ │
│ commitsTotal: 5                       │ 14:22 note: (none since) │ │
│ idleGraceRemaining: 0m                │ ● 3 commits without note │ │
│ Verdict: RENT-DUE                     │   → verdict: block-commit │ │
│ Action: block-commit                  └──────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────┤
│ RECENT ADVICE (from /advisor)                                       │
│ [critical] context.session-missing — session 2c91 not found in DB  │
│ [warning]  claims.conflicting-active-claims — sugar.ts also owned  │
│ [info]     claims.refine-whole-file — narrow to symbol range       │
├─────────────────────────────────────────────────────────────────────┤
│ VOICE CARDS                                                         │
│ ┌──────────────────────────────┬──────────────────────────────────┐│
│ │ nightshift:fix (AGENT)       │ PD SYSTEM VOICE                  ││
│ │ "I analyzed auth.ts and      │ ╔══════════════════════════════╗ ││
│ │  found a missing JWT check.  │ ║ [K] KILO — I wish to comm-   ║ ││
│ │  Shall I proceed with the    │ ║ unicate: advisoryMode active  ║ ││
│ │  patch strategy?"            │ ║ harbor:api:main session open  ║ ││
│ │ Signal: OVER (gray)          │ ╚══════════════════════════════╝ ││
│ └──────────────────────────────┴──────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

### Per-Agent Score Card (top strip)

- **Suggestibility score:** 0.0–1.0 derived from (accepted_suggestions /
  total_suggestions) with recency weighting. Shown as horizontal bar + numeric.
- **Rent status badge:**
  - `PAYING RENT` — `--signal-charlie` green: all three compulsion rules passing
  - `RENT DUE` — `--voice-pan-pan` amber: commitsSinceLastNote > 0,
    block-commit imminent
  - `IDLE` — `--signal-stale` amber: idle past graceMs, reclaim-eligible
  - `STALE` — `--signal-error` red: commitsBehindBase > 20 AND
    lastSignalAgeMs > 2h
- Accepted/rejected suggestion counts for current session.

### Compulsion State Machine (detail, left)

- Live facts from `lib/coast-guard/compulsion-facts.ts`: commitsSinceLastNote,
  claimsTotal, commitsTotal, commitsBehindBase, ageMs, lastSignalAgeMs,
  idleGraceRemaining.
- Each fact with inline warning indicator when it contributes to non-'paid'
  verdict.
- Current RentVerdict prominently displayed: `PAID | RENT-DUE | STALE | IDLE`.
- Current LeaseAction: `allow | block-commit | reclaim`.
- isMainWorktree indicator (reclaim gate: main checkout is never reclaimable).

### Rent Ledger (detail, right)

- Timeline of `pd note` events for this agent's session (from
  `GET /sessions/:id/notes`).
- Each note shown as a timestamped entry.
- Gaps between notes highlighted: if ≥1 commit falls in the gap, shown with
  count + amber highlight.
- `block-commit` events shown as red entries in the ledger.

### Recent Advice (from /advisor)

- Top 5 advice items from `POST /advisor` for this agent's current session +
  files.
- Severity color-coded: critical=`--signal-error`, warning=`--voice-pan-pan`,
  info=`--signal-info`.
- Category icons: context, claim, lock, symbol, salvage, channel, tuple.
- `Enter` on any advice item opens the suggested action in command bar
  pre-filled.

### Voice Cards (bottom strip)

- Two columns: agent voice (left) vs PD system voice (right).
- Agent voice: shows last 2 messages from this agent's transcript, signal type
  in canonical color.
- PD voice: bordered with `--brand-secondary` OKLCH double-line box (╔══╗
  style), italic signal labels.
- Visual distinction: agent messages have soft background tint (hashed callsign
  color); PD messages have structured box border — always clearly the
  coordination substrate, not an agent peer.

### Key Bindings (Suggestibility panel)

- `Tab` — cycle between agent score cards
- `Enter` — expand detail for focused agent
- `n` — jump to next non-'paid' agent
- `f` — filter to agents with active advice items only

---

## Key Bindings Map

### Global (any context)

| Key | Action |
|---|---|
| `1`–`9`, `0` | Switch to numbered panel (Fleet→Inbox) |
| `s` | Switch to Suggestibility panel |
| `m` | Switch to Memory/Briefing panel |
| `p` | Switch to PRs panel |
| `h` | Switch to Health panel |
| `c` | Switch to Commitments panel |
| `/` | Open Whois search overlay |
| `?` | Open keybindings help overlay |
| `Ctrl-P` | Pheromone spray mini-prompt |
| `F1` | Jump to HITL top bar (if active) |
| `Esc` | Return to previous pane / exit modal / exit zoom |
| `q` | Close current overlay/modal (NOT quit) |
| `Ctrl-C` / `Ctrl-Q` | Quit pd-console (confirmation required) |
| `\` | Toggle sidebar collapse (full ↔ glyph-only) |

### Pane Management (vim Ctrl-W prefix)

| Key | Action |
|---|---|
| `Ctrl-W v` | Vertical split |
| `Ctrl-W s` | Horizontal split |
| `Ctrl-W w` | Cycle focus between panes |
| `Ctrl-W c` | Close focused pane |
| `Ctrl-W h/j/k/l` | Move focus left/down/up/right |
| `Ctrl-W =` | Equalize pane sizes |
| `Ctrl-W z` | Zoom focused pane to fullscreen (toggle) |

### Navigation (within panels — list/tree mode)

| Key | Action |
|---|---|
| `j` / `k` | Move down/up |
| `g g` | Jump to top |
| `G` | Jump to bottom |
| `Ctrl-D` / `Ctrl-U` | Page down/up |
| `l` / `Enter` | Expand / drill into item |
| `h` | Collapse / go up one level |
| `Tab` | Cycle between sub-sections within panel |

### Fleet Panel (1)

| Key | Action |
|---|---|
| `n` | Spawn new agent (opens Sorties dispatch form) |
| `d` | Dispatch sortie for focused agent |
| `Enter` | Open agent detail / jump to Cockpit pane for agent |
| `x` | Kill focused agent (with confirmation) |
| `r` | Refresh fleet from daemon |
| `v` | Toggle grid/list view |
| `f` | Filter (all / active / blocked / idle) |

### Cockpit Panel (2)

| Key | Action |
|---|---|
| `Tab` | Cycle between agent chat panes |
| `i` | Enter input mode (type message to focused agent) |
| `Ctrl-H` | Toggle per-line pheromone heat overlay |
| `x` | Close focused agent pane (does not kill agent) |
| `a` | Open avatar pane |
| `r` | Refresh transcript |

### Roadmap Panel (3)

| Key | Action |
|---|---|
| `o` | Pop + Begin roadmap item (`pd roadmap pop --begin`, ADR-0033) |
| `d` | View Spider drafts queue |
| `Enter` | Open roadmap item detail |
| `f` | Filter: now / backlog / done / spider-draft |
| `l` | Link current item to a note |

### Peek Panel (4)

| Key | Action |
|---|---|
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
| `+` / `-` | Zoom in/out |

### Claims Panel (5)

| Key | Action |
|---|---|
| `f` | Filter to conflicts only |
| `u` | Filter to unclaimed files |
| `Enter` | Expand detail for focused claim |
| `Ctrl-R` | Release focused claim (confirmation) |
| `m` | Message the claim owner (pre-fills Inbox) |
| `r` | Refine whole-file claim to symbol |

### Sorties Panel (6)

| Key | Action |
|---|---|
| `n` | New dispatch form |
| `Enter` | Open live tail for focused sortie |
| `k` | Kill focused sortie |
| `p` | Pause/resume focused sortie |
| `o` | Open in Cockpit pane |
| `Ctrl-P` | Spray pheromone to focused agent |

### ADRs Panel (7)

| Key | Action |
|---|---|
| `/` | Fuzzy search ADRs |
| `p` | Filter: proposed only |
| `a` | Filter: accepted only |
| `e` | Open inline editor for focused ADR |
| `o` | Jump to roadmap items for focused ADR |
| `n` | Jump to next unSpider alert in document |
| `:w` | Save (in editor mode) |
| `:wq` | Save + create draft PR (in editor mode) |

### Suggestibility Panel (s)

| Key | Action |
|---|---|
| `Tab` | Cycle between agent cards |
| `Enter` | Expand detail for focused agent |
| `n` | Jump to next non-'paid' agent |
| `f` | Filter to agents with active advice |

### Command Bar / Minibuffer

| Key | Action |
|---|---|
| `:` | Open command mode (named commands) |
| `Ctrl-G` | Cancel / clear command bar |
| `Up` / `Down` | History in command bar |

### Named Commands (`:` prefix)

| Command | Action |
|---|---|
| `:pd <cmd>` | Run any pd CLI command, output in overlay |
| `:reload` | Reload current panel data |
| `:split <panel>` | Open named panel in split |
| `:spray <msg>` | Spray pheromone with message |
| `:note <text>` | Publish pd note immediately |
| `:backup` | Trigger manual snapshot (ADR-0037b) |

---

## Visual Design Tokens

All tokens resolve to OKLCH values at build time from
`website-v2/src/styles/tokens.semantic.css`. The Rust token mirror is generated
from that CSS — never hand-named. CI fails if the mirror diverges (Phase 4
acceptance criterion).

### Maritime Semantic Layer

| Token Name | Semantic Role | Usage |
|---|---|---|
| `--voice-mayday` | Operational disaster / HITL gate | HITL top bar ONLY — reserved, nothing else uses solid mayday-red |
| `--voice-pan-pan` | Urgent warning, not life-threatening | Rent-due warning, conflict close-call, unSpider escalation |
| `--signal-charlie` | Affirmative / success / approved | Approved states, paid-rent badge, successful dispatch |
| `--signal-uniform` | Danger / running into conflict | Conflict highlighting in Claims panel, overlap warnings |
| `--signal-victor` | Requires assistance / help needed | Agent conflict state, help-requested flags |
| `--signal-lima` | Stop immediately / guard blocked | Guard-blocked agent card, L flag rendering |
| `--brand-primary` | PD brand (blue) | PD logo, primary actions, sidebar active state |
| `--brand-secondary` | PD secondary accent | PD system message box borders (distinct from agent messages) |

### Agent State Tokens (ICS flag colors)

| Token Name | ICS Flag | Agent State |
|---|---|---|
| `--signal-active` | Hotel (H) — green | claim-active, pilot on board |
| `--signal-stale` | Yankee (Y) — amber | claim-stale, dragging anchor |
| `--signal-alpha` | Alpha (A) — muted blue | spawning, diver down |
| `--signal-bravo` | Bravo (B) — magenta | burning-cash, dangerous cargo |
| `--signal-conflict` | Victor (V) — red-orange | conflict, requires assistance |
| `--signal-warning` | Delta/Uniform — amber | blocked, danger ahead |
| `--signal-idle` | Mike (M) — gray | idle, no way through water |
| `--signal-healthy` | Papa (P) — bright green | fleet-healthy, about to put to sea |
| `--signal-kilo` | Kilo (K) — yellow | request/communicate |
| `--signal-error` | November (N) — red | refuse/failed |
| `--signal-info` | Romeo (R) — blue | inform/idle-waiting |

### Background and Surface Tokens

| Token Name | Semantic Role |
|---|---|
| `--surface-base` | Main pane background |
| `--surface-raised` | Panel cards, sidebar |
| `--surface-overlay` | Modal overlays, tooltips |
| `--surface-agent-tint` | Agent message background (derived from callsign hash × base hue) |
| `--surface-pd-system` | PD system message background (always distinct from agent tint) |

### Text Tokens

| Token Name | Semantic Role |
|---|---|
| `--text-primary` | Body text — minimum 14px equivalent in terminal cell units |
| `--text-secondary` | Metadata, captions — minimum 13px equivalent |
| `--text-muted` | Timestamps, labels — minimum 12px if uppercase+bold+tracked |
| `--text-callsign` | Agent callsign (bold, callsign-hashed color) |
| `--text-pd-voice` | PD system voice (italic, `--brand-secondary` hue) |

### Typography

| Use | Font |
|---|---|
| Body / UI labels | General Sans (or terminal fallback: system sans) |
| Code / transcripts / command bar | IBM Plex Mono / Departure Mono |
| Agent callsigns | IBM Plex Mono Bold |
| ICS flag letters | Commit Mono (centered in ANSI block) |

### Compulsion/Rent Status Tokens

| Token Name | Verdict | Usage |
|---|---|---|
| `--rent-paid` | alias `--signal-charlie` | Green: all rent rules passing |
| `--rent-due` | alias `--voice-pan-pan` | Amber: block-commit imminent |
| `--rent-stale` | alias `--signal-stale` | Amber: behind base, reclaim-eligible |
| `--rent-idle` | alias `--signal-error` | Red: idle past graceMs |

### Contrast and Accessibility

- All foreground/background pairs must meet WCAG AA (4.5:1 for normal text,
  3:1 for large).
- OKLCH L channel guarantees perceptual uniformity — hue shifts don't change
  apparent brightness.
- Truecolor → 256-color → 16-color fallback chain for code/heat heat maps
  (single-hue ramp).
- `NO_COLOR` env var respected (`lib/maritime.ts COLOR_ENABLED` pattern).
- Reduced-motion: animated elements (mayday pulse, flag transitions) respect
  `TERM_ANIMATIONS=0`.

---

## Implementation Matrix

| Phase | Roadmap slug | Status | Depends on | Description |
|-------|--------------|--------|------------|-------------|
| 0 | adr-0046-phase-0-conversation-multiplex-shell | now | — | ratatui shell: multi-pane multiplexer, sidebar nav, 60fps, panic/SIGINT restore. Panels: Fleet (roster only, static) + Cockpit (transcript read, no input). **Done when:** boots + multiplexes ≥2 live agent chats. |
| 1 | adr-0046-phase-1-avatar-dispatch-loop | now | phase-0 | Cockpit input → tube→spawner router → new agent pane appears. **Done when:** typed instruction spawns agent, chat appears as pane. |
| 2 | adr-0046-phase-2-pheromone-spray-action | now | phase-0 | `Ctrl-P` from any pane → `POST /pheromone/spray`, `git_sha_at_annotation`, revoke. **Done when:** spray visible to running agent and reversible. |
| 3 | adr-0046-phase-3-hitl-roadmap-fleet-strips | now | phase-0 | Mayday-red reserved HITL top bar, roadmap now list, my-agents, `GET /attention` integration. Peek panel basic (screenshots + approve/reject). **Done when:** blocked agent lights HITL bar within 3s. |
| 4 | adr-0046-phase-4-canonical-token-mirror | now | — | Reconcile/delete `design/tokens/primitives.json`, generate Rust token mirror from `tokens.semantic.css`, CI divergence check, contrast audit ≥AA. **Done when:** zero invented color names, regen zero diff. |
| 5 | adr-0046-phase-5-claims-suggestibility | now | phase-2 | Claims panel (full conflict tree + advisor integration) + Suggestibility panel (compulsion evaluator + rent ledger + voice cards). Inline code+heat context (`Ctrl-H`). |
| 6 | adr-0046-phase-6-adr-sessions-commitments | now | phase-3 | ADR browser + inline editor + unSpider alert surfacing. Sessions/Salvage panel with memory tier labels (ADR-0035). Commitments panel (ADR-0041). |
| 7 | adr-0046-phase-7-avatar-autonomy-loop | now | phase-1 | Avatar runs a roadmap item end-to-end (worktree→PR→adversarial test→review→CI→merge→prune→done), each step `pd attest`-gated + HITL-surfaced. PR panel (GitHub App integration, Copilot comment response). Feel pass: swoosh ≤400ms, reduced-motion, 15-persona blind-test QC. **Done when:** blind panel finds human-gate in <3s. |
| ongoing | — | — | phases 3–7 | Health panel (bosun heartbeat, backup status), Whois overlay, Inbox/Tube, Transcripts ledger, Memory/Briefing tier display, Account panel (ADR-0029 OIDC). Wire in parallel as daemon routes stabilize. |

---

## Consequences

### Positive

- The TUI matches the actual mental model: I converse and steer; I don't browse.
- Reuses shipped substrate (#231 attention, pheromone spray, #225 router) —
  wiring, not invention.
- The mayday-red reservation + `pd attest` gating make autonomy safe and the
  human-gate unmissable.
- ICS flag vocabulary offloads the operator's memory burden: flag meanings are
  pre-loaded from a real international standard, not learned from a custom legend.
- Three-column cockpit layout keeps navigation (sidebar), content (panes), and
  crisis (HITL bar) in permanently distinct spatial regions — no scanning for
  the thing that needs you.

### Negative

- ratatui + live multiplexed transcripts is real engineering; phased to de-risk.
- Phase 4 reconciliation may touch consumers of the rotted token file — audit
  first.
- Peek panel's before/after contact sheet + zoom requires either sixel support
  or a character-art upscaler; fallback to text diff when neither is available.

### Neutral

- The filetree survives only as an on-demand context layer (inline heat via
  `Ctrl-H` in Cockpit, Phase 5), deliberately demoted from the rejected v1.
- 17 panels is a lot of surface to ship; the priority tiers (p0→p3) and phased
  Implementation Matrix are the pacing mechanism.

---

## Open Questions

1. **Sixel support detection:** How gracefully does ratatui degrade when the
   terminal doesn't support sixel/kitty graphics? Is character-art upscaling
   sufficient for the Peek panel at typical terminal sizes?
2. **Callsign color hashing:** Should the hash be stable across daemon restarts
   (keyed on identity string) or per-session? Stable is better for recognition
   but slightly more complex if identities collide.
3. **Pane count ceiling:** 2×2 (4 panes) is the stated max. Is this right for
   a typical 24-row terminal? Should it be adaptive to terminal dimensions?
4. **HITL bar overflow:** When >3 agents are simultaneously in Foxtrot state,
   the horizontal scroll in the HITL bar may be awkward. Consider a collapsed
   count + expand-to-list mode.
5. **`:wq` in ADR editor:** Creating a draft PR from the ADR inline editor
   requires knowing which repo/branch to target. Auto-detect from `git remote`
   + current branch, or prompt?

---

## Dissenting Appendix — the separate "operator editor" (PR #231 Part 2)

PR #231 proposed a Typora-class Tauri + CodeMirror editor as a distinct app. This
ADR **rejects shipping a second GUI** (it breaks "one place") but **adopts its
mechanics** — per-paragraph heat ribbon, pin spray, inline agent marginalia,
replay scrubber — *inside* the TUI (Phases 2 + 5). Revisit only if a future need
for rich rich-text editing genuinely can't be met in-terminal.
