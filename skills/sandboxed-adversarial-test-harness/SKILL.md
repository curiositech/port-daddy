---
name: sandboxed-adversarial-test-harness
description: >-
  Designs and audits Drydock-style hostile-execution laboratories for untrusted,
  AI-authored, or pull-request-controlled code, including VM isolation, brokered I/O,
  provider spend custody, deterministic simulation, sealed provenance, external receipts,
  trusted-language/process selection, durable agent lifecycle accounting, crash-storm
  breakers, fail-cheap controls, and promotion gates. Use before a daemon, agent, test suite, build, or skill may touch
  real machines, networks, credentials, providers, repositories, or money. NOT for running
  the hostile workload, making production rebodiment/admission decisions, defining durable
  identity, treating same-UID guards as containment, routine correctness tests, agent
  training, or implementing a provider integration without a separately reviewed threat
  model.
license: Apache-2.0
allowed-tools: Read,Write,Edit,Grep,Glob,Bash(node:*)
metadata:
  category: Infrastructure & DevOps
  tags:
    - drydock
    - sandboxing
    - adversarial-testing
    - deterministic-simulation
    - spend-custody
    - provenance
  provenance:
    kind: first-party
    owners:
      - port-daddy
  pairs-with:
    - skill: agentic-zero-trust-security
      reason: Supplies capability and trust-boundary vocabulary for brokered effects.
    - skill: cost-verification-auditor
      reason: Reconciles provider usage and prices after Drydock has bounded dispatch authority.
    - skill: empirical-systems-evaluation
      reason: Turns Trial Basin scenarios into falsifiable experiments and calibrated claims.
    - skill: macos-host-security
      reason: Supplies host-specific macOS controls below the VM orchestration layer.
    - skill: runtime-verification-for-agents
      reason: Monitors the same invariants after a capability has earned runtime promotion.
    - skill: tlaplus-practitioner
      reason: Models crash, retry, cancellation, reservation, and settlement safety and liveness.
    - skill: agent-resurrection-and-body-continuity
      reason: Supplies the normative body-continuity contract that Drydock attempts to falsify at one exact tier.
    - skill: context-economics-for-agent-swarms
      reason: Supplies schema-valid native-unit capacity evidence; Drydock tests its observation and enforcement boundary.
  io-contract:
    kind: deliverable
    consumes:
      - kind: subject-and-threat-model
        format: markdown
      - kind: proposed-isolation-and-effect-topology
        format: markdown
      - kind: resurrection-plan
        format: json
        optional: true
      - kind: capacity-evidence
        format: json
        optional: true
    produces:
      - kind: drydock-review
        format: markdown
      - kind: adversarial-gate-matrix
        format: markdown
      - kind: promotion-verdict
        format: markdown
---

# Sandboxed Adversarial Test Harness / Drydock Safety Engineering

Design a proving ground whose safety does not depend on the code being tested. The
subject may be buggy, malicious, confused, recursively agentic, or silent. The
controller outside it must still bound effects, resources, authority, and evidence.

## Non-Negotiable Halt Gate

This skill designs and audits the laboratory. It does not authorize launching the
subject. Obey any operator or incident halt before all other steps. During a halt,
limit work to inert source inspection, schemas, fixtures, models, and documents. Do
not start the daemon, UI, agent backend, test suite, workflow, or provider canary to
“see what happens.” A design review is not a run lease.

## Composition Boundary

Drydock proves or falsifies one concrete implementation at one named capability
tier. It does not invent production identity, rebodiment, or capacity policy.
When continuity is in scope, consume a schema-valid resurrection plan from
`agent-resurrection-and-body-continuity`; when model allowance is in scope,
consume schema-valid capacity evidence from
`context-economics-for-agent-swarms`. A Drydock PASS cannot turn either artifact
into launch authority.

## Use This For

- Designing a VM or microVM laboratory for arbitrary code or agent runtimes.
- Moving integration tests off the developer/CI host and into disposable guests.
- Defining a typed broker for model, fixture, artifact, or simulated remote effects.
- Proving protocol exposure and actual financial exposure as separate properties.
- Building deterministic fault, race, crash, retry, and multi-worker simulations.
- Defining host-observed receipts and promotion gates that a guest cannot forge.
- Auditing an existing sandbox claim before it gains credentials, network, or money.

