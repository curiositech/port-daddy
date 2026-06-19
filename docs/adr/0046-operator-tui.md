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
4. **HiTL top bar** — `--voice-mayday`/`--status-error` *only* (reserved; nothing
   else may use solid mayday-red), so the one thing that needs a human always wins
   the pre-attentive race. Roadmap `now` list + my-agents + background-fleet strips.
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

## Implementation Matrix

| Phase | Roadmap slug | Status | Depends on | Description |
|-------|--------------|--------|------------|-------------|
| 0 | adr-0046-phase-0-conversation-multiplex-shell | now | — | ratatui shell: avatar pane + split/tab/move into role-labeled agent-chat panes; reads live `/spawn` + transcripts + tube. **Done when:** boots, multiplexes ≥2 live agent chats, 60fps-capped, restores terminal on panic/SIGINT |
| 1 | adr-0046-phase-1-avatar-dispatch-loop | now | adr-0046-phase-0-conversation-multiplex-shell | Talk to the avatar; it dispatches agents via the tube→spawner router (#225); replies stream into panes. **Done when:** a typed instruction spawns an agent and its chat appears as a pane |
| 2 | adr-0046-phase-2-pheromone-spray-action | now | adr-0046-phase-0-conversation-multiplex-shell | Key-bound spray from any pane → `pheromones.spray`/`feedback.drop`/tuple, with `git_sha_at_annotation`, revoke, lineage hover. **Done when:** a spray is visible to a running agent and reversible |
| 3 | adr-0046-phase-3-hitl-roadmap-fleet-strips | now | adr-0046-phase-0-conversation-multiplex-shell | HiTL top bar (mayday-red reserved) + roadmap `now` (`GET /roadmap/items`) + my-agents (`GET /attention`) + fleet strips. **Done when:** a blocked agent lights the HiTL bar within 3s and nothing else uses solid mayday-red |
| 4 | adr-0046-phase-4-canonical-token-mirror | now | — | Reconcile/delete `design/tokens/primitives.json`; generate the Rust token mirror from `tokens.semantic.css`; CI fails on divergence; contrast audit ≥AA. **Done when:** no invented color names remain and regen produces zero diff |
| 5 | adr-0046-phase-5-code-heat-context-inline | now | adr-0046-phase-2-pheromone-spray-action | On-demand inline code + per-line pheromone heat in an agent's pane (single-hue ramp, truecolor→256→16 fallback, light+dark tested). NOT a repo browser. **Done when:** heat shows where an agent is working, legibly, without a separate navigation mode |
| 6 | adr-0046-phase-6-avatar-autonomy-loop | now | adr-0046-phase-1-avatar-dispatch-loop | Avatar runs a roadmap item end-to-end (worktree→PR→adversarial test→review→CI→merge→prune→done), each step `pd attest`-gated + HiTL-surfaced. **Done when:** one roadmap item goes from `now` to `done` through the TUI with human approval gates, validated against the live daemon (not mocks) |
| 7 | adr-0046-phase-7-feel-and-blindtest | now | adr-0046-phase-3-hitl-roadmap-fleet-strips | Feel pass (swoosh ≤400ms curves, opt-in sound, reduced-motion), Commit Mono/IBM Plex/Departure Mono, 15-persona blind-test QC. **Done when:** the blind panel finds the single thing needing a human in <3s, fleet-idle = silent+calm |

## Consequences

### Positive
- The TUI matches the actual mental model: I converse and steer; I don't browse.
- Reuses shipped substrate (#231 attention, pheromone spray, #225 router) — wiring,
  not invention.
- The mayday-red reservation + `pd attest` gating make autonomy safe and the
  human-gate unmissable.

### Negative
- ratatui + live multiplexed transcripts is real engineering; phased to de-risk.
- Phase 4 reconciliation may touch consumers of the rotted token file — audit first.

### Neutral
- The filetree survives only as an on-demand context layer (Phase 5), deliberately
  demoted from the rejected v1.

## Dissenting Appendix — the separate "operator editor" (PR #231 Part 2)

PR #231 proposed a Typora-class Tauri + CodeMirror editor as a distinct app. This
ADR **rejects shipping a second GUI** (it breaks "one place") but **adopts its
mechanics** — per-paragraph heat ribbon, pin spray, inline agent marginalia,
replay scrubber — *inside* the TUI (Phases 2 + 5). Revisit only if a future need
for rich rich-text editing genuinely can't be met in-terminal.
