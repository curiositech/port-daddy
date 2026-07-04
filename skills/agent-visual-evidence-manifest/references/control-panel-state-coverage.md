# Control-Panel State Coverage

Use this when you need to know which states a control-panel PR's proof-artifact set must cover, and why partial coverage (e.g. only the happy-path "it's live" screenshot) is a critical finding rather than a nice-to-have.

## Why state coverage, not just artifact count

A PR can attach five polished screenshots and still prove nothing about the states most likely to hide a real bug: what happens when the daemon is unreachable, when an agent goes stale, when an operator has to deny a gate, or when a receipt needs to survive a daemon restart. `operator-control-panel-ux-flow.md`'s "Proof Artifacts Needed" section lists the full state inventory the control panel is expected to render correctly; this skill's `REQUIRED_STATES` set condenses that inventory into seven families a proof set must hit at minimum.

## The seven required states

| State | What it demonstrates | Representative UX moment |
| --- | --- | --- |
| `active` | A live, currently-running agent session renders correctly — transcript, tool calls, file artifacts, safety events. | Live transcript with message, tool call, file artifact row, and safety event. |
| `historical` | A completed session's state can be replayed faithfully from stored events, not just observed while live. | Historical replay of a finished run. |
| `blocked` | The panel correctly refuses to launch or proceed when a precondition is missing. | Blocked launch with missing transcript or missing control channel; launch blockers with one-click remediation. |
| `stale` | The panel detects and surfaces an agent that has stopped producing fresh events. | Stale agent remediation flow. |
| `gate` | An operator-approval checkpoint renders and can be acted on. | Waiting-for-operator gate with approve/deny. |
| `interrupt` | A mid-run interrupt command reaches the agent and the panel reflects acknowledgement. | Interrupt flow showing command, acknowledgement, and next actions. |
| `receipt` | A Work Receipt can be drafted, sealed, and (after a restart) verified against replayed events. | Work Receipt draft and sealed receipt; relaunch/reconnect proof that visible state rebuilds from daemon truth. |

## When this applies

Only PRs flagged `isControlPanelPr: true` are held to full coverage. A narrow PR touching an unrelated surface (e.g. a CLI-only change, a skill-doc edit) does not need to manufacture all seven states — set `isControlPanelPr: false` and the coverage check does not run at all. Do not flip this flag to `false` to dodge the requirement on a PR that genuinely does touch the control-panel surface; that is exactly the kind of self-attestation the underlying redteam review calls out as "the fastest route to fake compliance."

## Coverage is additive across a PR, not per-artifact

One artifact does not need to demonstrate every state. `statesCovered` is the union across the whole artifact set — a seven-artifact PR with one artifact per state, or a three-artifact PR where one recording walks through several states in sequence (and is manifested once per state it depicts), both satisfy the same requirement. What the gate will not accept is a PR that only ever shows the `active` state and calls it done.

## Relationship to `no-artifacts` and `undeclared-source-label`

State coverage is checked independently of per-artifact provenance completeness — a control-panel PR can have perfect state coverage and still fail on `manifest-missing-provenance-field` or `undeclared-source-label` for individual artifacts, and vice versa. Fix both classes of finding; neither substitutes for the other.