## Do Not Use This For

- Ordinary unit, product, or UX correctness review.
- Training or fine-tuning agents; use `agent-rl-sandbox-trainer` after containment.
- Claiming a worktree, path check, container, Seatbelt profile, seccomp filter, or
  proxy variable is a complete hostile-code boundary by itself.
- Executing pull-request-controlled configuration, setup, transforms, or tests on
  the host merely because the product binary runs in a guest.
- Calling an internal reservation ledger a hard provider bill cap.

## Expertise Map

| Question | Required expertise | Load |
|---|---|---|
| Which language and process may hold each authority? | TCB minimization, cross-language protocol, release independence, fail-cheap packaging | `references/implementation-language-and-fail-cheap-controls.md` |
| What belongs outside the adversary's control? | TCB design, virtualization, kernel isolation, device topology | `references/isolation-mechanisms-macos-linux.md` |
| Can any effect bypass the broker? | Capability security, protocol framing, network and artifact mediation | `references/isolation-mechanisms-macos-linux.md` |
| Can the bill exceed the operator's consent? | Integer accounting, concurrency, provider quota semantics, reconciliation | `references/spend-custody-and-accounting.md` |
| Can a race or crash be replayed? | Deterministic simulation, fault injection, state exploration, safety/liveness | `references/deterministic-simulation-and-formal-models.md` |
| Can a crash orphan a body or multiply spawns? | Durable admission, identity/body separation, process witnesses, scoped breakers, backend handoff | `references/agent-lifecycle-and-crash-storms.md` |
| Who can truthfully attest what happened? | Supply-chain provenance, witness classes, append-only receipts | `references/provenance-receipts-and-evidence.md` |
| Which attacks must the gate cover? | SSRF, traversal, exfiltration, resource, authority, billing, replay, teardown | `references/threat-classes-and-adversarial-recipes.md` |

If one person cannot answer all required questions, that is a review-composition need,
not permission to blur the answers. Record the missing expertise and block the tier
that depends on it.

## Drydock Review Process

```mermaid
flowchart TD
  A[Honor halt and define exact claim] --> B[Name subject, operator, assets, adversary]
  B --> C{Can subject execute arbitrary code?}
  C -->|Yes| D[Require disposable VM or microVM boundary]
  C -->|No| E[Justify narrower process boundary]
  D --> F[Keep keys ledger kill and receipts outside guest]
  E --> F
  F --> G[Seal source tests image scenario policy and prices]
  G --> H[Start with no network host mount secret or ambient socket]
  H --> I[Add only lease-bound typed broker channels]
  I --> J[Derive limits from observed payload and host policy]
  J --> K{Real provider requested?}
  K -->|No| L[Use fake replay or local model]
  K -->|Yes| M{Provider independently enforces loss ceiling?}
  M -->|No| N[Deny real-provider tier]
  M -->|Yes| O[Prove isolated custody and enforcement tolerance]
  L --> P[Define deterministic seeds schedules faults invariants]
  O --> P
  P --> Q[Collect host and broker witnessed receipts]
  Q --> R[Run stable adversarial gate IDs]
  R --> S{All required evidence complete?}
  S -->|No| T[FAIL INVALID INCOMPLETE or UNCERTAIN]
  S -->|Yes| U[PASS exact tier only]
```

### 1. State the proposition

Write one falsifiable sentence: “Exact subject digest X, under scenario Y and tier
Z, cannot exceed effects E, resources R, protocol exposure P, or provider loss F;
the named external witnesses can reconstruct every terminal path.” Avoid “safe.”

### 2. Draw the trusted computing base

List the transitive closure of components trusted to enforce or report the claim.
The subject, its dependencies, its tests, and its agent are untrusted. The controller,
broker, signing key, ledger, halt state, and final verdict must be outside the guest
and inaccessible from guest-writable storage. Minimize this set.

While an operator halt is active, this skill can produce static D0 design and
validation only. Every dynamic tier is `NOT_PROVISIONED` or `BLOCKED`, never PASS.
Building D1 in a separate Drydock project needs its own later authorization; the
existence of this skill does not authorize execution of the subject.

