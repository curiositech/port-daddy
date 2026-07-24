# pd-console story-linework production shell

This slice moves the full production GPUI console into the visual language in
`docs/design/story-linework/apps.html` without copying that document's older
product semantics. The source of truth remains the daemon command/query/event
contract. Color and motion explain that truth; they do not decorate over it.

## Visual grammar

- Cobalt is the single system accent. Signal colors are reserved for state.
- A two-block micro-flag identifies an actor, berth, or command context.
- Left-edge stripes carry row state. Dots carry liveness. They are not duplicates.
- Corner ticks bound live, inspectable surfaces. Full boxes are reserved for
  modal or explicitly isolated work.
- Each view gets at most one large color zone. Typography may cross that zone so
  the foreground color changes at the boundary, as in the story-linework ports.
- Stripes indicate flow or waiting direction. Dots indicate presence. Blinks
  indicate a fresh state transition and then stop.
- Operator states use text and the shared micro-flag grammar. Decorative emoji
  are not part of the console vocabulary.

## Motion grammar

The view that owns the state owns its animation. GPUI elements receive sampled
progress; they do not create independent clocks. Interaction transitions are
120-300 ms. Ambient motion is limited to a small leaf surface and stops when the
state is idle or the app is not visible.

While an animation is active, its owner requests every frame. When the transition
settles, that request loop stops and the console returns to event-driven redraws.

Reduced motion replaces travel and pulse with an immediate state color, edge,
or static phase. It never removes the state cue. A visible `MOTION ON` / `MOTION
REDUCED` control changes the policy at runtime; `PD_CONSOLE_REDUCED_MOTION=1`
only seeds startup for automation. The CLI drawer therefore resolves directly
instead of pretending to move through layout.

## First production slice

1. The old left rail is replaced by a flat title deck and L0-L3 navigation with
   grouped color rules and a cobalt active block.
2. Every pane uses square hairline framing, corner ticks, restrained state
   knockouts, and flat action/status rails.
3. The daemon-owned WorkPlan projection renders serial, parallel, exploratory,
   and gated work as distinct color-block wave columns rather than generic cards.
4. A real PTY-backed shell lives in a persistent drawer inside pd-console and is
   available from every operator surface.
5. Shell output is parsed as a terminal screen rather than appended as a fake
   transcript. `pd`, zsh/bash tools, and interactive terminal programs use the
   operator's real shell process.
6. The drawer uses corner ticks, a cobalt command zone, two-block micro-flags,
   state stripe, liveness dot, and explicit running/exited/error status.
7. The shared headless renderer adopts the same corner-tick and micro-flag
   grammar while preserving `NO_COLOR`, non-TTY, and structured-output behavior.
8. `story_linework.rs` is the shared GPUI primitive layer for corner ticks,
   two-block flags, and state stripes. Feature panes compose these primitives
   rather than drawing local imitations.

## Previous-shell recovery

Closing and reopening the drawer preserves the live PTY because drawer
visibility does not own the process. Restarting pd-console is different: a dead
process is never presented as resumed. The new shell may expose a clearly
labelled previous-shell receipt containing the launch directory, shell name,
terminal size, last status, and checkpoint age.

Receipt retention is an operator-visible three-state control:

- `OFF` stores neither metadata nor screen content.
- `METADATA` is the default and excludes terminal content.
- `SCREEN` additionally stores the bounded visible terminal screen.

Environment variables are never serialized in any mode. State is written
atomically under `~/.port-daddy/pd-console/shell-state.json`; the directory and
file are private on Unix. Read/write failures do not kill the active shell. They
surface as typed `PTY_RECEIPT_*` notices with a next action.

## Spark and Spider disposition

Accepted and implemented:

- honest previous-shell receipts with explicit privacy and retention controls;
- typed PTY failures with codes, sanitized detail, and visible next actions;
- a shared story-linework GPUI primitive layer;
- a visible reduced-motion policy plus state-preserving static fallbacks;
- a deterministic motion-plan test that fails on multiple owners, layout
  animation, unscoped loops, missing reduced-motion behavior, or continuous
  rung-1 redraw.

Already present and retained:

- the native PTY uses `vt100` for cursor, ANSI, truecolor, resize, and screen
  semantics;
- the drawer is global chrome available over every L0-L3 surface;
- terminal ANSI styling resolves through the active light/dark theme.

Rejected because they violate the consolidated runtime contract:

- PTY output does not trigger fleet actions. It remains an explicit operator
  shell, not a second command router or automation API.
