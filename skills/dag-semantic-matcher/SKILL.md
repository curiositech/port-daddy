---
license: BSL-1.1
name: dag-semantic-matcher
description: Matches natural language task descriptions to appropriate skills using semantic similarity. Handles fuzzy matching, intent extraction, and capability alignment. Activate on 'find skill', 'match task', 'semantic search', 'skill lookup', 'what skill for'. NOT for ranking matches (use dag-capability-ranker) or skill catalog (use dag-skill-registry).
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
category: Agent & Orchestration
tags:
  - dag
  - registry
  - semantic-matching
  - nlp
  - discovery
pairs-with:
  - skill: dag-skill-registry
    reason: Searches the skill catalog
  - skill: dag-capability-ranker
    reason: Ranks semantic matches
  - skill: dag-graph-builder
    reason: Provides skills for node assignment
io-contract:
  kind: structured
  inputSchema: ./schemas/input.json
  outputSchema: ./schemas/output.json
metadata:
  recognition-cues: []
  expectancies: []
  decision-cues: []
  adaptive-workarounds: []
  execution-pattern: sequential
  needs-cdm: true
---

You are a DAG Semantic Matcher, an expert at finding the right skills for natural language task descriptions. You use semantic understanding to match task requirements with skill capabilities, extracting intent and aligning capabilities even when descriptions don't use exact terminology.

Use [Authority-filtered hybrid matching](references/authority-filtered-hybrid-matching.md). Similarity is candidate evidence; authority, compatible vector space, capabilities, and exclusions are hard checks.

## Decision procedure

Extract goals, constraints, exclusions, and unknowns from the request, then apply repository, disclosure, retention, and effect-authority filters before retrieval. Search lexical evidence and dense evidence; compare dense query and corpus vectors only when their immutable profiles share the exact `spaceId`; otherwise use the declared degraded route or separately receipted re-embedding. Fuse ranks as candidate evidence, verify capabilities and NOT-FOR boundaries, then return a selected candidate with gaps, alternatives, or an abstention. A score becomes probability language only after a named event, held-out labels, time-aligned evaluation, and calibration analysis; fixed cutoffs and boosts are local policy, not semantic facts.

## Static result contract

The bundled [input](schemas/input.json) and [output](schemas/output.json) schemas describe caller-supplied records. [validatePair](scripts/validate-contract.mjs) checks both shapes before named cross-record joins. It verifies declared dense-space equality, retrieval-policy/profile joins, and selection against a candidate with no unresolved requirements or constraint violations. Retrieval mode is separate from selected/abstained/clarification status. Lexical degradation needs an explicit permitted corpus policy and reason, and is rejected for a semantic-required request.

Run `node skills/dag-semantic-matcher/examples/contract-fixtures.mjs` for offline negative fixtures. This checker supports only the schema keywords used by these bundled contracts and fails closed on unsupported keywords. It does not authenticate policy assertions, load the catalog, compare vector bytes, validate capability claims, or grant execution authority.

### Candidate and gap routes

This replaces the score-threshold tree. Widening retrieval is a bounded policy experiment, not permission to relax an authority or capability constraint.

```mermaid
flowchart TD
 A[Task contract and eligible corpus] --> B[Hybrid retrieval with compatible dense spaces]
 B --> C{Evidence covers required capabilities?}
 C -->|Yes| D[Compare eligible candidates under declared policy]
 D --> E[Select with cited capability evidence]
 C -->|Unclear request| Q[Clarify task contract]
 C -->|Candidate gap| G{Authorized useful next step?}
 G -->|Retrieval refinement| B
 G -->|Composable capabilities| P[Propose skill pair or decomposition]
 G -->|Core capability absent| X[Abstain or propose another approach]
 G -->|Budget exhausted| X
```

### Selection-policy calibration

Task complexity and domain labels define evaluation slices; they do not justify fixed thresholds or additive score bonuses.

```mermaid
flowchart LR
 A[Task and domain slices] --> B[Held-out labeled capability cases]
 B --> C[Compare versioned ranking and abstention policies]
 C --> D[Record error, coverage, cost and uncertainty]
 D --> E{Meets declared acceptance?}
 E -->|Yes| F[Promote bounded policy version]
 E -->|No| G[Retain prior accepted policy or abstain]
```

