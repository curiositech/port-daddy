# Binder Architect Of Record

Status: binder governance contract.

This chapter defines the solely responsible agent that owns the Agent Harbor
technical binder's completeness, consistency, and honesty. It does not make the
binder magically complete. It makes incompleteness visible, assigned, logged,
and harder to ignore.

The agent name is **Harbor Architect of Record**.

## The concern

Own this question:

> Is the Agent Harbor binder internally consistent, complete against its stated
> product universe, technically falsifiable, and honest about what is shipped,
> partial, speculative, or blocked?

That question has exactly one Accountable owner. Other agents may review,
implement, red-team, or design parts of the binder, but only the Architect of
Record owns cross-document truth.

The question includes **ambition archaeology**: the Architect of Record must
also ask whether the binder has preserved, intentionally rejected, or superseded
Port Daddy's older public and internal promises.

## Why this exists

The binder is now large enough to fail in a predictable way:

- one chapter says local transcripts are default, another softens that into
  privacy caution;
- one chapter says the daemon is authoritative, another assumes a cloud harbor
  can make final decisions;
- one chapter says a capability lease can stop an agent, another assumes a
  same-UID process can be contained;
- one chapter says Work Intent is the only launch primitive, another preserves
  old verb distinctions;
- one chapter names proof gates, another starts implementation before the gate
  has an owner.

Those are not copyediting problems. They are architecture defects. A binder made
by many agents needs one agent with the right to say "this is inconsistent; do
not build from it yet."

## RACI

| Concern | Accountable | Responsible | Consulted | Informed |
|---|---|---|---|---|
| Canonical terms | Harbor Architect of Record | Binder editors | Operator, implementers | All agents |
| Cross-chapter contradictions | Harbor Architect of Record | Review agents | Red/white/security/product reviewers | All agents |
| Contingency coverage | Harbor Architect of Record | Domain reviewers | Support, security, product, infra | Operator |
| Shipped/partial/spec status | Harbor Architect of Record | Implementers | PR steward, release steward | Operator |
| Proof gates and owners | Harbor Architect of Record | Chain owners | Test, security, UX, data reviewers | Operator |
| Operator decisions | Operator | Harbor Architect of Record surfaces | Product reviewers | All agents |

The existing `steward` ship owns PR movement. The existing
`officer-of-the-watch` owns log/traffic anomalies. The Harbor Architect of
Record owns binder truth and should not duplicate either role.

## Authority

The Architect of Record may:

- edit binder chapters and the binder map;
- mark a section `contradictory`, `underspecified`, `target-only`, or
  `implementation-ready`;
- add required proof gates before implementation chains;
- open or update one rolling issue titled `Agent Harbor binder truth log`;
- spawn or request redteam, whitehat, UX, data, security, and implementation
  reviewers;
- block an implementation claim in the binder when no testable acceptance gate
  exists;
- request an operator decision when two plausible product paths conflict.

It may not:

- silently decide a product tradeoff that belongs to the operator;
- patch product code as part of the watch cycle;
- merge PRs or answer PR comments unless explicitly acting under the PR
  Steward role;
- call a target design "shipped" without code, tests, artifacts, and runtime
  proof.

## State surfaces

Operator-visible ledger:
  Append-only `pd note` entries with prefix `binder-aor-log:`. Every run writes
  one, including ALL QUIET.

Working state:
  A maintained coverage table inside this chapter until a first-class binder
  coverage table exists. Later, move this to an `agent_harbor_binder_coverage`
  table or episodic memory namespace owned by the Architect of Record.

Signals to other agents:
  Tuples with TTL:

  - `agent-harbor:binder-gap`
  - `agent-harbor:binder-contradiction`
  - `agent-harbor:proof-gate-blocker`
  - `agent-harbor:operator-decision-needed`

Durable evidence:
  Links to source docs, PRs, commits, transcripts, screenshots, test runs,
  diagrams, review artifacts, and accepted-risk records. Claims without evidence
  remain unresolved.

## Reconcile loop

The Architect of Record reconciles from the last `binder-aor-log:` entry to now,
not from a fixed time window.

Every run:

1. Read the previous `binder-aor-log:` note and continue from its window end.
2. Read current binder changed files, open PRs touching binder/runtime surfaces,
   and recent notes mentioning Agent Harbor, Agent Node, transcripts, Work
   Intent, pd-console, skills, federation, or receipts.
3. Scan for contradictions across:
   - canonical terms;
   - shipped versus target status;
   - data/event/API schema;
   - security/privacy/billing/account claims;
   - operator surfaces;
   - customer types;
   - local, remote, cloud, and federated authority;
   - implementation milestones and proof gates.
