---
license: Apache-2.0
name: semantic-conflict-prediction
description: >
  AST-based semantic conflict prediction for multi-agent coding environments.
  Uses tree-sitter to parse code into ASTs, extract symbol-level claims, build
  dependency graphs, and predict conflicts BEFORE they happen -- at work-assignment
  time, not merge time. The key insight: git's textual merge is necessary but not
  sufficient. Two changes can merge cleanly and break the program. This skill covers
  tree-sitter fundamentals, symbol-level claims, dependency graph construction,
  conflict prediction algorithms, and integration with Port Daddy or similar
  coordination daemons. NOT FOR: textual merge conflict resolution (use git skills),
  linting or formatting (use static analysis tools), runtime verification of
  invariants (use runtime-verification-for-agents), or general multi-agent
  orchestration (use multi-agent-coordination).
category: Formal Methods & Verification
tags:
  - tree-sitter
  - AST
  - conflict-prediction
  - semantic-analysis
  - multi-agent
  - dependency-graph
  - symbol-claims
  - static-analysis
  - coordination
metadata:
  category: AI & Agents
  tags:
    - tree-sitter
    - AST
    - conflict-prediction
    - semantic-analysis
    - multi-agent
    - static-analysis
  pairs-with:
    - skill: multi-agent-coordination
      reason: Conflict prediction is the intelligence layer above coordination primitives
    - skill: runtime-verification-for-agents
      reason: Arbiter can enforce symbol claim consistency as a runtime invariant
    - skill: agentic-patterns
      reason: Individual agent claim behavior composes into system-wide conflict analysis
    - skill: game-theoretic-agent-incentives
      reason: Incentive design for agents to declare honest claims rather than over-claiming
---

# Semantic Conflict Prediction

**Version:** 1.0
**Domain:** Static Analysis, Agent Coordination, Conflict Prevention
**Lineage:** Port Daddy file claims (advisory), multi-agent-coordination (git worktrees), runtime-verification-for-agents (Arbiter pattern)

You are an expert in predicting semantic conflicts between concurrent code modifications using abstract syntax tree analysis. You understand tree-sitter parsing, symbol-level dependency graphs, and the gap between "git merge succeeds" and "program still works." Your goal: detect conflicting intent at work-assignment time so agents never produce changes that merge clean and break the build.

---

## When to Use This Skill

Load this skill when:

- Multiple agents will modify the same codebase and you need to partition work safely
- You need to go beyond file-level claims to symbol-level claims (function, class, method)
- You are building or extending a coordination daemon with conflict detection
- You need to construct a dependency graph across a codebase to understand blast radius
- You are designing an Arbiter invariant for SymbolClaimConsistency
- You need to analyze whether two proposed changes are semantically compatible
- You are implementing tree-sitter parsing for code intelligence in an agent system

Do NOT load this skill for:

- **Textual merge conflict resolution** -- that is git's job; this skill prevents the conflicts git cannot see
- **Linting or code formatting** -- use ESLint, Prettier, or language-specific tools
- **Runtime invariant monitoring** -- use runtime-verification-for-agents
- **General multi-agent orchestration** -- use multi-agent-coordination
- **Refactoring automation** -- tree-sitter is a tool here, not the goal

---

## The Problem: Candidate conflicts that Git may not fully represent

Git merges at the text level. It answers: "Can these two diffs be applied to the same file without overlapping lines?" This is necessary but catastrophically insufficient.

### The Canonical Example

```
Agent A modifies server.ts:
  - Renames parameter `createRoutes(app, db)` to `createRoutes(app, { db, cache })`

Agent B modifies app.ts:
  - Adds call `createRoutes(expressApp, database)`
```

Git sees two different files. Merge succeeds. TypeScript compilation fails. In a dynamic language, the failure is silent -- `db` is now `undefined` inside `createRoutes` and the error surfaces at runtime, three abstraction layers away.

### Taxonomy of Semantic Conflicts

| Conflict Type | What Happens | Git Detects? | Example |
|---|---|---|---|
| **Direct** | Same symbol modified by two agents | Sometimes (same file) | Both agents rewrite `handleAuth()` |
| **Signature** | Agent A changes a function's contract, Agent B uses the old contract | Never | Rename param, add required arg |
| **Dependency** | Agent A modifies X, Agent B reads X | Never | Agent A changes return type, Agent B destructures result |
| **Transitive** | Agent A modifies X, X used by Y, Agent B modifies Y | Never | Change in utility propagates through call chain |
| **Type-structural** | Agent A changes a type definition, Agent B creates instances of it | Never | Add required field to interface |
| **Import-path** | Agent A moves/renames a module, Agent B imports from old path | Sometimes | File rename vs import statement in different file |

**The insight:** The set of "git-clean merges that break the program" is larger than the set git catches. Semantic conflict prediction targets this gap.

---

## Tree-sitter Fundamentals

Tree-sitter is an incremental parsing library that generates concrete syntax trees. Runtime and supported grammar coverage depend on the pinned parser, grammar, file size, and repository workload; measure the local path before claiming real-time performance or language coverage.

### Why Tree-sitter (Not Regex, Not Full Compiler)

