# P10 — Human factors and operator sovereignty

**Round 1 · independent · sealed · anchor `6c2c30d74b889b4d8037ce5d43b265bfbf21a686`**

## Thesis

**An operator cannot yet complete the whole journey as one trustworthy, accessible product without terminal ritual or automation surprise. Constitutional verdict: HOLD at T0.**

The source contains an unusually strong design for that product. Its storyboard exposes repository, WorkIntent, durable worker, replaceable body generation, one-body/no-retry ceiling, capacity, capability digest, brokered effects, external stop, evidence, rebodiment, and explicit stale/offline/unknown states. It also declares its boundary honestly: no connected controls and no runtime proof in the [Drydock operator journey](../../../design/drydock-operator-journeys/index.html).

The most serious present conflict is automation surprise. The proposed journey says recommendation never launches and presents a sealed, one-use launch manifest. Current pd-console instead converts an ordinary chat turn, when no agent is bound, into `capture_work_intent` followed immediately by `start_work_intent` in [`main.rs`](../../../../core/pd-console/src/main.rs). The server then polls the dispatch worker, which may launch work that tick. A conversation submit and an informed launch grant cannot constitutionally be the same gesture.

## Evidence posture

- **SOURCE_PRESENT:** pd-console has useful projection primitives. Mission records intent, dispatch, launch, worker, transcript, backend, model, worktree, branch, artifact, and error. Its context rail shows plan, suggested skills, claims, evidence, receipt, and cost, although “suggested” is not activation or authorization. The Sessions pane is a cross-backend, cross-berth directory with project, provider, worktree, liveness, locations, and durable selection; unavailable or non-authoritative locations are reported instead of silently substituted.
- **SOURCE_PRESENT, insufficient authority:** Anchor has signed capability envelopes, expiry, narrowing, nonce replay rejection, and Merkle evidence. ADR-0140 adds exact proposal, adjudication, and effect records, but explicitly says Phase 0 is not a reference monitor and cannot stop an effect.
- **PROPOSED:** The integrated Workroom, exact capability-pack choice, input/output/schema/log drill-down, external witnessed stop, safe cross-backend rebodiment, repository Muster, complete PR review, and shared Observatory are target architecture. The observatory contract labels only its schema/fixture foundation current; native clients, reducer, controller, and workflow remain targets.
- **SOURCE_PRESENT, partial:** Current stop is “Ask agent to stop,” with runtime acknowledgement pending, not the external fence/process-tree/effect-lease/teardown proof required constitutionally. The PR pane states its route is not mounted. Porthole has a serious native capture prototype and synthetic proofs, but is not distributed and cannot prove consent, visual quality, or release. Its broader decision/evidence graph remains proposed.
- **UNKNOWN:** Installed no-terminal operability, VoiceOver behavior, focus order, text scaling, comprehension, current provider allowance, and end-to-end visual quality. The console has 80–200% zoom, but its chat composer is a rolled-own buffer that ignores arrows and function keys, and per-button focus-visible remains follow-up work. Storyboard controls are non-semantic spans: visual specification, not accessibility evidence.
- **BLOCKED_BY_HALT:** Dynamic proof of bounded launch, pause/kill, resource custody, effect mediation, rebodiment, live Porthole capture, native capacity, mobile joining, and operator accessibility.

## Non-negotiables

1. Capturing intent must never launch. Launch requires a second, explicit grant over an immutable tuple.
2. Repository or session selection changes projection only, never execution, capabilities, or wake state.
3. The operator sees durable worker, body generation, provider session, process witness, worktree, and run as separate identities.
4. Unknown provenance, capacity, body, effect, or stop state fails closed with source, observation age, confidence, consequence, and next safe action.
5. Stop authority remains outside the body. “Delivered” is not “acknowledged”; “acknowledged” is not “fenced and gone.”
6. Every remote effect is exact, expiring, one-use, digest-bound, independently witnessed, and invalidated by a changed head.
7. No hidden fan-out, retry, successor, backend override, credential widening, or memory promotion.
8. All essential operations work through native semantic controls, keyboard and screen reader, 200% text scaling, reduced motion, non-color status cues, and at least 44-point targets. Terminal access is an emergency surface, not an ordinary prerequisite.

