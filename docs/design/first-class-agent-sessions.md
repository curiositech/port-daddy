# First-Class Agent Sessions

Status: design (ready for ADR)

**One sentence:** Port Daddy sessions are durable identity vessels that survive harness embodiments, route work across Claude/Codex/PD native boundaries, and preserve immutable lineage and accounting throughout the agent's lifetime — orchestrated from a single operational surface (Beacon) and gated by the same trust/capability architecture as fleet work.

---

## The Why: Sessions as Persons, Not Transcripts

Port Daddy already observes **ephemeral bodies** (live process registrations), coordinates **bounded work** (sessions with notes), and preserves **memory handoffs** (sanitized episode continuations). The missing piece: a **durable agent identity** that survives process death and harness reboots while routing work seamlessly across three control planes.

### The Problem

- A strong Claude Code session disappears into transcript history after the harness closes.
- A Codex run completes and loses its coordination context.
- A PD-native fleet agent runs to completion; the next invocation starts from scratch.
- The operator has **no single pane** to see "what has this agent done across all my harnesses?" or "what can it do next?"
- Continuation requires manual re-seeding; the agent must rediscover its own history.
- Permissions and capability constraints are harness-local; they don't travel.

### The Goal

Sessions become **first-class durable persons** that:

1. **Survive harness boundaries.** A session spans Claude Code → Codex → PD native → Claude Code again. The durable agent identity (`AgentNode.agentNodeId`) is the continuity anchor.
2. **Preserve immutable lineage.** Every transition leaves a durable receipt: which harness, which transcript fragment, which credentials crossed the boundary, which memory was carried forward, how the daemon witnessed the handoff.
3. **Route through one trust gate.** The daemon's Door (ADR-0120 identity/capability enforcement) governs session creation, resumption, permission attachment, and all cross-harness promotion.
4. **Render in one operational pane.** Beacon (the operator-facing session & work surface) is the authoritative view: roster, transcripts, lineage, spends, durable roster promotions, and scheduling.
5. **Travel with permissions.** A session's declared capabilities (MCP scope, sandboxes, tool access, background-worker rights, Chromium policy) ride with the AgentNode profile and are re-enforced at each harness boundary.

---

## Part I: Architecture — The Session Spine

### Sessions as Nodes in the Work-Graph

In Port Daddy's six-plane model (ADR-0048), sessions live in **Plane 1 (Truth)** as append-only `session` records alongside `claim_forest`, `episodic_memory`, and `roadmap_items`. They are indexed by the daemon and queryable through Beacon and the `pd session` CLI.