Choose implementation languages by authority, not fashion. The Drydock default is
a Rust controller/watchdog/broker/transition core, a tiny out-of-process Swift
Virtualization.framework adapter on macOS, upstream Firecracker plus a Rust adapter
on Linux, and a read-only TypeScript/React evidence viewer. Rust reduces
memory-unsafe TCB risk; it does not supply isolation. Read
`references/implementation-language-and-fail-cheap-controls.md` before adding a
language, process, provider adapter, database writer, UI mutation path, or retry.

### 3. Choose isolation by adversary strength

- Pure inert data or a total function may use a process boundary if the narrower
  claim is explicit.
- Arbitrary code, package hooks, test configuration, shell, native modules, agent
  tools, or a daemon require a disposable VM or microVM.
- Namespaces, Landlock, seccomp, cgroups, Seatbelt, and path guards are defense in
  depth. They do not turn the same host identity into an independent jailer.

Record devices and mounts by enumeration. For hostile runs, empty network and
directory-sharing device lists are the baseline. “No route” must be proven from
host configuration, not inferred from a failed guest request.

### 4. Seal every executable input and exclude the canonical checkout

Content-address the guest image, source tree, test bundle, configuration, scenario,
policy, price catalog, fixture set, and controller build. Treat submitted Jest
configuration, transforms, setup, shell hooks, and tests as executable adversary
input. Run them inside a disposable guest or second test-runner guest, never on the
developer or CI host.

Fetch the exact remote commit into a dedicated bare source vault and materialize it
through a fresh linked worktree. Never package, test, stage, commit, or promote from
the canonical checkout. It must remain an exact clean projection of the live
`origin/main` tree and be absent from the guest. Guest work stays in guest-local
worktrees; approved output may enter only a fresh host linked review worktree on a
non-default branch. Record before/after canonical integrity receipts, but rely on
path and authority absence for prevention.

### 4.5 Account for every agent body before launch

Containment does not prove how many workers exist. When the subject can launch,
retry, resume, or replace an agent-like process, require one external durable
admission writer before every ingress. Separate the durable agent node, admitted
run, expiring body generation, backend session, host process/VM witness,
transcript, and capability set.

Reserve global and scoped capacity before asynchronous launch. Start every
controller boot with admission closed until all nonterminal runs and platform
handles reconcile. Treat a PID as one field in a host witness, never as identity.
Set automatic agent-birth retries and child depth to zero in the first tier. A
durable safety breaker survives restart, reboot, deployment, and calendar reset.
Read `references/agent-lifecycle-and-crash-storms.md` before designing an agent
launcher, process registry, retry, startup recovery, remote session, or backend
handoff.

### 5. Make channels absent before making them filtered

Start with no network device, no shared home, no canonical socket, no credential,
no production remote, and no writable host mount. Add only run-scoped typed
channels. Every channel names request/response byte limits, concurrency, deadline,
idempotency, replay, cancellation, destination, and receipt behavior.

### 6. Derive authority from what the broker observes

The guest may request less authority; it never declares the billable input or the
maximum used for admission. The broker resolves or receives the actual bounded
payload, recomputes digests and sizes, inventories media and tools, and derives
provider-specific conservative token and fee bounds. Unknown input kinds or stale
prices deny real dispatch.

### 7. Prove financial and subscription-capacity bounds

1. **Protocol-authority ceiling:** durable broker reservation limits what the
   broker is allowed to send.
2. **Billable financial-loss ceiling:** an isolated provider account, project, key, or
   payment rail independently refuses charges above the approved amount, including
   a measured worst-case enforcement lag.
3. **Subscription-capacity envelope:** documented provider or first-party-client
   observations preserve each native allowance window, reset horizon, auth mode,
   shared bucket, reserve, unresolved-attempt hold, checkpoint tail, and forecast
   uncertainty. This is not a hard cash cap: a recurring subscription and a
   `$0` incremental estimate do not make the route free.

