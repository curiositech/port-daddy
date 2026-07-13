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
or static phase. It never removes the state cue. The CLI drawer therefore
resolves directly instead of pretending to move through layout.

## First production slice

1. The old left rail is replaced by a flat title deck and L0-L3 navigation with
   grouped color rules and a cobalt active block.
2. Every pane uses square hairline framing, corner ticks, restrained state
   knockouts, and flat action/status rails.
3. Conjure renders serial, parallel, exploratory, and gated work as distinct
   color-block wave columns rather than generic cards.
4. A real PTY-backed shell lives in a persistent drawer inside pd-console and is
   available from every operator surface.
5. Shell output is parsed as a terminal screen rather than appended as a fake
   transcript. `pd`, zsh/bash tools, and interactive terminal programs use the
   operator's real shell process.
6. The drawer uses corner ticks, a cobalt command zone, two-block micro-flags,
   state stripe, liveness dot, and explicit running/exited/error status.
7. The shared headless renderer adopts the same corner-tick and micro-flag
   grammar while preserving `NO_COLOR`, non-TTY, and structured-output behavior.

## Rendering boundary

This slice stays on rung 1: GPUI layout, GPUI text, and Parley-backed glyphs.
There is no measured reason to introduce a bare Metal text pipeline. A future
living-harbor shader may render into a bounded texture behind a single surface,
but it must pause when idle, render a meaningful static reduced-motion phase,
and earn promotion with frame-time evidence.

## Acceptance criteria

- The GPUI app builds with `--features gpui` and the headless REPL still builds.
- Opening the CLI drawer starts one PTY session and does not shell out through
  the daemon, MCP, or a fake command dispatcher.
- Printable keys, Enter, Backspace, arrows, common control keys, resize, and
  process exit have defined behavior.
- A launch failure is visible in the drawer with a recoverable error message.
- Drawer reveal has one owner, does not animate layout, and honors
  `PD_CONSOLE_REDUCED_MOTION=1`.
- Terminal output remains legible at 1200x800 and 800x600 proof sizes.
- CLI plain mode contains no ANSI escapes and keeps complete, pipe-safe text.
- Visual proof includes the closed console, opening transition, open PTY with a
  real `pd status`, reduced-motion state, and a narrow-window capture.
