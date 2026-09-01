# The Olog Library Program

A 12-week practical program for building a personal library of ontology logs (ologs) and a functor search tool. This is not a course in category theory. It is a structured investment in a reusable knowledge asset that compounds over time.

**Start date:** Whenever you read this.
**Time commitment:** 3-5 hours per week, interleaved with normal work.
**Output:** A directory of validated ologs, a functor search script, and the muscle memory to model any new domain in 30 minutes.

---

## 1. Why Build an Olog Library?

Port Daddy coordinates agents. Agents do work across many domains: auth systems, build pipelines, database migrations, test suites, deployment flows. Every time you encounter a new domain, you currently start from scratch — reading code, asking questions, building a mental model.

An olog library changes this. When you model a domain as an olog, you make its structure explicit: what the types are, how they relate, what invariants hold. That olog is reusable. But the real payoff is not reuse within a single domain — it is **functor equivalence across domains**.

The insight: a CI pipeline and a cooking recipe have the same structure. They are both DAGs of dependent steps with typed inputs and outputs, where order matters and failure at any step halts downstream work. If you solve the scheduling problem for CI pipelines, you have solved it for cooking recipes, manufacturing workflows, and academic course prerequisites. The olog makes this equivalence explicit and searchable.

**The competitive advantage for Port Daddy specifically:** An orchestrator that carries an olog library can recognize when a new task is structurally equivalent to a previously-solved task. It does not need to re-derive the decomposition, the coordination pattern, or the merge strategy. It looks up the functor, applies the mapping, and executes. Orchestrators without this capability treat every task as novel. That is the arbitrage.

**The learning curve:** The first olog takes 2 hours. The second takes 1 hour. By the tenth, you are modeling new domains in 30 minutes, and you start seeing functors everywhere. The compound interest is real.

---

## 2. The 12-Week Program

### Weeks 1-2: Foundation — Model What You Know

The goal is to build two ologs from domains where you already know the ground truth, so you can verify the olog is correct by inspection.

#### Exercise 1: Port Daddy Core as an Olog

Model Port Daddy's coordination kernel. You know this system deeply — every type, every invariant. This is the "hello world."

**Start with these types:**

| Type | Label |
|------|-------|
| Agent | "an agent" |
| Session | "a session" |
| Note | "a note" |
| FileClaim | "a file claim" |
| Lock | "a lock" |
| Port | "a port assignment" |
| Identity | "a semantic identity" |

**Identify the arrows (all must be functional):**

```
a session    --is owned by-->       an agent          (functional: each session has exactly one agent)
a note       --belongs to-->        a session         (functional: each note belongs to exactly one session)
a file claim --was made in-->       a session         (functional: each file claim belongs to one session)
a file claim --targets-->           a file path       (functional: each claim targets one path)
a lock       --is held by-->        an agent          (functional: each lock has exactly one owner)
a port assignment --is claimed by--> a semantic identity (functional: deterministic hash)
an agent     --has as identity-->   a semantic identity (functional: each agent has one identity)
a session    --is in phase-->       a session phase   (functional: each session is in exactly one phase)
```

**Check for non-functional relationships that need spans:**

- An agent can have many sessions (one-to-many). This is fine — the arrow goes the other direction: session --> agent.
- A session can have many notes (one-to-many). Same: note --> session.
- An agent can hold many locks. Same: lock --> agent.

**Declare path equivalences:**

```
Path equivalence 1:
  a note --belongs to--> a session --is owned by--> an agent
  =
  a note --was written by--> an agent

  (Every note's session's owner IS the agent who wrote the note.)
  Verify: Pick 3 notes from your SQLite DB. Trace both paths. Do they arrive at the same agent?
```

```
Path equivalence 2:
  a file claim --was made in--> a session --is owned by--> an agent
  =
  a file claim --was claimed by--> an agent

  (The agent who owns the session is the agent who made the file claim.)
```

**Validation checklist:**
- [ ] Read each arrow aloud: "a session is owned by an agent" — true?
- [ ] Every arrow is functional — no element in the source maps to zero or multiple targets?
- [ ] Path equivalences checked against real data in `port-registry.db`?

Save the result as `ologs/port-daddy-core.json`.

#### Exercise 2: A Second Domain You Know

Pick something you have built or worked with extensively. Good candidates:

- **Git's object model**: commits, trees, blobs, refs, branches. A commit has exactly one tree. A tree entry points to exactly one object. A branch points to exactly one commit.
- **OAuth 2.0 flow**: clients, authorization codes, access tokens, refresh tokens, scopes. An authorization code was issued to exactly one client. An access token was derived from exactly one authorization code.
- **A task scheduler**: tasks, dependencies, workers, queues, results. A task is assigned to exactly one worker. A result belongs to exactly one task.

Build the olog. Validate it. Save as `ologs/<domain>.json`.

**Deliverable for Weeks 1-2:** Two validated ologs in `ologs/`, both hand-verified against real data or lived experience.

---

### Weeks 3-4: Functor Discovery — Find Your First Equivalence

Now look at your two ologs side by side. Is there a structure-preserving map from one to the other (or between substructures)?

#### Exercise 3: Compare Your Two Ologs

Lay out both ologs. For each type in olog A, ask: "Is there a type in olog B that plays the same structural role?"

If you modeled Port Daddy and Git:

| Port Daddy | Git | Why |
|-----------|-----|-----|
| a session | a branch | Both are scoped units of work with a lifecycle |
| a note | a commit | Both are immutable, append-only records of activity |
| a file claim | a tree entry | Both declare which files are relevant to a unit of work |
| an agent | a ref (HEAD) | Both point to the "current" unit of work |

Now check: do the arrows map? If `session --is owned by--> agent` maps to `branch --is pointed to by--> ref`, is the structure preserved? Does the arrow's directionality match? Is functionality preserved?

If some arrows map and others don't, you have a **partial functor**. That is still valuable — it tells you which parts of the structure are shared and where the domains diverge.

#### Exercise 4: A Third Domain, Deliberately Chosen

Pick a third domain specifically because you suspect it might be structurally similar to one of your first two. For example:

- If you modeled a task scheduler, try a build system (Make, Bazel). Both are DAG executors.
- If you modeled OAuth, try session management in a web framework. Both are identity lifecycle managers.
- If you modeled Port Daddy, try Kubernetes pod lifecycle. Both coordinate workers with health checks and crash recovery.

Model it as an olog. Then search for functors between it and your existing ologs.

**Deliverable for Weeks 3-4:** 1 documented functor (or partial functor) between two of your three ologs, written in plain English with a type-by-type mapping table. Saved as `ologs/functors/functor-<A>-to-<B>.json`.

---

### Weeks 5-6: LLM-Assisted Construction

By now you have built 3 ologs by hand. You know the failure modes: non-functional arrows, false path equivalences, kitchen-sink type lists. Time to see if Claude can accelerate the process.

#### Exercise 5: LLM Olog Proposal

Pick a new domain you are less familiar with. Give Claude this prompt:

```
Given the following domain description, construct an olog.

DOMAIN: [paste a 2-3 paragraph description of a system]

SCHEMA FORMAT:
{
  "name": "...",
  "version": "1.0",
  "types": [{ "id": "...", "label": "a ..." }],
  "arrows": [{ "source": "...", "target": "...", "label": "..." }],
  "pathEquivalences": [{ "paths": [["type1", "arrow1", "type2"], ["type1", "arrow2", "type3", "arrow3", "type2"]], "justification": "..." }]
}

RULES:
1. Every arrow must be functional (each source element maps to EXACTLY ONE target element).
2. Many-to-many relationships must be decomposed into spans with an intermediate type.
3. Every arrow label must form a readable sentence: "[source label] [arrow label] [target label]".
4. For each path equivalence, provide 3 concrete examples proving it holds.
5. Aim for 8-15 types. If you need more, decompose into sub-ologs.

EXISTING OLOGS FOR REFERENCE:
[paste 1-2 of your validated ologs as JSON]
```

**Evaluate the output:**

| Check | Pass/Fail | Notes |
|-------|-----------|-------|
| Types are singular indefinite noun phrases? | | |
| All arrows are functional? | | |
| Many-to-many decomposed into spans? | | |
| Arrow labels form readable sentences? | | |
| Path equivalences verified with examples? | | |
| No orphan types? | | |

Claude will likely get types and arrows 80% right. It will probably hallucinate at least one path equivalence. Fix the errors and save the corrected olog.

#### Exercise 6: Build a Validation Script

Write a script (`scripts/validate-olog.ts` or `scripts/validate-olog.py`) that checks:

1. **Schema validity**: Required fields present, correct types
2. **Label format**: Every type label starts with "a " or "an "
3. **Functional arrows**: No duplicate (source, label) pairs (would indicate non-functionality)
4. **No dangling references**: Every arrow's source and target exist in the types list
5. **No orphan types**: Every type appears in at least one arrow
6. **Path equivalence consistency**: Every type/arrow referenced in a path equivalence exists
7. **Identity arrows**: Implicit (every type has one), but warn if explicitly declared (redundant)

This does NOT verify semantic correctness (whether the arrow IS functional in the real domain) — only structural well-formedness. Semantic validation requires human review or instance data.

```bash
# Usage:
node scripts/validate-olog.js ologs/port-daddy-core.json
# Output: VALID (7 types, 8 arrows, 2 path equivalences)
#    or:  INVALID — arrow "speaks" from "a person" to "a language" is not functional (span needed)
```

**Deliverable for Weeks 5-6:** 3 new LLM-proposed, human-corrected ologs. A working validation script that catches structural errors.

---

### Weeks 7-8: Task Decomposition Application

This is where ologs start paying rent. Instead of modeling existing systems, you model **work you are about to do**.

#### Exercise 7: Pre-Task Olog

Pick a real coding task you are about to start. Before writing any code, model the task as an olog:

- What are the types involved? (files, modules, data structures, API endpoints, test cases)
- What are the functional relationships between them?
- What invariants must hold when you are done?

Example: "Add webhook retry logic to Port Daddy."

```
Types:
  W = "a webhook subscription"
  D = "a delivery attempt"
  E = "an event"
  R = "a retry policy"
  O = "a delivery outcome"

Arrows:
  D --was triggered by--> E    (each delivery attempt is for one event)
  D --targets-->          W    (each delivery attempt goes to one webhook)
  D --resulted in-->      O    (each attempt has exactly one outcome: success, failure, timeout)
  D --follows-->          R    (each attempt follows one retry policy)
  W --has-->              R    (each webhook has one retry policy)

Path equivalence:
  D --targets--> W --has--> R  =  D --follows--> R
  (The retry policy a delivery follows IS the policy of its target webhook.)
```

Now do the task. After finishing, revisit the olog.

#### Exercise 8: Post-Task Comparison

After completing the task, ask:

- Did the olog capture the actual structure? Were there types you missed?
- Did you introduce types that weren't in the olog? (Hidden complexity you didn't anticipate.)
- Were the path equivalences actually enforced in your implementation?
- Would the olog have helped you decompose the task for multiple agents?

Write a short comparison (5-10 bullet points) and save it alongside the olog.

Also try the reverse: take a completed task from your git history (pick a meaty one — a PR with 5+ files changed). Model it as an olog retroactively. How does it compare to the pre-task olog from Exercise 7?

**Deliverable for Weeks 7-8:** 2 task ologs with before/after comparison notes. An honest assessment of whether the pre-task olog was useful or just ceremony.

---

### Weeks 9-10: Functor Search at Scale

You now have ~8 ologs. Time to build the search tool.

#### Exercise 9: Functor Search Script

Build `scripts/functor-search.ts` (or `.py`). The algorithm:

**Input:** A query olog Q and a library directory of ologs.

**Output:** Candidate functors ranked by structural coverage.

**Algorithm (brute force, sufficient for <15 types per olog):**

```
For each library olog L:
  1. Generate all possible type mappings: f: types(Q) --> types(L)
     (This is |types(L)|^|types(Q)| candidates — for 10x10, that's 10 billion.
      Too many. Use constraint propagation instead.)

  2. BETTER: Use constraint propagation (AC-3 style):
     a. For each type t in Q, compute candidate targets in L:
        candidates(t) = { l in types(L) | in-degree(t) compatible with in-degree(l)
                          AND out-degree(t) compatible with out-degree(l) }
     b. For each arrow a: s-->t in Q, prune candidates:
        For each candidate mapping s->s', t->t':
          Keep only if there exists an arrow a': s'-->t' in L
     c. Iterate until no more pruning occurs
     d. Enumerate remaining consistent mappings

  3. Score each candidate functor:
     - arrows_mapped / total_arrows_in_Q  (coverage)
     - path_equivalences_preserved / total_path_equivalences  (fidelity)
     - Rank by coverage * fidelity

  4. Return top-K candidates with mapping tables
```

For 8 ologs of 8-15 types each, this completes in under 1 second. You do not need anything fancier until you have 50+ ologs with 30+ types each.

**Output format:**