Without proof 2 for billable routes, or proof 3 for subscription-backed routes,
real-provider execution is ineligible. Use fake, replay, or local models. Read
`references/spend-custody-and-accounting.md` and the paired
`context-economics-for-agent-swarms/references/subscription-capacity-ledger.md`
before writing equations.

### 8. Build Trial Basin as a deterministic laboratory

Make virtual time, random values, provider responses, message ordering, retries,
crashes, cancellation, and fault schedules explicit seeded inputs. Assert both
safety (“nothing bad happens”) and liveness (“required terminal or recovery state
is eventually reached under named fairness assumptions”). Preserve the seed,
schedule, event trace, and minimized counterexample.

Use a small formal model for reservation, cancellation, settlement, and teardown state
machines. Model checking explores the design; it does not prove that the concrete
hypervisor or runtime implements the model.

### 9. Label evidence by witness

Use at least these classes:

- `HOST_OBSERVED`: VM, device, mount, process, resource, or lifecycle fact from the controller.
- `BROKER_OBSERVED`: framed request, payload size, decision, dispatch, or byte count.
- `CAPACITY_OBSERVED`: native allowance, reset, auth mode, freshness, and parser provenance from a documented source.
- `PROVIDER_RECONCILED`: provider-side quota, usage, invoice, or rejection evidence.
- `GUEST_ASSERTED`: probe, log, test result, or claim produced inside the subject.
- `MODEL_CHECKED`: finite-model property and exact model/configuration.
- `REPLAYED`: exact seed, schedule, and fixtures reproduced the same observation.

A signature authenticates a statement and signer; it does not upgrade
`GUEST_ASSERTED` into `HOST_OBSERVED`.

### 10. Gate promotion by stable attacks and complete receipts

Give each gate a durable ID. Include hostile specimens for isolation, network,
resource exhaustion, broker protocol, spend races, false evidence, provenance,
artifact import, teardown, and controller mutation. A gate records exact input
digests, witness-class observation, expected terminal outcome, residual, and replay
instructions.

Use exact verdicts: `PASS`, `FAIL`, `INVALID`, `INCOMPLETE`, or `UNCERTAIN`.
Infrastructure failure never becomes PASS or “neutral success.” PASS applies only
to the exact subject, scenario, controller, policy, and capability tier evaluated.

## Capability Tiers

| Tier | Maximum authority | Promotion rule |
|---|---|---|
| T0 Static | no guest process, network, credential, or spend | schema and source review |
| T1 Deterministic | fake services in a disposable guest | repeatable safety/liveness scenarios |
| T2 Replay | recorded inputs, still no external network | exact trace replay and external receipts |
| T3A Billable canary | one real billable operation under provider-enforced custody | per-run human approval, one attempt/no retry, externally enforced cash ceiling, and reconciled tolerance |
| T3B Subscription canary | one real subscription-backed operation under a fresh native-unit reservation | per-run human approval, one attempt/no retry, worst-case allowance hold, checkpoint tail, before/after observation, and no claim of a hard cash cap |
| T4 Worker | one worker on fixture systems; quarantined output | separate review after the exact applicable T3A/T3B gate |
| T5 Crew | multiple workers under one aggregate envelope | independent adversarial program |
| T6 Federation | cross-host custody and settlement | deferred until composition is proven |

Promotion increases evidence, never ambient authority. Passing one tier does not
authorize the next.

## Output Contract

Produce one review using `templates/output-template.md` with:

- exact proposition and tier;
- subject and immutable input identities;
- TCB and excluded components;
- VM, device, mount, and network topology;
- typed effect and capability manifest;
- protocol-exposure calculation and financial-custody proof or explicit absence;
- deterministic scenario, seeds, invariants, and fault schedule;
- durable lifecycle states, global reservation scopes, process/VM witness,
  retry owner, breaker reset contract, and backend-continuation proof when agents
  can be launched;
- schema-valid resurrection-plan and capacity-evidence identities when those
  domains are in scope, plus negative fixtures for unsafe ready/unknown states;
- stable adversarial gate matrix;
- evidence grouped by witness class;
- residual risks and counterclaims; and
- exact verdict with the next permitted action.