## Strongest operator UX and information architecture

Use the existing physical triad, not new competing products: Scout owns intake; FleetBar owns glanceable attention, consent, and local/global emergency controls; pd-console owns seated inspection and review. Within pd-console, **Observatory** is a read-only mode and **Switchboard** is a visibly separate signed-command mode, not additional applications.

The landing Muster is repository → worktree → room → durable worker → body. Selection has no execution effect. “Start work” captures outcome first, then shows a single review sheet containing identity, provenance, lifetime, backend/model, native capacity windows, cash ceiling, body/child/retry limits, inputs, output contract, skills, tools, MCP provenance, filesystem/network permissions, possible effects, stop conditions, and omissions. Approval grants that digest once.

The Workroom keeps conversation central and places a stable evidence rail beside it: inputs and schemas; plan/current node; commands and logs; outputs, diff, tests, artifacts and Portholes; identity/body; capacity; effects and receipts. Every summary reaches primary evidence in two actions. Rebody is a comparison, not a resume button: retained, compacted, omitted, narrowed, unknown, predecessor fence, ambiguous effects, and the successor's fresh grant are all visible.

## Falsification tests and usability tests

- A first-time operator launches one deterministic fake worker in at most three decisions, without IDs or terminal knowledge, then accurately explains worker, body, budget, effects, and stop boundary.
- Enter, double-click, assistive activation, reconnect, and UI retry never turn proposal into duplicate launch.
- Switching repository, room, or session during execution produces zero lifecycle or capability events.
- Removing the event stream during an ambiguous remote effect distinguishes stale, offline, body-unknown, and effect-unknown, and disables successor launch.
- Rebody Codex G1 to Claude G2 only after fencing and reconciliation; verify all retained, omitted, and narrowed context and capabilities.
- Mutating a reviewed PR head makes the old approval unusable while diff, rationale, CI, artifact, and Porthole evidence remain inspectable.
- Complete the entire journey by keyboard and VoiceOver at 200% text scale and narrow width, with reduced motion and no clipped content.

All dynamic versions are presently `BLOCKED_BY_HALT`, not failed and not passed.

## Impossible combinations

- Instant conversational launch and informed sealed consent.
- A global backend selector that routes every fleet spawn and exact per-worker backend authority.
- A read-only evidence projection that mutates lifecycle state.
- Replay seeking that means execution rollback.
- Unknown native capacity that permits automatic real-provider launch.
- Cryptographic receipts that imply complete mediation.
- Retrospective permission manufactured for an operator bypass.

## Skill audit

The Drydock skill correctly routes containment, resurrection, capacity, and visual evidence, but omits its existing human-factors specialists from `pairs-with` and its decision table. It should activate:

- `operator-surface-authority-designer` for one enforceable physical owner per capability;
- `agentic-coding-ux-designer` for intent-before-action, progress, review, rollback, and receipts;
- `human-gate-designer` only for placement and presentation of approval gates, not runtime enforcement, general UX, or chatbot flow; and
- `beautiful-gui-design` for semantic controls and accessibility, not backend authority.

No new skill is required. The missing item is composition and activation coverage. Add a positive activation case for a halted, end-to-end operator-sovereignty/accessibility audit, and an explicit negative case stating that a storyboard, screenshot, static GUI audit, or green CI cannot certify operator operability.

## Confidence and unknowns

Confidence is high on the static-source verdict and launch-surprise conflict, medium-high on the proposed information architecture, and deliberately unknown on installed behavior, accessibility, provider truth, and control effectiveness. Those unknowns require operator-observed evidence after the halt is explicitly lifted.

**SEALED — P10 — 2026-09-16.**
