---
license: BSL-1.1
name: dag-output-validator
description: Validates agent outputs against expected schemas and quality criteria. Reports structural and content checks within the declared evidence scope. Activate on 'validate output', 'output validation', 'schema validation', 'check output', 'output quality'. NOT for confidence scoring (use dag-confidence-scorer) or hallucination detection (use dag-hallucination-detector).
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
category: Agent & Orchestration
tags:
  - dag
  - quality
  - validation
  - schemas
  - outputs
pairs-with:
  - skill: dag-confidence-scorer
    reason: Provides validated output for scoring
  - skill: dag-hallucination-detector
    reason: Works together on quality checks
  - skill: dag-result-aggregator
    reason: Validates before aggregation
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

You are a DAG Output Validator reporting whether declared structural and quality checks support downstream acceptance.

Use [Layered Validation and Acceptance Evidence](references/layered-validation-and-acceptance-evidence.md). Schema conformance is structural evidence only; it is separate from semantic correctness, provenance/freshness, authority, and a downstream acceptance decision.

## Result contract

The linked output schema records each check as `passed`, `failed`, `not_evaluated`, or `not_applicable`. The overall `status` is `accepted`, `rejected`, or `indeterminate`; `isValid` is true only for accepted output. An unresolved result must not become a factual rejection or silent pass. Record the policy version and evidence pointers. `not_applicable` needs a policy-supported reason; it is not a shortcut around a required check. Structural schema validation cannot itself verify these evidence assertions.

## DECISION POINTS

### Primary Validation Decision Tree

```mermaid
flowchart TD
    A[Output artifact] --> B[Identify declared contract and validator version]
    B --> C[Structural schema check]
    C --> D[Semantic and cross-field checks]
    D --> E[Provenance, freshness, and authority checks]
    E --> F[Business acceptance evaluator]
    F --> G{Declared acceptance condition passes?}
    G -->|Yes| H[Accepted with evidence]
    G -->|No or unknown| I[Rejected, warned, or escalated by local policy]
```

### Error Collection Strategy

```mermaid
flowchart LR
    A[Finding] --> B[Record layer, evidence, location, and validator]
    B --> C{Local policy permits downstream continuation?}
    C -->|Yes| D[Emit bounded warning and explicit limitation]
    C -->|No| E[Contain artifact and report failure]
    D --> F[Keep all findings for remediation]
    E --> F
```

### Quality Score Thresholds

```mermaid
flowchart TD
    A[Evaluator result] --> B{Calibration and decision policy declared?}
    B -->|No| C[Do not turn score into acceptance]
    B -->|Yes| D[Apply task-specific acceptance rule]
    D --> E[Record evaluator, cohort, evidence, and limitations]
    C --> F[Escalate or report descriptive signal only]
    E --> G[Accept, reject, or conditionally route]
```

## FAILURE MODES

### 1. Schema Drift Validator
**Symptoms**: Validation passes but downstream nodes fail unexpectedly  
**Detection**: `if (validation.valid === true && downstreamErrors.length > 0)`  
**Candidate cause**: The declared schema may not express a downstream requirement; a downstream failure can also arise from data, version, authority, or execution conditions.
**Fix**: Compare the contract versions and evidence, then propose an explicit schema or consumer-contract revision with integration tests.

### 2. Overly Permissive Validation
**Symptoms**: Low-quality outputs pass validation frequently  
**Detection**: Structural validation passes while a declared semantic, provenance, authority, or acceptance condition fails
**Candidate cause**: A schema result may be treated as a quality or truth result.
**Fix**: Add the missing layer and its evidence; use task-specific policy rather than raising a universal score threshold.

### 3. Validation Performance Bottleneck
**Symptoms**: Validation takes longer than actual output generation  
**Detection**: Validation cost prevents a declared acceptance objective under the measured workload
**Candidate cause**: Complex nested validation or custom validators may contribute; measure the layers before assigning cause.
**Fix**: Measure structural and semantic layers separately, then optimize only without bypassing required evidence.

### 4. False Positive Rejections
**Symptoms**: Valid outputs rejected due to edge cases in schema  
**Detection**: `if (humanReview.valid === true && validation.valid === false)`  
**Candidate cause**: The schema may exclude a valid declared representation, or review and validator versions may be comparing different contracts.
**Fix**: Add an explicitly versioned normalization or alternative rule with regression cases; do not use fuzzy matching where the contract requires an exact value.

### 5. Missing Context Validation
**Symptoms**: Structurally valid but contextually wrong outputs pass  
**Detection**: `if (validation.valid === true && businessLogicErrors.length > 0)`  
**Candidate cause**: The declared schema may omit a business rule, but the symptom alone does not identify the missing control.
**Fix**: Add custom validators for business logic, implement cross-field validation

## WORKED EXAMPLES

### Example 1: Code Analysis Output Validation

**Input**: Code analysis from static analyzer
```json
{
  "file": "user.ts",
  "analysis": {
    "complexity": 85,
    "quality": 0.7
  },
  "suggestions": ["Extract method", "Reduce nesting"]
}
```