```
Query: "webhook-retry" (5 types, 5 arrows, 1 path equivalence)

Match 1: "ci-pipeline" — coverage 80%, fidelity 100%
  webhook subscription  -->  pipeline config
  delivery attempt      -->  build step
  event                 -->  trigger (push/PR)
  retry policy          -->  retry config
  delivery outcome      -->  step result

Match 2: "email-queue" — coverage 60%, fidelity 100%
  delivery attempt      -->  email send attempt
  event                 -->  email event
  delivery outcome      -->  send result
  [no match for webhook subscription, retry policy]
```

**Deliverable for Weeks 9-10:** A working functor search script. Run it against your library. Document 2-3 non-obvious matches it finds.

---

### Weeks 11-12: Integration and Retrospective

#### Exercise 10: Integration Prototype

Pick one integration point and build it:

**Option A: Jury-rig integration.** When the Sensemaker produces a problem description, pass it through the LLM olog prompt from Exercise 5. Store the resulting olog alongside the task. When the Curator crystallizes a skill, include the task's olog in the skill metadata. Over time, skills accumulate ologs, and functor search can match new tasks to existing skills by structure, not just by keyword or embedding similarity.

**Option B: Port Daddy session metadata.** When `pd begin` starts a session, optionally attach an olog (as JSON in session metadata). When `pd salvage` recovers a dead agent's work, the olog provides structural context about what the agent was trying to do — not just the purpose string, but the actual type structure of the task.

**Option C: Fleet agent enhancement.** A fleet agent (the "librarian" or "sensemaker") periodically scans recent sessions and their notes, proposes ologs for completed work, and runs functor search to find cross-project structural equivalences. It writes its findings as notes.

Build one of these. It does not need to be polished — a prototype that demonstrates the pipeline is enough.

#### Retrospective

After 12 weeks, write an honest retrospective answering:

1. **Which ologs were useful?** Did any olog save you time on a real task? Which ones were shelf-ware?
2. **Which functors were surprising?** Did the search tool find equivalences you didn't see? Were they actionable?
3. **Where did the process break down?** Was modeling too slow? Were LLM proposals too noisy? Did path equivalences take too long to verify?
4. **What is the right granularity?** Are 8-15 type ologs the sweet spot, or do you want bigger/smaller?
5. **Would you recommend this to another developer?** Under what conditions?

Save the retrospective as `ologs/RETROSPECTIVE.md`.

**Deliverable for Weeks 11-12:** One integration prototype (working code). A written retrospective.

---

## 3. Functor Equivalence Classes — Where the Arbitrage Lives

These are concrete problem domains where solving one problem gives you the solution to all functor-equivalent problems. For each, the "K value" estimates how many distinct systems in the wild share this structure.

### 1. DAG Scheduling (K ~ 50+)

**Structure:** A directed acyclic graph of tasks with typed inputs/outputs, dependency edges, and a scheduler that respects topological order.

**Equivalent domains:**
- CI/CD pipelines (GitHub Actions, GitLab CI, Jenkins)
- Build systems (Make, Bazel, Gradle, Webpack)
- Data pipelines (Airflow, Dagster, Prefect)
- Recipe execution (cooking, chemistry protocols)
- Course prerequisites (academic catalogs)
- Project management (Gantt charts, critical path)
- Compiler passes (optimization pipeline)

**Functor in plain language:** A GitHub Actions workflow and a Makefile are the same thing. Steps map to targets. Dependencies map to prerequisites. Outputs map to build artifacts. If you have solved parallel execution with dependency respect for one, you have solved it for all.

### 2. Identity Lifecycle (K ~ 30+)

**Structure:** An entity is created, authenticated, authorized for scoped actions, refreshed periodically, and eventually revoked or expired.

**Equivalent domains:**
- OAuth 2.0 / OIDC flows
- Session management (web frameworks)
- API key lifecycle
- Certificate management (TLS, code signing)
- Agent registration in Port Daddy
- Kerberos ticket lifecycle
- JWT token lifecycle
- Subscription billing (trial -> active -> expired -> renewed)

**Functor in plain language:** An OAuth access token and a Port Daddy agent registration have the same lifecycle. Both are created, both have TTLs, both can be refreshed, both are revoked on expiry. The refresh mechanism for one maps to the heartbeat mechanism for the other.

### 3. CRUD + Ownership (K ~ 100+)

**Structure:** Entities are created, read, updated, deleted. Each entity is owned by exactly one principal. Access control is a function from (principal, entity, action) to boolean.

