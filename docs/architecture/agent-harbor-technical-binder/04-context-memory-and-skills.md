# 04 Context Memory And Skills

## Why transcripts are foundational

If Port Daddy cannot reconstruct what an agent saw, said, did, changed, and was
told, then "resume," "search past work," "learn from experience," and "make
better skills" are shaky concepts.

The transcript store is therefore not optional telemetry. It is the substrate
for:

- live streams in the app;
- historical replay;
- linked session continuation and successor spawning;
- context compaction;
- memory extraction;
- skill creation;
- accountability;
- training data curation if the user explicitly opts in later (the
  trajectory-export pipeline of ADR-0052 consumes this substrate; its Episode
  schema is a join over the ch. 09 event schema, and this opt-in plus the
  distilled-source contract below govern any dataset derived from it).

Notes remain valuable, but they become human and machine summaries on top of the
raw event trail. We should stop destroying notes. Notes are append-only memory
receipts.

## Transcript model

Every transcript event should have:

- timestamp;
- agent id;
- session id;
- turn id;
- provider/body/model tier;
- event kind;
- visibility class;
- source file or blob reference for large payloads;
- parent event ids when derived;
- redaction state;
- retention policy;
- hash for integrity.

The canonical schema lives in [09 Data Model And API](./09-data-model-and-api.md).
All adapter examples should be concrete instances of that schema, not parallel
event shapes.

The app should render events as a chat transcript, but storage should remain
event-sourced. A shell command, a file write, a GitHub reply, and an assistant
message are not all the same thing.

Important privacy limit:

Port Daddy records visible messages, tool calls, tool outputs, shell logs,
operator messages, summaries, and provider-exposed reasoning summaries. It must
not invent or imply access to hidden chain-of-thought that the provider does not
expose.

## Context pressure

Every compliant Agent Node should report context pressure:

- estimated tokens in current context;
- maximum context window;
- percentage used;
- last compaction time;
- size of active plan;
- unresolved obligations;
- number of retrieved memories;
- whether a Longshoreman compaction is requested;
- whether the next turn risks truncation.

The daemon should treat "context almost full" as an operational event, not an
agent's private problem.

Default thresholds:

- 60 percent: start preparing compaction candidates.
- 75 percent: Longshoreman builds a cited memory packet.
- 85 percent: warn the operator or agent before broad new work.
- 92 percent: require compaction or successor creation before next major action.

Pre-turn context envelope:

```json
{
  "agentId": "agent-...",
  "sessionId": "session-...",
  "turnId": "turn-...",
  "estimator": {"name": "provider-or-local", "version": "1", "confidence": 0.82},
  "windowTokens": 200000,
  "budgets": {
    "system": 6000,
    "operator": 12000,
    "transcriptTail": 30000,
    "toolResults": 25000,
    "memories": 20000,
    "skillGrafts": 12000,
    "workingPlan": 10000,
    "outputReserve": 16000
  },
  "used": {
    "transcriptTail": 18400,
    "memories": 8100,
    "skillGrafts": 2400
  },
  "pressure": 0.71,
  "action": "prepare_compaction"
}
```

Hard behavior should be tied to this envelope, not vague token estimates.

Context reconstruction tiers:

When context is lost — to compaction, eviction, or a long wait between wakes —
reconstruction has three tiers of increasing robustness. The weakest is **full
replay** of the raw transcript: simple, but expensive and itself context-hungry.
Stronger is a **stashed continuation summary** — a task description, handler set,
and relevant context persisted before the agent goes quiet. The most robust is
**plan-based recovery**: the durable plan itself supplies the context — "I am on
step 3 of 7, and the result of step 3 just arrived" — so the agent re-anchors
from structure rather than from a reconstructed narrative. Port Daddy's
roadmap/planner DAG (roadmap items, atomic claims, planner board) is
architecturally exactly this plan-based-recovery primitive; Cloudflare had to
invent one, whereas Port Daddy already ships it as a control-plane object. It is
simply not yet wired into the compaction and recovery flows — the gap that
Opportunity #2 of the durable-agents landscape brief (2026-07) names.

## Memory tiers

Core memory:
  Small identity packet for each durable agent soul. It includes role, current
  obligations, active project, safety rules, style preferences, and immediate
  continuity. Keep it tiny and human-inspectable.

Recall memory:
  Recent and important episodes for a project, repo, agent, or workgroup.
  Retrieved by recency, semantic relevance, active files, goals, and conflict
  risk.

Archival memory:
  Full transcript store, artifacts, diffs, PRs, notes, reviews, and embeddings.
  Searchable and cited. Not blindly injected.

Graph memory:
  Facts and relationships: agent worked on file, PR fixed issue, skill helped
  task, decision contradicted prior decision, test failed, route owns endpoint.
  Facts need validity intervals and sources.

Blackboard memory:
  Shared working facts for active collaboration: current blockers, file heat,
  unresolved parleys, decisions waiting for operator, agents doing similar work,
  and "do not duplicate this" warnings.

## Artifact harvest: booty

Status: shipped behind PR #1723, pending merge.

