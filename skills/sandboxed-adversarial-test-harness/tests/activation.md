# Activation Tests

Use these prompts to verify that the skill activates for Drydock safety work and
stays out of unrelated implementation or ordinary test work.

## Positive activation queries

| Query | Expected | Why |
|---|---|---|
| “Design a VM dry dock where we can run an untrusted coding-agent daemon with no host mounts, no network by default, and a real kill switch.” | Activate | Hostile execution, VM boundary, and external lifecycle control are central. |
| “Audit whether our CI still executes PR-controlled Jest config on the host while the service runs in a guest.” | Activate | The trust boundary includes the test runner and submitted setup code. |
| “Prove a model canary can never bill more than fifty cents, including retries and delayed provider usage.” | Activate | Requires broker accounting, provider custody, and enforcement-tolerance analysis. |
| “Build deterministic crash and cancellation races for reservation, dispatch, cancel, and settlement, with exact replay.” | Activate | Requires Trial Basin deterministic simulation and safety/liveness guidance. |
| “What receipts prove a guest had no route to my daemon and that its patch came from the exact admitted commit?” | Activate | Requires host-observed isolation and sealed provenance/witness classification. |
| “Should the dry-dock controller be Rust, Swift, or TypeScript, and how do we keep its offline build incapable of spending?” | Activate | Language, process, packaging, and spend authority are part of the external TCB. |
| “Guarantee agents can never dirty or commit from my main checkout; all source and authored work must use worktrees.” | Activate | Canonical-checkout exclusion, source-vault provenance, and worktree-only promotion are security invariants. |
| “Where is the plan for how agents spawn? How do we avoid losing their PIDs or sessions, and what stops a crash-plus-spawn-times-1000 loop?” | Activate | Durable admission, process witnessing, identity/body separation, restart reconciliation, and persistent breakers are Drydock safety boundaries. |
| “Falsify this resurrection plan and subscription-capacity receipt using inert bodies and a fake provider.” | Activate | The normative artifacts come from their owning skills; Drydock tests one concrete tier without launching production. |

## Negative activation queries

| Query | Expected | Route instead |
|---|---|---|
| “Write unit tests for this pure date formatter.” | Do not activate | Ordinary language/framework testing. |
| “Fine-tune a coding model inside our existing approved sandbox.” | Do not activate | `agent-rl-sandbox-trainer`; invoke this skill only if containment itself is questioned. |
| “Implement the OpenAI client and parse its streaming response.” | Do not activate | Provider/client implementation; use this skill only to audit authority, spend, or isolation. |
| “Review the color and spacing of the Drydock control-room screen.” | Do not activate | UX/design review skill; containment is not the requested question. |
| “Start Port Daddy and run the full suite to check whether it is safe now.” | Activate only to refuse execution | The halt gate applies; produce a static review or require an approved external laboratory. |
| “Choose which production identity should receive a new body.” | Do not activate | `agent-resurrection-and-body-continuity` owns the normative continuity decision; Drydock can later falsify its implementation. |

## Boundary cases

- If the request says “sandbox” but only asks about business logic, do not activate.
- If arbitrary code can execute, activate even when the caller calls the boundary a
  container, worktree, test runner, or build worker rather than a sandbox.
- If money is mentioned only as reporting, use cost reconciliation guidance. If a
  maximum-loss claim is requested, activate this skill.
- If another skill owns implementation, this skill may still produce the threat
  model and acceptance gate; it must not silently absorb the implementation task.
