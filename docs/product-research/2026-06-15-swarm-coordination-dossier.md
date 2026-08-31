# Port Daddy Swarm Coordination Dossier

**Date.** 2026-06-15
**Status.** Historical research snapshot. Its tuple-backed Parley prototype was
supplanted by STORE0's indexed tenant/harbor SQLite authority on 2026-08-24;
tuple references below describe the June 2026 baseline and are not current
production authority.
**Mode.** Diataxis explanation: this document explains what Port Daddy should mean by swarm coordination, then names the next build steps.

## Executive Claim

Port Daddy should become serious about swarm coordination by refusing the fake version first.

The serious version is not a mystical hive mind. It is governed concurrency: a local authority that decides when multi-agent work is justified, isolates cognition, keeps writes single-threaded, records disagreement, forces reconciliation before publication, and measures whether the swarm helped.

The repo already contains a strong substrate:

- **Daemon** (`server.ts`): the always-on local authority that hosts the coordination routes and owns runtime truth.
- **Tuple space** (`lib/tuples.ts`): an append-only blackboard where agents publish machine-readable facts.
- **Quorum** (`lib/quorum.ts`): tuple-backed proposals and votes for fleet decisions.
- **Sessions** (`routes/sessions.ts`): durable task identity, notes, and file or region claims.
- **Attention** (`lib/attention.ts`, `routes/attention.ts`): the intended one-call inbox plus subscribed-channel read surface.
- **Sorties** (`routes/sorties.ts`): budgeted mission launches for multi-agent work.
- **Arbiter** (`lib/arbiter.ts`): the policy monitor for forbidden coordination states.

What is missing is not another raw messaging channel. The missing layer is a swarm decision and evaluation loop: when to form a swarm, what topology to use, how to tolerate failed subagents, when to force a parley, what evidence counts as collapse, and how operators see the result.

This branch adds three executable pieces:

- `evaluateSwarmFit()` chooses a topology from task shape and evidence.
- `tallyCouncilVotes()` records council votes without hiding failed or timed-out roles.
- `pd parley` records a tuple-backed forced-reconciliation protocol for contested surfaces.

It also makes roadmap maintenance enforceable: `pd roadmap upsert` and
`pd roadmap touch` write actor-attributed receipts to `roadmap_items`, and the
Coordination Guard now blocks coordination-surface commits when this receipt is
missing. The live roadmap row for this slice is `swarm-coordination-parley`
(`status=now`).

## The Imported Swarm Memo, Reduced To Product Law

The downloaded memo at `/Users/erichowens/Downloads/agentic-swarm-coordination.md` argues that 2026 multi-agent results are task-conditional, expensive, and failure-prone. The useful laws for Port Daddy are:

1. Decomposability is destiny. Breadth-first work can benefit; strict sequential reasoning often degrades.
2. Context isolation is the working primitive. Subagents should receive scoped prompts, not the parent's whole trace.
3. Writes stay single-threaded. Intelligence can be distributed; publication authority should not be.
4. Verification dominates topology. An inspector outside the contaminated worker context is mandatory for write-bearing work.
5. Heterogeneity matters. Similar agents tend to reinforce similar errors.
6. Coordination health must be measured. Cost, collisions, disagreements, verification coverage, and operator legibility are first-class outputs.

Terms of art used here:

- **Stigmergy** (Grassé 1959; Dorigo and Blum 2005): coordination through a shared environment rather than direct commands. In Port Daddy, tuples, notes, pheromones, and claims are the environment.
- **Contract Net Protocol** (Smith 1980): announce, bid, award, report; a classic decentralized task-allocation protocol. ADR-0047 maps it to Port Daddy dispatch.
- **GPGP/TAEMS** (Decker and Lesser 1995): task-relationship and commitment machinery for deciding what coordination is needed and when it terminates.
- **Dec-POMDP** (Bernstein et al. 2002): a decentralized partially observable decision process; optimal general multi-agent planning is intractable, which is why Port Daddy needs simple topology gates.
- **Sheaf-theoretic coordination** (modern applied sheaf literature): local states must agree on shared projections; useful as a future metric for disagreement, not a Phase-0 dependency.

## Council Results