The legacy `schemas/harness-spec.schema.json` and
`scripts/containment_audit.mjs` check five policy-shape classes only. They are a
useful T0 lint, not containment evidence, VM evidence, spend proof, or a deployment
gate. Never promote because that script returns `pass: true`.

## Anti-Patterns

Reject these shortcuts during design review. Load
`references/anti-patterns.md` for the novice/expert/timeline treatment.

| Shortcut | Required correction |
|---|---|
| Same-UID wrapper called containment | Put hostile execution behind the selected VM or microVM boundary. |
| Host executes submitted tests | Execute the entire submitted test runner inside the disposable guest. |
| “Keep main clean” as convention | Make the canonical checkout structurally absent and schema-invalid. |
| Process-local child count as global truth | Reserve globally before birth and reconcile every prior body before reopening admission. |
| Backoff as spawn safety | Persist hard birth, ancestry, and retry bounds before adding jitter. |
| Guest self-attestation as containment proof | Use external host witnesses and label guest claims honestly. |
| Internal ledger as hard provider cap | Distinguish broker authority from provider custody and measured enforcement lag. |
| Subscription allowance as free | Keep native allowance and cash ledgers separate; unknown capacity fails closed. |
| One language everywhere | Minimize the trusted implementation while using narrow native adapters where required. |
| Presentation as containment | Treat galleries and fixtures as views, never enforcement evidence. |
| Guest-declared billing inputs | Measure payloads at the broker and derive conservative bounds. |
| Random chaos without replay | Control clock, entropy, order, and fault schedules; preserve the minimized seed. |
| Signed claim as truth | Treat signatures as origin/integrity proof, not witness authority. |

## References

| File | Load When |
|---|---|
| `references/implementation-language-and-fail-cheap-controls.md` | Selecting languages/processes, separating offline and canary packages, designing durable state, retries, UI authority, or a release-independent TCB. |
| `references/isolation-mechanisms-macos-linux.md` | Choosing VM, microVM, device, network, filesystem, kernel, and process boundaries. |
| `references/spend-custody-and-accounting.md` | Designing broker reservation, provider custody, settlement, refunds, retries, or real canaries. |
| `references/agent-lifecycle-and-crash-storms.md` | Designing spawn admission, durable identity/body/run joins, PID/VM witnesses, crash recovery, scoped breakers, or backend handoff. |
| `references/deterministic-simulation-and-formal-models.md` | Designing Trial Basin seeds, virtual time, faults, schedule exploration, safety, and liveness. |
| `references/provenance-receipts-and-evidence.md` | Sealing inputs and deciding which witness may assert each receipt field. |
| `references/threat-classes-and-adversarial-recipes.md` | Building the complete hostile-specimen and failure matrix. |
| `references/anti-patterns.md` | Reviewing common shortcuts through novice, expert, and failure-timeline lenses. |
| `templates/output-template.md` | Writing the integrated Drydock review and promotion verdict. |
| `tests/activation.md` | Evaluating skill activation and rejection behavior. |
| `examples/sample-input.json` | Inspecting the paired legacy T0 policy-lint input used by the abbreviated example. |
| `examples/expected-output.md` | Seeing an abbreviated review with honest limits. |
| `schemas/harness-spec.schema.json` | Using the legacy five-class T0 policy-lint input. |
| `scripts/containment_audit.mjs` | Running legacy policy-shape lint only, never containment proof. |
| `agents/openai.yaml` | Configuring a specialist only when agent fan-out is permitted by operator policy. |

## Skill Bundle Index

- `SKILL.md`: activation, decision process, evidence classes, tiers, and anti-patterns.
- `README.md` and `CHANGELOG.md`: bundle orientation and version history.
- `references/`: implementation language, fail-cheap controls, isolation, spend,
  durable agent lifecycle, simulation, provenance, anti-patterns, and adversarial recipes.
- `templates/output-template.md`: integrated review artifact.
- `tests/activation.md`: positive, negative, and boundary activation prompts.
- `examples/`: abbreviated legacy and Drydock examples.
- `schemas/harness-spec.schema.json` and `scripts/containment_audit.mjs`: legacy T0 lint.
- `agents/openai.yaml`: optional specialist descriptor, subject to local fan-out policy.