| Approach | Speed | Accuracy | Incremental | Multi-language |
|---|---|---|---|---|
| Regex/string matching | Measure on the target corpus | Can serve narrow lexical conventions; does not generally model nesting or scope | No | Manually maintained |
| Full compiler (tsc, rustc) | Measure for the pinned build | Compiler diagnostics and type information within configured scope | Toolchain-specific | Toolchain-specific |
| Tree-sitter | Measure for the pinned parser and corpus | Grammar-defined syntax; no general type inference | Supports incremental parsing | Installed grammar set only |
| Language server (LSP) | Measure for the pinned server/workload | May expose semantic services such as types and references within server support | Server-specific | Per server |

Tree-sitter can expose grammar-defined syntax and symbol structure when the required grammar is installed and parsing succeeds. It does not establish type-level or runtime behavior; measure latency and report grammar/parse coverage on the target repository.

**Boundary:** Regex can be useful for deliberately narrow lexical conventions, but it does not provide general syntax-tree scope or nesting. Tree-sitter applies the selected grammar and can report syntax nodes; parser success does not guarantee complete language support or correct symbol resolution for every repository construct.

### Setting Up Tree-sitter in Node.js

```bash
npm install tree-sitter tree-sitter-typescript tree-sitter-python tree-sitter-javascript
```

```typescript
import Parser from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';

const parser = new Parser();
parser.setLanguage(TypeScript.typescript);

const sourceCode = `
export function createRoutes(app: Express, db: Database): Router {
  const router = express.Router();
  router.get('/health', (req, res) => res.json({ ok: true }));
  return router;
}
`;

const tree = parser.parse(sourceCode);
const rootNode = tree.rootNode;
```

### Key Node Types by Language

**TypeScript/JavaScript:**
- `function_declaration` -- named function (`function foo() {}`)
- `arrow_function` -- arrow function (`const foo = () => {}`)
- `method_definition` -- class method (`class C { foo() {} }`)
- `class_declaration` -- class definition
- `variable_declarator` -- `const x = ...` (the `x = ...` part)
- `import_statement` -- `import { x } from './y'`
- `export_statement` -- `export function/class/const`
- `interface_declaration` -- `interface Foo { ... }`
- `type_alias_declaration` -- `type Foo = ...`
- `call_expression` -- function call (`foo(arg)`)
- `member_expression` -- property access (`obj.prop`)

**Python:**
- `function_definition` -- `def foo():`
- `class_definition` -- `class Foo:`
- `import_statement` -- `import x`
- `import_from_statement` -- `from x import y`
- `call` -- function call
- `attribute` -- `obj.attr`
- `decorated_definition` -- `@decorator` + function/class

### Querying with S-expressions

Tree-sitter queries use S-expression patterns to match AST nodes:

```typescript
// Find all exported function declarations with their names
const query = new Parser.Query(TypeScript.typescript, `
  (export_statement
    (function_declaration
      name: (identifier) @func_name
      parameters: (formal_parameters) @params
    )
  ) @export
`);

const matches = query.matches(tree.rootNode);
for (const match of matches) {
  const nameNode = match.captures.find(c => c.name === 'func_name');
  console.log(`Found exported function: ${nameNode.node.text}`);
}
```

```typescript
// Find all call expressions to a specific function
const callQuery = new Parser.Query(TypeScript.typescript, `
  (call_expression
    function: (identifier) @callee
    arguments: (arguments) @args
  )
`);
```

### Incremental Parsing

Tree-sitter's killer feature for conflict prediction: when code changes, you do not re-parse the entire file. You tell tree-sitter what changed and it updates the tree incrementally.

```typescript
// Initial parse
let tree = parser.parse(sourceCode);

// Code was edited: characters 50-60 were replaced with new text
tree.edit({
  startIndex: 50,
  oldEndIndex: 60,
  newEndIndex: 65,
  startPosition: { row: 3, column: 10 },
  oldEndPosition: { row: 3, column: 20 },
  newEndPosition: { row: 3, column: 25 },
});

// Re-parse using old tree -- only changed subtrees are re-parsed
tree = parser.parse(newSourceCode, tree);
```

If parser cost is material on the target workload, it affects claim-path latency. Measure parsing and graph-build time on the pinned repository/workload against the caller's declared latency budget; do not infer performance from this hypothetical example.

---

## Symbol-Level Claims

### The Granularity Hierarchy

Choose granularity from the declared deliverable and expected edit surface. A symbol claim can improve coordination when symbol resolution is current, but the preferred level is repository- and task-dependent; file, class, function, and statement scopes are not universal quality rankings. See [claim granularity](diagrams/research-s12-claim-granularity-and-declared-edit-surface.md).

**Decision framework:** Select scope from the declared deliverable, expected edit surface, and freshness/coverage of symbol resolution. Use a symbol scope only when the index can resolve it against the same source snapshot; choose a broader file or module scope for cross-cutting API changes, generated code, unresolved symbols, or stale/incomplete indexes. Do not assume one granularity is best for every task.

**Anti-pattern: Over-claiming.** An agent that claims the entire file "because it might need to change anything" defeats the purpose of granular claims. Over-claiming is the coordination equivalent of a global mutex -- it serializes all work.