The requested council was attempted with six roles: swarm-theory researcher, code cartographer, ADR archaeologist, red-team cynic, engineer/prototyper, and dreamer/product strategist.

Two completed:

| Role | Vote | Finding |
|---|---|---|
| ADR archaeologist | C, prototype lab first | Port Daddy's strongest theory is governed concurrency: single-writer authority plus typed protocols and digest-with-zoom. |
| Engineer/prototyper | A, incremental hardening | The smallest useful prototype is tuple-backed parley / reducer logic, but PR #380 already owns parley design. |

Four sidecars failed due upstream compact or stream errors. That failure is not incidental. A serious swarm must have quiescence, retries, partial-result accounting, and role replacement. The new `tallyCouncilVotes()` function models exactly that: failed roles stay visible, quorum is explicit, unanimity can block collapse, and dissenters are named.

My synthesis vote is A-through-C: incrementally harden existing primitives, but run them through a lab harness before declaring a new swarm kernel. B, a new swarm kernel subsystem, is premature while the single-writer daemon is still the intended authority. D, abandoning swarm language, throws away a useful product frame, but Port Daddy should define "swarm" as legible, governed, measured cooperation.

## What Port Daddy Already Has

ADR-0048 defines **Port Daddy** as the harbor-master for agent swarms: local-first authority for making coding agents legible, accountable, and safe to one operator. That ADR splits the system into L0 daemon, L1 coordination protocol, L2 legibility and authority, and L3 economy.

ADR-0047 says Port Daddy is substrate-rich and protocol-poor. It already has tube, pheromones, notes, inboxes, commitments, and Arbiter, but messages need typed performatives, delegation chains, and explicit termination. That is the exact gap the downloaded memo points at.

The whitepapers sharpen the same shape:

- `whitepaper/source/single-writer-kernel.tex` says one local SQLite/WAL writer is the decider. That is why serious Port Daddy swarms should not use local consensus for local mutations.
- `whitepaper/source/legible-swarm.tex` says the binding constraint is read-poverty and operator legibility. That is why every swarm summary must zoom to source artifacts.
- `docs/product-research/2026-06-03-hive-mind-realism-check.md` already warns that "swarms beat frontier" is task-conditional, not universal.

The codebase has shipped pieces:

- Tuple blackboard: `lib/tuples.ts`, `routes/tuples.ts`.
- Proposal/vote primitive: `lib/quorum.ts`, `routes/quorum.ts`.
- Swarm example: `examples/swarm/coordination-board.ts`.
- Sessions, claims, and notes: `routes/sessions.ts`.
- Agent inbox and attention: `routes/attention.ts`.
- Sorties and spawn: `routes/sorties.ts`, `routes/spawn.ts`.
- Commitments, Arbiter, and Coast Guard surfaces: `routes/commitments.ts`, `routes/arbiter.ts`, `routes/attest.ts`, `routes/relay.ts`.

## What Is Still Foreign

1. Fit gating. Port Daddy can launch or coordinate agents, but it does not yet say when multi-agent is a bad idea.
2. Topology selection. "Spawn more agents" is not a topology. The system needs named modes: single agent, single agent plus inspector, read-only council, single-writer council, lab-only swarm.
3. Partial-failure semantics. Four of six council members failed in this run. A serious swarm turns that into state, not vibes.
4. Forced reconciliation. Phase 0 now ships manual parley call/respond/resolve, but automatic freeze, rent, and detector triggers are still future work.
5. Evaluation. There is no default scorecard for time, cost, collision rate, verification coverage, disagreement, and operator legibility.
6. Attention reliability. In this run, `pd attention` repeatedly failed with "Was there a typo in the url or port?" while `pd status` was nominal. A mandatory inbox primitive cannot be fragile.
7. Session binding reliability. The first session became abandoned mid-slice from the CLI's point of view. Serious swarms require stable identity across fresh shells and compaction boundaries.

## Proposed Architecture

### Phase 0: Swarm Fit, Council Reducers, Parley, And Roadmap Receipts

Ship the first production-grade slice in this branch:

- `evaluateSwarmFit(input)` returns a topology, reasons, requirements, and risks.
- `tallyCouncilVotes(results, options)` returns quorum state, vote counts, dissenters, missing roles, and risks.
- `createParley()` stores `SUMMONED`, `CONVENED`, `COLLAPSED`, `ESCALATED`, and `VOIDED` state over tuple records.
- `pd parley fit/call/respond/resolve/list/show` gives agents and operators a manual reconciliation surface.
- `pd roadmap upsert/touch` gives agents a direct way to pay the roadmap receipt required by the guard.

The fit and tally functions remain pure and testable. Parley uses tuple space so
it composes with existing daemon state without adding a new table before the
protocol proves its shape.

### Phase 1: Swarm Lab

Add a lab runner that compares these topologies on the same task:

1. Single agent.
2. Single agent plus inspector.
3. Orchestrator plus read-only council.
4. Single-writer council with explicit contracts.
5. Lab-only parallel writers, never publishable without collapse.

Score every run:

- wall-clock time
- token and dollar cost
- file claim conflicts
- semantic conflicts found by tests
- verification coverage
- council failure rate
- dissent and collapse outcome
- operator legibility score

### Phase 2: Parley / Wave Collapse Automation

ADR-0055 is included in this branch. The required next shape is:

- divergence is allowed while thinking
- the contested surface freezes before publication when an open parley exists
- claim overlap and detector findings can auto-summon affected sessions
- collapse writes durable commitments or escalates with the full transcript
- dissent remains attached to the outcome

### Phase 3: Operator Surface

FleetBar and Fleet Control Center should show:

- why a swarm was formed
- which topology was selected
- who participated
- who failed or timed out
- what evidence each role supplied
- whether quorum, unanimity, or escalation happened
- the exact artifacts and validations behind the summary

No summary without zoom. No green check without evidence.

## WinDAGs Skill Graft By Phase

I ran the WinDAGs graft/search path for the parley phase plan and rejected noisy
matches where they did not fit the phase. The useful graft is below. Each phase
should start by loading the named skill(s), then carrying their failure modes and
quality gates into implementation.

Important tool split:

- `windags_skill_graft` stays narrow: given a task, node, or phase, it attaches
  already-known WinDAGs skills and their quality gates.
- `windags_skill_reference` stays exact: given a selected skill and relative
  path, it returns the requested reference, script, template, schema, or asset.
- `windags_skill_induct` should be a new tool: given declared roots and a task
  context, it discovers repo-local, user, machine, shared, and global skill
  artifacts, normalizes them into WinDAGs skill cards, and emits a curated
  activation plan.

Do not overload graft with induction. Grafting is selection and application.
Induction is ingestion, provenance, contract repair, and presentation.

| Phase | Skill graft | What it contributes to Port Daddy |
|---|---|---|
| Phase 0: fit/tally/manual parley/roadmap receipts | `multi-agent-coordination` + `build-verification-expert` | Coupling matrix, worktree/session isolation, conflict-resolution taxonomy, explicit failed-role accounting, and verification that CLI/API/build artifacts all still line up. |
| Phase 1: open-parley surface freeze | `dag-scope-enforcer` + `multi-agent-coordination` | Strict scope enforcement: normalize paths, resolve symlinks, make deny win over allow, audit every violation, and keep the freeze scoped to party plus contested surface. |
| Phase 2: rent for unanswered summons | `normative-bdi-agents` + `dag-scope-enforcer` | Treat "respond to parley" as an adopted norm/obligation, record deliberate refusal separately from ghosting, and make TTL expiry a consequence-bearing state. |
| Phase 3: claim-overlap trigger | `multi-agent-coordination` + `dag-parallel-executor` | Controlled parallelism, resource caps, debounce, dedupe, cooldown, and dead-agent salvage so auto-summons do not become a stampede. |
| Phase 4: collapse into commitments | `normative-bdi-agents` + `dag-feedback-synthesizer` | Turn agreement into explicit per-party obligations, preserve impossible/refusal evidence, and produce targeted adoption feedback instead of generic "try harder" notes. |
| Phase 5: detector-triggered parleys | `agentic-skill-discovery` + `dag-feedback-synthesizer` | Separate detector proposal from independent validation, attach evidence, measure false positives, and synthesize actionable trigger feedback without contaminating the parley stream. |

The graft also adds a process invariant: any phase that changes coordination
architecture must update `roadmap_items` before commit. That is why Phase 0 adds
`pd roadmap upsert/touch` and a Coordination Guard receipt check.