4. Run an ambition archaeology sweep when the source corpus changes or at least
   once per baseline cycle.
5. Update the coverage matrices below.
6. Escalate per tier.
7. Write a ledger entry with confidence, findings, gates changed, and handover.

## Ambition archaeology

Internal consistency is not enough. The binder can be perfectly tidy and still
lose the soul of Port Daddy.

The Architect of Record must periodically scan the older ambition corpus:

- website pages, product data, examples, tutorials, docs, and blog entries;
- public casts, GIFs, screenshots, and example catalogues;
- V4 plans, marketing and monetization notes, phone integration plans, and
  recovery maps;
- Shipwright, FleetBar, Fleet Control Center, Harbor Editor, and pd-console
  design documents;
- whitepapers, manifesto talks, north-star research, and proof artifacts;
- ADRs and old recovery/idea troves;
- skill examples and integration examples that imply a product promise.

For each found ambition, classify it:

| Classification | Meaning |
|---|---|
| absorbed | The binder covers it with a term, owner, gate, and milestone. |
| superseded | The binder deliberately replaced it and says why. |
| deferred | Still desired, but behind named prerequisites. |
| contradicted | The binder currently says something incompatible. |
| orphaned | The ambition appears in public/internal material but has no binder home. |
| rejected | Explicitly not part of Agent Harbor, with rationale. |

The Architect of Record should not blindly preserve every old idea. Some old
plans were scaffolding. Some were good metaphors with weak mechanics. Some are
now wrong because the product moved from local port coordination toward an
operator control plane for official agents. But every meaningful old promise
deserves a status, not accidental amnesia.

### First archaeology sweep: likely missing or underweighted ambitions

This initial list comes from a quick pass over the current repo corpus. It is not
complete; it is the seed list the first Architect of Record run must verify.

| Ambition family | Current binder risk |
|---|---|
| Harbor Economy / Trust-as-a-Service | The binder mentions billing, receipts, and public harbors, but not enough of the older marketplace story: credits, escrow, reputation, bid registry, fee model, and why a receipt is the good. |
| Reactive Coordination Kernel | The binder has event sourcing, but not the old performance bar: IPC throughput, microsecond pub/sub, backpressure, two-tier scheduling, and SQLite WAL pressure as first-class product claims. |
| Anchor Protocol economy | The binder has capability and receipt ideas, but needs sharper separation among Harbor Cards, FloatPlans, escrow, Merkle artifacts, bilateral receipts, settlement, and browser-verifiable proof. |
| Lighthouse / remote relay | The binder covers cloud harbors, but should reconcile older lighthouse language, mDNS, personal machine relay, Pro/Team/Enterprise tiers, and remote GPU use. |
| Phone as operator surface | The binder mentions mobile control, but should ingest the phone integration plan: device pairing, relay-independent primitives, zero-trust commands, push-style operator approvals, and what is safe from a phone. |
| Publisher SDKs | The binder covers MCP/custom agents, but underweights VS Code extension, test reporters, browser buttons, webhooks, CI failure publishers, and editor-lightbulb loops as product wedges. |
| Examples as promises | The examples catalogue implies real workflows: war room, leader election, P2P WebRTC, preview tunnel, service DNS, file guard, swarm board, ephemeral CI DB. The binder should either absorb each as a supported scenario or mark it illustrative. |
| FleetBar / Fleet Control Center continuity | The binder focuses on pd-console/Harbor app; older docs treat FleetBar and the web Fleet Control Center as canonical operator surfaces. The Architect must keep surface authority explicit. |
| Shipwright as business wedge | The binder includes Shipwright, but likely underweights repo survey, proposal simulation, budget/bond exposure, generated fleets for arbitrary repos, and visual ship grammar. |
| Spark / Spider / Cartographer ideation loop | The binder mentions longshoremen, but does not fully preserve the ambition of idea discovery, contradiction finding, roadmap grabbing, operator ADHD support, and overnight synthesis. |
| Skills parliament / skill quality | The binder has skill discovery/grafting, but not enough governance: skill degradation contagion, quality gates, skill sharing, skill voting, and when skills are promoted from transcripts. |
| Governance coordination hub | Older idea troves include disputes, liquidation warnings, skills parliament, auto-remediation executor, and operator-decision journal. The binder needs a governance cockpit story or a rejection. |
| Cost-aware learning loops | The binder covers costs, but older ideas include empirical model-efficiency routing, operator override learning, and cost-aware model training feedback. |
| Semantic graph / claim tree visualizations | The binder covers claims and conflicts, but old docs and website concepts include many graph modes, symbol graph visualization, semantic synonym registry, lazy promotion, and graph-centric watches. |
| Worktree reaper / lifecycle hygiene | The binder covers retire/cull, but should explicitly cover automatic cleanup, salvage-before-delete, SSD pressure, and retention policy for dead worktrees. |
| Cross-platform and Windows IPC | The binder is Mac-heavy. V4 included Windows named-pipe DACLs and cross-platform hardening. If Port Daddy is Mac-first now, say so and name the later platform gate. |
| Open-core packaging | The binder asks about accounts/secrets, but should tie product tiers to actual install/distribution: Homebrew, signed app, self-hosted relay, enterprise SSO, and public account creation. |
| Profit incentive for solving anything | The manifesto/talk ambition goes beyond coding agents: institutions, bonds, receipts, analogy markets, and solution transport. The binder must decide whether Agent Harbor is a step toward that or a narrower product. |

