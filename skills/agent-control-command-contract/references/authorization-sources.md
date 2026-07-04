# Authorization Sources: Authoritative State vs. Stale Projections

Use this when you need to decide whether a control panel is allowed to authorize a command from the data it's currently displaying, or whether it must re-check something else first.

## The core split

`redteam-agent-harbor-control-plane.md` #15 states the rule as a fixture: "Freeze or corrupt the roster projection, then attempt interrupt, approval, and destructive denial flows. Queries may show stale labels; commands must re-check authoritative event/lease/control state or fail closed." A control command has exactly two legitimate authorization sources and two illegitimate ones.

| Source | Reads from | Can it authorize a command? |
| --- | --- | --- |
| `authoritative-lease` | A live lease record the daemon holds for the target body/session right now. | Yes — a lease is proof of current ownership, not a cached snapshot of past ownership. |
| `authoritative-event` | The last appended, durable event in the target's control/session event log. | Yes — an appended event is the daemon's own record of truth, re-read at authorization time. |
| `cached-projection` | A materialized view (roster table, session-list row, dashboard card) built from events at some prior point. | No — a projection is disposable and can be stale, corrupted, frozen mid-rebuild, or simply behind the event log by one tick. |
| `ui-state` | Whatever the client currently has in memory/local state. | No — the operator's browser tab, GPUI pane, or CLI session can be arbitrarily behind reality, especially after reconnect. |

The operator-control-panel-ux-flow.md packet is explicit that this is fine to violate for *display*: "stale rows never appear as live because a stale session row exists" is a UI labeling rule, not an authorization rule. A pane is allowed to say "this looks stale" while still being wrong about exact state. A command is not allowed that latitude.

## Why this is not paranoia

The failure mode isn't a bug that only shows up in adversarial testing — it's the default outcome of building a control panel the normal way: read the roster once, render rows, wire buttons to the row's data. That's correct for display and wrong for authorization, and the two code paths look identical until someone freezes the daemon mid-rebuild or a WebSocket drops a reconnect event.

Concretely, the daemon-side handler for `interrupt`/`pause`/`kill`/`steer`/`checkpoint`/`fork` must:

1. Accept the command with whatever target id the (possibly stale) UI sent.
2. Before delivering anything, re-resolve that target against the authoritative lease or event log — not the projection the UI read to render the button.
3. Fail closed (return `unsupported` or a denial event, never a silent no-op) if the authoritative check disagrees with what the UI believed.

## What "fail closed" means here

An empty or absent authorization check is not evidence of safety. If `authorizationSource` is missing, unset, or ambiguous, treat it exactly like `cached-projection` or `ui-state` — never assume authoritative behavior in the absence of proof. This mirrors the binder's broader rule in #6: "No self-reported capability can advance a compliance level without daemon-observed evidence." The same discipline applies to authorization: no command authorizes itself by existing in a UI that renders a button.