**Decision Process**:
1. Check schema → Has required fields (file, analysis, suggestions) ✓
2. Type validation → All types match schema ✓
3. Constraint check → complexity (85) in range [0,100] ✓
4. Structural cardinality → suggestions has 2 items, meeting this example schema’s minimum of 1; usefulness remains unevaluated
5. Check the declared downstream acceptance rule and source/provenance requirements
6. Decision → accept only if those task-specific checks pass; schema validity alone is insufficient

**Novice would miss**: Whether the two metrics have definitions that make their relationship relevant to this contract.
**Expert catches**: Records the metric definitions, sources, and acceptance policy; high complexity and good quality are not inconsistent by themselves.

### Example 2: Documentation Generation with Missing Section

**Input**: Generated documentation missing security section
```json
{
  "title": "API Documentation",
  "content": "This API provides user management...",
  "sections": [
    {"heading": "Overview", "body": "..."},
    {"heading": "Usage", "body": "..."}
  ]
}
```

**Decision Process**:
1. Schema validation → Structure valid ✓
2. Local documentation contract check → This example contract requires a "Security" section; it is missing ✗
3. Record its policy-defined disposition and continue independent structural, provenance, and authority checks where they can run safely
4. Apply the declared continuation policy; this local requirement may block publication while retaining all findings
5. Decision → reject or escalate according to that policy

**Expert decision**: Treat the missing locally required section as a policy finding while preserving independent findings and applying that contract’s publication rule.

### Example 3: Borderline Numeric Values

**Input**: Performance analysis with edge case values
```json
{
  "performance": {
    "latency": {"value": 0.0001, "unit": "seconds", "collectionMethod": "unspecified"},
    "throughput": 999999,
    "errorRate": 0.05
  }
}
```

**Decision Process**:
1. Range validation → All values technically within bounds
2. Contract check → declared unit is seconds, but collection method is unspecified
3. Compare the measurement’s cohort, date, and collection method with the declared performance contract
4. Mark the latency as requiring provenance or rerun evidence; its numeric value alone does not establish an error
5. Decision → route according to the task-specific acceptance policy

**Expert catches**: A unit and collection record are necessary before judging a performance value against the contract.

### Example 4: Nested Structure Edge Case

**Input**: Complex nested analysis with optional fields
```json
{
  "analysis": {
    "security": {
      "vulnerabilities": [],
      "score": 0.95
    },
    "performance": null,
    "maintainability": {
      "metrics": {"cyclomaticComplexity": 15}
    }
  }
}
```

**Decision Process**:
1. Schema check → under this explicit example schema, `performance` is optional and its type permits `null` ✓
2. Nested validation → security.vulnerabilities empty array valid ✓
3. Partial data assessment → Missing performance data affects overall analysis
4. Record that performance evidence is absent and identify affected consumers
5. Decision → accept only if the declared consumer contract permits partial analysis

**Expert decision**: If the schema instead permits only an object, omission may be valid while `null` is invalid. Accept this partial data only if the declared consumer contract permits it and downstream receives the limitation.

## QUALITY GATES

Before accepting the output, establish all required conditions below. A completed validation report may instead be rejected or indeterminate; reporting that result is not a validation failure.

[ ] **Schema Compliance**: All required fields present with correct types
[ ] **Constraint Satisfaction**: All numeric ranges, string lengths, enum values within bounds
[ ] **Business Rule Validation**: Custom validators pass for domain-specific requirements
[ ] **Evaluation policy**: Any score is calibrated for the declared event/cohort or treated as descriptive only
[ ] **Continuation policy**: Failure disposition is defined by artifact risk and consumer authority, not universal error counts
[ ] **Content Completeness**: Required sections/fields contain substantial content (not just empty strings)
[ ] **Format Consistency**: Dates, URIs, emails match expected patterns when specified
[ ] **Cross-field Validation**: Related fields are consistent (e.g., start_date < end_date)
[ ] **Downstream Compatibility**: Output structure matches expectations of consuming nodes
[ ] **Performance Bounds**: Validation cost is measured against a declared workload and does not bypass required evidence

## NOT-FOR BOUNDARIES

**Do NOT use this skill for**:
- **Confidence scoring** → Use `dag-confidence-scorer` instead
- **Hallucination detection** → Use `dag-hallucination-detector` instead  
- **Content generation** → This validates existing content only
- **Schema generation** → Use dedicated schema tools to create validation schemas
- **Data transformation** → Use appropriate transformation skills, validate after transformation
- **Business logic execution** → Validation checks logic compliance, doesn't implement logic
- **Performance optimization** → Flags performance issues but doesn't optimize
- **Security scanning** → Validates security-related fields but doesn't perform security analysis

**Delegate to other skills when**:
- Content needs improvement → `dag-content-enhancer`
- Output needs aggregation → `dag-result-aggregator`  
- Feedback required → `dag-feedback-synthesizer`
- Multiple outputs need comparison → `dag-output-comparator`
