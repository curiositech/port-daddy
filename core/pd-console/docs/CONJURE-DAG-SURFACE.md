# Conjure — prompt → hypertree DAG of skillful agents (Rust UI surface)

*Operator types intent; pd-console blooms a hypertree DAG of skill-equipped agent
nodes, context partitioned per node, rendered as a living vector graph. Grounded
in the real windags model (`/Users/erichowens/coding/workgroup-ai`). Mock:
`~/coding/tmp/console-mock/conjure-dag.html`.*

## Data flow

```
operator prompt
   │  (SurfaceKind::Conjure — a new pane; the leaf recipe's "action" = next_move)
   ▼
pd-console `Conjure` toolbar command
   │  current shipped hook: `claude -p <dag_gen_prompt>` via `conjure::generate_dag_via_cli`
   │  future clean hook: `mcp__windags__windags_next_move(prompt, projectPath, useSkillSearch:true)`
   │  fallback: prompt-titled fixture DAG whenever provider/tooling fails
   ▼
PredictedDAG  { title, problem_classification, confidence, waves[], premortem, topology }
   │  PredictedWave { wave_number, parallelizable, nodes[] }
   │  PredictedNode { id, skill_id, role_description, why, commitment_level,
   │                  input_contract, output_contract, model_tier, estimated_*, cascade_depth,
   │                  skill_fit, ask_user_before_proceeding }
   ▼
render (Vello, Rung 1) + dispatch (non-HITL nodes → skillful agents; gated nodes held)
```

## Rendering — Vello/Parley (Rung 1), not bare Metal

The DAG is a node-graph = the canonical Vello vector use case (`vello-parley-rendering` +
`metal-text-pipeline`: Rung 1 proven ~0.5–2ms/frame @ M4 Max via `pd-timeline-proto`). Port the
existing React-Flow layout (`packages/cli/src/visualize-dag.ts`) — it's trivial math, no graph solver:

- **Layout:** wave columns (x = `wave_number` × COLW), nodes centered vertically within a column. Feed-forward edges left→right (base DAG is acyclic; cyclic topologies use `topologyDetail` edges).
- **Node card** (Parley text in a Vello rounded rect): `skill_id` eyebrow · `role_description` · `why` · model-tier chip (`haiku`/`sonnet`/`opus`) · `$cost·Nm` · `↯cascade` · the scoped-context footer.
- **Edges** styled by `commitment_level`: COMMITTED = solid + accent glow; TENTATIVE = dashed cobalt; EXPLORATORY = dotted, faint. (matches windags' own stroke semantics.)
- **Gate badge** when `ask_user_before_proceeding` — the HITL pause.
- Lives in a gpui `SurfaceKind::Conjure` pane (companion Vello window now, render-to-texture embed later — ADR-0086); `rust-gpui-motion` blooms nodes in wave-by-wave as the plan streams back.

## The agent-context-partitioner (the context slice)

The partitioner is **`ScopedAccumulator` + `SharedWhiteboard`** (in windags core) — not a SKILL.md;
agents graft the lens on demand. Per node, `getContextForNode()` yields a `NodeContext`:
- **full** — direct-dependency outputs (the nodes this one points back to),
- **compressed** — upstream wave summaries (~2k tok, 4 chars ≈ 1 tok),
- **shared** — the whiteboard (tech_stack, claims, …),
- everything else **pruned**.

The UI makes this legible: each node's footer shows `◖ 2 full · Σw0-1 · wb`, and the inspector
breaks down the exact slice + token budget. This is the "efficiently slicing context" the operator asked for — visible, per node.

## Dispatch — nodes are skillful agents

Each `PredictedNode` maps to a skill-equipped agent (the `harbor-*` agents, or any catalog skill
grafted via `windags_skill_graft`). "Spawn agent" on a node launches it with that skill preloaded +
the standing kit (windags + port-daddy) + its scoped `NodeContext`. Gates (`ask_user_before_proceeding`)
hold the wave until the operator approves. Coordinate dispatch through port-daddy (claims per node).

## Build slices
1. ✅ **Conjure pane**: input box → `PredictedDag` parse/fixture fallback → read-only Block render.
2. ✅ **Vello graph**: wave-column layout; node cards + commitment edges; Method-A offscreen PNG capture; GPUI pane hosts the inline image.
3. ✅ **Inspector + partition viz**: node contracts + the `NodeContext` slice (`full`, `compressed`, `shared`, budget, pruned).
4. ✅ **Dispatch**: non-HITL nodes → spawned agents through the existing daemon spawn path; gated nodes pause.
5. 🔶 **Live re-plan**: still future. Current live generation uses `claude:cli`; the canonical `windags_next_move` MCP path is blocked by a 401 invalid Anthropic key on this machine.

Validation snapshot (2026-06-27):

- `cargo build --features gpui --bin pd-console` — passed.
- `cargo test` in `core/pd-console` — passed.
- `cargo test conjure::tests` — 29 passed.
- `bash core/pd-conjure-proto/scripts/capture.sh fixture.json conjure-dag-vello.png` — passed; rendered a 2448×1220 PNG.

Honest scope: the "see your plan" win and the gated dispatch loop are now present.
The remaining gap is provider-clean WinDAGs live planning/re-plan, not the console
surface, renderer, inspector, or dispatch wiring.
