# Plan: The Port Daddy Semantic Token Graph

## Objective
Transform Port Daddy from a flat service registry into a **Reactive Semantic Token Graph**. This will enable AI agents to navigate the development environment through high-fidelity relationships between agents, skills, purposes, file regions, and code symbols.

## 🏗️ Backend Design: The Graph Core

### 1. Unified Edge Table
Move beyond fixed columns to a flexible relationship model. This allows for arbitrary connections like "Agent X has Skill Y" or "Function Z is a dependency of Service W."

```sql
CREATE TABLE graph_edges (
  source_id  TEXT NOT NULL, -- Format: 'type:id' (e.g., 'agent:cli-123')
  relation   TEXT NOT NULL, -- Relationship type (e.g., 'claims', 'knows', 'contains')
  target_id  TEXT NOT NULL, -- Format: 'type:id' (e.g., 'symbol:handleLogin')
  metadata   TEXT,          -- JSON for line ranges, confidence scores, etc.
  created_at INTEGER,
  PRIMARY KEY (source_id, relation, target_id)
);
```

### 2. Hierarchical Wildcard Engine
Implement a **Recursive Token Resolver**. When an agent queries `myapp:*`, the engine will:
1. Identify `myapp` as a project root.
2. Traverse all `contains` edges to find sub-tokens.
3. Return a unified result set across all matching semantic paths.

### 3. "Code Archaeology" Integration
Enhance `pd scan` to extract code symbols.
- **Surface Level**: Index exported functions and classes.
- **Deep Level**: Map `symbol:A --calls--> symbol:B`.
- **Constraint**: Port Daddy is NOT a full IDE indexer. It should store a **high-value summary** of the codebase structure to help agents avoid blind spots.

## 🔌 API & Discovery

### 1. The `pd discover` Command
Agents should no longer just "find ports." They should "discover capabilities."
- `pd discover --skill "typescript" --status "active"`: Find an available peer with specific expertise.
- `pd discover --path "src/auth.ts"`: See all agents/sessions involved in this file, including sub-file symbol claims.

### 2. Reactive Sub-graph Subscriptions
Current `pd watch` is channel-centric. New `pd watch` will be **Graph-centric**.
- `pd watch "symbol:processPayment:*"`: Be notified if any agent claims, modifies, or creates a relation to this symbol or its children.

## 🛳️ Harbors as Semantic Sandboxes
Harbors are no longer just "permission groups"; they are **Graph Projections**.
- **Context Isolation**: When an agent enters a Harbor, its queries are biased towards tokens within that Harbor's scope.
- **Resource Inheritance**: A Harbor can declare `provides(skill:postgres)`, and all agents within it gain that "ambient skill" automatically in the graph.

## 🧠 Autonomous Graph Expansion
Agents are not just passive inhabitants; they are **Graph Architects**.
- **Declaration API**: `POST /graph/declare { source: "agent:me", relation: "knows", target: "skill:stripe-api" }`.
- **Inference Rules**: PD will support lightweight rules, e.g., "If Agent X claims `file:A` and `file:A --contains--> symbol:B`, then Agent X implicitly `influences` symbol:B."

## 🎨 User-Facing Design (UI/UX)

### 1. The Swarm Map (Visualizer)
A new "Graph" tab in the PD Dashboard:
- **Force-Directed Graph**: Real-time visual layout of the swarm.
- **Heat Map Overlay**: Visual intensity for "hot" files or symbols (many claims/conflicts).
- **Relationship Filtering**: Toggle visibility of `calls`, `claims`, `is-a`, etc.

### 2. Semantic TUI
The `pd sessions` and `pd agents` commands will be upgraded to show **Relationship Previews**:
```bash
$ pd agents --identity "myapp:*"
ID              PROJECT    STATUS    RELATIONS
cli-123         myapp:api  busy      claims(symbol:handleLogin), knows(typescript)
worker-456      myapp:web  ready     claims(file:src/app.tsx)
```

## 🧠 Critical Collaboration & Constraints

### 1. Consistency vs. Performance
- **Risk**: Decomposing every function in a large codebase into SQLite will bloat the DB and slow down heartbeats.
- **Solution**: Use **Lazy Indexing**. Only "promote" a code symbol to a Graph Token if an agent explicitly interacts with it (claims it, mentions it in a note).

### 2. Semantic Ambiguity
- **Risk**: Agents might use different names for the same skill (e.g., `js` vs `javascript`).
- **Solution**: Implement a minimal **Synonym Registry** or use lightweight local embeddings (via Ollama/pd spawn) to normalize tokens.

## Implementation Phases

1. **Phase 1: Edge Foundation**: Create the `graph_edges` table and migrate existing sessions/claims to it.
2. **Phase 2: Wildcard Expansion**: Implement the Recursive Token Resolver for `pd discover`.
3. **Phase 3: Symbol Extraction**: Integrate a basic symbol extractor into `pd scan`.
4. **Phase 4: Visualizer**: Launch the Dashboard Graph View.
