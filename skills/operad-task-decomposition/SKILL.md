---
license: Apache-2.0
name: operad-task-decomposition
description: "Model hierarchical task composition with typed interfaces and colored operads. Use when designing multi-agent decompositions, checking subworkflow boundaries, or distinguishing formal substitution from scheduling and execution semantics. Covers wiring diagrams, explicit artifact bindings, and an acyclic task-workflow model. Not for runtime orchestration, proving agent correctness, or general category theory education."
category: Research & Academic
tags:
  - category-theory
  - operads
  - task-decomposition
  - multi-agent
  - wiring-diagrams
  - spivak
  - composition
  - applied-math
---

# Operad Task Decomposition

Use typed composition to make a decomposition's interfaces and substitutions explicit. An operad supplies laws for combining operations. A compatible interpretation supplies their meaning. Executable agents, permissions, effects, and schedules require additional contracts and evidence.

This skill chooses an **acyclic task workflow** for execution planning. Acyclicity is a constraint of that workflow, not a law of every operad. A typed DAG alone does not establish an operad algebra or prove that agents will complete the task correctly.

## When to Use

- Design reusable subworkflows with declared inputs and outputs.
- Check that a proposed replacement preserves a node's external interface.
- Explain the difference between a composition expression and its execution.
- Ground artifact types in a domain vocabulary, including an olog when useful.
- Identify where a decomposition needs explicit sharing or effect contracts.

Use dag-orchestrator for runtime scheduling, dag-quality for outcome evaluation, and skill-architect for individual skill construction. Do not introduce operad terminology when ordinary typed interfaces explain the whole problem.

## Core Mental Models

### 1. Specify the mathematical structure

Here, **operad** means a symmetric colored operad, also called a symmetric multicategory. Some authors use “operad” only for the one-color case; state the convention when comparing sources.

An operad O specifies:

- Colors A, B, C, ... representing interfaces or sorts.
- Operations O(A_1, ..., A_n; B), with an ordered list of input colors and one output color. Arity n may be zero.
- Substitution: an operation producing A_i can fill an A_i input slot of another operation.
- An identity operation for each color.
- Unit and associativity laws for substitution.
- Symmetric actions and equivariance laws: consistently reindexing slots and the substituted operations respects composition.

Permuting input positions does not say that an operation is commutative. For example, swapping the ports of `subtract(left, right)` requires tracking which value reaches each port.

