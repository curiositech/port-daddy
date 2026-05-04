# 0026. Fleet AST + Diagnostic Taxonomy

## Status

PROPOSED

## Context

ADR-0019 introduced `pd-fleet.yml` and a `FleetConfig` runtime model.
`lib/fleet-engine.ts` ships a working parser (`loadFleetConfig`) and a small
`validateTopology()` that detects cycles plus four flat-string warnings (no
producer, undeclared channel, missing budget, etc.).

That is enough for `pd fleet up` to refuse to start a broken fleet. It is not
enough for the Fleet Console vision: a YAML editor in the dashboard that
decorates each line with errors, warnings, cost predictions, and "this channel
never fires in this project" hints.

The gap between today's parser and that vision is structural, not cosmetic:

1. **No source spans.** `loadFleetConfig` produces a logical `FleetConfig`
   directly. The original line/column of every key is discarded. A UI cannot
   draw a red squiggle without ranges; a CLI cannot print
   `pd-fleet.yml:42:5: error[FLEET004]: ...` without ranges either.
2. **No diagnostic shape.** Warnings are `string[]`. There is no severity, no
   stable code, no related fix, no documentation link. The Console needs all
   four to render and the CLI needs them to make `--json` output stable enough
   to script against.
3. **No project-graph or cost inputs.** The interesting diagnostics ("this
   event never fires here", "this will burn $42/day") need data that lives
   outside the YAML: pub/sub history, cron expansion, `cost-tracker.ts`
   rates. None of that is wired into the validator today.
4. **No layering contract.** The Console, the CLI, the LSP, and a future
   GitHub Action will all want the same diagnostics. Without a single
   producer that returns a stable JSON shape, each surface will roll its own
   and they will drift.

This ADR defines the foundation. Visual builder, registry, semantic merge,
and prod-relay flag are explicitly out of scope (see Non-goals).

## Decision Drivers

- One producer of diagnostics, many consumers (CLI, dashboard, LSP, CI).
- Diagnostics must be addressable: severity, code, range, message, optional fix.
- Source spans must survive YAML → AST. Comments and trivia don't have to.
- Cost and project-graph analyzers must be replaceable; an analyzer can fail
  or be unavailable (no PD daemon, no cost history) without nuking the lint.
- Stay backwards-compatible: the existing `FleetConfig` and `validateTopology`
  contracts keep working. The new world layers above them.

## Decision

Introduce two new modules and a single CLI surface:

- `lib/fleet-ast.ts` — Source-aware parse (`parseFleetSource`) that returns a
  `FleetAst` with positions on every node, plus a lossy projection
  `astToConfig()` that produces today's `FleetConfig`.
- `lib/fleet-diagnostics.ts` — A `lintFleet(ast, ctx)` function that runs a
  pluggable list of analyzers and returns `Diagnostic[]`. Each diagnostic has
  a stable code, severity, range, human message, and optional fix.
- `pd fleet lint [--json] [--format=human|sarif]` — Thin CLI over
  `lintFleet`. JSON output is the contract every other surface consumes.

Today's `validateTopology()` becomes one analyzer of many, called
`topology` and emitting codes `FLEET001..FLEET004` to preserve behavior. New
analyzers are additive.

## The AST

`FleetAst` mirrors the YAML structure but adds a `range` to every node and
preserves enough information that diagnostics can point at the right token.

```ts
// lib/fleet-ast.ts
export interface SourceRange {
  start: { line: number; column: number; offset: number };
  end:   { line: number; column: number; offset: number };
}

export interface FleetAstNode<T extends string> {
  kind: T;
  range: SourceRange;
}

export interface FleetAst extends FleetAstNode<'fleet'> {
  name:     StringNode;
  harbor?:  StringNode;
  limits?:  LimitsNode;
  defaults?: DefaultsNode;
  agents:   Map<string, AgentNode>;   // keyed by agent name, range covers the key
  watchers: Map<string, WatcherNode>;
  channels: Map<string, ChannelNode>;
  trivia:   TriviaNode[];             // comments, blank-line groups (for fix output)
}

export interface AgentNode extends FleetAstNode<'agent'> {
  name:     StringNode;
  prompt?:  StringNode;
  trigger?: ChannelRefNode;
  schedule?: CronNode;
  triggerTuple?: TupleNode;
  backend?: EnumNode<Backend>;
  model?:   StringNode;
  modelTier?: EnumNode<ModelTier>;
  worktree?: BoolNode;
  singleton?: BoolNode;
  onSuccess?: PublishActionNode;       // parsed: { action: 'publish', channel: ChannelRefNode }
  onFailure?: PublishActionNode;
  identity?: StringNode;
  timeout?:  IntNode;
  allowedTools?: StringNode;
  fallbacks?: RuntimeTargetNode[];
  cooldownMs?: IntNode;
  /* …all properties from pd-fleet.schema.json, each as a typed node… */
}

export interface ChannelRefNode extends FleetAstNode<'channelRef'> {
  channel: string;        // the literal string
  declared: boolean;      // populated post-parse: did `channels:` register it?
}

export interface CronNode extends FleetAstNode<'cron'> {
  expression: string;
  approxRunsPerHour?: number;   // populated by analyzer, not parser
  parseError?: string;
}
```

Notes:

- We use a YAML library that exposes positions (`yaml` ≥ v2 has `cstNode` /
  `range`). The AST is a thin re-shaping over its CST output.
- `astToConfig(ast): FleetConfig` is the lossy projection that today's
  `loadFleetConfig` already produces. We keep it so nothing downstream breaks.
- The AST is immutable. Edits in the future visual builder produce a new AST
  and serialize it back via a separate `serializeFleet(ast): string`. That
  serializer is not part of this ADR.

## The Diagnostic Taxonomy

```ts
// lib/fleet-diagnostics.ts
export type Severity = 'error' | 'warning' | 'info' | 'hint';

export interface Diagnostic {
  code:     string;          // e.g. 'FLEET007' — stable across releases
  severity: Severity;
  range:    SourceRange;     // primary location (the squiggle)
  message:  string;          // one sentence, ends with a period
  related?: RelatedLocation[]; // e.g. "channel declared here, never published"
  fix?:     Fix;             // optional, machine-applicable
  doc?:     string;          // url or doc anchor: 'pd-fleet#FLEET007'
  source:   'topology' | 'cost' | 'project-graph' | 'schema' | 'cron' | 'security';
}

export interface RelatedLocation { range: SourceRange; message: string; }

export interface Fix {
  title: string;
  edits: TextEdit[];         // VS Code-style
}

export interface TextEdit { range: SourceRange; newText: string; }
```

Severities mean what `tsc` and the LSP spec mean by them:

- **error**: `pd fleet up` MUST refuse to start.
- **warning**: starts, but `pd fleet lint --strict` exits non-zero. CI bait.
- **info**: visible in the Console gutter; ignored by CLI by default.
- **hint**: refactor suggestion, faint underline only.

Codes are stable. Once shipped, a code's severity can be lowered but never
re-purposed. Removed codes are reserved, never reused.

## Initial Diagnostic Catalog

Codes 001–004 reproduce today's `validateTopology` output so we don't regress.

| Code      | Severity | Source        | Rule                                                                                              |
|-----------|----------|---------------|---------------------------------------------------------------------------------------------------|
| FLEET001  | error    | topology      | Trigger graph has a cycle. (Already detected.)                                                    |
| FLEET002  | warning  | topology      | Channel declared in `channels:` has no producer and is not marked `external_producer`.            |
| FLEET003  | warning  | topology      | Agent publishes to a channel that is not declared in `channels:`.                                 |
| FLEET004  | error    | topology      | `fleet.limits.budget_usd_per_day` is required when `agents:` is non-empty.                        |
| FLEET005  | error    | schema        | YAML failed JSON-schema validation. (Wraps the AJV error with a real range.)                      |
| FLEET006  | error    | schema        | Agent has neither `trigger`, `schedule`, nor `triggerTuple`. It will never fire.                  |
| FLEET007  | warning  | project-graph | "This event never fires in this project" — channel has zero pub history in PD's pubsub log.       |
| FLEET008  | warning  | cost          | Predicted daily cost exceeds `limits.budget_usd_per_day`. Includes the math in the message.       |
| FLEET009  | info     | cost          | Predicted daily cost is in the top decile of fleets we have data for. Suggests `model_tier: low`. |
| FLEET010  | error    | cron          | Cron expression failed to parse. (Caught here, not at runtime.)                                   |
| FLEET011  | hint     | topology      | Channel has > 4 consumers. Consider splitting or using a tuple pattern for selectivity.           |
| FLEET012  | hint     | security      | Agent `worktree: false` AND has destructive `allowedTools` (Bash, Write). Suggest worktree.       |
| FLEET013  | warning  | topology      | `on_success: publish X` where X is consumed only by self → trivial loop guarded by cooldown only. |
| FLEET014  | info     | topology      | `singleton: true` agent triggered by a high-rate channel; consider `dedupe_window_ms`.            |

The catalog is open-ended. New codes get a section in `docs/fleet/diagnostics.md`
with example, rationale, and fix.

The user-facing wording in the Fleet Console message ("this can't run", "this
event never fires", "this will cost $$$ in $TIME, are you sure?", "consider
adding ___") maps directly to this catalog: FLEET006/FLEET010 are the "can't
run" set; FLEET007 is "never fires"; FLEET008/FLEET009 are the cost prompts;
FLEET011/FLEET012/FLEET014 are the "consider adding" hints.

## Analyzer Inputs

The signature is `lintFleet(ast: FleetAst, ctx: LintContext): Diagnostic[]`,
where `LintContext` carries everything an analyzer might need.

```ts
export interface LintContext {
  projectDir:   string;
  projectName:  string;
  pubsubHistory?: PubsubHistory;     // optional — analyzers degrade gracefully
  costRates?:   CostRates;
  cronClock?:   CronClock;
  now:          Date;
}

export interface PubsubHistory {
  // A read-only view of PD's pubsub log scoped to this project.
  channelStats(channel: string): { firstSeen: Date | null; count: number; lastSeen: Date | null };
}

export interface CostRates {
  perInvocationUsd(target: { backend: string; model?: string; modelTier?: string }):
    { usd: number; isEstimate: boolean };
}

export interface CronClock {
  approxRunsPerHour(expression: string): number | { error: string };
}
```

Where each input comes from:

- **PubsubHistory** — new query over PD's existing pubsub log table, scoped by
  project hash. Cheap; one indexed query per channel-ref. Absent when running
  outside a daemon (CI lint of a YAML); analyzers using it must skip cleanly.
- **CostRates** — wraps `lib/cost-tracker.ts` `MODEL_RATES` and the
  flat-per-session estimate table. Already in-tree; this ADR just exposes it
  through a narrower interface so analyzers don't import the whole tracker.
- **CronClock** — uses the same cron lib `pd fleet up` already uses
  (currently `cron-parser` based on imports). Returns a runs-per-hour number
  by stepping `next()` over a one-hour window.

Predicted daily cost (FLEET008) is then:

```
runsPerDay      = cronRunsPerHour(agent.schedule) * 24
                  || pubsubRate(agent.trigger) * 86400
runsPerDay      *= 1 - dedupe_window adjustment
predictedUsd    = runsPerDay * costRates.perInvocationUsd(resolved runtime).usd
```

If `predictedUsd > limits.budget_usd_per_day` → FLEET008 with the actual math
in the message: `Predicted $4.20/day (840 runs × $0.005) exceeds budget $1.00/day.`

## CLI Surface

```
pd fleet lint                  # human format, exit 0 on no errors
pd fleet lint --strict         # exit 1 on warnings too
pd fleet lint --json           # machine-readable: { diagnostics: Diagnostic[] }
pd fleet lint --format=sarif   # GitHub Code Scanning compatible
pd fleet lint --only=topology  # restrict to one analyzer (for debugging)
pd fleet lint --since=7d       # cost/project-graph use a 7-day window
```

`pd fleet up` calls `lintFleet` internally and refuses to start if any
`error` diagnostic is present. Today's hard validation paths route through
the same producer.

## Layering

```
yaml source ──► parseFleetSource ──► FleetAst ──► lintFleet ──► Diagnostic[]
                                          │
                                          └─► astToConfig ──► FleetConfig (existing)
                                                                  │
                                                                  └─► createFleetRunner (existing)
```

The Fleet Console panel (a later ADR) consumes the JSON output of
`pd fleet lint --json` over an HTTP endpoint, decorates a Monaco editor with
the ranges, and writes back through `serializeFleet`. The visual builder is
strictly a projection of the AST and is not part of this ADR.

## Migration

1. Land `lib/fleet-ast.ts` and `parseFleetSource` next to today's
   `loadFleetConfig`. `loadFleetConfig` becomes
   `astToConfig(parseFleetSource(readFileSync(path)))`.
2. Land `lib/fleet-diagnostics.ts` with the `topology` analyzer ported from
   `validateTopology`. Keep `validateTopology` as a deprecated re-export that
   converts `Diagnostic[]` back to `string[]` for one release.
3. Add `pd fleet lint` CLI. Wire `pd fleet up` through it.
4. Add the `cost`, `cron`, `project-graph` analyzers behind feature flags so
   they can be developed independently and turned on per code.
5. Document each FLEET### code in `docs/fleet/diagnostics.md` as it lands.
6. Only after 1–5 ship: build the Fleet Console panel that consumes
   `lint --json` (separate ADR).

Each step is independently shippable and reversible.

## Non-goals

Explicitly NOT in this ADR:

- Visual builder UI (left/middle/right pane, drag-and-drop). Layered on top.
- Public registry / `pd install <template>`. Separate concern entirely.
- Project-local registry. Separate concern.
- `pd fleet diff` / `pd fleet preview` / sandboxed harbors. Each is its own
  subproject; the AST + diagnostics give them a shared substrate but do not
  define them.
- Semantic merge tool for `pd-fleet.yml` conflicts. Needs the AST, but the
  merge algorithm is a separate design.
- Prod relay / `deploy: prod` flag. Out of scope.
- Branch protection / signed configs. Operational policy, not lint.

These are deliberately listed so future PRs can reference this ADR as their
foundation rather than re-litigating it.

## Open Questions

1. **YAML lib choice.** `yaml` v2 exposes positions; `js-yaml` does not. We
   currently depend on `js-yaml` in fleet-engine. Migration cost is one
   parse call; the dep adds ~100KB. Worth it.
2. **Diagnostic stability across versions.** Do we ship a JSON schema for
   `Diagnostic` so external tools can pin to it? Probably yes — emit it
   from `pd fleet lint --print-schema`.
3. **Project-graph privacy.** PubsubHistory reads channel names + counts.
   Channel names sometimes encode user data ("user:42:notify"). The lint
   never *prints* history values, only "fired N times" / "never fired", so
   this is probably fine, but worth a security pass.
4. **Where does the cost-rate table live for non-daemon lint?** Today
   `cost-tracker.ts` requires a SQLite db. The lint must work without a
   daemon (e.g. in CI). Either (a) ship rates as a static JSON in the
   package, or (b) document `pd fleet lint` as daemon-required. Leaning (a).
5. **Multi-file fleets.** ADR-0019 left `includes:` as an open question.
   The AST should be designed to support multi-file resolution from day
   one (each node remembers its source URI), but the resolver itself can
   land later.

## Consequences

**Positive**

- One source of truth for "is this fleet okay" across CLI, dashboard, CI,
  and the future LSP.
- Adding a new rule is one analyzer file + one catalog row + one doc page.
- The Fleet Console panel becomes a thin client over a stable API.
- Cost predictions stop being a surprise at month-end.

**Negative**

- More moving parts. The current "warnings as `string[]`" is genuinely
  simple; this ADR introduces an AST, a context object, and a typed
  diagnostic. The complexity is justified only if the Console actually
  ships. If it doesn't, we will have over-engineered the linter.
- YAML lib swap touches every existing call site of `loadFleetConfig`.
- Project-graph analyzer can be slow on projects with very long pubsub
  history; needs a bounded query window (`--since=7d` default).