- pd-console does not parse Conjure output into a private DAG. WorkPlan is a
  daemon query projection and the daemon owns every launch decision.
- semantic stripes live in shell chrome; pd-console does not rewrite a command's
  terminal output or fabricate ANSI regions.

## Rendering boundary

This slice stays on rung 1: GPUI layout, GPUI text, and Parley-backed glyphs.
There is no measured reason to introduce a bare Metal text pipeline. A future
living-harbor shader may render into a bounded texture behind a single surface,
but it must pause when idle, render a meaningful static reduced-motion phase,
and earn promotion with frame-time evidence.

GPUI 0.2.2 can park the macOS display link for an inactive native window even
after model state changes. The production shell therefore pairs `notify` and
`refresh` with a bounded, alternating half-point window-size presentation nudge
only when changed data is delivered. The toggle has no cumulative drift and is
not an animation loop; it wakes one compositor callback so live transcript and
roster updates actually reach the visible frame.

## Live daemon proof

The final native proof targets one named feature daemon, not a fixture or the
canonical `:9876` runtime:

- berth `pd-console-live` on `http://127.0.0.1:3166`;
- tier `codebase`, branch `codex/pd-console-story-linework-motion`, canonical
  `false`, state plane `ephemeral:pd-console-live`;
- `pd dev up --fleet` arms the berth worker while preserving the feature-berth
  identity and isolated database;
- two console-issued WorkIntents became two distinct compatibility dispatches,
  sessions, worktrees, `$10` bonds, and live spawned bodies;
- the Active Agents and Conductor panes read those rows back from the same
  daemon, while the Lane consumes the merged transcript stream and publishes
  operator steering turns on the daemon control channel;
- proof captures live under
  `core/pd-console/docs/artifacts/gpui/proof-live-workintent-multiplex/`.

This is intentionally honest about the migration boundary. Execution currently
uses the receipted `dispatches-compatibility` projection behind
`work-intent.start`; pd-console does not author a backend, provider, body,
AgentNode, or AgentRun. Native WorkPlan materialization can replace that daemon
projection later without changing the surface command.

The first multiplex run also exposed a destructive compatibility bug: a body
could finish with dirty files, fail to publish a draft PR, be mapped from
`produced` to `settled`, and then have its only worktree reaped. The Conductor
adapter now requires a durable artifact before reporting `settled`; a completed
review run without one becomes `salvage`, with its worktree and transcript
preserved for inspection and replay.

The proof restart then exposed a second durability violation: ordinary
`pd dev down` deleted the named berth database. Normal stop and automatic
dead/idle-process reaping now preserve profile state. Destruction requires an
explicit `--purge`/`--reset` or `pd dev gc`, and the CLI reports whether the
ledger was preserved or purged.

## Acceptance criteria

- The GPUI app builds with `--features gpui` and the headless REPL still builds.
- Opening the CLI drawer starts one PTY session and does not shell out through
  the daemon, MCP, or a fake command dispatcher.
- Printable keys, Enter, Backspace, arrows, common control keys, resize, and
  process exit have defined behavior.
- A launch failure is visible in the drawer with a recoverable error message.
- Every PTY and receipt failure has a stable code and an explicit next action.
- Restarting the app labels restored data as a previous-shell receipt and never
  claims that the old process resumed.
- Metadata retention excludes screen content; every mode excludes environment.
- Drawer reveal has one owner, does not animate layout, and honors
  both the visible motion control and `PD_CONSOLE_REDUCED_MOTION=1` startup seed.
- The motion contract test rejects continuous redraw on the rung-1 shell.
- Terminal output remains legible at 1200x800 and 800x600 proof sizes.
- CLI plain mode contains no ANSI escapes and keeps complete, pipe-safe text.
- Visual proof includes the closed console, opening transition, open PTY with a
  real `pd status`, reduced-motion state, and a narrow-window capture.
- A named codebase berth can opt into its fleet worker with `pd dev up --fleet`
  without losing berth identity or redirecting child `pd` calls to canonical.
- Stopping and restarting a named berth preserves its cool-bus ledger by
  default; destructive state reset is explicit and visibly reported.
- Two `$10` WorkIntents produce distinct dispatch receipts, sessions, worktrees,
  body registrations, and transcript streams on the addressed berth.
- A completed review run cannot settle or be reaped without a durable artifact;
  missing publication routes the dispatch to salvage and preserves its worktree.
- The visible Lane keeps a viewport-sized live tail so a new operator turn and
  subsequent agent output remain above the fixed controls; the durable
  transcript retains the complete history.