A finite list of types and operation signatures is a **presentation starting point**. It can generate a free operad of formal composites. If additional equations are imposed, state them; a signature table alone neither defines an execution semantics nor checks those equations. See [Leinster, Chapter 2](https://arxiv.org/pdf/math/0305049).

### 2. Associativity preserves a substitution tree

Suppose the declarations are:

```text
f : (B, C) -> D
g : (A1, A2) -> B
h : (X) -> A1
```

The same substitution tree can be assembled in either grouping:

```text
(f compose (g, id_C)) compose (h, id_A2, id_C)
    = f compose (g compose (h, id_A2), id_C)
    : (X, A2, C) -> D
```

This equation preserves the operations, slot assignments, and tree. It does not authorize replacing the entire tree with a new prompt, dropping intermediate checks, changing the dependency order, or swapping agents.

It also does not make each individual operation associative. With deterministic subtraction, `(8 - 3) - 1 = 4` and `8 - (3 - 1) = 6`. Those are different trees of operations; operadic substitution remains associative.

### 3. Interpretation is a separate obligation

A Set-valued algebra assigns a carrier set to each color and an actual function to each operation, preserving identities, substitution, and symmetry. Equal formal composites then have equal denotations in that algebra. This is a statement about a specified mathematical interpretation, not a certificate that an implementation conforms to it. See [Spivak, §2.2](https://arxiv.org/html/1305.0297v1).

For a task system, distinguish four layers:

| Layer | What must be supplied | What it supports |
|---|---|---|
| Formal syntax | Colors, operations, substitution, laws | Well-formed composites and formal equations |
| Compatible interpretation | Carriers and operation meanings preserving those laws | Equality under that interpretation |
| Implementation | Code/model versions, input bindings, effects, authority, error handling | A concrete candidate realization |
| Observations | Traces, output checks, controlled comparisons | Bounded evidence about actual behavior |

Pure function composition is associative, but determinism alone does not justify changing a workflow's operations or effects. Nondeterminism does not turn the operad laws into “approximate associativity.” Choose an appropriate semantics for relations, distributions, state, or effects and establish its composition rules. If a probabilistic interpretation is used, equal distributions still do not require identical sampled outputs.

If the practical question is whether two agent implementations behave similarly, define the outcome, workload, randomness, tolerance, and comparison method. That empirical claim is separate from an operad equation. A replacement with the same input/output signature may still differ in quality, authority, latency, cost, or external effects.

### 4. Wiring diagrams require a chosen grammar

In a wiring-diagram operad, a color can be an entire **box interface** with multiple typed ports. An operation is a wiring arrangement of inner boxes within an outer box. Its operadic input slots are the inner-box interfaces; its output color is the outer-box interface. Wire types and operad colors therefore need not be the same objects.

Substitution replaces an inner box with a diagram having the matching interface. Which diagrams are permitted depends on the chosen construction. Spivak's [2013 paper](https://arxiv.org/abs/1305.0297) includes recursion; [Vagner, Spivak, and Lerman](https://arxiv.org/abs/1408.1598) give an interpretation involving open dynamical systems. These are not universal finite-DAG execution rules.

For this skill, use directed acyclic data dependencies, explicitly declared boundaries, and finite node instances. Ordinary operad expressions are tree-shaped; a workflow with a value feeding several consumers additionally needs a specified sharing interpretation. For example:

- An immutable, versioned patch artifact can be read by both review and test nodes.
- An exclusive mutation grant cannot be duplicated merely because both consumers accept its schema.
- A feedback loop is rejected by this skill's outer DAG contract. It may be represented by a bounded iteration node with explicit state, stopping conditions, and failure handling. This is an engineering choice, not a theorem excluding feedback from operads.

[Fong and Spivak, §5.2.2](https://arxiv.org/pdf/1803.05316) provide an acyclic port-graph construction. Their §§6.5.1–6.5.3 discuss operads and wiring diagrams more generally.

### 5. Composition does not determine a runtime schedule

A symmetric monoidal category can model side-by-side structure with a tensor:

```text
f : A -> B, g : C -> D
f tensor g : A tensor C -> B tensor D
```

It induces an operad with operations `O(A1, ..., An; B) = Hom(A1 tensor ... tensor An, B)`. The tensor belongs to that additional categorical structure; an arbitrary colored operad need not provide a tensor of its colors. See [Fong and Spivak, §6.5.2](https://arxiv.org/pdf/1803.05316).

Side-by-side structure does not guarantee simultaneous execution. Two nodes can share an immutable input and still run concurrently. Conversely, nodes with disjoint data inputs may conflict over mutable files, credentials, rate limits, or capacity.

Derive readiness from explicit dependency edges. Then check effects, permissions, budgets, worker availability, and scheduling policy. Wave barriers are one possible schedule and can add unnecessary waiting. Operad laws alone neither calculate maximum parallelism nor prove a scheduler optimal. Using an unavailable value is a readiness failure even when its declared type is correct.

### 6. Domain vocabulary can inform colors

An olog may supply names and relationships for domain entities. Task colors can refer to that vocabulary, with separate schemas, refinements, and provenance requirements. For example:

```text
plan_fulfillment : (Customer, OrderDetails, InventorySnapshot) -> FulfillmentPlan
```

An olog functor alone does not establish problem equivalence or automatically transfer a task operad. A transfer must also map operations and preserve the relevant composition and interpretation. Do not infer behavioral equivalence merely from aligned type names.

## Construction Workflow

### Step 1: Declare interfaces and evidence requirements

List external inputs, required outputs, and intermediate artifacts. Give each a name, description, and checkable schema where practical. Add version, repository, subject digest, and authority constraints when they matter.

Two values satisfying the same schema need not be interchangeable: test results for patch P do not validate patch Q. Encode or check such relationships explicitly. Avoid both a universal `text` type and distinctions that no consumer needs.

### Step 2: Declare operations and effects

For each operation, specify named input ports and an output port, plus:

- Preconditions and output predicates.
- Implementation or agent assignment and its version.
- Read/write effects, required authority, and resource budget.
- Failure, cancellation, retry, and uncertain-effect behavior.

These operational annotations supplement the mathematical signature. Operads impose no universal five-input limit. Split a large operation when doing so improves evaluation, ownership, reuse, or resource control; measure the added coordination cost.

### Step 3: Bind actual artifacts

Use explicit node and port identifiers. Never select a producer solely by type: several nodes may produce a `ReviewReport`, or several revisions of the same patch may exist. Declare external inputs separately and bind every required port exactly once unless the operation explicitly accepts a collection.

### Step 4: Check the chosen DAG and substitution boundary

Check declaration consistency, input completeness, source-port existence, schema compatibility, and final-output reachability. Reject cycles under this skill's chosen DAG contract. Check artifact identity and provenance relationships separately from schema compatibility.

A proposed subworkflow must preserve the replaced node's external interface and satisfy its effect, authority, budget, and failure contracts. Preserve boundary bindings during substitution and recheck the resulting graph. A matching signature establishes interface compatibility only; implementation correctness needs its own evidence.

### Step 5: Propose and evaluate execution

Compute dependency readiness, then assess resource and effect conflicts. Mark a proposed concurrent group as conditional on those checks. If testing hierarchy-preserving execution versus a flattened implementation, hold inputs and implementation versions fixed, record changed context and effect ordering, and evaluate outcome quality and total cost. Do not report that experiment as a test of the abstract associativity axiom.

## Practical Representation

The following is a typed workflow representation, not a complete operad definition or proof checker. `outputs` permits structured box interfaces; the earlier artifact-operation model's single output can instead be a product record.

```typescript
type Source =
  | { external: string }
  | { node: string; port: string };

type Port = { name: string; type: string };

interface OperationDeclaration {
  name: string;
  inputs: Port[];
  outputs: Port[];
  contract: string; // reference to effects, predicates, authority, retry policy
}

interface TypedTaskWorkflow {
  types: { name: string; description: string; schema?: object }[];
  operations: OperationDeclaration[];
  externalInputs: Port[];
  nodes: {
    id: string;
    operation: string;
    bindings: Record<string, Source>;
  }[];
  outputs: { name: string; type: string; source: Source }[];
}
```

Example instance bindings, with declarations `review: Patch -> Review`, `test: Patch -> Tests`, and `finalize: (Patch, Review, Tests) -> Deliverable`:

```json
{
  "externalInputs": [{ "name": "patch", "type": "Patch" }],
  "nodes": [
    { "id": "r", "operation": "review", "bindings": {
      "patch": { "external": "patch" }
    } },
    { "id": "t", "operation": "test", "bindings": {
      "patch": { "external": "patch" }
    } },
    { "id": "f", "operation": "finalize", "bindings": {
      "patch": { "external": "patch" },
      "review": { "node": "r", "port": "result" },
      "tests": { "node": "t", "port": "result" }
    } }
  ],
  "outputs": [{ "name": "deliverable", "type": "Deliverable",
    "source": { "node": "f", "port": "result" } }]
}
```

This fragment omits the type and operation declaration tables. Each declaration's output port is named `result`. The patch is an immutable artifact; review and tests must record its digest. Finalization checks that both reports refer to that exact digest and satisfy the acceptance policy. Review and test may run concurrently only if their implementations' effects and allocated resources permit it.

A checker for this representation should:

1. Reject duplicate identifiers, undeclared types/operations, unknown source ports, and missing or extra input bindings.
2. Resolve each source by identifier and check the declared source and target types, or an explicitly permitted compatibility relation.
3. Build edges from bindings, check acyclicity, and trace declared final outputs back to available external inputs or zero-input operations.
4. Validate runtime artifact schemas, digests, and predicates when values arrive.
5. Evaluate effect and authority contracts before scheduling or substitution.

Unused library types are not an operad violation. Unused nodes in a particular execution plan are a review signal because they may consume resources without supporting the deliverable.

## Applying the Model to a DAG Planner

For a Jury-rig-style planner, this is a modeling proposal unless the implementation has been checked against the definitions above:

| Planner element | Modeling interpretation | Additional obligation |
|---|---|---|
| Artifact schema | Sort in an artifact-operation model | Schema, refinements, provenance |
| Node interface | Color in a box-wiring model | Explicit port correspondence |
| Node implementation | Candidate interpretation of an operation | Contract conformance |
| Node expansion | Substitution by a subworkflow | Boundary and effect preservation |
| Wave | Proposed schedule | Readiness, resources, interference |
| Graph rewrite | A new composition candidate | No semantic equivalence from types alone |

Do not switch between artifact colors and box-interface colors without saying which model is in use. A graph planner's existence does not prove it constructs an operad algebra.

## Anti-Patterns and Diagnostic Questions

- **“The two prompts have the same signature, so replacement preserves behavior.”** Check output predicates, provenance, effects, and evaluation evidence. Typing is only one obligation.
- **“Grouping is irrelevant because the agents are deterministic.”** Determine whether this is the same formal substitution tree, then specify the interpretation. Changed operations or effect ordering require separate reasoning.
- **“Multi-input means independent inputs.”** An input list describes requirements. Inspect dependencies and shared resources to assess concurrency; curried and uncurried function representations can express the same requirements.
- **“Every operad forbids cycles.”** Identify the diagram grammar. Reject cycles here because this workflow chooses a DAG, while other wiring constructions admit feedback or recursion.
- **“An operad is just a type system.”** Typing constrains interfaces; the operad additionally specifies substitution and its laws. Neither feature alone supplies a runtime scheduler or a correctness proof.
- **“Static type checks are free and sufficient.”** They require a defined representation and checker, and they do not establish semantic truth or authority. State exactly which properties were checked.
- **“Five inputs is a mathematical limit.”** There is no such operad axiom. Choose granularity using the task's validation and execution costs.

## Primary References

Sources checked 2026-09-23:

- **Leinster (2004), Higher Operads, Higher Categories**, [author preprint](https://arxiv.org/pdf/math/0305049), Chapter 2, especially Definition 2.1.1, Examples 2.1.2–2.1.5, and Definition 2.1.12. Definitions of multicategories and algebras; the unary case is a category; the monoidal construction is additional structure.
- **Fong and Spivak (2019), An Invitation to Applied Category Theory**, [author preprint](https://arxiv.org/pdf/1803.05316). Chapter 6 is correct: §§6.5.1–6.5.3 cover operads, algebras, and their relation to symmetric monoidal categories. Chapter 5 §5.2.2 separately defines acyclic port graphs.
- **Spivak (2013), The operad of wiring diagrams: formalizing a graphical language for databases, recursion, and plug-and-play circuits**, [arXiv:1305.0297](https://arxiv.org/abs/1305.0297). §2 states conventions, operad functors, and algebras; recursion is within the paper's scope.
- **Vagner, Spivak, and Lerman (2015), Algebras of Open Dynamical Systems on the Operad of Wiring Diagrams**, [arXiv:1408.1598](https://arxiv.org/abs/1408.1598). A specific wiring construction and compatible dynamical-system interpretations; not a generic agent-execution guarantee.
- **Catlab.jl**, [official documentation](https://algebraicjulia.github.io/Catlab.jl/latest/). Computational structures and wiring-diagram tooling. The project explicitly distinguishes itself from a theorem prover or proof assistant; using it does not certify agent behavior.

## Quality Gates

For the **mathematical claim**:

- [ ] State whether colors are artifact sorts or box interfaces.
- [ ] Specify the chosen operad, or label signatures as generators for formal syntax.
- [ ] Use unit, substitution associativity, and equivariance laws with their actual scope.
- [ ] Supply a compatible interpretation before claiming semantic equality.
- [ ] Identify which implementation obligations remain unproved.

For the **chosen task workflow**:

- [ ] Declare concrete ports, source bindings, external inputs, and final outputs.
- [ ] Check type compatibility, completeness, provenance, and relevant refinements.
- [ ] Check acyclicity as this workflow's constraint, with bounded iteration contracts where needed.
- [ ] Make sharing, effects, authority, retries, and resource limits explicit.
- [ ] Check proposed concurrency against readiness and interference.
- [ ] Evaluate substitutions against the full interface and behavioral contract.
- [ ] Report static checks and empirical results separately from formal guarantees.