**Anti-pattern: Under-claiming.** An agent that claims only the function it modifies but not the functions it calls is hiding dependencies. If it changes `validateInput()` and three other functions call `validateInput()`, those callers are implicit dependencies.

### Claim Types

```typescript
interface SymbolClaim {
  file: string;           // Relative path: 'src/server.ts'
  symbolPath: string[];   // Hierarchical: ['createRoutes'] or ['UserService', 'authenticate']
  claimType: 'modify' | 'read' | 'add-sibling' | 'add-child' | 'delete' | 'rename';
  agentId: string;
  sessionId: string;
  scopeConfidence?: number; // requester estimate only; not conflict probability
  timestamp: number;
}
```

**Claim types explained:**

| Type | Meaning | Example |
|---|---|---|
| `modify` | Will change the body or signature of this symbol | Rewriting a function's implementation |
| `read` | Depends on this symbol remaining stable | Calls this function, extends this class |
| `add-sibling` | Will add a new symbol at the same level | Adding a new method to a class, new export to a module |
| `add-child` | Will add a new symbol inside this one | Adding a statement inside a function |
| `delete` | Will remove this symbol | Removing a deprecated function |
| `rename` | Will change this symbol's name | Renaming a function, class, or variable |

**`rename` is the most dangerous claim type.** A rename affects every reference site across the entire codebase. It is an implicit read-claim on every file that imports or uses the symbol.

### Extracting Symbol Paths from Tree-sitter

```typescript
function extractSymbols(rootNode: Parser.SyntaxNode, filePath: string): Symbol[] {
  const symbols: Symbol[] = [];

  function walk(node: Parser.SyntaxNode, parentPath: string[]) {
    const symbolTypes = [
      'function_declaration',
      'method_definition',
      'class_declaration',
      'interface_declaration',
      'type_alias_declaration',
      'enum_declaration',
    ];

    if (symbolTypes.includes(node.type)) {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        const symbolPath = [...parentPath, nameNode.text];
        symbols.push({
          file: filePath,
          symbolPath,
          type: node.type,
          startLine: node.startPosition.row,
          endLine: node.endPosition.row,
          exported: isExported(node),
          parameters: extractParameters(node),
          returnType: extractReturnType(node),
        });

        // Recurse into children (e.g., methods inside classes)
        for (const child of node.children) {
          walk(child, symbolPath);
        }
        return; // Don't double-walk children
      }
    }

    // Non-symbol nodes: recurse normally
    for (const child of node.children) {
      walk(child, parentPath);
    }
  }

  walk(rootNode, []);
  return symbols;
}

// Handle variable declarations that are actually function expressions
function extractVariableSymbols(rootNode: Parser.SyntaxNode, filePath: string): Symbol[] {
  const query = new Parser.Query(language, `
    (variable_declarator
      name: (identifier) @name
      value: [(arrow_function) (function_expression)] @value
    )
  `);

  return query.matches(rootNode).map(match => {
    const nameNode = match.captures.find(c => c.name === 'name')!.node;
    return {
      file: filePath,
      symbolPath: [nameNode.text],
      type: 'function_expression',
      startLine: nameNode.startPosition.row,
      endLine: match.captures.find(c => c.name === 'value')!.node.endPosition.row,
      exported: isExported(nameNode.parent!.parent!),
    };
  });
}
```

**Shibboleth:** If someone's symbol extractor does not handle arrow functions assigned to `const`, it will miss half the functions in a modern TypeScript codebase. `const handler = async (req, res) => { ... }` is a function declaration in everything but AST node type.

---

## Dependency Graph Construction

The dependency graph answers: "If I change symbol X, what else might break?"

### Graph Structure

```typescript
interface DependencyGraph {
  nodes: Map<string, SymbolNode>;  // key: 'file.ts::ClassName.methodName'
  edges: Map<string, DependencyEdge[]>;
}

interface SymbolNode {
  id: string;              // 'src/server.ts::createRoutes'
  file: string;
  symbolPath: string[];
  type: 'function' | 'class' | 'method' | 'interface' | 'type' | 'variable';
  exported: boolean;
  signature?: string;      // For functions: parameter types + return type
}

interface DependencyEdge {
  from: string;   // Symbol that depends
  to: string;     // Symbol being depended on
  type: 'calls' | 'imports' | 'extends' | 'implements' | 'references' | 'instantiates';
  evidenceKind: 'direct' | 'conditional' | 'dynamic' | 'unknown'; // taxonomy only; not a calibrated weight
}
```

### Building the Graph Incrementally

Pin the source snapshot, parser and grammar version, and build configuration. Parse the claimed file and record parse errors; extract symbols and references supported by the available syntax; update only graph edges whose source snapshot is current; then compare the new claim with active claims. Mark unresolved names, dynamic calls, reflection, generated code, or stale indexes unknown instead of treating absence as evidence of no dependency. See [parse and trace a symbol claim](diagrams/research-s05-parse-and-trace-a-declared-symbol-claim-ascii-conversion.md).

### Import/Export Tracking