**Equivalent domains:**
- REST APIs (virtually all of them)
- File systems (files, directories, permissions)
- Database tables with row-level security
- CMS content management
- Project management tools (Jira, Linear, Asana)
- Social media posts and comments
- Shopping carts and order management

**Functor in plain language:** A blog post and a Jira ticket are the same thing. Both have an owner. Both support CRUD operations. Both have access control. The fields differ but the structure is identical. If you build a generic CRUD framework once, you never build it again — the olog makes this explicit instead of hoping your developers notice the pattern.

### 4. Verification Chains (K ~ 20+)

**Structure:** An artifact is produced, then passes through a sequence of verification steps. Each step either approves (passes to next step) or rejects (returns to producer). The chain has a terminal approval state.

**Equivalent domains:**
- Code review (PR -> review -> approval -> merge)
- Test suites (write code -> unit tests -> integration tests -> deploy)
- QA workflows (develop -> QA -> staging -> production)
- Document approval (draft -> review -> legal -> sign)
- Insurance underwriting (application -> assessment -> approval -> policy)
- Academic peer review (submission -> review -> revision -> acceptance)

**Functor in plain language:** A pull request review and an insurance application are the same thing. Both start as a proposal, pass through a sequence of assessments by different reviewers, can be returned for revision, and terminate in approval or rejection. The domain vocabulary differs but the state machine is identical.

### 5. State Machines with Rollback (K ~ 25+)

**Structure:** An entity transitions through states. Some transitions are reversible. Some states are terminal. Rollback restores the previous state and may trigger compensating actions.

**Equivalent domains:**
- Deployment pipelines (deploy -> verify -> rollback or promote)
- Database migrations (up -> verify -> down or continue)
- Infrastructure provisioning (Terraform plan -> apply -> destroy)
- Order fulfillment (placed -> shipped -> delivered -> returned)
- Saga pattern in microservices
- Transaction commit protocols (prepare -> commit -> rollback)

**Functor in plain language:** A Terraform apply and a database migration are the same thing. Both change state, both have a verification step, both support rollback with compensating actions, both have a "committed" terminal state after which rollback is expensive. If you build robust rollback handling once, every deployment system benefits.

### 6. Pub/Sub Event Routing (K ~ 15+)

**Structure:** Publishers emit events to channels. Subscribers listen on channels. Events are delivered to all matching subscribers. Delivery has at-least-once or at-most-once semantics.

**Equivalent domains:**
- Message queues (RabbitMQ, Kafka, SQS)
- Webhook systems
- Event-driven architectures
- Port Daddy's messaging module
- Operating system signals
- DOM event listeners in browsers
- Database triggers and notifications

**Functor in plain language:** A Kafka topic and a Port Daddy channel are the same thing. Producers map to publishers. Consumers map to subscribers. Partitions map to channels. The delivery guarantee semantics are a parameter, not a structural difference.

### 7. Resource Pools with Contention (K ~ 20+)

**Structure:** A finite pool of resources. Requesters acquire resources (blocking if unavailable). Resources are held for a duration, then released. Contention is managed by queuing, priority, or timeout.

**Equivalent domains:**
- Database connection pools
- Thread pools
- Port assignment (Port Daddy itself)
- Parking lots and hotel rooms
- Mutex/semaphore systems
- Cloud instance provisioning
- Library book checkout

**Functor in plain language:** A database connection pool and Port Daddy's port assignment are the same thing. Both manage a finite set of resources. Both handle contention (what happens when two requesters want the same resource?). Both have TTL-based expiry. Both have cleanup for abandoned resources.

---

## 4. The Olog File Format

All ologs are stored as JSON in an `ologs/` directory. This format is designed to be human-readable, machine-validatable, and searchable by the functor search tool.

### Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["name", "version", "types", "arrows"],
  "properties": {
    "name": {
      "type": "string",
      "description": "Kebab-case identifier, unique in the library"
    },
    "version": {
      "type": "string",
      "pattern": "^\\d+\\.\\d+$"
    },
    "description": {
      "type": "string",
      "description": "1-2 sentence summary of what this olog models"
    },
    "domain": {
      "type": "string",
      "description": "High-level category: 'coordination', 'auth', 'data-pipeline', etc."
    },
    "source": {
      "type": "string",
      "enum": ["hand-built", "llm-proposed", "llm-proposed-human-verified", "extracted-from-code"],
      "description": "How this olog was constructed"
    },
    "types": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "label"],
        "properties": {
          "id": { "type": "string", "pattern": "^[a-z][a-z0-9_]*$" },
          "label": { "type": "string", "description": "Singular indefinite noun phrase: 'a session', 'an agent'" },
          "description": { "type": "string" },
          "isPrimitive": { "type": "boolean", "description": "True for 'a string', 'a number', 'a date', etc." }
        }
      }
    },
    "arrows": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["source", "target", "label"],
        "properties": {
          "id": { "type": "string", "description": "Optional stable identifier for the arrow" },
          "source": { "type": "string", "description": "id of source type" },
          "target": { "type": "string", "description": "id of target type" },
          "label": { "type": "string", "description": "Verb phrase: 'is owned by', 'has as birthplace'" },
          "isInjective": { "type": "boolean", "description": "True if the arrow is one-to-one (not just many-to-one)" },
          "isSpanLeg": { "type": "boolean", "description": "True if this arrow is part of a span decomposition" }
        }
      }
    },
    "pathEquivalences": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["path1", "path2"],
        "properties": {
          "path1": {
            "type": "array",
            "items": { "type": "string" },
            "description": "Alternating type and arrow ids: [type1, arrow1, type2, arrow2, type3]"
          },
          "path2": {
            "type": "array",
            "items": { "type": "string" },
            "description": "Same format as path1, must start and end at same types"
          },
          "justification": { "type": "string" },
          "verifiedExamples": {
            "type": "array",
            "items": { "type": "string" },
            "description": "3+ concrete examples showing equivalence holds"
          }
        }
      }
    },
    "metadata": {
      "type": "object",
      "properties": {
        "created": { "type": "string", "format": "date" },
        "author": { "type": "string" },
        "relatedOlogs": { "type": "array", "items": { "type": "string" } },
        "tags": { "type": "array", "items": { "type": "string" } }
      }
    }
  }
}
```

### Example: Port Daddy Core

```json
{
  "name": "port-daddy-core",
  "version": "1.0",
  "description": "Core coordination kernel: agents, sessions, notes, locks, ports",
  "domain": "coordination",
  "source": "hand-built",
  "types": [
    { "id": "agent", "label": "an agent" },
    { "id": "session", "label": "a session" },
    { "id": "note", "label": "a note" },
    { "id": "file_claim", "label": "a file claim" },
    { "id": "lock", "label": "a lock" },
    { "id": "port_assignment", "label": "a port assignment" },
    { "id": "identity", "label": "a semantic identity" },
    { "id": "phase", "label": "a session phase" },
    { "id": "file_path", "label": "a file path", "isPrimitive": true }
  ],
  "arrows": [
    { "source": "session", "target": "agent", "label": "is owned by" },
    { "source": "note", "target": "session", "label": "belongs to" },
    { "source": "file_claim", "target": "session", "label": "was made in" },
    { "source": "file_claim", "target": "file_path", "label": "targets" },
    { "source": "lock", "target": "agent", "label": "is held by" },
    { "source": "port_assignment", "target": "identity", "label": "is claimed by" },
    { "source": "agent", "target": "identity", "label": "has as identity" },
    { "source": "session", "target": "phase", "label": "is in" }
  ],
  "pathEquivalences": [
    {
      "path1": ["note", "belongs to", "session", "is owned by", "agent"],
      "path2": ["note", "was written by", "agent"],
      "justification": "Every note is written in a session, and that session's owner is the note's author. Verified against port-registry.db.",
      "verifiedExamples": [
        "Note 'fixed auth bug' in session owned by agent fleet-qa -> fleet-qa wrote it",
        "Note 'progress update' in session owned by agent spark-001 -> spark-001 wrote it",
        "Note 'test results' in session owned by agent gardener -> gardener wrote it"
      ]
    }
  ],
  "metadata": {
    "created": "2026-03-30",
    "author": "erich",
    "tags": ["port-daddy", "coordination", "multi-agent", "sessions"]
  }
}
```

### Functor File Format

Store discovered functors in `ologs/functors/`:

```json
{
  "name": "sessions-to-git-branches",
  "sourceOlog": "port-daddy-core",
  "targetOlog": "git-object-model",
  "coverage": 0.75,
  "fidelity": 1.0,
  "typeMapping": {
    "session": "branch",
    "note": "commit",
    "file_claim": "tree_entry",
    "agent": "head_ref"
  },
  "arrowMapping": {
    "note.belongs_to.session": "commit.is_on.branch",
    "file_claim.was_made_in.session": "tree_entry.belongs_to.tree"
  },
  "unmappedTypes": ["lock", "port_assignment", "identity", "phase"],
  "notes": "Partial functor. The lifecycle structure maps well but PD has coordination primitives (locks, ports) that git does not.",
  "discovered": "2026-04-15",
  "method": "manual"
}
```

### Directory Structure

```
ologs/
  port-daddy-core.json
  git-object-model.json
  oauth2-flow.json
  ci-pipeline.json
  ...
  functors/
    sessions-to-git-branches.json
    oauth2-to-agent-lifecycle.json
    ...
  RETROSPECTIVE.md
