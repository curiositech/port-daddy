# Agent Coordination: Directory Services, Working Groups, Group Chats, Shared Data

**Status:** research / design exploration — NOT a build plan
**Author:** researcher subagent (read-only orientation)
**Date:** 2026-05-19
**Audience:** operator + future PD-architect agents

---

## Executive Summary

PD already has most of the substrate it needs for a real agent directory + ad-hoc working-group system. What it lacks is:

1. A **directory query path** that combines `agents.skills` / `agents.identity_*` / `harbor_members.capabilities` with the existing semantic resolver into a single `pd whois` lookup. The semantic table is the most-used coordination surface in the daemon (8k/week); the inbox is the least-used (46 lifetime). The phonebook should ride the busy rail, not the dead one.
2. A **group abstraction** distinct from harbors (cryptographic identity scope) and channels (pub/sub topic). Harbors are too heavyweight to spawn per-incident; channels are too anonymous to know who's listening. The missing primitive is the *working group* — a named, TTL'd set of agents pinned to a concern (file, roadmap item, incident, file claim cluster).
3. **Layered delivery semantics**, not yet another delivery API. The current options (channel pub/sub, agent inbox DM, tuples) all assume the recipient pulls. The "ambient context streams" idea — what arrives in an agent's next turn — is the actual UX problem, and it cuts across all three.
4. **Honesty about conscription.** Drafting agents into groups is plausible only because PD has bonds, budget ledger, and project wallets. Without those, conscription would be lawless. Even with them, the default should be **observed, not compelled** — push notice, do not require response. Compelled response only when the operator explicitly signs the dragoon.

The 46-inbox-message lifetime is the cautionary tale: agents don't check things they aren't surfaced into their working context. Any new primitive that requires explicit polling will see the same fate. Everything below is designed to attach to existing high-traffic paths (semantic resolution, claim watchers, session briefings) rather than create a new one.

---

## 1. Prior Art Survey

### 1.1 FIPA Directory Facilitator (DF) and Agent Management Service (AMS)

The canonical multi-agent yellow-pages pattern. Two mandatory agents per platform:

- **AMS** owns agent identity, lifecycle, and naming (the white pages).
- **DF** owns capability advertisements (the yellow pages).

**Registration:** Each agent posts a `DFAgentDescription` containing service name, type, ontologies, languages, protocols, and a property bag. Registration is explicit, self-asserted, and modifiable.

**Query:** Agents call `DFService.search(template)` with a partial `DFAgentDescription` as a constraint. The DF returns all matching agent descriptions. There is no ranking — you get the matching set and the caller picks.

**Freshness:** Largely absent. The DF entry persists until the agent deregisters or the platform shuts down. Stale entries are a known weakness — research papers cited (Ahmed et al., 2009; context-aware DFs) propose heartbeat-gated and context-sensitive extensions.

**Federation:** A DF can register itself with parent DFs to form a hierarchy. JADE provides a GUI for federated DF management.

**What survives in our setting:** the `register / search` API shape and the property-bag service description. What doesn't survive: the FIPA assumption that agents are stable processes on a distributed enterprise platform. PD agents are ephemeral — many die after a single CLI session. Freshness becomes existential, not a footnote.

