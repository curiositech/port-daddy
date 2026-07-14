# Story Linework Operator State Grammar

This is the shared semantic contract for the `pd` CLI, FleetBar, Fleet Control
Center, and `pd-console`. The surfaces may use different rendering technology,
but a color, edge, stripe, dot, flag, or animation must mean the same thing on
every surface.

The visual system extends `apps.html` and `proposal.html`. It does not replace
daemon truth. A surface renders the last durable state it can prove and names
unknown or recovering state directly.

## Visual Layers

1. Edge: ownership and scope. Corner ticks bound one live truth region. A solid
   rail means the region has a current owner. A broken rail means ownership is
   stale or disputed.
2. Stripe: transition or contention. Motion occurs only when a state changes.
   Idle state is still. Reduced motion holds the final stripe position.
3. Dot: liveness. A dot may pulse only while fresh heartbeat or stream evidence
   is arriving. It becomes static for confirmed, unknown, blocked, and failed.
4. Color block: semantic state. Color is never the only carrier; text and edge
   shape remain legible in monochrome and high-contrast modes.
5. Signal face: registered ICOS meaning. Two-block micro-faces preserve the
   recognizable colors of the real flag. They are not decorative aliases.

## State Registry

| State | Tone | Signal | Operator meaning |
| --- | --- | --- | --- |
| healthy | green | none | Health confirmed; no coordination flag implied |
| fleet-healthy | green | P | Fleet prepared to proceed |
| active | blue | H | Active ownership, pilot aboard |
| spawning | blue | A | Delicate launch in progress, keep clear |
| pending | amber | none | Queued or pending; deadline and retry budget remain visible |
| idle | gray | M | Stopped and making no way |
| unknown | gray | none | Current truth has not been confirmed |
| awaiting-human | violet | F | Disabled, communicate with operator |
| warning | amber | U | Running into danger |
| conflict | violet | V | Requires assistance or arbitration |
| blocked | violet | D | Maneuvering with difficulty |
| guard-blocked | violet | F | Guard requires operator communication |
| recovering | violet | none | Recovery is in progress |
| lost | red | none | Agent lost mid-run |
| confirmed | green | C | Affirmative durable receipt |
| refused | red | N | Negative or refused |
| failed | red | none | Operation failed; show the next action |
| mayday | red | J | Grave operational danger |
| request | cyan | K | Request to communicate |
| info | cyan | R | Procedure acknowledgement: received |

`R` is the procedure acknowledgement "Received". It has no 1969 single-letter
meaning and must not be described using the obsolete 1931 folklore gloss.

## Failure And Recovery

- Pending has a deadline or retry budget. It never spins forever.
- Unknown means the caller lost certainty, not that nothing happened.
- Recovering shows the receipt or checkpoint being replayed.
- Failed includes a typed code, correlation or receipt id, and one next action.
- Awaiting-human and guard interception use Foxtrot because both disable
  consequential work until operator communication. A conflict asking for
  arbitration uses Victor. These are distinct operator obligations.
- A previous shell or editor state may be restored from a receipt, but a dead
  process is never labeled resumed.

## Output Contracts

The CLI renders story linework only for human TTY output. JSON, quiet, pipes,
redirects, `NO_COLOR`, `FORCE_COLOR=0`, and `TERM=dumb` preserve plain output.
Color degrades from truecolor to 256 to 16 colors. Unicode structure is disabled
when terminal capability cannot be proven.

Native surfaces support light and dark appearances, increased contrast, Dynamic
Type, VoiceOver labels, and reduced motion. Decorative corner ticks are hidden
from accessibility trees. State rows expose state, signal name, meaning, and next
action as one coherent accessibility value.

## Source Of Truth

- ICOS meanings and Port Daddy mappings: `lib/maritime-signals.ts`
- CLI state and two-block faces: `cli/utils/ui.ts`
- Terminal policy: `cli/utils/output.ts`
- SwiftUI target, proposed in PR #1929: `apps/FleetBar/FleetBar/StoryLinework.swift`
- GPUI primitives: `core/pd-console/src/story_linework.rs`

`lib/maritime-signals.ts` is the referee. When a surface needs a new signal,
change that registry first, verify the group against the International Code of
Signals corpus, then implement every renderer. Do not assign a flag because its
letter resembles a product verb.