```

---

## 5. Tools and Resources

### CQL (Categorical Query Language)

**What it is:** A tool from categoricaldata.net that directly implements ologs as database schemas with categorical semantics. It can compute pushouts, pullbacks, and limited functor search.

**When to use it:** When you want formal verification that your olog is consistent, or when you want to mechanically derive a SQL schema from an olog.

**Getting started:**
```bash
# Download the JAR from https://categoricaldata.net/download
# Requires Java 11+
java -jar cql.jar
```

CQL uses its own declarative language. You define a schema (olog), an instance (data), and CQL computes migrations between schemas. The sigma/delta/pi operations correspond to functor push/pull.

### Catlab.jl

**What it is:** A Julia library for applied category theory. Supports C-Sets (functor categories), homomorphism search, and visualization.

**When to use it:** When you need computational functor search over large ologs, or when you want to visualize olog structure as graphs.

**Getting started:**
```julia
using Catlab, Catlab.CategoricalAlgebra, Catlab.Graphs

# Define a schema (olog skeleton)
@present SchSession(FreeSchema) begin
  Agent::Ob
  Session::Ob
  Note::Ob
  owned_by::Hom(Session, Agent)
  belongs_to::Hom(Note, Session)
end
```

### Simple TypeScript Validation Script

For day-to-day use, you do not need CQL or Catlab. A 100-line TypeScript script handles validation:

```typescript
// scripts/validate-olog.ts
import { readFileSync } from 'fs';

interface Olog {
  name: string;
  types: { id: string; label: string }[];
  arrows: { source: string; target: string; label: string }[];
  pathEquivalences?: { path1: string[]; path2: string[] }[];
}

function validate(olog: Olog): string[] {
  const errors: string[] = [];
  const typeIds = new Set(olog.types.map(t => t.id));

  // Check labels
  for (const t of olog.types) {
    if (!t.label.match(/^an? /)) {
      errors.push(`Type "${t.id}" label must start with "a " or "an ": got "${t.label}"`);
    }
  }

  // Check arrow references
  for (const a of olog.arrows) {
    if (!typeIds.has(a.source)) errors.push(`Arrow "${a.label}": source "${a.source}" not in types`);
    if (!typeIds.has(a.target)) errors.push(`Arrow "${a.label}": target "${a.target}" not in types`);
  }

  // Check orphan types
  const referenced = new Set<string>();
  for (const a of olog.arrows) { referenced.add(a.source); referenced.add(a.target); }
  for (const t of olog.types) {
    if (!referenced.has(t.id) && !t.isPrimitive) {
      errors.push(`Type "${t.id}" is orphaned (not referenced by any arrow)`);
    }
  }

  // Check path equivalence references
  for (const pe of (olog.pathEquivalences || [])) {
    for (const step of [...pe.path1, ...pe.path2]) {
      if (!typeIds.has(step) && !olog.arrows.some(a => a.label === step)) {
        // It could be a type or an arrow label — check both
      }
    }
  }

  return errors;
}

// Run
const file = process.argv[2];
if (!file) { console.error('Usage: npx tsx scripts/validate-olog.ts <file.json>'); process.exit(1); }
const olog = JSON.parse(readFileSync(file, 'utf8'));
const errors = validate(olog);
if (errors.length === 0) {
  console.log(`VALID: ${olog.name} (${olog.types.length} types, ${olog.arrows.length} arrows)`);
} else {
  console.log(`INVALID: ${errors.length} error(s)`);
  errors.forEach(e => console.log(`  - ${e}`));
  process.exit(1);
}
```

### Claude Prompt Template for Olog Proposals

Save this as `ologs/PROMPT-TEMPLATE.md` and paste it into Claude when you want an olog proposed:

```
I need you to construct an olog (ontology log) for the following domain.