**A session is not:**
- A transcript (that lives in the harness).
- A fleet body (that's a transient process registration).
- A static actor (that's an organizational role from source code).

**A session is:**
- A **bounded unit of coordinated agent work** anchored to a durable `sessionId` (UUID).
- Owned by a durable `AgentNode` (via `agentNodeId`).
- Gated by the Door (identity, capability, rent check).
- Scoped to a repository or project (via `harbor` field, ADR-0048).
- Carrying immutable notes, claims, and a final handoff transcript.
- Queryable in Beacon by lineage, agent, project, and temporal range.

### Session Lifecycle — The Four Phases

```
┌─────────────────────────────────────────────────────────────────────┐
│                  DURABLE AGENT (AgentNode)                         │
│                  persists across all phases                         │
└────┬────────────────────────────────────────────────────────────────┘
     │
     ├─ PHASE 1: MINTING (new session, new body)
     │  ├─ `pd session start --agent <agent-id>` or harness init
     │  ├─ Daemon mints new sessionId, links to AgentNode
     │  ├─ Door validates: identity ✓, capability ✓, rent ✓
     │  └─ Return session config to harness
     │
     ├─ PHASE 2: WORK (harness owns embodiment)
     │  ├─ Claude Code / Codex / PD-native runs the body
     │  ├─ Daemon observes tool calls, fetches notes/memory, routes inbox
     │  ├─ `pd note` appends to session's immutable log
     │  ├─ `pd claim` reserves file regions (regional governance)
     │  └─ Cost accrual flows to the AgentNode's ledger
     │
     ├─ PHASE 3: HANDOFF (body ceases, continuity chosen)
     │  ├─ Harness offers transcript fragment to daemon
     │  ├─ Daemon scans & sanitizes (gitleaks, secrets, auth)
     │  ├─ Creates durable handoff episode
     │  │  ├─ episode.source = "claude" | "codex" | "pd" | <harness>
     │  │  ├─ episode.transcript_hash = Blake3(sanitized fragment)
     │  │  └─ episode.agentNodeId = target continuity agent
     │  ├─ Mints continuation receipt (durable, public-facing)
     │  └─ Session moves to "closed" state, notes immutable-locked
     │
     └─ PHASE 4: RESUMPTION (new body, same person)
        ├─ `pd session continue` or harness asks daemon
        ├─ Door checks: same AgentNode ✓, continuation receipt ✓, new harness compatible ✓
        ├─ Daemon compiles resumption capsule (handoff episode + harvested memory + profile)
        ├─ New harness spins up new sessionId, linked to same AgentNode
        ├─ New session's notes immediately reference prior episode
        └─ Cost, permissions, and durable context flow through
```

### The Durable Handoff Capsule

When a session ends and resumption is planned, the harness offers its sanitized transcript to the daemon. The daemon creates a **handoff episode** (a record in `episodic_memory` with source-specific shape):

```typescript
// episodic_memory record
{
  id: "ep_xyz789",
  agentNodeId: "agent_03fk9a2m",          // who this episode belongs to
  sessionId: "sess_abc123",                // originating session
  source: "claude" | "codex" | "pd",       // harness type
  
  // Immutable capsule
  transcript_hash: "blake3_...",           // Blake3 of sanitized fragment
  transcript_size_bytes: 45000,
  cost_usd: 0.23,
  
  // Re-usable memory (harvested at handoff time)
  harvested_facts: [
    { category: "project_structure", fact: "monorepo with apps/cli/core" },
    { category: "git_state", fact: "branch: codex/3-28, 3 commits ahead main" },
    { category: "validation", fact: "PR #5001 merged, all tests green" }
  ],
  
  // Continuation affordance
  continuation_receipt: "rcpt_...",       // reference for resumption
  can_resume_in: ["claude", "codex"],     // harnesses that can pick this up
  expires_at: timestamp,                   // ~7 days from creation
  
  created_at: timestamp,
  lineage_chain: "ep_abc123 -> ep_def456 -> ep_xyz789"  // full history
}
```

The capsule is:
- **Immutable** (appended once, never edited).
- **Sanitized** (transcript passes gitleaks & secret-detection; auth tokens, passwords, API keys stripped).
- **Durable** (indexed by `agentNodeId` for future resumptions).
- **Lineage-preserving** (each episode chains to its predecessor).

### Permissions & Capabilities — The Profile Envelope

An agent's declared capabilities live on its `AgentNode.profile` (ADR-0119), which is itself append-only and versioned:

```typescript
// AgentNode profile (v1)
{
  agentNodeId: "agent_03fk9a2m",
  displayName: "Claude Refactoring Expert",
  remit: "code cleanup, dead-code removal, module simplification",
  
  // Declared capability surface
  capabilities: {
    mcp: ["filesystem", "git", "browser"],           // MCP scopes
    sandboxes: ["readonly:docs", "readwrite:src"],   // region access
    tools: ["bash", "edit", "read", "write", "grep"], // allowed tool set
    background_workers: true,                         // can spawn background tasks
    chromium: {
      headless: true,
      sandbox: true,
      viewport: "1280x800"
    },
    hotkeys: ["ctrl+s", "cmd+k"],                     // if interactive
    cache_policy: "hybrid"                             // local + remote
  },
  
  // Runtime observability
  declared_triggers: [
    { type: "scheduled", cron: "0 9 * * MON" },
    { type: "git_event", filter: "ref:refs/heads/main" }
  ],
  
  // Sanitized lineage
  latest_handoff_episode: "ep_xyz789",
  promotion_source: "session_promoted:sess_abc123",  // how this profile was born
  
  revision: 2,
  created_at: timestamp,
  updated_at: timestamp
}
```

**Transition rule:** When a session is promoted to a durable agent (or when an existing agent starts a new session), the daemon:

1. Validates the profile is fresh and consistent.
2. Mints a new session with the profile's capabilities attached.
3. **Stamps each capability as "declared" (not "enforced")** until a runtime adapter confirms it (ADR-0119, "permission policy is declaration-only").
4. Passes the profile to the new harness, which is responsible for enforcing the declared sandboxes, MCP scopes, and tool constraints.

### Resumption: The Exact Join

When resuming, the daemon compiles a **resumption capsule** distinct from the handoff episode:

```typescript
// POST /memory/handoffs/:episodeId/continue
{
  episodeId: "ep_xyz789",
  targetHarness: "claude" | "codex",      // where we're resuming
  
  // Return values
  resumptionCapsule: {
    sessionId: "sess_def456",              // new session for new body
    agentNodeId: "agent_03fk9a2m",         // same person
    
    // Compiled context
    profile: { ... },                       // current declared capabilities
    handoffEpisode: { ... },                // previous work's immutable record
    harvestedMemory: [ ... ],               // facts harvested at handoff
    
    // Lineage proof
    lineageChain: "ep_abc123 -> ep_def456 -> ep_xyz789",
    continuationReceipt: "rcpt_...",
    
    // Instructions for the harness
    harness_hints: {
      restore_mcp_scope: ["filesystem", "git"],
      enforce_sandbox: "readwrite:src",
      max_cost_per_step: 0.05,
      background_workers_allowed: true
    }
  },
  
  newSessionId: "sess_def456",
  mustValidate: {
    harness: "claude",                      // only Claude can resume this
    workspace: "/Users/erichowens/...",     // same Git root or fail
    profile_version: 2                       // must match or prompt refresh
  }
}
```

The harness receives this capsule and:
1. Restores MCP scope from `harness_hints.restore_mcp_scope`.
2. Enforces regional sandboxes (e.g., "only edit inside `src/` directory").
3. Loads the `harvestedMemory` facts into episodic memory (not into context window; the agent can request them).
4. Begins the new session with the new `sessionId`, already linked to the same `agentNodeId`.
5. The agent's first action can be `pd session attach <episodeId>` to read the full prior transcript (bounded, indexed fetch).

### Durable Accounting & Lineage

Every transition is witnessed by the daemon:

```
Beacon's Session Timeline View:

2026-08-05T09:15:22Z  MINTED       sess_abc123  claude            cost: $0.00
2026-08-05T09:18:44Z  WORKING      sess_abc123  (agent has notes)  cost: $0.32
2026-08-05T09:42:19Z  HANDOFF      sess_abc123  → ep_abc123       cost: $0.32 (final)
                       └─ source: claude
                       └─ transcript_hash: blake3_xyz
2026-08-05T09:42:31Z  RESUMED      sess_def456  codex (from ep_abc123) cost: $0.00
2026-08-05T10:10:52Z  WORKING      sess_def456  (agent has notes) cost: $0.11
2026-08-05T10:31:18Z  HANDED-OFF   sess_def456  → ep_def456       cost: $0.11 (final)
                       └─ source: codex
                       └─ transcript_hash: blake3_abc

[Lineage chain visible: ep_abc123 -> ep_def456 -> (pending)]
[Total spend across agent: $0.43]
[Next resumption available from: ep_def456, expires 2026-08-12T10:31:18Z]
```

Each record is immutable, timestamped, and queryable by agent, project, and time range.

---

## Part II: Operations & Boundaries

### One: Beacon — The Operator's Single Pane

Beacon (the operator-facing control surface, sister to pd-console for agents) owns:

- **Roster view**: named agents, profiles, declare capabilities, edit remits.
- **Session timeline**: per-agent, per-project; see all phase transitions.
- **Transcript browser**: bytestring search (BM25) across sanitized handoff episodes; jump to a specific transcript fragment.
- **Continuation controls**: "resume this agent in Claude/Codex/PD" with one click; Beacon gathers validation and fires `POST /memory/handoffs/:episodeId/continue` to the daemon.
- **Spend & lineage**: cumulative spend per agent, durable lineage chains, and expiry dates.
- **Trigger & scheduling**: declare wake-source (GitHub event, scheduled cron, email) and bind to an agent/plan.

Beacon is **not** the harness. It does not run code or display a transcript while an agent is live. It is a pure projection of daemon Truth, with no state of its own.

### Two: The Harness Adapter Contract (ADR-0118)

Each harness (Claude Code, Codex, PD-native) implements a minimal contract:

```typescript
// Harness adapter (e.g., claude-code-adapter.ts)
interface HarnessAdapterContract {
  // 1. On session start
  onSessionStart(config: {
    sessionId: string,
    agentNodeId: string,
    profile: AgentProfile,          // current declared capabilities
    resumingFrom?: HandoffEpisode    // if resumption
  }): Promise<void>
  
  // 2. On session work
  reportProgress(update: {
    sessionId: string,
    operation: "tool-call" | "note-written" | "claim-made" | "cost-incurred",
    detail: any
  }): Promise<void>
  
  // 3. On session end
  offerHandoff(transcript: {
    sessionId: string,
    fragment: string,               // transcript excerpt, may be partial
    agentNodeId: string,
    canContinueIn: string[],        // ["claude", "codex", ...]
    finalNote?: string
  }): Promise<HandoffEpisode>
  
  // 4. Query session state
  getSessionState(sessionId: string): Promise<SessionState>
}
```

A harness that implements this contract can:
- Receive resumption capsules from any other harness.
- Report progress to the daemon so Beacon sees live updates.
- Hand off with confidence that lineage and accounting are preserved.

### Three: Working vs Stalled — The Heartbeat

A session is **working** if:
- The harness has reported progress within the last `session_heartbeat_ttl` (default 2 min for interactive, 30 sec for fleet).
- The session's state is not `"closed"` or `"abandoned"`.

A session is **stalled** if:
- No progress reported for `2 × heartbeat_ttl`.
- The harness is non-responsive when queried.
- Cost accrual has stopped, but the session was not closed.

Beacon displays stalled sessions in a distinct visual state (e.g., amber warning) and offers:
- "Force-close this session?" (terminal session, accept no more notes).
- "Restart the harness?" (prod the harness to resume heartbeat).
- "Link to live support?" (escalate to the operator if harness is genuinely hung).

Stalled sessions **do not automatically resume**; the operator must explicitly choose resumption or closure.

### Four: Permissions & Isolation — The Sandbox Envelope

When a session starts, the daemon attaches the agent's profile capabilities to the new session record. The harness reads these capabilities and enforces them as **sandboxes**:

| Capability | Enforcement | Boundary |
|---|---|---|
| **MCP scope** | Harness filters MCP tool access before calling daemon | "Can only use `filesystem` and `git` MCP servers" |
| **Sandbox (region)** | Harness tool-call gates (before `read`, `edit`, `write`) | "Can only edit files under `src/`; read anything under `docs/`" |
| **Tool set** | Harness permits/denies per session | "Can call `bash`, `edit`, `read`; no `write`" |
| **Background workers** | Daemon spawn gate (admitter checks capability) | "Can spawn up to 3 background tasks concurrently" |
| **Chromium** | Browser automation harness (if present) | `headless=true`, `sandbox=true`, viewport constraints |
| **Cache policy** | Harness embedding/vector cache mode | "Use local MiniLM only; no remote embeddings" |
| **Hotkeys** | UI harness (if interactive) | "Can bind `Ctrl+S` for save; no `Ctrl+Z` undo" |

**Isolation rule:** Capabilities are **declared once on the profile and re-enforced at every session boundary**. If an agent profile declares `readonly:docs`, every new session (regardless of harness) inherits that constraint. The operator can edit the profile to grant/revoke; the next session sees the change.

### Five: MCP, Connectors, and Caches

- **MCP scope** is a list of MCP server names declared on the profile. The harness initialization code filters tool calls to permitted servers only.
- **Connectors** (OAuth, API keys for third-party services) are stored in the daemon's secret vault (Keychain on macOS). A session's profile can declare which connectors it needs; the daemon resolves them at session-start time and passes OAuth handles to the harness.
- **Caches** (embedding models, compiled asset maps, Git object caches) live in `~/.port-daddy/` and are **harness-agnostic**. The `pd embed` service is the canonical embedder (ADR-0061); all harnesses use it, and one model (`Xenova/all-MiniLM-L6-v2`) is cached locally for hybrid search.
- **Hotkeys** and **background workers** are only enforced when the harness is interactive (Claude Code) or fleet-driven (PD-native). Codex does not support either, so its profile simply declares the capability as "not-enforced".

### Six: Restrained Nautical Microcopy

Port Daddy uses maritime terminology throughout. For sessions, adopt the same voice:

| Concept | Nautical | Usage |
|---|---|---|
| Session start | "Cast off" | "Casting off a new session" |
| Session working | "Under way" | "Session is under way" |
| Session stalled | "Becalmed" | "Session is becalmed; no progress in 4 minutes" |
| Handoff | "Weighing anchor" | "Weighing anchor, preparing handoff to Codex" |
| Resumption | "Reconvening" | "Reconvening from handoff episode ep_xyz" |
| Cost | "Spend" | "Spent $0.32 on this leg" |
| Lineage | "Logbook" | "Logbook shows 3 prior legs" |
| Abandon | "Scuttle" | "Scuttle this session?" |
| Operator view | "Bridge" | "Visible on the Bridge (Beacon)" |

Examples:
- "Session `sess_abc123` is under way; spent $0.15 so far."
- "Weighing anchor and preparing handoff to Codex."
- "Reconvening from handoff episode `ep_def456` (cost: $0.11)."
- "Logbook shows 5 legs; total spend $0.62."

---

## Invariants & Verification

### Immutability Guarantees

1. **Session records are append-only.** Once a session is minted and enters "working," its ID, owner, and scope are immutable. The session can be closed or scuttled, but not edited mid-flight.
2. **Handoff episodes are immutable.** Once written, an episode's transcript hash, cost, and lineage chain are permanent. A new episode can be appended; the old one is never overwritten.
3. **Notes are immutable.** Identical to ADR-0007: notes can be added to a working session; once the session closes, notes are locked. Corrections are written as new notes.

### Harness Isolation

1. **One session per active harness per agent.** An agent cannot have two concurrent sessions in Claude Code. It *can* have a working session in Claude Code and a separate completed session in Codex; resumption bridges them.
2. **Transcript isolation.** Each harness owns its transcript fragment. The daemon does not store the full transcript; it stores a Blake3 hash and a sanitized excerpt. The harness retains the full transcript locally.
3. **MCP & tool scope isolation.** A harness enforces the declared scope before calling the daemon. The daemon's "Door" does not re-check the tool name; it assumes the harness is honest (ADR-0120, TCB boundary).

### Testing & Validation

Tests should verify:

- **Session lifecycle transitions.** A session can be minted, transition through working/stalled/closed/scuttled states, and never revert.
- **Handoff capsule creation.** When a session closes with a handoff intent, the daemon creates an immutable episode with correct lineage.
- **Resumption capsule compilation.** Given a handoff episode and a target harness, the daemon produces a valid resumption capsule with restored capabilities and lineage.
- **Permission enforcement.** A session with sandbox constraints properly gates tool calls. A session with MCP scope filtering correctly rejects tools outside the scope.
- **Accounting flow.** Cost accrual flows from the harness to the session to the AgentNode ledger correctly.
- **Stalled detection.** Sessions without heartbeat reports within `2 × ttl` transition to "becalmed" state.

---

## Future Seams

This design assumes future extensions without breaking the core:

1. **Harbor federation** (ADR seam): Sessions scoped to a harbor can be queried across federated daemons.
2. **Autonomous resumption** (ADR seam): Beacon can schedule automatic resumption on a cadence or event.
3. **Reputation ledger** (ADR seam): Completion receipts can feed into an outcome predictor (not yet designed).
4. **The phone** (ADR seam): A thin Relay-carried surface can display session state and trigger resumption from mobile.

None of these require changes to the core session spine. They are pure surface additions.

---

## Summary

Port Daddy sessions are **durable persons** that:

- Route work across Claude/Codex/PD harness boundaries via immutable handoff episodes.
- Preserve immutable lineage, transcripts (hashed), and cost accounting at the daemon level.
- Travel with declared capabilities (MCP, sandboxes, tools, Chromium, caches) attached to an AgentNode profile.
- Are created and resumed through the daemon's Door (identity, capability, rent check).
- Are observed from a single operator pane (Beacon) with timeline, spend, and lineage visibility.
- Remain first-class work atoms in Port Daddy's six-plane model (Plane 1 Truth, indexed like roadmap items and claims).

When a session is promoted to a durable agent, that agent can be re-invoked by name, scheduled, or resumed from any compatible harness — with zero manual re-seeding and full lineage provenance preserved.