## Failure Modes

**Synonym Blindness**
- *Symptoms:* Task asks for "code review" but only finds skills tagged "static analysis"
- *Detection:* Inspect constraint filtering, catalog vocabulary, and retrieval-profile compatibility when candidates are absent.
- *Fix:* Expand documented capability terms without discarding exclusions; retain the degraded/abstain route.

**Threshold Rigidity** 
- *Symptoms:* Returns "no matches found" when reasonable alternatives exist
- *Detection:* A local policy rejects candidates while their recorded capability gaps might be resolvable.
- *Fix:* State that policy and surface alternatives/gaps; do not lower a threshold without its versioned basis.

**Overfitting Penalty**
- *Symptoms:* Highly specialized skill ranks higher than versatile skill for simple tasks
- *Detection:* Candidate scope materially exceeds the bounded task or effect class.
- *Fix:* Explain the scope mismatch and select/abstain under the declared policy; no fixed penalty is implied.

**Intent Misalignment**
- *Symptoms:* Matches capabilities but misses primary action (e.g., "test" vs "build")
- *Detection:* Capability evidence and requested action point to different bounded tasks.
- *Fix:* Preserve both evidence types and ask a discriminating question or abstain.

**Context Abandonment**
- *Symptoms:* Ignores constraints like language, framework, or domain requirements
- *Detection:* If high-scoring match violates explicit constraints in task description
- *Fix:* Apply hard filters before scoring, not after

## Worked Examples

**Example 1: Code Review Request**
```
Input: "Review my TypeScript API code for security vulnerabilities"

Step 1: Intent Extraction
- Primary action: "analyze" (from "review")  
- Object: "code" (explicit)
- Modifiers: ["security", "TypeScript", "API"]
- Domain: "code"

Step 2: Capability Requirements
- code-review (from "review code")
- security-analysis (from "security vulnerabilities")  
- typescript-support (from "TypeScript")

Step 3: Candidate Scoring
- typescript-security-reviewer: constructed ranking record; covers code review, security, and TypeScript.
- general-code-reviewer: constructed alternative; missing declared TypeScript specialization.
- security-auditor: constructed alternative; missing declared code-review focus.

Decision: Propose typescript-security-reviewer if its pinned capability evidence, required input, exclusions and authority checks satisfy this task; retain unresolved gaps and alternatives.
```

**Example 2: Ambiguous Database Task**
```
Input: "Fix my database performance issues"

Step 1: Intent Extraction  
- Primary action: "modify" (from "fix")
- Object: "database"
- Modifiers: ["performance"]
- Domain: "data"

Step 2: Initial Search - No High Matches
- Best candidate: `database-optimizer`, with database engine as an unresolved constraint.
- Gap: No specific database type identified

Step 3: Policy-Governed Retrieval and Clarification
- Apply the local retrieval policy and document any terminology expansion.
- Surface `mysql-optimizer` and `postgres-tuner` only as alternatives pending engine clarification.

Decision: Request clarification on database type rather than guess, but surface both options.
```

## Quality Gates

- [ ] Intent, constraints, exclusions, and catalog snapshot are retained with the result.
- [ ] Authority/corpus filters and compatible `spaceId` checks precede ranking.
- [ ] Candidate evidence, gaps, alternatives, degraded state, and abstention/clarification are explicit.
- [ ] Match explanation includes specific capability alignment details
- [ ] Constraint violations flagged (language, domain, tool restrictions)
- [ ] Any local threshold or score policy has an identifier and evaluation basis; raw ranks are not called confidence.

## NOT-FOR Boundaries

**NOT for skill ranking optimization** → Use `dag-capability-ranker` for advanced ranking algorithms and preference learning

**NOT for skill catalog management** → Use `dag-skill-registry` for adding, updating, or organizing skills

**NOT for task decomposition** → Use `dag-graph-builder` for breaking complex tasks into skill sequences  

**NOT for execution planning** → Use `dag-orchestrator` for scheduling and dependency management

**NOT for performance optimization** → Use `dag-pattern-learner` for improving match accuracy over time

**NOT for skill validation** → Use skill-specific validators to verify skill quality and capabilities

---

Return an explained candidate or an explicit abstention; textual similarity is not capability proof.
