# 05 Cooperative Coding And Governance

## Cooperative vibe coding

Cooperative vibe coding is not "many agents all touching the repo." It is a
governed collaboration pattern where humans and agents have visible intentions,
bounded permissions, durable transcripts, and ways to reconcile conflicts.

Modes:

Solo with staff:
  One human uses Port Daddy while Longshoremen watch CI, memory, claims,
  transcript search, and skill grafts.

Pair with agent:
  Human and one Voyager work together. The agent can suggest, patch, test, and
  respond to guidance.

Ensemble:
  Several Voyagers split work by context partition, with a Longshoreman tracking
  dependencies and parleys.

Nightshift:
  Background agents work asynchronously under strict budgets, tests, and PR
  rules, then present artifacts and transcripts.

Harbor co-edit:
  Humans and agents become co-equal peers in a governed editor buffer, with
  claims, semantic conflicts, and salvage.

## Who controls the agents?

The operator controls the harbor policy.

Agent souls control their commitments within that policy.

Longshoremen can suggest, nudge, route, and sometimes pause according to policy,
but they should not silently perform consequential actions outside their mandate.

Examples:

- A conflict Longshoreman may warn two agents and suggest a parley.
- A guard may block a destructive git action immediately.
- A PR Longshoreman may draft a reply, but posting it can require policy-based
  approval.
- A Nightshift agent may open a draft PR under budget, but merging requires
  explicit rules and green gates.

The app should show which actions are automatic, which are suggested, and which
need HITL approval.

## Claims and semantic conflict prediction

File claims are useful but too blunt. Port Daddy should prefer:

- symbol claims;
- region claims;
- intent type: read, modify, add sibling, add child, delete, rename;
- dependency graph impact;
- confidence-scored conflicts.

Blocking policy:

- direct same-symbol conflicting write: block or force parley;
- dependency conflict: warn and suggest coordination;
- low-confidence conflict: surface as advisory;
- rename/delete: high-risk, require stronger review;
- generated artifacts or migrations: use locks.

The operator should see file heat and conflict risk in the app and editor
plugin. A clean Git merge is not proof of semantic safety.

## Parley

Parley is a structured reconciliation protocol, not chat spam.

Trigger parley when:

- two agents claim overlapping symbols;
- a Longshoreman predicts high semantic conflict;
- one agent's decision invalidates another's assumptions;
- docs, code, and roadmap contradict each other;
- stale work would be expensive to merge later;
- a human asks for a council.

Parley should include:

- contested surface;
- participants;
- current claims;
- each party's desired outcome;
- evidence links;
- deadline;
- proposed resolution;
- resulting commitments.

The daemon can freeze contested edits for the parties until parley resolves if
the risk is high enough. Ordinary progress notes should not flood the parley
channel.

## Incentive model

Advisory claims only work if cooperation is cheaper than defection.

Port Daddy should make cooperation incentive-compatible by combining:

- persistent identity;
- observable history;
- append-only ledger;
- reputation;
- bonds or cleanup cost accounting for risky actions;
- graduated sanctions;
- cheap, visible coordination recommendations;
- easy remediation for honest mistakes.

Avoid brittle "grim trigger" rules. A failed heartbeat, stale branch, or bad
claim should usually lead to warnings and recovery before harsh penalties.

Minimum game model:

- reward early claims, early parley, honest self-report, and clean handoffs with
  reputation credit and lower future review friction;
- charge cleanup escrow for risky autonomous actions, broad claims, forceful
  refactors, and remote/expensive runs;
- slash or mark debt when an agent bypasses guard, hides work, ignores parley,
  or leaves unrecoverable cleanup;
- decay sanctions over time after repaired behavior;
- provide appeal paths for false positives;
- simulate defection so bypassing claims is measurably more expensive than
  cooperating.

The first version can be simple ledger events and UI badges. The important part
is that the daemon can measure and compare cooperation outcomes.

## Rent at claim: the session start gate

Status: shipped behind PR #1729, pending merge.

Sessions must not float free of the roadmap. `pd begin` charges one line of
rent at session start: link the work to the roadmap, or say why you are off it.
Three mutually exclusive options:

- `--roadmap <slug>`: link an existing roadmap item. Unknown slugs fail with a
  did-you-mean list;
- `--roadmap-new "<title>"`: draft genesis — creates a backlog roadmap item
  with `genesis-at-begin` provenance and links it;
- `--sidequest "<one-line reason>"`: explicit opt-out with a stated reason.

Rules:

- the link or reason persists on the session record and surfaces in
  `pd whoami` and the session roster;
- non-TTY invocations with none of the three fail closed with a message that
  names only the three correct actions, no bypass;
- `PD_RENT_EXEMPT` accepts a bounded list (`hotfix`, `chore`) and is recorded
  as the sidequest reason, never silently;
- the daemon validates the fields when present but does not require them, so
  programmatic callers keep working until MCP enforcement parity lands;
- `pd session relink` is the correction valve for a mislinked or drifted
  session (follow-up in flight);
- with rent charged at begin, the PR-time roadmap gate becomes a consistency
  check — does the PR's roadmap trailer match what the session claimed —
  rather than the first moment the question is asked.

Design rulings, so later slices do not regress them:

- the rent is ONE LINE. Never grow the start gate into a heavyweight form;
- NO similarity-threshold gates. Retrieval may nominate candidate roadmap
  items, but a similarity score never blocks a begin;
- prefer structural overlap signals (same files, same symbols, same roadmap
  item) over semantic guesses when warning about duplicate work.

This is the incentive model made concrete at the cheapest possible point: the
moment of intent, priced at one line.

## Harbor Staff and Voyagers

Recommended role split:

Longshoremen:
  Durable staff agents. They manage memory, conflicts, skill grafts, PR queues,
  CI, roadmap drift, and transcript indexing.

Voyagers:
  Task agents. They solve one bounded problem and report artifacts.

Cartographer:
  Finds contradictions, roadmap gaps, stale assumptions, and operator questions.

Spark:
  Generates possibilities, alternatives, and synthesis for operator review.

Spider:
  Connects scattered evidence across transcripts, docs, PRs, and code.

Shipwright:
  Builds and mutates agent definitions, skills, and workgroup configurations.

Coast Guard:
  Enforces sandbox, budget, and destructive-action policy.

Coxswain:
  Coordinates active file/symbol claims and parley pressure.

These can be real Agent Nodes over time. First they may be services and jobs
inside the daemon.

## Harbor Editor

The Harbor Editor should follow the existing battle plan:

1. Build a read-only editor surface in `pd-console` by reusing the mux and pane
   system.
2. Add a local Loro-backed editable buffer.
3. Add LAN or daemon-bus collaboration.
4. Add agents as peers with claims rendered in the buffer.
5. Add salvage and provenance.
6. Add remote harbor topology and visual polish.

Do not start with transport or 3D water. The hard risk is the editable buffer
and governable CRDT integration.

The point is not to beat every editor at raw text editing. The point is to show
a human and agents working in the same governed document, with claims, semantic
risk, authorship, provenance, and salvage.

## CRDT and daemon governance

The editor buffer can be collaborative, but governance belongs to the daemon:

- Loro records text operations and authorship.
- The daemon records claims, capabilities, approvals, and transcript events.
- Awareness/presence should mirror enough state into durable claims so reconnect
  does not erase coordination truth.
- Agent writes outside claim should be rejected or sent to a shadow patch.
- Dead agent operations should be salvageable and attributable.

Buffer convergence without accountability is not enough.

## Public, team, and federated harbors

Harbor governance models:

Personal harbor:
  One user, local daemon. Default.

Team harbor:
  Team-managed authority. Users and agents get role-based capabilities.

Guest harbor:
  A user invites another human or agent with a scoped Harbor Card.

Public harbor:
  Publicly discoverable agents, skills, or simulations. Needs moderation,
  abuse handling, revocation, identity, and rate limits.

Federated harbor:
  Multiple daemons exchange signed events. Authority remains local to each
  domain but shared artifacts have inclusion proofs and capability cards.

Rules should answer:

- who can invite;
- who can see transcripts;
- who can edit files;
- who can grant secrets;
- who pays;
- who can revoke;
- who owns memory generated by shared work;
- what becomes public.

## Blackboard

The blackboard is the live structured state all agents and operator surfaces can
read:

- active goals;
- open contradictions;
- contested files;
- file heat;
- recent decisions;
- blocked agents;
- pending approvals;
- PR queue;
- CI failures;
- candidate skill grafts;
- important transcript episodes;
- "similar work in progress" warnings.

Longshoremen write to the blackboard. Voyagers read scoped slices. The operator
sees it as cards, badges, search, and timeline, not raw JSON.

Blackboard is a projection over ledger facts plus explicit assertions. Items
need TTL, source links, confidence, supersession, writer permissions, and status.
Milestone 6 should ship a read-only/search blackboard over transcript and memory
facts; active conflict/parley write semantics belong in Milestone 8.

## Simulation sandbox

Implementation vehicle: **Coordination-Bench**, ADR-0052 phases 3a/3b
(`docs/adr/0052-trajectory-export-and-rl-loop.md`, Amendment 1). Bench-v1
covers the fast seeded hazards on the ephemeral daemon; bench-v2 carries the
org-config sweeps, the counterpart-agent spectrum, and the defection-pricing
metric described below. Do not build a second sandbox.

Port Daddy should build a coordination sandbox to evaluate agent organization:

- many identical agents versus heterogeneous roles;
- single prime agent splitting into specialists;
- stigmergic blackboard coordination;
- explicit parley and contract-net assignment;
- Longshoreman-guided compaction;
- skill grafting versus no grafting;
- file-claim enforcement versus advisory claims;
- local versus remote bodies.

Problems to throw at it:

- multi-file refactor with hidden semantic conflict;
- PR response campaign with bot comments and CI failure;
- UI polish task requiring screenshots and mobile pass;
- stale worktree salvage;
- dependency upgrade with tests;
- docs/code contradiction audit;
- security-sensitive tool use;
- large research synthesis with skill creation.

Score:

- task success;
- merge conflicts;
- semantic conflicts;
- operator interruptions;
- cost;
- context waste;
- transcript completeness;
- time to recover from failure;
- quality of handoff;
- memory usefulness later.

The sandbox becomes the empirical basis for better prompts, tools, skills, and
agent policies.