```typescript
function extractImports(rootNode: Parser.SyntaxNode, filePath: string): ImportInfo[] {
  const query = new Parser.Query(language, `
    (import_statement
      source: (string) @source
    ) @import
  `);

  return query.matches(rootNode).map(match => {
    const sourceNode = match.captures.find(c => c.name === 'source')!.node;
    const importNode = match.captures.find(c => c.name === 'import')!.node;

    // Extract named imports
    const namedQuery = new Parser.Query(language, `
      (import_specifier
        name: (identifier) @imported
        alias: (identifier)? @alias
      )
    `);

    const names = namedQuery.matches(importNode).map(m => ({
      imported: m.captures.find(c => c.name === 'imported')!.node.text,
      alias: m.captures.find(c => c.name === 'alias')?.node.text,
    }));

    return {
      file: filePath,
      source: resolveImportPath(filePath, sourceNode.text),
      namedImports: names,
      isDefault: importNode.text.includes('import ') && !importNode.text.includes('{'),
      isNamespace: importNode.text.includes('* as'),
    };
  });
}
```

### Call Graph Construction

```typescript
function extractCallsFromFunction(
  funcNode: Parser.SyntaxNode,
  containingSymbol: string
): CallEdge[] {
  const edges: CallEdge[] = [];

  const callQuery = new Parser.Query(language, `
    (call_expression
      function: [
        (identifier) @direct_call
        (member_expression
          object: (identifier) @object
          property: (property_identifier) @method
        )
      ]
      arguments: (arguments) @args
    )
  `);

  const matches = callQuery.matches(funcNode);
  for (const match of matches) {
    const directCall = match.captures.find(c => c.name === 'direct_call');
    const object = match.captures.find(c => c.name === 'object');
    const method = match.captures.find(c => c.name === 'method');
    const args = match.captures.find(c => c.name === 'args')!;

    if (directCall) {
      edges.push({
        from: containingSymbol,
        to: directCall.node.text,
        type: 'calls',
        argCount: countArguments(args.node),
        evidenceKind: isInsideConditional(directCall.node) ? 'conditional' : 'direct',
      });
    } else if (object && method) {
      edges.push({
        from: containingSymbol,
        to: `${object.node.text}.${method.node.text}`,
        type: 'calls',
        argCount: countArguments(args.node),
        evidenceKind: isInsideConditional(object.node) ? 'conditional' : 'direct',
      });
    }
  }

  return edges;
}
```

### Type Dependency Tracking

```typescript
function extractTypeDependencies(rootNode: Parser.SyntaxNode): TypeEdge[] {
  const edges: TypeEdge[] = [];

  // Find class extensions
  const extendsQuery = new Parser.Query(language, `
    (class_declaration
      name: (type_identifier) @class_name
      (class_heritage
        (extends_clause
          value: (identifier) @parent_class
        )
      )
    )
  `);

  // Find interface implementations
  const implementsQuery = new Parser.Query(language, `
    (class_declaration
      name: (type_identifier) @class_name
      (class_heritage
        (implements_clause
          (type_identifier) @interface_name
        )
      )
    )
  `);

  // Find type references in parameter types, return types, variable types
  const typeRefQuery = new Parser.Query(language, `
    (type_identifier) @type_ref
  `);

  // ... build edges from matches
  return edges;
}
```

---

## Conflict Prediction Algorithm

Given two sets of claims from two agents, predict whether their work will conflict.

### Decision Tree: Is This a Conflict?

Use the authored decision map as candidate classification only; it does not establish runtime semantic conflict. See [conflict candidates and uncertainty](diagrams/research-s06-conflict-candidates-not-semantic-verdicts-ascii-conversion.md).



### The Conflict Matrix

When two claims land on the same symbol, the conflict depends on claim types:

| Agent A \ Agent B | modify | read | add-sibling | add-child | delete | rename |
|---|---|---|---|---|---|---|
| modify | BLOCK | WARN | SAFE | WARN | BLOCK | BLOCK |
| read | WARN | SAFE | SAFE | SAFE | BLOCK | BLOCK |
| add-sibling | SAFE | SAFE | SAFE | SAFE | WARN | WARN |
| add-child | WARN | SAFE | SAFE | WARN | BLOCK | BLOCK |
| delete | BLOCK | BLOCK | WARN | BLOCK | BLOCK | BLOCK |
| rename | BLOCK | BLOCK | WARN | BLOCK | BLOCK | BLOCK |

**Reading the matrix:** Treat the matrix as a heuristic for coordination, not a proof that edits are compatible or incompatible. Validate overlap against current symbols, scope, contracts, and integration results; unresolved dependency evidence stays advisory/unknown. The fixed-width matrix remains a data table, not a diagram.

### Candidate evidence (not probability)

Do not infer conflict likelihood from dependency distance or a hand-written score. Emit transparent evidence and severity labels for reviewer/coordinator triage. Calibrate any ranking model only on held-out integration outcomes.

```typescript
interface ConflictPrediction {
  agentA: string;
  agentB: string;
  symbolA: string;
  symbolB: string;
  conflictType: 'direct' | 'dependency' | 'transitive' | 'signature' | 'type-structural';
  severity: 'blocking' | 'warning' | 'info';
  evidence: string[];  // structural observations; unresolved evidence remains unknown
  explanation: string;
  suggestedResolution: string;
}


```