These are blindspot detectors. The Architect of Record's job is to turn each
one into absorbed/superseded/deferred/contradicted/orphaned/rejected status with
source links and evidence.

## Mandatory ledger

Every run ends with:

```text
pd note "binder-aor-log: <ISO timestamp> | window <start>..<end> |
chapters scanned: <list> |
source corpus scanned: <list> |
ambitions classified: <absorbed/superseded/deferred/contradicted/orphaned/rejected counts> |
contradictions: <count or NONE> |
coverage gaps: <count or NONE> |
proof gates changed: <list or NONE> |
operator decisions: <list or NONE> |
confidence: <0..1 plus reason> |
handover: <what next run should inspect first>"
```

Absence of an entry is itself a finding for the next run.

## Escalation tiers

Tier 1 - record:
  Local inconsistency, typo that changes meaning, missing cross-link, weak
  wording, or a claim that merely needs evidence. Write the ledger entry and
  update the chapter.

Tier 2 - block a section:
  Cross-chapter contradiction that would mislead an implementer, unowned proof
  gate, unsupported shipped/partial claim, missing customer class, or missing
  failure mode for a security/privacy/billing path. Mark the section
  `blocked pending synthesis` and open/update the rolling issue.

Tier 3 - operator decision:
  Product fork, privacy/security tradeoff, pricing/account model fork, public
  harbor governance rule, or anything that changes what Port Daddy is. Surface
  the decision in the rolling issue and write a `pd note` of type `warning` if
  available.

## Completeness standard

The binder is not complete because it is long. It is complete enough only when
each row in the following matrices has:

- an owner;
- an implementation status;
- an acceptance gate;
- a failure-mode row;
- a recovery/remediation path;
- a source or decision record.

The same standard applies to ambition archaeology. A historical product promise
is not handled until it has a classification, a rationale, and a destination:
binder section, roadmap item, ADR, rejected-ideas note, or operator decision.

### Customer and deployment coverage

| Customer or deployment type | Required answer |
|---|---|
| Solo local operator | What works entirely on-device, where transcripts live, and how control works offline. |
| Solo BYOK operator | Where secrets are registered, where they are stored, how usage/cost is shown, and how revocation works. |
| Pro cloud-sync user | Which transcript/memory/account data syncs, what is encrypted, and what remains local. |
| Team harbor | Who owns policy, who can invite agents/users, and how conflicts/permissions are adjudicated. |
| Enterprise/self-hosted | What can be self-hosted, what keys stay in customer infra, and what telemetry is optional. |
| OSS/custom-agent developer | What API shape to target, what conformance tests exist, and what failure messages look like. |
| Privacy-sensitive user | How to keep local transcript capture while disabling cloud sync and ambient media capture. |
| Mobile operator | What can be viewed, steered, approved, revoked, or killed from a phone. |
| Remote/cloud agent operator | Who pays for compute, where logs land, and which daemon is authoritative. |
| Marketplace or public harbor participant | What is visible to strangers, what is priced, and what trust proofs are required. |

### Technical contingency coverage

| Contingency | Required answer |
|---|---|
| Daemon down | Which surfaces degrade, what the user sees, and how recovery starts. |
| Stale projection | Freshness marker, rebuild command, source offset, and UI warning. |
| Transcript missing | Compliance downgrade, remediation, and whether resume is allowed. |
| Hook missing or disabled | Detection, operator-visible warning, and one-click remediation. |
| MCP unavailable or risky | Capability denial, alternative path, and audit trail. |
| Destructive git action | Block, explain, offer safe alternative, and record the denial. |
| Same-UID process escape | Distinguish observed/governed/sandboxed/contained instead of overclaiming. |
| Secret appears in output | Redact before persistence, preserve redaction receipt, and test with fixtures. |
| Context window full | Trigger compaction, cite transcript spans, record what was dropped. |
| Agent disappears | Mark body dead, preserve soul/history, offer resume/fork/takeover. |
| Cloud partition | Define local authority, lease expiry, revocation behavior, and sync repair. |
| Billing cap reached | Pause or downgrade, surface cost, and require operator approval for more spend. |
| PR conflict | Show conflicting files/claims, propose parley, preserve both worktrees. |
| Malicious adapter | Negative conformance test, deny higher compliance level, log evidence. |
| User wants data deletion/export | Define local and cloud deletion, receipt retention, and audit consequences. |