DOMAIN DESCRIPTION:
[paste here]

OUTPUT FORMAT (JSON):
{
  "name": "kebab-case-name",
  "version": "1.0",
  "description": "1-2 sentence summary",
  "domain": "category",
  "source": "llm-proposed",
  "types": [{ "id": "snake_case", "label": "a/an singular noun phrase" }],
  "arrows": [{ "source": "type_id", "target": "type_id", "label": "verb phrase" }],
  "pathEquivalences": [{
    "path1": ["type", "arrow_label", "type", ...],
    "path2": ["type", "arrow_label", "type", ...],
    "justification": "why these paths are equivalent",
    "verifiedExamples": ["example 1", "example 2", "example 3"]
  }]
}

CONSTRAINTS:
1. Every arrow MUST be functional: each element of the source type maps to EXACTLY ONE element of the target type.
2. If a relationship is many-to-many, decompose it into a SPAN: introduce an intermediate type with two functional arrows.
3. If a relationship is one-to-many (e.g., "a person has many addresses"), the arrow goes the OTHER direction: "an address belongs to a person."
4. Every arrow label must form a grammatically correct sentence: "[source label] [arrow label] [target label]."
5. Aim for 8-15 types. If you need more, say so and suggest decomposition.
6. For every path equivalence, the 3 verified examples must be CONCRETE, not hypothetical.
7. Do NOT declare a path equivalence unless you are certain it holds for ALL instances.
```

---

## 6. Monthly Maintenance (Post-Program)

After the 12 weeks, the olog library should be a living asset, not a completed project.

### Weekly (15 minutes)

- When you start a non-trivial task, ask: "Does an olog for this domain exist in my library?" If yes, review it. If no, consider building one (only if the task is complex enough to benefit).
- Add 1-2 ologs per week from real work. Favor domains you will encounter again.

### When Starting a New Project

- Run functor search against your library. If a match exists, start from the mapped structure instead of from scratch.
- If no match exists, build the olog as part of initial design. It replaces or supplements an architecture diagram.

### Monthly (30 minutes)

- Run the validation script across all ologs. Fix any that have drifted from the schema.
- Review the functor index. Are there new cross-domain equivalences you missed?
- Delete ologs that were never useful (be ruthless — dead ologs obscure live ones).

### Quarterly (1 hour)

- Update the retrospective. What worked this quarter? What didn't?
- Share anonymized ologs publicly if appropriate. The olog captures structure, not proprietary logic. A "ci-pipeline" olog is not a trade secret — but the functor mapping it to your internal deployment system might be.
- Evaluate whether the functor search tool needs improvement. At 20+ ologs, brute force may slow down. Consider adding heuristic pre-filtering by domain tag.

### Growth Targets

| Milestone | Library Size | Expected Date |
|-----------|-------------|---------------|
| Foundation | 3 ologs | End of Week 2 |
| First functor | 3 ologs, 1 functor | End of Week 4 |
| LLM workflow | 6 ologs, validation script | End of Week 6 |
| Task application | 8 ologs | End of Week 8 |
| Functor search | 8 ologs, search tool | End of Week 10 |
| Integration | 10+ ologs, 1 integration | End of Week 12 |
| Steady state | 20+ ologs, 5+ functors | Month 6 |
| Compound returns | 40+ ologs, functor search is faster than manual design | Month 12 |

---

## Appendix: Quick Reference Card

**Is it a type?** Can you write "a [noun phrase]" and have it refer to any member of the class? Yes -> type. No -> probably an instance or an attribute.

**Is the arrow functional?** Does every element in the source map to exactly one element in the target? Yes -> valid arrow. No -> decompose into a span.

**Is the path equivalence real?** Test it with 3 concrete instances. If any instance produces different results via the two paths, the equivalence is false.

**How many types?** 8-15 per olog. If you have more, decompose into sub-ologs connected by functors.

**When is an olog worth building?** When you will encounter the domain again, when multiple agents need to coordinate within the domain, or when you suspect the domain is structurally equivalent to one you have already modeled.

**When is an olog NOT worth building?** For one-off tasks, for domains with fewer than 4 types, or when the relationships are so simple that a 3-sentence description suffices.

---

*This document is a program, not a textbook. Every section ends with something to build. Start with Exercise 1 — model Port Daddy — and the rest follows.*