### The Full Prediction Pipeline

```typescript
function predictConflicts(
  claimsA: SymbolClaim[],
  claimsB: SymbolClaim[],
  graph: DependencyGraph,
  policy: { maxDependencyHops: number }
): ConflictPrediction[] {
  const predictions: ConflictPrediction[] = [];

  for (const a of claimsA) {
    for (const b of claimsB) {
      const aId = symbolId(a);
      const bId = symbolId(b);

      // Check 1: Direct conflict (same symbol)
      if (aId === bId) {
        const severity = CONFLICT_MATRIX[a.claimType][b.claimType];
        if (severity !== 'safe') {
          predictions.push({
            agentA: a.agentId,
            agentB: b.agentId,
            symbolA: aId,
            symbolB: bId,
            conflictType: 'direct',
            severity,
            evidence: [`same symbol: ${aId}`, `${a.claimType} vs ${b.claimType}`],
            explanation: `Both agents claim ${aId}: ${a.claimType} vs ${b.claimType}`,
            suggestedResolution: severity === 'blocking'
              ? `Serialize: one agent must complete before the other starts`
              : `Coordinate: agents should communicate about changes to ${aId}`,
          });
        }
        continue;
      }

      // Check 2: Dependency conflict
      const pathAtoB = findShortestPath(graph, aId, bId);
      const pathBtoA = findShortestPath(graph, bId, aId);
      const path = pathAtoB ?? pathBtoA;

      if (path && path.length <= policy.maxDependencyHops) { // policy parameter; calibrate cost/coverage locally
        const isModifyRead =
          (a.claimType === 'modify' && b.claimType === 'read') ||
          (b.claimType === 'modify' && a.claimType === 'read');

        const severity = path.length === 1 ? 'warning' : 'info';
        predictions.push({
            agentA: a.agentId,
            agentB: b.agentId,
            symbolA: aId,
            symbolB: bId,
            conflictType: path.length === 1 ? 'dependency' : 'transitive',
            severity,
            evidence: [`dependency path length=${path.length}`, `source snapshot and graph freshness recorded by caller`],
            explanation: `${aId} ${a.claimType} -> ${path.map(e => e.to).join(' -> ')} <- ${bId} ${b.claimType}`,
            suggestedResolution: isModifyRead
              ? `Agent modifying ${aId} should notify agent reading it before changing the contract`
              : `Unverified transitive candidate. Review current scope and integration evidence; do not block from this path alone.`,
          });
        }
      }

      // Check 3: Signature conflict
      if (a.claimType === 'modify' && b.claimType !== 'modify') {
        const callers = graph.edges.get(aId)?.filter(e => e.type === 'calls') ?? [];
        const bCallsA = callers.some(e => e.from === bId);
        if (bCallsA) {
          predictions.push({
            agentA: a.agentId,
            agentB: b.agentId,
            symbolA: aId,
            symbolB: bId,
            conflictType: 'signature',
            severity: 'warning',
            evidence: [`declared call edge from ${bId} to ${aId}`, `signature impact not verified`],
            explanation: `Agent A may change the signature of ${aId}, which Agent B calls from ${bId}`,
            suggestedResolution: `Agent A: if changing ${aId}'s signature, add backward-compatible overload or notify Agent B`,
          });
        }
      }
    }
  }

  // Sort by declared severity only; no numeric probability is inferred.
  return predictions.sort((a, b) => {
    const severityOrder = { blocking: 0, warning: 1, info: 2 };
    const sevDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (sevDiff !== 0) return sevDiff;
    return 0;
  });
}
```

---

## Integration with Port Daddy

Port Daddy currently supports file-level claims (`POST /sessions/:id/files`). Symbol-level claims extend this with richer semantics.

### Proposed API: Symbol Claims

```
POST /sessions/:id/symbols
Content-Type: application/json

{
  "claims": [
    {
      "file": "src/server.ts",
      "symbolPath": ["createRoutes"],
      "claimType": "modify"
    },
    {
      "file": "src/routes/index.ts",
      "symbolPath": ["registerRoutes"],
      "claimType": "read"
    }
  ]
}

Response 200:
{
  "claimed": 2,
  "conflicts": [
    {
      "conflictType": "dependency",
      "severity": "warning",
      "evidence": ["declared dependency edge", "scope overlap requires review"],
      "otherAgent": "agent-xyz",
      "otherSession": "session-456",
      "symbol": "src/routes/index.ts::registerRoutes",
      "explanation": "Agent 'agent-xyz' has a modify claim on registerRoutes, which you declared a read dependency on",
      "suggestedResolution": "Coordinate with agent-xyz: your read depends on their modification"
    }
  ]
}

