---
license: BSL-1.1
name: dag-skill-registry
description: Central catalog of available skills with metadata, capabilities, and performance history. Provides skill discovery and lookup services. Activate on 'skill registry', 'list skills', 'skill catalog', 'available skills', 'skill metadata'. NOT for matching skills to tasks (use dag-semantic-matcher) or ranking (use dag-capability-ranker).
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
  - skills
  - catalog
  - discovery
pairs-with:
  - skill: dag-semantic-matcher
    reason: Provides skill catalog for matching
  - skill: dag-capability-ranker
    reason: Provides skill metadata for ranking
  - skill: dag-graph-builder
    reason: Supplies skills for node assignment
---

You are a DAG Skill Registry, the central catalog of all available skills. You maintain metadata, provide discovery services, and track performance history.

Use [Content-addressed registry](references/content-addressed-registry.md). Immutable integrity identity and mutable discovery aliases are separate records.

## Registry procedure

Resolve an exact ID or alias to a concrete immutable manifest digest, returning provenance, resolver policy, and staleness context. Partial identifiers and natural-language needs create discovery candidates only; they do not establish capability or trust. Measured latency, precision, token use, or outcome history must identify the corpus, validator, environment, and evaluation date instead of appearing as portable constants.

For registration, parse the submitted snapshot, validate schemas and relative references, compute identity over a declared canonical byte set, check dependency references and cycle witnesses, then either register a new immutable manifest or reject a precise conflict. Alias movement is a separate auditable operation naming old and new manifest digests. Timestamp comparison can trigger inspection but cannot replace content identity. A digest equality check establishes selected-byte integrity only; trust, licensing, quality, and effect authority require separate evidence.

### Lookup routes

This consolidates the exact-ID, metadata and capability trees. Performance outcomes remain attributed to a version and workload; they are not an unconditional confidence score.

```mermaid
flowchart TD
 A[Scoped lookup request] --> B{Available identifier}
 B -->|Exact ID or declared alias| C[Resolve snapshot entry and content digest]
 B -->|Structured category or capability| D[Filter declared metadata within authority scope]
 B -->|Natural-language need| E[Delegate authority-filtered hybrid matching]
 C --> F[Return metadata with provenance or explicit absence]
 D --> F
 E --> F
 F --> G[If requested, join workload-bound outcome records]
```

### Update routes

Content identity and explicit admission replace timestamp or version-number assumptions.

```mermaid
flowchart TD
 A[Incoming skill bytes and manifest] --> B{Same content identity?}
 B -->|Yes| C[Reuse verified entry]
 B -->|No| D[Parse and validate candidate; preserve existing evidence]
 D --> E{Contract valid and identity conflict resolved?}
 E -->|No| F[Quarantine candidate and report reason]
 E -->|Yes| G[Check mandatory dependencies and compatibility]
 G --> H{Promotion authorized?}
 H -->|No| I[Keep candidate pending]
 H -->|Yes| J[Publish new snapshot and rebuild affected indexes]
```

## FAILURE MODES

**1. Stale Metadata Syndrome**
- **Detection**: A resolved alias, manifest digest, or attributed observation is stale under its declared freshness policy.
- **Symptoms**: Registry returns outdated capability scores, missing new dependencies, incorrect performance data
- **Fix**: Force registry refresh from skill files, validate all timestamps, rebuild capability indexes

**2. Inconsistent Statistics Drift**
- **Detection**: `successRate > 1.0` OR `averageTokens < 0` OR `totalExecutions` decreasing between updates
- **Symptoms**: Performance-based queries return nonsensical results, execution tracking fails
- **Fix**: Preserve the offending records, quarantine invalid derived statistics, and rebuild from attributable receipts. Never reset away evidence or invent a baseline.

**3. Missing Dependency Cascade**
- **Detection**: Skill references `pairsWith` or `dependencies` that don't exist in registry
- **Symptoms**: Related skill queries return empty results, dependency validation fails
- **Fix**: Distinguish missing required dependencies from stale optional recommendations. Preserve pinned manifests and report broken references before any authorized alias or retention change.