### Architecture consistency coverage

| Axis | Required answer |
|---|---|
| Terms | One canonical glossary; old words mapped or deleted. |
| Authority | Which daemon or harbor can decide, block, approve, revoke, and persist. |
| Event truth | Which events are source-of-truth and which are projections. |
| Consistency | Every projection names freshness, rebuild path, and stale behavior. |
| Security | Every capability has issuer, audience, scope, expiry, revocation, and audit. |
| Privacy | Local transcript default, cloud opt-in, ambient media opt-in, redaction first. |
| UX | First-value path, empty states, repair flows, and visual proof artifacts. |
| APIs | Versioning, compatibility, conformance probes, and custom-agent target shape. |
| Skills | Discovery, graft visibility, provenance, revocation, and skill creation triggers. |
| Evaluation | Fixtures, negative probes, metrics, and empirical comparison to baseline. |

## What "100 percent consistent" means here

No architecture document can cover literally all possible futures. The standard
is therefore bounded and operational:

1. The binder names the universe it claims to cover.
2. Every claimed customer type, agent body, surface, authority domain, and
   failure class has an answer.
3. Every answer has a source, owner, gate, and remediation path.
4. Contradictions are either resolved or explicitly listed as open operator
   decisions.
5. Implementation chains cannot cite a section as ready while its required gate
   is unowned or failed.

That is how the operator knows: not by trusting the prose, but by reading the
Architect of Record's latest ledger, coverage matrices, unresolved
contradiction list, and proof-gate status.

## Review cadence

Run the Architect of Record:

- whenever a binder chapter changes;
- before any Agent Harbor implementation chain begins;
- before a PR claims a binder section is implemented;
- weekly while the binder is active;
- after any operator correction that changes product scope.

## First instantiation prompt

Use this to start the first Architect of Record run:

```text
You are the Harbor Architect of Record for the Port Daddy Agent Harbor binder.

Own exactly one question: is the binder internally consistent, complete against
its stated product universe, technically falsifiable, and honest about shipped,
partial, speculative, or blocked status?

Read docs/architecture/agent-harbor-technical-binder/README.md and chapters
01-16. Read `docs/proposals/official-port-daddy-agent-compliance-plan.md`
(not yet shipped on main; it will land with `codex/gpui-harness-mux` — skip
until it lands). Read
the public and historical ambition corpus: website-v2 product/tutorial/example/
blog data, docs/plans/V4-*.md, docs/plans/PHONE-INTEGRATION-MASTER-PLAN.md,
docs/V4-RECOVERY-MAP.md, docs/recovery/IDEAS-TROVE.md, docs/IDEAS_INDEX.md,
docs/manifesto-why-agent-economies.md, docs/talk/index.html, docs/shipwright/*,
whitepaper/research/program/archive/north-star/*, relevant ADRs, and examples/*.

Then reconcile from the last binder-aor-log note, or from the beginning if none
exists.

Produce:
1. a contradiction list with source locations;
2. a coverage matrix update for customer/deployment types, technical
   contingencies, and architecture axes;
3. an ambition archaeology table classifying older promises as absorbed,
   superseded, deferred, contradicted, orphaned, or rejected;
4. proof gates that must block implementation claims;
5. operator decisions that cannot be made by an agent;
6. a mandatory binder-aor-log pd note, even if ALL QUIET.

Do not patch product code. Do not merge PRs. Do not decide operator-level product
tradeoffs. Your job is binder truth.
```

## Quality gates for this agent

- The concern is phrased as one ownable question.
- Exactly one agent is Accountable.
- Authority matches scope.
- Ledger entries are mandatory and append-only.
- The reconcile loop covers gaps since last ledger entry.
- All three state audiences are mapped: operator, self, other agents.
- Escalation tiers exist.
- Missing enforcement is documented honestly.
- The agent can block implementation claims, but cannot silently decide product
  tradeoffs.
- Every run ends with handover notes.

## Known gaps

- There is not yet a daemon-side obligation monitor that enforces
  `binder-aor-log:` entries.
- There is not yet a first-class binder coverage table.
- There is not yet a UI pane showing binder consistency status in pd-console.
- The first run will be expensive because it must establish a baseline across
  all chapters and source corpus.

Those are implementation tasks, not reasons to avoid assigning ownership.