Response 409 (blocking conflict):
{
  "claimed": 0,
  "conflicts": [
    {
      "conflictType": "direct",
      "severity": "blocking",
      "evidence": ["same symbol", "incompatible claim types"],
      "otherAgent": "agent-abc",
      "otherSession": "session-789",
      "symbol": "src/server.ts::createRoutes",
      "explanation": "Agent 'agent-abc' already has a modify claim on createRoutes",
      "suggestedResolution": "Wait for agent-abc to complete, or negotiate via pub/sub channel 'symbol-conflicts'"
    }
  ]
}
```

### Arbiter Invariant: SymbolClaimConsistency

```
SymbolClaimConsistency:
  For all pairs of active sessions (S1, S2) where S1 != S2:
    For all symbol claims (C1 in S1, C2 in S2):
      If C1.symbol == C2.symbol:
        CONFLICT_MATRIX[C1.claimType][C2.claimType] != 'blocking'

Violation triggers: Alert + optional session pause for blocking conflicts
Check strategy: Synchronous on every POST /sessions/:id/symbols
```

### CLI Integration

```bash
# Claim symbols for your session
pd session symbols claim $SESSION_ID \
  --file src/server.ts --symbol createRoutes --type modify \
  --file src/routes/index.ts --symbol registerRoutes --type read

# Check for conflicts without claiming
pd session symbols check $SESSION_ID \
  --file src/server.ts --symbol createRoutes --type modify

# List all symbol claims across active sessions
pd session symbols list --active

# Show dependency graph for a symbol
pd symbols deps src/server.ts::createRoutes --depth 3
```

### Integration Architecture

See [claim submission and parse-failure boundary](diagrams/research-s07-claim-submission-and-parse-failure-boundary-ascii-conversion.md); route diagrams describe candidate processing, not a guarantee of complete semantic resolution.

[Converted workflow: claim submission, symbol resolution, unknown path, and integration review](diagrams/research-s07-claim-submission-and-parse-failure-boundary-ascii-conversion.md). The diagram is a proposed flow; current product/API support must be verified independently.

---

## Tree-sitter Beyond Conflict Prediction

Once you have tree-sitter parsing infrastructure, it unlocks capabilities far beyond conflict detection.

### Code Search and Navigation

```typescript
// "Find all functions that take a Database parameter"
const dbParamQuery = new Parser.Query(language, `
  (function_declaration
    name: (identifier) @name
    parameters: (formal_parameters
      (required_parameter
        pattern: (identifier)
        type: (type_annotation
          (type_identifier) @param_type
        )
      )
    )
  )
`);

// Filter matches where @param_type.text === 'Database'
```

### Automated Refactoring

```typescript
// Rename a function across the codebase
function renameSymbol(
  graph: DependencyGraph,
  symbolId: string,
  newName: string
): FileEdit[] {
  const edits: FileEdit[] = [];
  const node = graph.nodes.get(symbolId);
  if (!node) throw new Error(`Symbol not found: ${symbolId}`);

  // Edit 1: The declaration itself
  edits.push({
    file: node.file,
    oldText: node.symbolPath[node.symbolPath.length - 1],
    newText: newName,
    line: node.startLine,
  });

  // Edit 2: All reference sites
  const references = findAllReferences(graph, symbolId);
  for (const ref of references) {
    edits.push({
      file: ref.file,
      oldText: node.symbolPath[node.symbolPath.length - 1],
      newText: newName,
      line: ref.line,
    });
  }

  // Edit 3: Import statements
  const importRefs = findImportReferences(graph, symbolId);
  for (const imp of importRefs) {
    edits.push({
      file: imp.file,
      oldText: node.symbolPath[node.symbolPath.length - 1],
      newText: newName,
      line: imp.line,
    });
  }

  return edits;
}
```

### Code Metrics

```typescript
function cyclomaticComplexity(funcNode: Parser.SyntaxNode): number {
  let complexity = 1; // Base path

  const branchTypes = [
    'if_statement', 'else_clause',
    'for_statement', 'for_in_statement',
    'while_statement', 'do_statement',
    'switch_case',
    'catch_clause',
    'ternary_expression',   // ? :
    'binary_expression',    // && and || (short-circuit)
  ];

  function walk(node: Parser.SyntaxNode) {
    if (branchTypes.includes(node.type)) {
      if (node.type === 'binary_expression') {
        const op = node.childForFieldName('operator');
        if (op && (op.text === '&&' || op.text === '||')) {
          complexity++;
        }
      } else {
        complexity++;
      }
    }
    for (const child of node.children) {
      walk(child);
    }
  }

  walk(funcNode);
  return complexity;
}
```

### Architecture Enforcement

```typescript
// Define allowed import rules
const architectureRules: ImportRule[] = [
  { from: 'routes/*',  canImport: ['lib/*', 'types/*'],    cannotImport: ['routes/*'] },
  { from: 'lib/*',     canImport: ['lib/*', 'types/*'],    cannotImport: ['routes/*'] },
  { from: 'types/*',   canImport: [],                      cannotImport: ['lib/*', 'routes/*'] },
];

