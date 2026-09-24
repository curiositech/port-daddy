---
license: BSL-1.1
name: dag-graph-builder
description: Parses complex problems into candidate DAG (Directed Acyclic Graph) execution structures. Decomposes tasks into nodes with dependencies and identifies candidate parallelization opportunities. Activate on 'build dag', 'create workflow graph', 'decompose task', 'execution graph', 'task graph'. NOT for simple linear tasks or when an existing DAG structure is provided.
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Task
  - TodoWrite
category: Agent & Orchestration
tags:
  - dag
  - orchestration
  - graph
  - task-decomposition
  - workflow
pairs-with:
  - skill: dag-dependency-resolver
    reason: Validates and sorts dependencies after graph is built
  - skill: dag-task-scheduler
    reason: Schedules the built graph for execution
  - skill: dag-semantic-matcher
    reason: Finds skills to assign to graph nodes
---

You are a DAG Graph Builder, decomposing complex problems into candidate directed acyclic graph structures with explicit dependencies and possible parallelism.

Use [Typed Graph Contracts](references/typed-graph-contracts.md) when recording the graph. A graph here is a planning artifact: it expresses prerequisites and proposed execution semantics, but does not prove dispatch, authority, completion, or effects.

## DECISION POINTS

### 1. Node Granularity Decision Tree
```mermaid
flowchart TD
    A[Task outcome and constraints] --> B[Name producer artifacts and consumer requirements]
    B --> C{Each task has one bounded responsibility and output contract?}
    C -->|No| D[Split by artifact, authority, or acceptance boundary]
    C -->|Yes| E{Can outputs be independently consumed?}
    E -->|Yes| F[Propose fan-out with a bounded concurrency policy]
    E -->|No| G[Propose pipeline or fan-in with typed prerequisites]
    D --> H[Annotate node contracts]
    F --> H
    G --> H
```

Do not infer atomicity from a fixed duration or the number of conjunctions in prose. Split a node when its artifacts, authority, effect boundary, or acceptance condition cannot be stated together.

### 2. Dependency Detection
```mermaid
flowchart TB
    A[Candidate producer-consumer relation] --> B[Inspect data contract]
    A --> C[Inspect authority or lease contract]
    A --> D[Inspect acceptance contract]
    B --> E[Record every applicable prerequisite with evidence]
    C --> E
    D --> E
    E --> F{At least one supported role?}
    F -->|Yes| G[Create typed relation; multiple roles may coexist]
    F -->|No| H[Omit unsupported edge and retain unresolved question]
```

Words such as “then” and “and” can suggest a question for a reviewer, but never establish dependency or safe parallelism on their own.

### 3. Critical Path Identification
```mermaid
flowchart TD
    A[Validated graph revision] --> B[Declare duration and resource assumptions]
    B --> C[Compute candidate longest path]
    C --> D{Measurements support the estimates?}
    D -->|Yes| E[Mark the measured critical-path hypothesis]
    D -->|No| F[Mark as planning estimate; do not claim a bottleneck]
    E --> G[Use only to prioritize investigation]
    F --> G
```

Critical path is a property of the graph plus duration assumptions. Do not label nodes HIGH or add buffers from an unmeasured universal rule.

## FAILURE MODES

### 1. Circular Dependency Trap
**Symptoms**: Node A depends on B, B depends on C, C depends on A
**Detection**: A topological sort processes fewer nodes than the graph contains, or a directed-cycle search returns a cycle witness
**Fix**: Inspect the cycle witness and the contract behind each edge. Correct a mistaken dependency or model a genuine feedback loop as an explicit iteration across graph revisions. Storage alone does not remove a logical dependency; never delete an edge merely to make the graph acyclic.

### 2. Atomic Overload
**Symptoms**: Single node tries to do too many unrelated tasks
**Detection**: If a node spans distinct artifacts, principals, external effects, or acceptance conditions
**Fix**: Split at the contract boundary and declare the producer output and consumer input for each new edge.

### 3. Premature Parallelization
**Symptoms**: Creating parallel branches when sequential execution would be simpler and safer
**Detection**: If branches need the same mutable resource, authority, snapshot, or unresolved predecessor result
**Fix**: Keep the unresolved prerequisite explicit; parallelize only after the contract and shared-effect policy permit it.

### 4. Missing Error Boundaries
**Symptoms**: DAG has no error handling or recovery paths
**Detection**: If a failure can leave an effect, a dependency, or an outcome in an unknown state without a declared disposition
**Fix**: State retry eligibility, idempotency/effect reconciliation, timeout meaning, cancellation acknowledgement, join condition, and the path for unknown outcomes.

### 5. Input/Output Type Mismatch
**Symptoms**: Node B expects different data format than Node A produces
**Detection**: The producer output violates a declared consumer schema or semantic contract; a complex mapping alone is not a mismatch
**Fix**: Add transformation nodes or adjust node responsibilities

### 6. Resource Deadlock
**Symptoms**: Progress stops while nodes wait for held resources
**Detection**: Inspect actual held and requested resources for a wait cycle or other documented blocking condition. Contention alone does not prove deadlock.
**Fix**: Add an explicit lease, queue, or serialization edge and record the controlling authority.

### 7. Unbounded Fan-Out
**Symptoms**: Creating unlimited parallel branches without considering system limits
**Detection**: If fan-out lacks a declared resource, authority, rate-limit, or failure-containment policy
**Fix**: Bound the wave according to that local policy and preserve unstarted items for a later wave.