## `windags_skill_induct` Tool Contract

The new tool should solve the problem the current skill flow exposes: another
repo may carry its own skills, references, scripts, templates, and lived
runbooks, but a global WinDAGs graft cannot safely pretend it has seen them.

Proposed request:

```json
{
  "task": "Design Port Daddy parley phase 2 rent integration",
  "roots": [
    { "scope": "repo", "path": "/repo/.agents/skills" },
    { "scope": "repo", "path": "/repo/skills" },
    { "scope": "user", "path": "~/.codex/skills" },
    { "scope": "global", "path": "/opt/homebrew/Cellar/windags/2.7.0/libexec/skills" }
  ],
  "budget": {
    "catalogTokens": 2000,
    "activationTokens": 6000,
    "excerptTokensPerReference": 1200
  },
  "trustPolicy": {
    "repoLocal": "summarize-only-until-approved",
    "global": "trusted",
    "network": "deny-by-default"
  }
}
```

Proposed response:

```json
{
  "rawArtifacts": [
    {
      "id": "port-daddy-agent-skill",
      "scope": "repo",
      "uri": "/repo/skills/port-daddy-agent-skill/SKILL.md",
      "digest": "sha256:...",
      "trustTier": "repo-local"
    }
  ],
  "skillCards": [
    {
      "id": "port-daddy-agent-skill",
      "activation": {
        "useWhen": ["working inside Port Daddy"],
        "notFor": ["generic terminal tasks outside coordinated repos"]
      },
      "io": {
        "inputs": ["task", "worktree", "active session"],
        "outputs": ["notes", "claims", "validation evidence"],
        "sideEffects": ["daemon writes", "roadmap receipts"]
      },
      "resources": {
        "references": [],
        "scripts": [],
        "templates": []
      },
      "missingContracts": ["machine-readable eval cases"]
    }
  ],
  "activationPlan": {
    "selectedSkills": ["port-daddy-agent-skill"],
    "loadNow": [
      {
        "skill": "port-daddy-agent-skill",
        "resource": "SKILL.md",
        "mode": "full"
      }
    ],
    "loadOnDemand": [],
    "nearMisses": [],
    "unloadedResources": [],
    "risks": ["repo-local instructions may be untrusted until project is trusted"]
  }
}
```

This gives agents the missing presentation layer:

```text
prompt
  -> meta-skill/router
  -> windags_skill_induct for local/global context
  -> windags_skill_graft for phase/node selection
  -> windags_skill_reference for exact resources
  -> bounded excerpts or full resources
  -> execution with an unloaded-resource ledger
```

The output should be curated at presentation time. A skill can have large
references, scripts, templates, schemas, and examples, but the agent should see
only the selected slices plus an index of what remains. That avoids both failure
modes: four-turn archaeology and context stuffing.

## Prototype Decision Rules

The initial rules in `evaluateSwarmFit()` deliberately encode the memo's conservative posture:

- depth-first or non-decomposable work stays single-agent
- high single-agent baseline plus one-context fit stays single-agent
- low-value tasks stay single-agent
- valuable breadth-first work with independent subtasks becomes a read-only council
- partially independent or write-contentious work becomes a single-writer council
- parallel writers are lab-only and cannot publish until collapsed
- missing verification and homogeneous agents are explicit risks

These rules are not the final science. They are the first executable fence around the failure mode "we launched a swarm because swarm sounded cool."

## Build Implications

Port Daddy does this by becoming a measured coordination authority, not by pretending every agent is a peer in a mystical democracy.

The L0 daemon remains the single writer. L1 adds typed protocols, commitments, and parley. L2 makes the council visible to the operator. L3 can eventually price and federate this, but only after local swarm truth is stable.

Near-term engineering order:

1. Land this Phase-0 slice: fit gate, council tally, manual parley, roadmap receipts.
2. Add open-parley surface freeze to Coordination Guard.
3. Add a lab runner that records scorecards as tuples.
4. Make `pd attention` and session binding reliable enough to be mandatory.
5. Wire the chosen topology into sorties and FleetBar.

That is how Port Daddy becomes serious: it stops counting spawned agents and starts proving that coordination improved the outcome.