function checkArchitectureViolations(
  imports: ImportInfo[],
  rules: ImportRule[]
): Violation[] {
  return imports.flatMap(imp => {
    const rule = rules.find(r => matchGlob(imp.file, r.from));
    if (!rule) return [];

    const forbidden = rule.cannotImport.some(p => matchGlob(imp.source, p));
    if (forbidden) {
      return [{
        file: imp.file,
        source: imp.source,
        rule: `${rule.from} cannot import from ${rule.cannotImport.join(', ')}`,
        severity: 'error',
      }];
    }
    return [];
  });
}
```

---

## Practical Limitations

### What Tree-sitter Cannot See

**Dynamic dispatch:**
```typescript
const handler = handlers[req.method]; // Which function? Unknown statically.
handler(req, res);
```
Tree-sitter sees a call to `handler` but cannot by itself resolve which function `handlers[req.method]` points to. Mark this dependency unknown unless another analysis supplies complete target evidence.

**Mitigation:** Track assignments where the analysis supports them and enumerate possible targets. If the target set is incomplete, report unknown coverage; do not infer a numeric confidence reduction.

**Reflection and metaprogramming:**
```typescript
class.prototype[methodName] = function() { ... };
Reflect.apply(target, thisArg, args);
eval(`${funcName}(${args})`);
```

**Mitigation:** Mark `eval`, `Reflect`, and dynamic property assignment as unresolved unless a separate analysis resolves the targets. Do not encode unknown as numeric zero confidence; report the affected coverage and route for review.

**String-based references:**
```json
// config.json
{ "handler": "src/handlers/auth.ts:handleLogin" }
```
```yaml
# docker-compose.yml
services:
  api:
    command: "node src/server.ts"
