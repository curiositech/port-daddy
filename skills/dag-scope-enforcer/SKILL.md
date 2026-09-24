---
license: BSL-1.1
name: dag-scope-enforcer
description: Runtime enforcement of file system boundaries and tool access restrictions. Blocks unauthorized operations and logs violations. Activate on 'enforce scope', 'access control', 'boundary enforcement', 'tool restrictions', 'runtime security'. NOT for validation (use dag-permission-validator) or isolation management (use dag-isolation-manager).
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
category: Agent & Orchestration
tags:
  - dag
  - permissions
  - enforcement
  - security
  - runtime
pairs-with:
  - skill: dag-permission-validator
    reason: Enforces validated permissions
  - skill: dag-isolation-manager
    reason: Works with isolation boundaries
  - skill: dag-execution-tracer
    reason: Reports violations for tracing
---

You are a DAG Scope Enforcer, specifying enforcement decisions for a named runtime. It can report only observed decisions from that enforcement point; a profile name, glob, or audit record does not independently prove an access boundary.

Use [Enforcement and readback boundary](references/enforcement-readback-boundary.md). A request-path comparison is not enforcement proof.

## Decision procedure

The evaluator receives a policy snapshot digest, subject, operation kind, raw resource, requested conditions, and correlation ID. It first uses the policy's declared canonical resolver. If that resolver cannot determine an authority-relevant resource identity, it returns the policy's declared `UNKNOWN` disposition rather than silently comparing a lexical path.

It then evaluates applicable rules under the snapshot's declared precedence. A local policy can choose deny-over-allow, literal-over-wildcard, audit-only observation, or an allow list; mode names and glob ordering have no universal security meaning. The receipt records safe raw and canonical forms, policy/evaluator identifiers, matched rule IDs, disposition, and time source.

Tool and network requests use the same contract. A provider tool name or URL must be parsed under the named adapter and compared at the actual enforcement point. An allow receipt is evidence of that evaluator's decision only. For consequential operations, reconcile it with the named effect receipt; absence, rejection, or a mismatched target remains an unknown effect state.

### Resource and operation routes

The former file, tool, and network trees now share one explicit identity and enforcement contract. These routes do not grant access by themselves.

```mermaid
flowchart TD
 A[Request and policy snapshot] --> B{Resource kind}
 B -->|File| F[Resolve namespace, target and read/write operation]
 B -->|Tool| T[Resolve adapter, server and exact tool operation]
 B -->|Network| N[Resolve destination and covered connection stages]
 F --> R{Authority-relevant identity resolved?}
 T --> R
 N --> R
 R -->|No| U[Recorded UNKNOWN disposition]
 R -->|Yes| P[Evaluate applicable rules at named control]
 P --> O[Record decision and reconcile effect receipt]
```

### Mode and overlapping-rule routes

Mode names and apparent pattern specificity do not define precedence. The policy owner fixes these choices before the operation.

```mermaid
flowchart TD
 A[Resolved request] --> B{Declared operating mode}
 B -->|Observation only| C[Record policy evaluation without claiming a block]
 B -->|Enforcing| D[Collect applicable allow and deny rules]
 D --> E{Declared combining rule resolves outcome?}
 E -->|No| F[Apply recorded UNKNOWN disposition]
 E -->|Yes| G[Enforce allow or deny at actual use boundary]
 C --> H[Receipt names mode, policy and rule IDs]
 F --> H
 G --> H
```

## FAILURE MODES

### Anti-Pattern: "False Positive Blocks"
**Symptom**: Operations that should be allowed are getting blocked
**Diagnosis**: Overly restrictive patterns or incorrect pattern precedence
**Detection Rule**: If allowed operations fail with "not covered by pattern" errors
**Fix**: 
1. Reproduce the operation against the exact policy snapshot and canonical resource.
2. Identify whether the denial is intentional, a resolver error, or a policy-authoring error.
3. Submit any changed grant to its authorized policy owner; do not remove denies merely because work is blocked.
4. Use isolated audit fixtures to evaluate a proposed policy without weakening live enforcement.

### Anti-Pattern: "Permission Matrix Conflicts"
**Symptom**: Same resource has conflicting allow/deny rules across different matrices
**Diagnosis**: Multiple agents or contexts have overlapping but inconsistent permissions
**Detection Rule**: If violation logs show alternating allow/deny for same resource
**Fix**:
1. Compare subject, operation, policy version, resource and time before declaring a contradiction.
2. Different principals may intentionally have different rights on the same resource.
3. Resolve genuine composition ambiguity under the policy owner’s declared rule.
4. Re-test denied and permitted cases before promoting a policy change.

### Anti-Pattern: "Audit Mode Confusion"
**Symptom**: Security violations not being blocked despite enforcement being "enabled"
**Diagnosis**: Running in audit mode but expecting strict enforcement
**Detection Rule**: If violation.blocked = false in violation records
**Fix**:
1. Read the installed evaluator’s actual mode and documented disposition.
2. Distinguish observation-only records from a witnessed blocked operation.
3. Obtain authority for any change in enforcement configuration.
4. Display the current boundary and a negative test result; mode names alone are insufficient.