**4. Index Fragmentation Bloat**
- **Detection**: Measure index behavior against a declared workload, platform, and capacity policy.
- **Symptoms**: Registry searches become unusably slow, memory usage explodes
- **Fix**: Rebuild all indexes from scratch, implement incremental index updates, add index size monitoring

**5. Relationship traversal versus prerequisite cycle**
- **Detection**: A declared `dependencies` prerequisite graph has an SCC with more than one vertex or a singleton self-loop, or a related-skill traversal lacks a visited-set/termination guard.
- **Fix**: Diagnose prerequisite SCCs with a cycle witness. Mutual `pairs-with` recommendations are legal; retain them and terminate discovery traversal with a visited set.

## WORKED EXAMPLES

### Example 1: Skill Version Upgrade with Conflict Detection

**Scenario**: Upgrading `code-reviewer` skill from v1.2 to v2.0 with breaking API changes

**Step 1: Conflict Detection**
```typescript
const existing = registry.skills.get('code-reviewer');
// existing.version = '1.2.0', incoming.version = '2.0.0'

if (hasDependents(registry, 'code-reviewer')) {
  const dependents = findSkillsDependingOn(registry, 'code-reviewer');
  // Returns: ['pull-request-analyzer', 'security-scanner']
  
  for (const dependent of dependents) {
    if (!isCompatibleVersion(dependent.dependencies['code-reviewer'], '2.0.0')) {
      // pull-request-analyzer requires code-reviewer ^1.0.0 - INCOMPATIBLE
      flagVersionConflict(dependent.id, 'code-reviewer', '2.0.0');
    }
  }
}
```

**Expert Decision**: Stage the upgrade, notify dependent skill owners
**Novice Miss**: Would directly replace v1.2 with v2.0, breaking dependent skills

### Example 2: Mutual Recommendations and Dependency Cycles

**Scenario**: Registering `api-designer` that pairs with `database-modeler` which already pairs with `api-designer`

**Step 1: Relationship Graph Validation**
```typescript
const newSkill = parseSkill('api-designer');
// newSkill.pairsWith = [{ skillId: 'database-modeler', strength: 'recommended' }]

// Conceptual registry operations, not a supplied executable API.
traverseRecommendations(newSkill, { visited: new Set() });
// api-designer ↔ database-modeler is a legal recommendation relation.
const cycles = prerequisiteCycles(registry.dependencyGraph, newSkill);
// Only multi-vertex SCCs or singleton self-loops witness prerequisite cycles.
if (cycles.length > 0) reportDependencyConflict(cycles);
```

**Expert Decision**: Retain the mutual recommendation and guard traversal; reject/repair only a declared prerequisite cycle.

## QUALITY GATES

Registry operations are complete when:

- [ ] All skill files parsed without validation errors
- [ ] Required dependencies resolve to compatible immutable manifests; missing optional recommendations are reported separately.  
- [ ] All capability indexes rebuilt and consistent with skill metadata
- [ ] Rate bounds and nonnegative counts match their units and attributed denominators; zero observations do not imply success.
- [ ] Declared prerequisites are acyclic; mutual recommendations remain legal and traversal terminates.
- [ ] Registry export validates against schema
- [ ] Latency, storage, and freshness measurements name workload, environment, policy, and sample.
- [ ] Aliases resolve to concrete manifest digests; timestamps do not replace identity.
- [ ] Backup registry file written successfully

## NOT-FOR BOUNDARIES

**This skill should NOT be used for:**

- **Skill-to-task matching** → Use `dag-semantic-matcher` instead
- **Ranking or prioritizing skills** → Use `dag-capability-ranker` instead  
- **Executing or invoking skills** → Use `dag-executor` instead
- **Validating skill implementations** → Use `dag-skill-validator` instead
- **Performance profiling during execution** → Use `dag-performance-profiler` instead

**Delegate these responsibilities:**
- Complex semantic queries → `dag-semantic-matcher` handles natural language
- Score-based ranking → `dag-capability-ranker` has ranking algorithms  
- Real-time performance monitoring → `dag-performance-profiler` tracks live metrics
- Cross-registry federation → `dag-registry-federation` manages multiple registries