```

**Mitigation:** Maintain a registry of known config-to-code mappings. Parse common config formats (JSON, YAML, TOML) and resolve string references where patterns are known. Accept that novel config formats will be missed.

**Cross-language boundaries:**
```typescript
// TypeScript calls native addon
const { compress } = require('./native/zlib.node');
```

**Mitigation:** Mark cross-language edges unresolved unless an indexed binding/build artifact establishes them. State language/parser coverage rather than assigning an uncalibrated confidence score.

### Performance Characteristics

| Operation | Time | Memory | Notes |
|---|---|---|---|
| Operation | Cost boundary | Measurement needed |
|---|---|---|
| Parse one file / project | Parser, grammar, file size, cache, and hardware dependent | Measure cold and warm runs on declared corpus. |
| Extract symbols / references | Depends on grammar queries and unresolved syntax | Record parse coverage and query cost. |
| Build/update dependency graph | Depends on project size, imports, and language features | Measure full build and incremental invalidation. |
| Compare claim sets / traverse paths | Depends on claim count, graph size, policy bound, and cache | Measure candidate count, truncation, precision/recall, and latency. |

**Performance anti-pattern:** Rebuilding the entire dependency graph on every claim. The graph should be built once at daemon startup (or lazily on first access), then updated incrementally as files change and claims arrive.

**Performance anti-pattern:** Parsing files that have not changed since last parse. Cache parse trees keyed by `(filePath, contentHash)`. Tree-sitter trees are re-usable across queries.

### The 80/20 Rule for Conflict Prediction

You do not need perfect analysis to be useful. The goal is to test whether candidate warnings help coordinators catch integration problems at acceptable review cost. Claim reduced merge failures only after a controlled, held-out comparison against an equal-effort baseline.

In practice, report candidate categories separately: same-symbol overlap, signature/declared-reference paths, transitive candidates, and unresolved dynamic/reflection/cross-language coverage. Even direct overlap is not proof of semantic conflict or integration failure. Measure detection and false alarms against adjudicated changes in the target repositories; no inherited percentages are treated as validated rates.

---

## Decision Frameworks

Use these diagrams as policy-choice checklists, then validate the chosen claims against the live build and authority model:

- [Choose prediction scope and evidence](diagrams/research-s08-conflict-evidence-pipeline-ascii-conversion.md)
- [Choose advisory versus enforcement](diagrams/research-s09-trust-boundary-for-conflict-enforcement-ascii-conversion.md)
- [Handle missing or unparseable claims](diagrams/research-s10-candidate-claims-have-an-evidence-path-ascii-conversion.md)

Treat absence from a parse or graph as `UNKNOWN`, not `SAFE`. An enforced 409 is appropriate only when a locally verified policy says the exact claim conflict blocks admission; do not require a score of `1.0` or label a ranking score as confidence. Advisory mode remains the default unless route coverage and consequence analysis justify stronger enforcement.

---

## Anti-Patterns

### 1. The Global Mutex
**Symptom:** Agent claims an entire file when the declared work is narrower.
**Result:** Unrelated work may be serialized without evidence.
**Fix:** Prefer the smallest reviewable declared surface supported by parser/index coverage; use file-level or broader claims when generated/API-wide changes or incomplete indexing require them. Explain the scope choice.

### 2. The Silent Consumer
**Symptom:** Agent reads a function's output but does not declare a `read` claim.
**Result:** When the function changes, the silent consumer breaks with no warning.
**Fix:** Suggest a read dependency only when a current, declared analysis resolves the call edge; show the evidence and let the owning agent or coordinator confirm it. Mark dynamic, stale, or incomplete paths unknown rather than minting a claim automatically.

### 3. The Premature Optimizer
**Symptom:** Choosing a parser or language server before defining the semantic evidence the detector needs.
**Result:** Extra integration cost or missing evidence, depending on the repository and toolchain.
**Fix:** Start with the narrowest tool that supplies the required evidence on the target repository. Compare grammar-based syntax against compiler or language-server information when type/reference resolution matters; measure integration cost and coverage instead of assuming a universal winner.

### 4. The Overfitter
**Symptom:** Predicting conflicts at expression granularity.
**Result:** Every agent conflicts with every other agent because they both use `console.log`.
**Fix:** Choose granularity and any edge filters from declared task scope and measured false-alarm/miss costs. Treat standard-library or leaf-expression exclusions as policy hypotheses; test them against held-out repository changes and disclose what coverage they remove.

### 5. The Graph Maximalist
**Symptom:** Computing unbounded transitive dependencies without reporting cost or uncertainty.
**Result:** Large candidate sets and indirect paths can obscure review; depth alone does not establish conflict likelihood.
**Fix:** Expose a configurable query budget/depth, record truncation as unknown coverage, and validate precision/recall and cost across held-out repositories before setting policy.

### 6. The Config Ignorer
**Symptom:** Only analyzing source code, ignoring config files that reference source symbols.
**Result:** Agent renames a handler function. Config still references the old name. Runtime crash.
**Fix:** Parse config files (JSON, YAML, TOML) and treat string values that match symbol names as soft dependencies.

---

## Shibboleths: How to Tell if Someone Understands This Domain

**They understand:** "We parse with tree-sitter for structure, not for types. Type inference is the compiler's job -- we just need to know what calls what."

**They do not understand:** "We can use regex to find function definitions and then grep for calls." (Structural nesting, scope, and aliasing make regex unreliable for anything beyond toy examples.)

**They understand:** "A rename claim is the most dangerous claim type because it implies read-claims on every reference site across the entire codebase."

**They do not understand:** "Rename is just a modify claim on one symbol." (Renames have global blast radius.)

**They understand:** "Dependency distance is a structural feature, not a calibrated probability. We report the path and let the coordinator review its current scope."

**They do not understand:** "All conflicts are equally important." (Severity labels are policy triage, not measured likelihood.)

**They understand:** "The hard part is not the AST parsing. It is maintaining the dependency graph incrementally without re-analyzing the entire project on every change."

**They do not understand:** "Just parse all the files every time someone makes a claim." (A full parse per claim may be costly on a large repository; measure the pinned build and use incremental updates or bounded indexing when the workload warrants it.)

**They understand:** "Dynamic dispatch can leave target sets unknown; we report the affected coverage and evidence rather than an uncalibrated confidence value."

**They do not understand:** "Our static analysis catches every relevant integration conflict." (Syntax and dependency evidence have declared scope; dynamic behavior and compatibility need separate evidence.)

---

## References and Further Reading

- **Tree-sitter documentation:** https://tree-sitter.github.io/tree-sitter/
- **Tree-sitter playground:** https://tree-sitter.github.io/tree-sitter/playground (interactive AST visualization)
- **node-tree-sitter:** https://github.com/tree-sitter/node-tree-sitter
- **Port Daddy:** coordination daemon that this skill extends (see `~/coding/port-daddy/`)
- **runtime-verification-for-agents:** companion skill for enforcing invariants at runtime
- **multi-agent-coordination:** companion skill for the coordination layer this builds on
- **Rice's theorem:** undecidability of non-trivial semantic properties of programs (why perfect static analysis is impossible)
- **Binkley & Harman (2004):** "A Survey of Empirical Results on Program Slicing" -- dependency analysis foundations
- **Horwitz, Reps & Binkley (1990):** "Interprocedural Slicing Using Dependence Graphs" -- the formal basis for cross-function dependency tracking


See [source correction ledger](references/source-correction-ledger.md) for withdrawn unvalidated numerical accuracy, path-depth, and performance claims.

## Evidence boundary and calibration

See [evidence and calibration](references/evidence-and-calibration.md) for the linked procedure and source limits.

Tree-sitter parses grammar-shaped syntax and supports syntax-node queries. It does not by itself resolve all names, types, macros, reflection, generated code, runtime dispatch, or semantic compatibility. Record source snapshot, parser/grammar/build configuration, parse errors, and unknown language features. Same-symbol overlap and dependency edges are structural evidence; integrated builds/tests or reviewed behavior supply outcome evidence. Return an advisory candidate or `UNKNOWN` when the index is stale/incomplete.

Do not expose `confidence` as probability unless calibrated against independently adjudicated repository/task outcomes. Split by repository or time before tuning and report held-out precision/recall by language/configuration. The research pass found no verified study supporting inherited semantic-conflict accuracy percentages. Official docs support only syntax/query scope: [Tree-sitter syntax/query docs](https://tree-sitter.github.io/tree-sitter/using-parsers/queries/1-syntax.html) and [grammar authoring guide](https://tree-sitter.github.io/tree-sitter/creating-parsers/3-writing-the-grammar.html).

The diagram index links an UNKNOWN/advisory overview and each converted workflow: [conflict overview](diagrams/01_flowchart_decision-points.md), S05, S06, S07, S08, S09, S10, and [claim granularity](diagrams/research-s12-claim-granularity-and-declared-edit-surface.md).