Archival memory owns artifacts, but until now nothing harvested them. Booty is
the artifact-harvest layer: design workups, images, HTMLs, videos, and shaders
produced during a session are deposited into the existing content-addressed
blob store, with a provenance row per deposit. Bytes live in the blob store
(`lib/blob.ts`); booty is only the provenance ledger
(`lib/booty.ts`, will land with PR #1723). Each deposit records:

```text
{ hash, media_type, original_path, byte_size,
  branch, worktree, session, agent_identity, roadmap_link, note }
```

Surfaces: `pd booty add <path...>` and `pd booty list`, plus `GET /booty` and
`POST /booty`. Provenance is resolved from the active session context and git
worktree, not typed by hand. Re-deposit of the same bytes on the same branch
is idempotent; the same bytes on a different branch is a new provenance row.

Doctrine:

- artifacts are durable truth on ANY plane and any branch. A render produced
  on an ephemeral daemon is still evidence and is never quarantined;
- provenance travels with the artifact, always — who, where, which session,
  which roadmap item;
- "promote" is curation, not rescue: choosing which harvested artifacts to
  surface, never a precondition for keeping them.

Worktree-death sweep hooks, operator surfaces, and promote flows are
follow-ups, not part of this slice.

## Retrieval policy

Retrieval should depend on the task:

- conversation continuation: recency first, then active obligations;
- bug fixing: files, symbols, errors, tests, prior fixes, and recent diffs;
- PR response: review comments, diff, CI logs, prior bot replies, roadmap item;
- planning: source docs, open contradictions, research notes, milestone state;
- skill grafting: task shape, prior successful skills, validation history;
- conflict resolution: file claims, semantic dependency graph, parley history.

Retrieved memories should stay under a fixed context budget and include
citations back to transcript events or documents. A memory without a source is a
suggestion, not a fact.

## Longshoremen

Longshoremen are durable infrastructure agents. Their jobs include:

- compacting transcripts into continuation packets;
- creating handoff summaries with citations;
- extracting episodes and graph facts;
- detecting contradictions across docs, PRs, and agent plans;
- recommending skill grafts;
- preparing PR replies and roadmap updates;
- watching conflict predictors and parley channels;
- shepherding stale or dead agents into salvage.

They should usually be reactive or passive-proactive. The always-on default is:

- 80 percent reactive;
- 15 percent passive proactive;
- 5 percent active proactive.

That keeps them helpful without becoming noisy.

## How Longshoremen compact Voyagers

Compaction happens at two scales, and Port Daddy should keep them distinct.

**Macro-compaction** summarizes *ranges* of older transcript events into a
non-destructive overlay. The originals are never deleted — they stay in the
event store for audit, citation, and search — and the overlay sits above them.
When a range is re-summarized, the existing summary is passed back to the model
to *update* rather than regenerated from scratch, so the summary accretes context
across passes instead of drifting. The compaction packet described below is that
macro overlay: a first-class, cited summary event laid over a range, never a
replacement for the events it covers.

**Micro-compaction** is read-time truncation of individual aged tool outputs.
Old or oversized tool results are shortened or replaced with previews at the
moment the next context window is assembled, while the most recent few (roughly
the last handful) are kept intact. Micro-compaction writes no transcript events
and produces no overlay; it is a projection applied when building context, not a
durable summary.

A compaction packet (the macro overlay) should contain:

- agent identity and role;
- current task and success criteria;
- relevant operator instructions;
- active files, claims, and worktree;
- current diff summary;
- unresolved blockers;
- decisions made and why;
- commands/tests run and results;
- PR and review state;
- recent transcript excerpts by citation;
- next intended action;
- safety constraints and budget.

The packet must cite source events. A compaction that cannot be traced back is
too easy to hallucinate.

`compaction_packet` is a first-class transcript event. Its schema includes:

- active obligation list;
- factual claims with source event ids or source spans;
- omitted-known-risk list;
- files and claims covered;
- commands/tests covered;
- next-action recommendation;
- source hashes;
- validator result.

The validator fails uncited factual claims and warns when active obligations are
missing.

Boundary rule: a compaction range must never split a tool-call/tool-result pair.
The macro summarizer shifts range boundaries so a `tool_use` event and its
matching `tool_result` are always compacted together or left together — never
one without the other. This is the direct defense against the orphaned-pair
failure class documented in the field (claude-code #14173, #40305): drop a
`tool_use` while retaining its `tool_result` (or the reverse) and the resulting
message array is malformed, the provider rejects it with a hard 400, and `/clear`
becomes the only recovery. The boundary check belongs in the validator alongside
the uncited-claim check.

Scope note: this chapter covers *in-session* compaction — keeping one running
agent's context healthy. Cross-*process* continuation, where a dying or evicted
agent stashes a sanitized handoff capsule for a successor to resume from, is a
related but distinct concern governed by ADR-0118 (harness adapter contract);
the two should not be conflated — a compaction overlay lives inside a live
session's event stream, whereas a handoff capsule crosses the boundary between
sessions.

## How Longshoremen compact themselves

Longshoremen also have finite context. They should use the same system:

- append transcript events for their own observations and decisions;
- maintain a tiny core identity packet;
- periodically checkpoint open obligations;
- ask another Longshoreman or reviewer to validate high-impact summaries;
- cite source events in their memory updates;
- store old context as episodes, not giant self-prompts.

A Longshoreman's continuity comes from the daemon ledger, not from assuming a
single model conversation lives forever.

## Context partitioning

When work gets too large, Port Daddy should split context deliberately.

Spawn another agent when:

```text
spawn_cost + communication_cost < stay_cost
```

Practical triggers:

- context above 75 percent and task graph still broad;
- independent files or modules with low dependency coupling;
- separate research, implementation, review, and validation tracks;
- repeated topic switching by the operator;
- work that can run while the main agent keeps a critical path.

Port Daddy should use:

- semantic chunking of transcript and repo context;
- causal dependency graph so handoffs include prerequisites;
- online clustering for live partition decisions;
- batch clustering for post-hoc memory organization;
- DAG partitioning for planned work;
- consensus before committing to large splits.

Handoffs should transfer the minimum required context plus citations. Do not
copy the entire harbor into every subagent.

## Skill discovery

Skill discovery should be its own service, not a prompt habit.

Inputs:

- task text;
- repo and file context;
- current agent role;
- past successful skills;
- failure modes;
- budget and deadline;
- user-mentioned skills;
- available skill roots.

Outputs:

- candidate skills with reasons;
- required reference files;
- confidence;
- incompatibilities;
- validation requirements;
- whether to graft now, ask, or ignore.

The system should separate proposal from validation. One model can propose a new
skill or skill graft, but another validator or test should decide whether it is
admitted to the shared library.

Untrusted transcript-derived skills are quarantined until reviewed. Skills never
override Articles, daemon guard policy, system/developer/operator instructions,
or explicit user constraints.

## Skill grafting

Grafting means injecting the relevant skill obligations into the agent's next
context at the right moment.

Graft layers:

Light graft:
  A short reminder: "Use semantic conflict prediction before editing contested
  files."

Reference graft:
  Summarized obligations plus path citations to the relevant skill references.

Full graft:
  Full skill body and required references, used when the skill is central.

Tool graft:
  Adds available tools or MCP endpoints needed by the skill.

Team graft:
  Announces the skill as a shared rule for a workgroup or harbor.

Grafts should expire. A skill relevant to UI polish should not remain injected
for a later backend-only turn.

Skill graft envelope:

```json
{
  "skillId": "semantic-conflict-prediction",
  "version": "2026-06-30",
  "scope": "repo",
  "level": "reference",
  "selectedBy": "daemon:skill-index",
  "validatedBy": "agent:skill-reviewer",
  "provenance": ["file:/path/SKILL.md"],
  "permissionDelta": [],
  "instructionPrecedence": "below-articles-and-operator",
  "expires": {"turns": 3, "paths": ["src/conflicts.ts"]},
  "conflicts": []
}
```

## Skill creation

Agents should propose new skills when:

- the same failure recurs across sessions;
- a successful procedure is hard-won and reusable;
- a project-specific pattern would help future agents;
- a new tool requires safe operating instructions;
- transcript search finds several similar solutions;
- postmortem shows a missing guardrail.

The skill creation pipeline:

1. Candidate episode found in transcript or note.
2. Longshoreman extracts the procedure with source citations.
3. Skillwright drafts a skill card, trigger rules, steps, examples, and tests.
4. Independent reviewer validates it against the source episode.
5. Skill is admitted as private, team, repo, or public.
6. Future grafts track usage and outcomes.

## Skill sharing

Skill scopes:

- private user skill;
- repo skill;
- team harbor skill;
- public marketplace skill;
- global built-in skill.

Shared harbor skills require governance:

- author identity;
- version;
- provenance;
- permissions;
- compatibility;
- review status;
- revocation path;
- usage analytics with privacy controls.

It is not always one host and one guest. A harbor can be personal, team-hosted,
company-hosted, public, or federated. The rule is explicit authority and
capability cards, not assumed trust.

## Transcript search and blackboard

Two high-value tools should be built early:

Transcript search:
  Search across past agent transcripts, notes, tool calls, diffs, files, PRs,
  and outcomes. Answer questions like "who fixed this before?", "what command
  deployed the worker?", "which agent touched this route?", and "why did the
  previous reviewer object?"

Blackboard:
  A shared live board for current harbor state: active goals, unresolved
  contradictions, claimed files, blocked agents, recent decisions, parley
  invites, test failures, and suggested next moves. It should be structured,
  timestamped, and source-linked, not a loose chat.

These are not extras. They are what make Port Daddy feel smarter tomorrow than
it was today.

## Deletion and derived memory

If raw transcript payloads are deleted after distillation, derived memory must
not pretend the raw source still exists.

Distilled source contract:

- original event tombstone and hash;
- redacted excerpt or user-approved digest;
- derivation transform;
- confidence;
- source payload state: present, redacted, deleted, expired;
- policy for invalidating or degrading derived facts.

The UI should show "source payload deleted" when a memory can only cite a
tombstone or digest.