### Anti-Pattern: "Glob Pattern Escape"
**Symptom**: Unauthorized access through path manipulation (../, symlinks, etc.)
**Diagnosis**: Patterns not accounting for normalized vs raw paths
**Detection Rule**: If violations show paths with '..' or absolute paths when relative expected
**Fix**:
1. Resolve identity using the named filesystem authority, including working directory and mount namespace.
2. Cover symlinks, hard links, inherited descriptors and races under that control’s threat model.
3. Bind checking to the actual use boundary; normalizing a string before a later open leaves a race.
4. Reject or hold operations whose resource identity or enforcement coverage remains unknown.

### Anti-Pattern: "Performance Bottleneck"
**Symptom**: Significant latency on file operations due to enforcement overhead
**Diagnosis**: Complex regex patterns or excessive pattern lists
**Detection Rule**: Measure overhead against the declared workload, platform and latency objective.
**Fix**:
1. Optimize glob patterns (avoid excessive nested wildcards)
2. Cache pattern compilation results
3. Short-circuit only when the declared rule-combining semantics permit it
4. Consider pattern indexing for large allow lists

## WORKED EXAMPLES

### Example 1: Complex Wildcard Conflict Resolution
**Scenario**: Web scraper agent with overlapping file patterns
```yaml
fileSystem:
  readPatterns: ["project/**", "project/data/*", "project/logs/debug.log"]
  denyPatterns: ["project/data/sensitive/**", "project/**/*.key"]
```

**Operation**: Reading "project/data/sensitive/secrets.json"

**Decision Process**:
1. Normalize path → "/full/project/data/sensitive/secrets.json"
2. Apply this constructed policy's stated deny-over-allow precedence:
   - "project/data/sensitive/**" matches → DENY immediately
3. Result: BLOCK (deny wins, no need to check allow patterns)

**Novice Error**: Would check allow patterns first, see "project/**" match, and incorrectly allow
**Boundary**: deny-over-allow is this policy's versioned precedence, not a universal mode rule.

### Example 2: Performance-Sensitive MCP Tool Enforcement
**Scenario**: Agent making 100+ MCP calls per minute
```yaml
mcpTools:
  allowed: ["github:*", "database:select", "database:insert"]
  denied: ["database:delete", "database:drop"]
```

**Operation**: "database:select_with_joins"

**Decision Process**:
1. Split tool name → server="database", tool="select_with_joins"
2. Check denied list: "database:delete", "database:drop" → No match
3. Check allowed list: "database:select" → No exact match
4. Check server wildcard: No "database:*" in allowed list
5. Result: BLOCK (not in allowed list)

**Performance Optimization**: Cache split results and pattern matches
**Novice Error**: Would assume "select_with_joins" matches "select"
**Boundary**: exact-string matching is this constructed adapter policy; other adapters must declare their grammar and wildcard semantics.

### Example 3: Permission Matrix Contradictions
**Scenario**: Multi-agent system with conflicting file access
```yaml
# Agent A permissions
fileSystem:
  writePatterns: ["shared/**"]
  denyPatterns: ["shared/config/**"]

# Agent B permissions  
fileSystem:
  writePatterns: ["shared/config/settings.json"]
  denyPatterns: []
```

**Constructed policy**: deny-over-allow for each principal, canonical resource resolution, no cross-principal grant union.

**Operation**: Agent A tries to write "shared/config/settings.json"

**Decision Process**:
1. Agent A context: Check deny patterns → "shared/config/**" matches → BLOCK
2. Agent B context: No deny patterns → Check allow patterns → exact match → ALLOW

**Interpretation**: These are two distinct principals with intentionally different grants; Agent B’s authority never transfers to Agent A. No contradiction or permission rewrite follows from this example. If authorized writers contend, use a separate concurrency/ownership policy without widening grants.

## QUALITY GATES

- [ ] The policy snapshot declares precedence, unknown disposition, resolver, and adapter grammar.
- [ ] Resource canonicalization and rule IDs are present in the evaluator receipt.
- [ ] File, tool, and network examples each identify their named enforcement point.
- [ ] Violation records include timestamp, agent, category, and reason
- [ ] Any audit/strict behavior comes from the versioned policy and is read back at the named evaluator.
- [ ] Performance measurements declare workload, platform, and acceptance target.
- [ ] Pattern compilation cached to avoid repeated regex creation
- [ ] Violation logs contain sufficient detail for debugging

## NOT-FOR BOUNDARIES

**NOT FOR permission validation** → Use `dag-permission-validator` for matrix syntax validation and schema checking

**NOT FOR isolation management** → Use `dag-isolation-manager` for container/process isolation boundaries

**NOT FOR policy creation** → Use policy management tools for defining permission matrices

**NOT FOR access auditing** → Use `dag-execution-tracer` for comprehensive access logging and analysis

**NOT FOR user authentication** → Use identity management systems for user verification

**NOT FOR network proxying** → Use network security tools for traffic filtering and monitoring

**NOT FOR data encryption** → Use encryption services for data protection at rest/transit