Sources: [FIPA Agent Management Specification (FIPA00023)](http://www.fipa.org/specs/fipa00023/XC00023H.html), [Directory Facilitator and Service Discovery Agent](https://fipa.org/docs/input/f-in-00070/f-in-00070.pdf).

### 1.2 KQML vs FIPA-ACL Performatives

KQML embedded community-management performatives directly in the language: `register`, `unregister`, `forward`, `broadcast`, `advertise`, `recommend`, `recruit`, `subscribe`, `broker`. FIPA-ACL stripped those out and pushed them into the AMS/DF — the language stays about content, the platform handles directory. PD's `tube` performatives (REQUEST / CFP / PROPOSE / INFORM / AGREE / REFUSE / FAILURE) are FIPA-ACL-style: pure content acts, no register/advertise. That's the right call — but it means the platform (PD itself) has to be the directory, because the protocol has been deliberately stripped of `advertise`.

**Key KQML primitive PD does not yet have:** `subscribe` — "persistent intention to notify me of value, and again when it changes." FIPA promoted this to a full interaction protocol (FIPA00035). For an agent that wants to be looped in on all `harbor=expungement-guide` activity, this is the missing semantic. Today PD has SSE on `msg/:channel/subscribe` — channel-typed and pull-based. A FIPA-style subscribe over a *query* (not a channel) is a strict superset.

Sources: [FIPA Subscribe Interaction Protocol (FIPA00035)](http://www.fipa.org/specs/fipa00035/SC00035H.html), [Agent Communication Languages Comparison — KQML / FIPA-ACL](http://www.objs.com/agility/tech-reports/9807-comparing-ACLs.html).

### 1.3 JADE — DF in production

JADE is the most-deployed FIPA-compliant runtime. Lessons:

- The DF GUI ships out of the box and is used heavily — operators *do* want to inspect/edit the directory by hand. PD's dashboard panels are the analog.
- DF federation works but is rarely used; teams collapse to a single DF in practice.
- `DFService.searchUntilFound` is a polling loop that has been criticized in literature for stale-data thrashing.

Lesson for PD: ship a great single-node directory. Don't waste design on federation until the operator hits the limit of one daemon.

Sources: [Introduction to the DF — JADE](https://jade.tilab.com/documentation/tutorials-guides/dfgui/introduction/), [Java Agent Development Framework — Wikipedia](https://en.wikipedia.org/wiki/Java_Agent_Development_Framework).

### 1.4 ActivityPub / Mastodon — pull-based, follow-graph discovery

Each actor exposes an `outbox` (their public stream) and an `inbox` (delivery target). Discovery is **pull on demand** (any server can fetch any actor's outbox) augmented by **push delivery** to subscribed inboxes. There is no global registry — discovery starts from a chosen instance.

Relevant patterns:

- **Outbox = public capability advertisement.** An agent's outbox is its self-declared activity feed. PD's per-agent `agent_card` and `purpose` are the analog.
- **Inbox = guaranteed delivery point.** `agent_inbox` is correctly named — it is precisely an ActivityPub-style inbox. The reason it's at 46 messages lifetime is that nothing pushes to it on the busy rail.
- **Follow as subscribe.** A follow is a persistent subscribe on an actor's outbox.

For PD, this maps to "agent A wants to subscribe to all activity from agent B (or all agents matching capability X)" — a working-group primitive without explicit group formation. The group *is* the follow graph.

Source: [Understanding ActivityPub — Sebastian Jambor](https://seb.jambor.dev/posts/understanding-activitypub/), [ActivityPub — W3C](https://www.w3.org/TR/2016/WD-activitypub-20160128/).

### 1.5 Discord — role-based mentions, presence-gated broadcast

`@everyone` notifies all; `@here` notifies only non-idle online. Custom roles can be mentionable or not. Importantly, **presence** is first-class: a `@here` is fundamentally different from `@everyone` because it respects who is *currently* available.

Translation: PD already has `agents.last_heartbeat` and `agents.status`. "Online" maps to "heartbeat within N seconds AND status != stopped." A `pd group huddle frontend` should default to `@here` semantics — notify the alive-and-ready subset, not the historical roster.

Sources: [Discord — Notifications Settings 101](https://support.discord.com/hc/en-us/articles/215253258-Notifications-Settings-101), [Discord — @everyone & @here difference](https://www.remote.tools/remote-work/discord-everyone-here).

### 1.6 Slack — huddles and ad-hoc group formation

The Slack huddles model is the *closest existing UX analog* for what's being asked. Properties:

- **Huddles spawn in context** — they start from a channel or DM you're already in.
- **Drop-in / drop-out** — no explicit invite. Anyone in the parent channel can join the huddle.
- **Side-by-side persistence** — messages, files, and reference threads stay in the parent channel even after the huddle ends.
- **The group is implicit in the parent channel membership.** Slack doesn't make you re-declare who can join.

This maps cleanly onto: *the working group is implicit in the file-claim cluster, the harbor membership, or the roadmap-item subscription set.* The huddle is the synchronous foreground; the channel is the asynchronous record.

Source: [Slack — Solve problems aloud with Huddles](https://slack.com/resources/using-slack/solve-problems-aloud-with-slack-huddles), [Ad Hoc Meetings — Slack blog](https://slack.com/blog/productivity/ad-hoc-meetings-how-to-transform-impromptu-conversations-into-action).

### 1.7 GitHub CODEOWNERS — file-path → reviewer routing

A `CODEOWNERS` file is a gitignore-pattern → owner-list registry. PRs touching matching paths auto-assign owners as reviewers. Precedence: last matching pattern wins. GitHub extended this with **SERVICEOWNERS** for cross-repo service ownership.

Mechanically this is **the simplest possible expertise phonebook** — and the most successful. It works because:

1. Patterns are *automatic* — no agent has to advertise; ownership is declared in a file.
2. Routing is *triggered by activity* — a PR touching `apps/frontend/**` pulls in `@frontend-team`, not by query but by event.
3. Patterns are *additive and inheritable* — broad rules with specific overrides.

For PD, the equivalent is: a project-local `.portdaddy/owners.yml` (or stored as harbor metadata) mapping path/symbol patterns to agent identities or capability tokens. Then a file claim or symbol claim *automatically* triggers a notification to the matching identities. This is the missing "push" pattern.

Source: [About code owners — GitHub Docs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners), [SERVICEOWNERS at GitHub — Engineering Blog](https://github.blog/engineering/architecture-optimization/how-we-organize-and-get-things-done-with-serviceowners/).

### 1.8 LangGraph Supervisor / Swarm

- **Supervisor:** a single orchestrator routes to workers; each call is a routing decision plus optional state synthesis. One observable choke point.
- **Swarm:** agents hand off directly via `Command(goto=..., graph=Command.PARENT)`. No central router; routing logic is distributed in handoff tools.

Current production guidance: **start with supervisor**, graduate to swarm when latency forces it. PD already runs both shapes in disguise — orchestrator-plugins (supervisor) and pd-spawn-aware fleet agents that DM each other (swarm-ish). The directory is what makes a swarm *legible* — without it, swarm handoffs are by hard-coded name.

Source: [LangGraph Multi-Agent Supervisor](https://reference.langchain.com/python/langgraph-supervisor), [Multi-Agent Orchestration in LangGraph — DEV community](https://dev.to/focused_dot_io/multi-agent-orchestration-in-langgraph-supervisor-vs-swarm-tradeoffs-and-architecture-1b7e).

### 1.9 AutoGen GroupChat

`GroupChatManager` picks the next speaker via `speaker_selection_method ∈ {auto, manual, random, round_robin, custom}`. The `auto` method is itself an LLM call ("which agent should speak next?") — explicit acknowledgment that **selection is a model decision when there is no obvious rule.** `SelectorGroupChat` extends this with conversation-context-aware selection over agent descriptions.

For PD: the `pd whois`-style ranker should expose a `method` knob with at least `{semantic, recency, success_rate, llm}` — and the LLM method should be a cheap Haiku call when the cheap rankers tie. This mirrors the jury_rig skill-search cascade pattern the operator already uses.

Source: [AutoGen GroupChat — AG2 docs](https://docs.ag2.ai/latest/docs/api-reference/autogen/GroupChat/), [Selector Group Chat — AutoGen](https://microsoft.github.io/autogen/dev//user-guide/agentchat-user-guide/selector-group-chat.html).

### 1.10 CrewAI roles + hierarchical delegation

Each agent has `role`, `goal`, `backstory`, and `allow_delegation`. When delegation is on, agents get a `delegate-to-coworker` tool. Two pathologies they explicitly warn about:

- **Buck-passing loops.** Agents delegate back and forth until budget exhausts. Fix: limit `max_iter` and turn off `allow_delegation` for executors.
- **Vague role boundaries.** "Researcher" vs "Senior Data Researcher" matters — the model uses the role string as a routing prior.

For PD, the takeaway is: **the directory entry's identity_context / purpose / agent_card text is load-bearing.** Whatever the agent self-declares becomes the routing prior. Generic identities will round-robin; specific ones will get hits.

Source: [CrewAI Collaboration docs](https://docs.crewai.com/en/concepts/collaboration), [Hierarchical AI Agents — ActiveWizards](https://activewizards.com/blog/hierarchical-ai-agents-a-guide-to-crewai-delegation).

### 1.11 OpenAI Swarm → Agents SDK

Handoffs are just **functions returning Agent objects**. No protocol. No registry. The triage agent has a tool `transfer_to_refunds_agent()` which returns the refunds agent — control passes. Now superseded by the OpenAI Agents SDK.

This is the most stripped-down model and reveals a truth: **if your set of agents is small and known, you don't need a directory.** PD's audience is the opposite — long-tail of ephemeral agents — so the directory is non-optional. But: for the *static* core agents (gardener, qa, dock-master, etc.), a pure-handoff approach is fine and probably already de facto in use.

Source: [Swarm — OpenAI's Experimental Approach — Arize](https://arize.com/blog/swarm-openai-experimental-approach-to-multi-agent-systems/), [openai/swarm GitHub](https://github.com/openai/swarm).

### 1.12 Anthropic multi-agent research system

The Anthropic blueprint (April–June 2025): lead agent plans, **spawns parallel subagents with private context windows**, each subagent does breadth-first exploration, results return as **condensed findings via shared memory**, lead synthesizes. Outperformed single-agent Opus 4 by 90.2% on internal eval.

Two patterns directly relevant:

- **Parallel breadth-first subagents** — the lead acts as a one-shot supervisor, not a continuous orchestrator. PD's `pd spawn` already does this; the gap is that subagent findings don't reliably bubble up.
- **Shared memory return path** — the subagents write to a known location; the lead reads. Avoids long-chat retention.

Anthropic's "Outcomes" (rubrics) and "Multi-Agent Orchestration" (decompose + delegate) capabilities, launched May 2026, are essentially first-party versions of what PD's orchestrator-plugins + bonds + telos already aim at.

Source: [How we built our multi-agent research system — Anthropic Engineering](https://www.anthropic.com/engineering/multi-agent-research-system), [Claude Managed Agents — ChatForest](https://chatforest.com/guides/claude-managed-agents-dreaming-outcomes-multiagent/).

### 1.13 Vector-embedding agent selection (STRMAC, AgentRouter, Tool-to-Agent)

State of the art (late 2025 / early 2026):

- **STRMAC (Optimal-Agent-Selection, arXiv 2511.02200):** lightweight LM encodes problem state; LLM-derived embeddings encode agent expertise; learned router picks best agent per task. Demonstrably better than hand-coded routing.
- **AgentRouter (arXiv 2510.05445):** queries, entities, agents in a unified graph; heterogeneous GNN propagates and produces routing distributions.
- **Tool-to-Agent Retrieval (arXiv 2511.01854):** embed tools and parent agents in the same space, link via metadata, retrieve either depending on query fit. Avoids "context dilution" when many tools collapse into one agent description.

Direct implication for PD: **the agent description should be embedded at the same granularity as its skills.** If an agent declares 8 skills, embed 9 vectors (one per skill + one for the agent identity), not 1. PD's `semantic_terms` table is already keyed by `(term, model)` — adding agent identity terms and skill terms to the same table is mechanically trivial.

Source: [Optimal-Agent-Selection (STRMAC, arXiv)](https://arxiv.org/html/2511.02200v1), [AgentRouter (arXiv)](https://arxiv.org/html/2510.05445v1), [Tool-to-Agent Retrieval (arXiv)](https://arxiv.org/pdf/2511.01854).

### 1.14 Service mesh (Istio) — relevant or not?

Istio's service registry pattern (control plane watches platform, pushes registry to all sidecars via EDS) is **structurally identical** to what PD does: daemon (control plane) maintains `agents` table; CLI/MCP clients (sidecars) query.

The key insight from Istio is **separation between the registry (what's there) and the routing policy (what to do).** PD currently conflates the two — `pd agents list` is both the registry view and the routing surface. A `pd whois` query needs to be the routing surface; `pd agents` stays the registry.

What does *not* translate: service mesh assumes long-lived service identities and L4/L7 traffic. PD agents are conversational, not request-response loadbalanced. The mesh metaphor leaks if pushed too far.

Source: [Istio / Architecture](https://istio.io/latest/docs/ops/deployment/architecture/), [How to Implement Service Discovery with Istio — OneUptime](https://oneuptime.com/blog/post/2026-02-24-how-to-implement-service-discovery-pattern-with-istio/view).

### 1.15 Blackboard systems (HEARSAY-II)

The original 1970s pattern: shared hierarchical workspace, knowledge-source modules monitor and post, a central scheduler picks which knowledge source to activate next. Modern reincarnations: Terrarium (arXiv 2510.14312) puts an LLM blackboard at the center of a multi-agent safety study; LLM-based blackboard data-science multi-agent systems (arXiv 2510.01285) coordinate analysis tasks.

PD's `tuples` table is a Linda tuple-space, not a HEARSAY blackboard — Linda is flat key-pattern matching, HEARSAY is hierarchical with abstraction levels. The blackboard pattern is what you'd *want* for a sustained coordination concern (e.g., "the in-progress design for the FleetBar redesign") where multiple agents post partial contributions at different abstraction levels (sketches → schema → code → tests).

Source: [Terrarium: Revisiting the Blackboard (arXiv)](https://arxiv.org/html/2510.14312v1), [LLM-based Multi-Agent Blackboard System (arXiv)](https://arxiv.org/html/2510.01285v1), [Resurgence of Blackboard Systems — Medium](https://medium.com/@shawncutter/the-resurgence-of-blackboard-systems-b10ea72a8326).

### 1.16 Contract Net Protocol (Smith 1980, FIPA00029)

Manager broadcasts `CFP` → contractors bid → manager awards. PD already has the performatives (CFP, PROPOSE, AGREE, REFUSE) via the tube envelope. What's missing is the **bidding semantics on top of bonds.** A CFP that says "I need a frontend agent for ~$0.20 of budget, who'll take it for less?" is a real contract net — and PD's `bond_escrow` + `budget_ledger` are exactly the substrate.

This is the path to *paid* working-group formation, distinct from the operator-dragoon case.

Source: [Contract Net Protocol — Wikipedia](https://en.wikipedia.org/wiki/Contract_Net_Protocol), [Contract Net Protocol — Grokipedia](https://grokipedia.com/page/contract_net_protocol).

### 1.17 CRDT-backed shared docs (Yjs, Automerge)

By 2026, **AI agents as CRDT peers** is an established pattern: the agent opens a Yjs doc on the server side and participates as just another peer alongside human editors. Convergence guarantees that human and agent edits compose without a coordinator.

This is the right *shared data structure* model for things like a shared roadmap, a shared plan, a shared TODO list that multiple agents iterate. The pattern: server-side CRDT doc with multiple agent peers, optional human peer, conflict-free convergence.

For PD this would be a heavyweight addition (Yjs has a substantial dependency footprint), but the alternative — versioned shared state with explicit conflict resolution — is what `merge-queue` and `symbol-index` already provide. The choice is between "true CRDT" (no conflicts, eventual convergence, no rebase) and "git-style merge with explicit conflict markers" (conflicts visible, agent reconciles). For development work, git-style is more honest; agents *need* to see conflicts to reason about them.

Source: [AI agents as CRDT peers — Electric](https://electric.ax/blog/2026/04/08/ai-agents-as-crdt-peers-with-yjs), [Real-Time Data Sync — Fordel Studios](https://fordelstudios.com/research/real-time-data-sync-patterns).

---

## 2. Expertise Phonebook — Concrete Design

### 2.1 What "capability" means in PD

A capability claim in PD should be **multi-rooted** — drawn from several sources, ranked together. Sources, in order of trust:

1. **Earned (highest):** successful completion of a sortie tagged with capability X. From `sorties`, `roadmap_progress`, `episodic_memory`. Weight: high; decays with recency.
2. **Self-declared with evidence:** `agents.skills` JSON list, justified by the agent's identity / purpose / agent_card. Weight: medium.
3. **Self-declared without evidence:** `agents.skills` alone. Weight: low — but this is what most agents will have at registration time.
4. **Inferred:** files claimed, symbols claimed, harbors joined. An agent that has only ever touched `apps/frontend/**` and joined `harbor=fleetbar` has implicit frontend capability whether it declared so or not. This is the CODEOWNERS pattern in reverse.

The phonebook should never trust (3) on its own. The ranker must weight (1) + (4) above (3).

### 2.2 Schema additions (proposed)

Reuse the existing `semantic_terms` table. Add a join table linking terms to agents with a context label:

```sql
CREATE TABLE IF NOT EXISTS agent_capabilities (
  agent_id        TEXT NOT NULL,
  term            TEXT NOT NULL,
  source          TEXT NOT NULL,    -- 'earned' | 'declared' | 'inferred'
  evidence        TEXT,             -- JSON pointer to sortie/roadmap/files
  strength        REAL NOT NULL,    -- 0..1
  last_seen       INTEGER NOT NULL, -- ms
  expires_at      INTEGER,          -- ms, null = no TTL
  PRIMARY KEY (agent_id, term, source)
);
CREATE INDEX idx_agent_capabilities_term ON agent_capabilities(term, last_seen DESC);
CREATE INDEX idx_agent_capabilities_agent ON agent_capabilities(agent_id);
```

This rides the existing `semantic_terms` table for embeddings. New writes from `agents.skills` registration, sortie completion hooks, and file-claim watchers go here.

### 2.3 Freshness

Hard rules:

- **Heartbeat gate.** Any agent with `last_heartbeat < now - 5min` is filtered out of `pd whois` results by default. Override with `--include-stale`.
- **Recency-decayed strength.** `effective = strength * exp(-(now - last_seen) / TAU)` with `TAU = 7 days` for earned, `48h` for declared, `30 days` for inferred (file ownership ages slowly).
- **Bound on stale rows.** `expires_at` defaults to 30 days for `declared`, null for `earned` (kept indefinitely as evidence), 60 days for `inferred`. Background sweep deletes expired rows.

The phonebook entry for an agent that died 3 days ago is gracefully degraded, not silently wrong: the entry stays visible in `pd whois --include-stale` but is excluded from default results.

### 2.4 Ranking — cascade

Default `pd whois <query>` cascade (mirrors jury_rig skill-search):

1. **Exact match** on `agent_capabilities.term` → return immediately, ranked by `effective_strength DESC`.
2. **Lexical (BM25/TF-IDF)** over `agents.purpose`, `agents.agent_card`, `agents.skills` joined. Cheap, fast.
3. **Semantic (embedding)** via existing `semantic-resolver` — embed the query, cosine-rank against `semantic_terms` rows that join to `agent_capabilities`. The semantic resolver already does this for term reconciliation; reuse the same path.
4. **LLM tiebreak** — when top-K embedding results are within 0.02 cosine, hand the K candidates and the query to a Haiku call: "Which is best fit and why?" Cached.

Output is always ranked, never a raw set. Always includes the `source` (earned/declared/inferred) per result so callers can decide whether to trust.

### 2.5 Conflict resolution — three agents claim "frontend expert"

Three layers:

1. **Default policy:** rank-and-return, let the caller (or the LLM) pick. This is the FIPA approach and the right default — PD does not need to be opinionated here.
2. **Operator pinning:** `pd whois set-preferred frontend <agent-id>` writes a row in a new `phonebook_overrides` table. Future queries resolve the operator pick first.
3. **Bond-weighted tiebreak:** when capabilities tie, sort by `bond_balance DESC` — agents that have skin in the game outrank empty-pocketed ones. This is *only* triggered when the operator explicitly opts in via `pd whois --bond-weighted` or sets it as the project default.

### 2.6 Could the existing semantic resolver already be the phonebook?

**Mostly yes.** The semantic resolver already:

- Stores embeddings for arbitrary terms.
- Resolves a query string to canonical terms via cosine ranking.
- Logs decisions for operator review.
- Has an override table for operator pinning.

The gap is purely the **agent join**. There is no edge from a `semantic_term` to an `agent_id`. Adding `agent_capabilities` (above) is the minimum delta to turn the existing infrastructure into a phonebook. No new embedding pipeline. No new ranking pipeline. Just a join table and a CLI wrapper.

### 2.7 API sketch

```bash
# Query
pd whois "frontend expertise"
# → ranked list of agents with source, strength, last_seen, status
#   --json for machine consumption
#   --include-stale to override heartbeat gate
#   --bond-weighted for skin-in-the-game tiebreak
#   --explain to surface ranker reasoning

# Register / refresh
pd capability declare <agent_id> "frontend, typescript, react" --source declared
pd capability earn <agent_id> "frontend" --from sortie/<sortie_id>
# (or, more likely: post-commit/sortie-completion hook does this automatically)

# Operator overrides
pd whois set-preferred frontend <agent_id>
pd whois clear-preferred frontend
```

```typescript
// MCP / SDK
pd.whois(query: string, opts?: { includeStale?: boolean; bondWeighted?: boolean; explain?: boolean }): Promise<WhoisResult[]>;
pd.capability.declare(agentId: string, terms: string[], opts?: { source?: 'declared'; expires?: number }): void;
pd.capability.earn(agentId: string, term: string, evidence: { sortieId?: string; roadmapId?: string }): void;
```

---

## 3. Ad-hoc Working Group Formation

### 3.1 Four formation modes

**A. Implicit / auto-detected.** A group exists *by virtue of overlap.* No one calls `pd group create`. Triggers:
- Two or more agents with overlapping `session_files` claims → "shared-file group" exists on those file paths.
- Two or more agents on the same `harbor` → "harbor group" exists.
- Two or more sorties pinned to the same `roadmap_item` → "roadmap group" exists.

**B. Explicit / requested.** An agent or operator calls `pd group form --capability frontend --ttl 1h`. The daemon resolves capability via `pd whois`, returns a group handle, and ticks heartbeats on member presence.

**C. Conscripted / drafted.** The daemon (or orchestrator, or an operator-blessed agent) decides "you three are now a group" based on detected concern (an incident, a stuck claim, a roadmap escalation). Members are *notified*, not auto-consented.

**D. Hybrid.** Auto-detected groups have a "promote to explicit" option — if the implicit group becomes load-bearing, an agent can call `pd group promote` to give it a name and TTL.

### 3.2 Default: hybrid, biased toward implicit

The default should be **implicit detection + optional explicit promotion**, because that mirrors Slack huddles + GitHub CODEOWNERS — the most successful real-world patterns. Explicit-only formation is what FIPA DF does, and the data is clear: people forget to register, the directory rots.

Concretely: PD should *already know* that agent A and agent B are both claiming files under `apps/frontend/**`. That's a frontend group. Surfacing it in `pd group list` and letting any member promote it to named, TTL'd, with-its-own-channel is the right ergonomic.

### 3.3 Schema

```sql
CREATE TABLE IF NOT EXISTS groups (
  id              TEXT PRIMARY KEY,         -- e.g., 'g_frontend_2026-05-19_a3f'
  name            TEXT NOT NULL,
  concern_type    TEXT NOT NULL,            -- 'files' | 'harbor' | 'roadmap' | 'incident' | 'capability'
  concern_ref     TEXT NOT NULL,            -- path glob, harbor name, roadmap_id, etc.
  formation       TEXT NOT NULL,            -- 'implicit' | 'explicit' | 'conscripted'
  created_by      TEXT,                     -- agent_id or 'operator' or 'daemon'
  created_at      INTEGER NOT NULL,
  expires_at      INTEGER,
  channel         TEXT,                     -- backing channel for group chat; nullable until first post
  metadata        TEXT
);
CREATE TABLE IF NOT EXISTS group_members (
  group_id        TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  agent_id        TEXT NOT NULL,
  role            TEXT NOT NULL,            -- 'member' | 'observer' | 'lead' | 'dragooned'
  joined_at       INTEGER NOT NULL,
  joined_via      TEXT NOT NULL,            -- 'auto' | 'opt-in' | 'invited' | 'conscripted'
  consent         INTEGER NOT NULL DEFAULT 1, -- 0 if dragooned without consent
  PRIMARY KEY (group_id, agent_id)
);
```

Implicit groups are detected by background sweep (every 30s? aligned with session heartbeat). They are *materialized* into `groups` rows only when they become non-trivial (≥2 members, overlap sustained for ≥60s) or when something queries them. Cheap implicit groups don't need rows; they're computed on the fly. Materialized only when promoted, addressed, or referenced.

### 3.4 Membership churn

Implicit-group membership tracks the underlying concern: claim a file → join the file-group; release the claim → leave. This is automatic. No `pd group join` needed for the common case.

Explicit-group membership requires opt-in (`pd group join <id>`) or invite (`pd group invite <id> <agent_id>`).

Conscripted groups: see § 5.

---

## 4. Group Chat Semantics

### 4.1 The actual UX problem: ambient context streams

The 46-inbox-message-lifetime fact is the design constraint. Agents don't check inboxes. The question is not "what API does the recipient use to receive" — it's **what arrives in the agent's next turn's context window without the agent doing anything**.

This is the ambient context streams idea, and it's the single biggest leverage point for any new coordination primitive. The shape:

```
On next turn, the agent's system prompt (or first user message) is
augmented with:
- new inbox messages since last turn (already exists)
- new tuples matching the agent's subscriptions
- new group messages from groups the agent is a member of
- new claim-watcher events (already exists via pheromone)
- new semantic resolutions in the agent's project (operator review)
```

This is delivered *once per turn*, deduped, summarized when large. The agent doesn't poll; the harness injects. This is what makes the inbox useful — and equally, makes group chats useful without forcing a session loop.

### 4.2 Four delivery modes per group (layered)

| Mode | Semantics | Use when |
|---|---|---|
| **Channel** | Post lands in group's backing channel; members fetch on next ambient injection. No push, no acknowledgement. | Most messages. The default. Like a Slack channel. |
| **Huddle** | Active (heartbeat < 1min) members get message in their *next* turn injection regardless of channel polling. Idle members see it as channel. | Time-sensitive coordination during synchronous work. Like Slack huddle / Discord `@here`. |
| **REQUEST** | Compelled response. A tube REQUEST performative with timeout. Target agent's next turn must respond, or the orchestrator marks failure. Costs bond. | Real binding work assignment. Like CFP / Contract Net. |
| **Observer-mode** | Listening allowed; no response expected. Member is in `group_members` with `role='observer'`. | Lurking, audit, learning. Important for the gardener / dock-master / spark sense-making agents. |

The poster picks the mode per message. Default is channel.

### 4.3 Group post → who gets it

```
group.post(message, mode='huddle'):
  for member in group_members where role != 'observer':
    if mode == 'channel':
      append to group.channel (existing messages table)
    elif mode == 'huddle':
      if agent.last_heartbeat > now - 60s:
        push to ambient stream for next turn
      else:
        append to group.channel (degrades to channel)
    elif mode == 'request':
      create tube REQUEST envelope
      charge poster's bond
      target turn must respond or FAILURE auto-emitted
```

Observers always see channel-mode; never get pushes.

### 4.4 Why this layered model

It maps onto existing primitives:
- Channel mode = `messages` table + SSE (already shipped)
- Huddle mode = ambient stream injection (the upgrade path)
- REQUEST mode = `tube` + `bonds` (already shipped)
- Observer mode = `group_members.role='observer'` (just metadata)

There is no new transport. There is one new abstraction (group), one new delivery semantic (ambient injection), and a thin wrapper that picks mode per post.

---

## 5. Conscription / Dragooning — Honest Design

### 5.1 Who can dragoon?

Tiered authority:

| Who | What they can dragoon for | Cost |
|---|---|---|
| **Operator** (the human) | Anything, any agent | Free. Operator is sovereign. |
| **Orchestrator plugin** (with operator-blessed signing key) | Any group within its project scope | Charged to project wallet. |
| **Lead agent of an existing group** | Add additional members to its own group | Charged to group's bond pool. |
| **Any agent** | Cannot dragoon. Can only invite or post. | N/A |
| **Daemon itself** | Conscripted-observer only (never compelled response) | Free. |

The daemon-itself rule: PD can auto-add an agent as an *observer* to a group when it detects relevance (e.g., the gardener should observe any group that forms on a stuck claim). It cannot make the gardener compelled to respond. This is the "passive draft" — the agent is looped in without being forced to act.

### 5.2 Does the dragooned agent consent?

**Default: opt-in observer.** When dragooned, the agent receives an ambient injection: "You were drafted into group X by Y. You are an observer by default. Respond `accept` to become member, `decline` to leave, or ignore." Ignoring keeps you as observer.

**Compelled response mode:** Only with REQUEST performative + bond posted by drafter. The agent's turn must respond; failure to respond auto-emits FAILURE and refunds bond to drafter, debits agent's reputation.

**Refuse with reason:** REFUSE performative is first-class. The drafted agent can refuse and provide a reason; the drafter sees it; no bond charged.

### 5.3 Bond / cost charged?

Yes, three knobs:

1. **Joining a conscripted group is free** for the dragooned agent (it didn't ask).
2. **Sending a REQUEST that compels response costs the sender's bond.** Refunded on response (success or REFUSE with reason); forfeited on no-response.
3. **Conscription-by-orchestrator debits project wallet**, not the dragooned agent's bond. This prevents orchestrators from draining specialist agents by churn.

### 5.4 Interaction with already-claimed work

Three options, agent picks:

- **Drop and join** — release current claims, join group as primary. Reputation penalty if claims were active sortie work.
- **Finish and join** — finish current claim work, join group at completion. Default. Latency penalty for drafter.
- **Join in parallel** — observer-mode addition; current work continues; group injections appear in ambient stream alongside. Default for *observer* dragoons.

The agent's response to the draft message picks the mode. The harness exposes these as suggested tool calls.

### 5.5 Where bond / wallet substrate already lives

`bond_escrow`, `budget_ledger`, `project_wallets` — all exist. The dragoon-pricing logic is a thin layer on top: when the dragoon API is called, charge appropriately and record the debit reason as `'group:dragoon'` for accounting.

---

## 6. Shared Data Structures Beyond Messages/Tuples/Inbox

### 6.1 Survey

| Pattern | What it is | PD relevance |
|---|---|---|
| **Blackboard (HEARSAY-II)** | Shared hierarchical workspace; knowledge sources post at abstraction levels | High for sustained concerns (designs, plans). PD `tuples` is the flat sibling. |
| **CRDT-backed shared docs (Yjs/Automerge)** | Multi-peer convergent docs; agent is just another peer | High latency to build, high value for shared roadmap/plan |
| **Versioned shared state (Git-like)** | Read-modify-write with explicit conflict resolution | Already what merge-queue + symbol-index do |
| **Voting/consensus** | Aggregate agent opinions on a question | Lightweight; useful for "should we ship?" decisions |
| **Auction/market (Contract Net)** | Bid for tasks | Bond substrate ready; protocol substrate ready (tube CFP) |
| **Stigmergic pheromones** | Indirect coordination via environmental traces | Already in PD (`pheromone.ts`, `tuples.ts`) |

### 6.2 What should PD add next?

**Recommendation: blackboard, scoped to working groups.**

A group's blackboard is a hierarchical key-value workspace that members contribute to and the chat thread comments on. Concretely:

```sql
CREATE TABLE IF NOT EXISTS group_blackboard (
  group_id      TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  path          TEXT NOT NULL,            -- '/design/h2/typography' (hierarchical)
  value         TEXT NOT NULL,            -- markdown / JSON / text
  content_type  TEXT NOT NULL DEFAULT 'text/markdown',
  author        TEXT NOT NULL,
  version       INTEGER NOT NULL,
  parent_version INTEGER,                 -- causal predecessor for conflict detection
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (group_id, path, version)
);
CREATE INDEX idx_group_blackboard_latest ON group_blackboard(group_id, path, version DESC);
```

Why blackboard before CRDT:
- **CRDT is heavyweight.** Yjs adds substantial dependency surface. Worth it for human-collaborative editors; arguable for agent-coordinating workspaces.
- **Blackboard is honest about conflicts.** Agents reading code *need* to see conflicts; CRDT eventual convergence is wrong for code-like artifacts.
- **PD already uses git as its conflict-resolution layer.** Adding a parallel CRDT is duplicative. Adding blackboard *for non-git-tracked artifacts* (plans, sketches, decisions) is additive.
- **The blackboard pattern is being rediscovered for LLM multi-agent systems** (Terrarium, the 2510 paper). It's the most live area in MAS research right now.

Pair the blackboard with `tube INFORM` performatives — when an agent posts to the blackboard, an INFORM ripples to group ambient streams. The blackboard is *the durable record*; the chat is *the discussion of contributions to the blackboard*. Slack-channel metaphor, hardened.

### 6.3 What NOT to add next

- **Full Yjs CRDT.** Too much weight. Revisit if humans become co-editors of agent workspaces.
- **Voting / consensus.** Premature. Re-evaluate once groups exist and are used.
- **Auction/market full-CNP.** The substrate is there; ship explicit groups + REQUEST first, then layer CNP as a group-formation mode (mode E).

---

## 7. Tradeoffs and Open Questions

### 7.1 The 46-inbox-message problem, restated

Anything that requires an agent to **explicitly check** something gets ignored. The inbox is read 46 times in PD's lifetime; the semantic resolver runs 8k/week. The ratio is two orders of magnitude.

**Design rule:** every new primitive must either:
1. Ride a high-traffic path (ambient turn-injection, semantic resolver, claim watcher), or
2. Be triggered by an event the agent is *already* doing (claiming a file, posting a message, opening a sortie).

Anything else dies in the 46-inbox graveyard.

### 7.2 Where rich coordination becomes ceremony

Risks of overengineering:

- **Group lifecycle pages.** If `pd group create` requires more than two flags (name, concern), agents won't use it. Implicit formation is the safety valve.
- **Subscription explosion.** Every agent subscribing to every channel = ambient streams flooded. Need per-agent ambient budget (max N injected items per turn, ranked by `relevance * recency`).
- **Phonebook stale-rot.** Without aggressive freshness gating, the phonebook degrades to noise within weeks. The TTL/heartbeat rules in § 2.3 are non-negotiable.
- **Conscription abuse.** If any agent can dragoon, you get pull-request-review-spam at agent-scale. Authority tiers (§ 5.1) prevent this.
- **Blackboard sprawl.** A group with 200 blackboard paths is a wiki, not a workspace. Cap blackboard paths per group (say 50) with operator override; auto-archive old paths.

### 7.3 FIPA in single-operator-workstation context

What survives from the enterprise-distributed FIPA / JADE legacy:

- **DF as a concept** — yes, in the form of the phonebook.
- **DF federation** — no. One daemon per workstation; federate only if multi-machine becomes real.
- **Subscribe interaction protocol** — yes, as the basis for ambient streams.
- **AMS / DF separation** — partially. PD's `agents` table is the AMS; `agent_capabilities` (new) is the DF. Keeping them separate keeps identity and capability decoupled.
- **Mandatory ACL grammar** — no. PD's tube performatives + opaque content is sufficient; full SL/KIF content language is overkill.

### 7.4 Open questions for the operator

1. **Should `pd whois` default to bond-weighted ranking?** Argument for: skin-in-the-game is a real signal. Argument against: penalizes new agents and aligns badly with PD's "every agent owns the directory" ethic. *Recommendation: opt-in flag, not default.*

2. **Should implicit groups be materialized eagerly or lazily?** Lazy is cheaper but means `pd group list` requires a scan. Eager keeps queries fast but writes a lot of short-lived rows. *Recommendation: lazy + materialize-on-promote, with a per-project cache invalidated by claim/harbor/roadmap mutation.*

3. **Should the gardener (or any sense-making agent) be auto-conscripted as observer on every new group?** Argument for: enables PD's own coordination intelligence to learn. Argument against: ambient-stream flood for the gardener. *Recommendation: yes, observer-only, with a separate gardener-specific ambient budget.*

4. **Does the blackboard replace `tuples`, or complement?** Complement. Tuples are flat / pattern-matched / Linda-style. Blackboard is hierarchical / addressed / wiki-style. They serve different needs.

5. **REQUEST-compelled-response default timeout?** Suggest 5 minutes for huddle-context, 1 hour for asynchronous REQUEST. Bond size scales with timeout.

6. **What's the right size of an ambient injection?** Suggest a fixed token budget per turn (e.g., 2k tokens) ranked by `relevance * recency`, with overflow summarized. Need experimentation.

---

## 8. Concrete Next-Steps Decision Tree (for the operator)

If the operator wants to move on this, the smallest meaningful slice is:

**Slice 1 (the phonebook):**
- Add `agent_capabilities` table.
- Wire `agents.skills` → declared rows on registration.
- Wire sortie/roadmap completion → earned rows.
- Wire claim watcher → inferred rows (via path → capability mapping in a `.portdaddy/owners.yml`).
- Ship `pd whois <query>` reusing the existing semantic-resolver path.
- Operator review surface in the dashboard (reuse the existing semantic-resolutions panel).

This is ~2 days of work and reuses 100% existing infrastructure.

**Slice 2 (implicit groups):**
- Add `groups` and `group_members` tables.
- Implicit-group detector running on heartbeat (overlap on files, harbors, roadmap items).
- `pd group list` (computes implicit + lists materialized).
- `pd group promote <auto-id>` (materializes implicit → explicit + names it).
- `pd group post <id> <message>` (writes to backing channel).

**Slice 3 (ambient stream upgrade):**
- Per-agent ambient budget.
- Turn-injection now includes group posts (huddle mode) in addition to inbox.
- This is the lever that unlocks all the other primitives.

**Slice 4 (REQUEST + observer):**
- Tube REQUEST integration with group post.
- Observer role in `group_members`.
- Bond charging for compelled-response.

**Slice 5 (blackboard):**
- `group_blackboard` table.
- `pd group blackboard set/get/list/history`.
- Blackboard writes auto-INFORM the group.

**Slice 6 (dragoon):**
- Conscript API (operator-only initially).
- Bond charging for orchestrator/agent-initiated drafts.
- Reputation tracking for refused / unanswered drafts.

Slices 1–3 are the high-leverage core. 4–6 are interesting once you see how 1–3 are used in practice. **Do not build 4–6 speculatively** — wait for the dogfooding to surface the next bottleneck.

---

## 9. Sources Cited (de-duplicated)

- [FIPA Agent Management Specification (FIPA00023)](http://www.fipa.org/specs/fipa00023/XC00023H.html)
- [FIPA Subscribe Interaction Protocol (FIPA00035)](http://www.fipa.org/specs/fipa00035/SC00035H.html)
- [Directory Facilitator and Service Discovery Agent (FIPA input doc)](https://fipa.org/docs/input/f-in-00070/f-in-00070.pdf)
- [JADE — Introduction to the DF](https://jade.tilab.com/documentation/tutorials-guides/dfgui/introduction/)
- [Java Agent Development Framework — Wikipedia](https://en.wikipedia.org/wiki/Java_Agent_Development_Framework)
- [Agent Communication Languages Comparison — KQML / FIPA-ACL (OBJS technote)](http://www.objs.com/agility/tech-reports/9807-comparing-ACLs.html)
- [Understanding ActivityPub — Sebastian Jambor](https://seb.jambor.dev/posts/understanding-activitypub/)
- [ActivityPub — W3C Working Draft](https://www.w3.org/TR/2016/WD-activitypub-20160128/)
- [Discord — @everyone & @here difference](https://www.remote.tools/remote-work/discord-everyone-here)
- [Discord — Notifications Settings 101](https://support.discord.com/hc/en-us/articles/215253258-Notifications-Settings-101)
- [Slack — Solve problems aloud with Huddles](https://slack.com/resources/using-slack/solve-problems-aloud-with-slack-huddles)
- [Ad Hoc Meetings — Slack blog](https://slack.com/blog/productivity/ad-hoc-meetings-how-to-transform-impromptu-conversations-into-action)
- [About code owners — GitHub Docs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)
- [SERVICEOWNERS at GitHub — Engineering Blog](https://github.blog/engineering/architecture-optimization/how-we-organize-and-get-things-done-with-serviceowners/)
- [LangGraph Multi-Agent Supervisor](https://reference.langchain.com/python/langgraph-supervisor)
- [Multi-Agent Orchestration in LangGraph: Supervisor vs Swarm (DEV)](https://dev.to/focused_dot_io/multi-agent-orchestration-in-langgraph-supervisor-vs-swarm-tradeoffs-and-architecture-1b7e)
- [AutoGen GroupChat — AG2 reference](https://docs.ag2.ai/latest/docs/api-reference/autogen/GroupChat/)
- [AutoGen Selector Group Chat](https://microsoft.github.io/autogen/dev//user-guide/agentchat-user-guide/selector-group-chat.html)
- [CrewAI — Collaboration](https://docs.crewai.com/en/concepts/collaboration)
- [Hierarchical AI Agents — ActiveWizards CrewAI guide](https://activewizards.com/blog/hierarchical-ai-agents-a-guide-to-crewai-delegation)
- [Swarm — OpenAI Experimental (Arize)](https://arize.com/blog/swarm-openai-experimental-approach-to-multi-agent-systems/)
- [openai/swarm — GitHub](https://github.com/openai/swarm)
- [How we built our multi-agent research system — Anthropic Engineering](https://www.anthropic.com/engineering/multi-agent-research-system)
- [Claude Managed Agents — ChatForest](https://chatforest.com/guides/claude-managed-agents-dreaming-outcomes-multiagent/)
- [Optimal-Agent-Selection / STRMAC (arXiv 2511.02200)](https://arxiv.org/html/2511.02200v1)
- [AgentRouter (arXiv 2510.05445)](https://arxiv.org/html/2510.05445v1)
- [Tool-to-Agent Retrieval (arXiv 2511.01854)](https://arxiv.org/pdf/2511.01854)
- [Istio / Architecture](https://istio.io/latest/docs/ops/deployment/architecture/)
- [How to Implement Service Discovery with Istio — OneUptime](https://oneuptime.com/blog/post/2026-02-24-how-to-implement-service-discovery-pattern-with-istio/view)
- [Terrarium: Revisiting the Blackboard (arXiv 2510.14312)](https://arxiv.org/html/2510.14312v1)
- [LLM-based Multi-Agent Blackboard System (arXiv 2510.01285)](https://arxiv.org/html/2510.01285v1)
- [The Resurgence of Blackboard Systems — Medium (Cutter)](https://medium.com/@shawncutter/the-resurgence-of-blackboard-systems-b10ea72a8326)
- [Contract Net Protocol — Wikipedia](https://en.wikipedia.org/wiki/Contract_Net_Protocol)
- [AI agents as CRDT peers — Electric blog](https://electric.ax/blog/2026/04/08/ai-agents-as-crdt-peers-with-yjs)
- [Real-Time Data Sync — Fordel Studios](https://fordelstudios.com/research/real-time-data-sync-patterns)