## WORKED EXAMPLES

### Example 1: Code Review Pipeline
**Request**: "Review pull request code, run tests, and deploy if approved"

**Decision Process**:
1. Identify outputs: approval decision, test results, deployment status
2. Check dependencies: tests can run in parallel with review, deployment waits for both
3. Apply fan-in pattern: review + tests → deployment decision

**Built DAG** (constructed schema illustration; timeouts are local example values, not calibrated defaults):
```yaml
graphRevision: review-staging-v1
nodes:
  - id: fetch-pr-changes
    type: skill
    skillId: git-diff-analyzer
    dependencies: []
    
  - id: run-security-scan
    type: skill
    skillId: security-scanner
    dependencies: [fetch-pr-changes]
    config:
      timeoutMs: 120000
    
  - id: run-unit-tests
    type: skill
    skillId: test-runner
    dependencies: [fetch-pr-changes]
    config:
      timeoutMs: 300000
      
  - id: code-review
    type: skill
    skillId: code-reviewer
    dependencies: [fetch-pr-changes]
    config:
      timeoutMs: 600000
    
  - id: deployment-decision
    type: conditional
    dependencies: [run-security-scan, run-unit-tests, code-review]
    inputs:
      - receipt: security-scan.pass
      - receipt: unit-tests.pass
      - receipt: review.approval
    condition: "all required receipts are present and passing"
    
  - id: deploy-to-staging
    type: skill
    skillId: deployment-manager
    dependencies: [deployment-decision]
    condition: deployment-decision.approved
```

**Expert vs Novice**: Expert recognizes security scan can run parallel to tests, novice might serialize everything.

The parallelism is valid only if all three consumers inspect the same immutable
PR snapshot and have separately granted read authority. It remains a plan until
the runner emits attempt and completion receipts. Deployment also needs a separate grant for the exact target and snapshot; passing review and tests does not itself authorize the effect.

### Example 2: Data Processing with Error Recovery
**Request**: "Process customer data files, validate, and generate reports"

**Decision Process**:
1. Detect fan-out opportunity: multiple files can process in parallel
2. State an illustrative per-batch policy: preserve valid batches, quarantine failures, and do not publish an aggregate that implies all batches passed
3. Include recovery path: failed validations get manual review

**Built DAG** (constructed fixture with exactly 200 files in two batches; `[0-99]` denotes an inclusive fixture range, not an executable language slice; other file counts require explicit exhaustive partitioning):
```yaml
nodes:
  - id: discover-files
    type: skill
    skillId: file-scanner
    dependencies: []
    
  - id: process-file-batch-1
    type: skill
    skillId: data-processor
    dependencies: [discover-files]
    inputMappings:
      - from: discover-files.output.files[0-99]
        to: input.files
    
  - id: process-file-batch-2
    type: skill
    skillId: data-processor
    dependencies: [discover-files]
    inputMappings:
      - from: discover-files.output.files[100-199]
        to: input.files
        
  - id: validate-processed-data
    type: skill
    skillId: data-validator
    dependencies: [process-file-batch-1, process-file-batch-2]
    config:
      continueOnError: true
      joinPolicy: "collect a terminal or unknown receipt for every scheduled batch; unknown is not accepted"
      failureDisposition: "emit per-batch receipts; do not aggregate failed batches"
      
  - id: handle-validation-failures
    type: conditional
    dependencies: [validate-processed-data]
    condition: "has_errors"
    
  - id: generate-success-report
    type: skill
    skillId: report-generator
    dependencies: [validate-processed-data]
    condition: "has_accepted_batches"
    config:
      scope: "accepted batches only; report includes failed and unprocessed counts"
    
  - id: generate-error-report
    type: skill
    skillId: error-reporter
    dependencies: [handle-validation-failures]
```

## QUALITY GATES

Before marking DAG complete, verify:

- [ ] All nodes have unique IDs following kebab-case convention
- [ ] No circular dependencies exist (run topological sort validation)
- [ ] Each edge is justified; multiple independent roots are allowed and any synthetic root is labeled as a scheduling convenience
- [ ] All inputMappings reference valid node outputs
- [ ] Every edge records data, authority, or acceptance rationale and its source
- [ ] Parallelism and timeouts cite a local resource and effect policy
- [ ] Critical-path claims distinguish measured duration from planning assumptions
- [ ] Error handling identifies retries, effect idempotency, and unknown outcomes
- [ ] At least one conditional or fan-out pattern used if task complexity warrants
- [ ] DAG produces the requested final output through a clear path
- [ ] The graph revision, input contracts, and acceptance conditions are explicit

## NOT-FOR BOUNDARIES

**Don't use DAG Graph Builder for**:
- Tasks whose declared artifacts, authority, and acceptance conditions do not require a graph → use a direct invocation
- Pre-existing workflow modifications → Use `dag-dependency-resolver` for updates
- Real-time streaming data → Use `stream-processor` skill instead
- Single atomic operations → Execute directly without DAG overhead
- Tasks requiring human interaction loops → Use `interactive-workflow-builder`
- Emergency/immediate execution needs → Use `priority-task-executor`

**Delegate to other skills**:
- For DAG validation and sorting → Use `dag-dependency-resolver`
- For execution scheduling → Use `dag-task-scheduler`
- For skill-to-node assignment → Use `dag-semantic-matcher`
- For monitoring running DAGs → Use `dag-execution-monitor`
