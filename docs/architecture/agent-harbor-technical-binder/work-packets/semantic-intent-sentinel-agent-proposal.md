# Semantic Intent Sentinel — Agent Proposal

Status: proposal, not yet implemented. No code exists. No `pd-fleet.yml` entry.
This packet exists to reserve the concern and settle the "does this duplicate
Lookout or the binder's Longshoreman role" question before anyone builds it.

Scope:
  Defines a new, narrowly-scoped agent -- the Semantic Intent Sentinel -- that
  watches semantic/topical proximity between concurrently active work across
  the fleet, as distinct from (a) literal file/symbol overlap (already covered
  by `skills/semantic-conflict-prediction`) and (b) post-hoc cross-PR
  contradiction-hunting on already-opened PRs (already covered by the Lookout
  ideation ship, PR #721).

Inputs read:

- `skills/semantic-conflict-prediction/SKILL.md` (updated 2026-07, § Port Daddy
  Integration and § Beyond Single-Prediction)
- `skills/semantic-conflict-prediction/references/2026-agentic-conflict-research.md`
- `docs/architecture/agent-harbor-technical-binder/04-context-memory-and-skills.md`
  (Longshoreman role: continuity, compaction, dependency/parley tracking)
- `docs/architecture/agent-harbor-technical-binder/05-cooperative-coding-and-governance.md`
  (claims, semantic conflict prediction, parley triggers, who-controls-the-agents)
- `docs/adr/0032-unspider-contradiction-finder.md` (unSpider: structural
  contradiction/overlap detection across roadmap and code reality)
- `apps/fleet-executor/src/github.ts`, `fleet/ships/unspider.md` (Lookout's real
  cross-PR tools: `fetchOpenPullRequests`, `listRecentBranches`,
  `renderFleetContext`; PR #721, open)
- Operator research digest, 2026-07: MASE failure modes (context thrashing,
  cascading hallucinations), semantic-lock broadcast pattern, Continuous
  Semantic Integration

---

## Why this is a real gap, not a rename of something that exists

Three things already exist and this proposal must not re-describe them:

1. **Symbol claims (`semantic-conflict-prediction`)** answer: "do these two
   agents' claimed symbols/files conflict, given the dependency graph as it
   exists right now?" This is structural and requires literal overlap (same
   symbol, or a dependency edge between symbols) to fire at all. Two agents
   both refactoring authentication in *different, unrelated* files -- no
   shared symbol, no dependency edge -- produce zero signal here.
2. **Lookout (PR #721)** watches *already-opened* PRs and recent branches and
   reasons in prose about contradiction/architecture trouble/cross-PR issues,
   posting an advisory `pd parley call`. It is real, it is live-instantiable
   today (pending merge), and it is the correct home for anything that reasons
   over *finished* diffs sitting in open PRs.
3. **Longshoreman (binder role, ch04/ch05)** is a broad governance archetype:
   tracks dependencies and parleys for an Ensemble of Voyagers, guides context
   compaction, warns on high-semantic-conflict predictions, and can suggest a
   parley. It is a *role class*, not a single agent implementation, and it is
   defined generically -- it does not specify *how* semantic proximity across
   concurrently active (not-yet-PR'd) work gets computed.

**The gap:** nothing today watches *in-progress, not-yet-PR'd* work for
*topical* proximity -- two agents whose task descriptions, target files, or
recent commits cluster near each other in embedding space, even with zero
literal symbol overlap. This is the "semantic cloud of intent" the operator
named. It requires:

- reading live session/claim state (not finished PR diffs -- Lookout's input),
- computing proximity over *unstructured* task descriptions and diffs (must be
  embeddings/cosine-similarity or a cheap LLM classification call -- never a
  keyword list, per the operator's standing NO KEYWORD-BASED NLP rule),
- broadcasting a low-cost, advisory nudge before the overlap becomes a merge
  problem, not after a PR exists to diff against.

This is a **specialization of the Longshoreman archetype** -- it is a
Longshoreman that specifically watches semantic-cloud proximity across
concurrently active sessions, the way unSpider (ADR-0032) is a specialization
that specifically hunts roadmap/code contradictions. Same relationship: named
role class → narrowly-scoped concrete agent.

---

## Agent definition

**Name:** Semantic Intent Sentinel (`sentinel` in fleet config; ship class
`ideation`, same non-blocking category as Spider/Spark/Lookout/Snipe)

**Concern (one sentence):** Detect and broadcast topical/semantic proximity
between concurrently active agents' declared work, before either agent has
produced a diff worth AST-comparing or a PR worth Lookout-comparing.

**Scope:**

- IN scope: active Port Daddy sessions and their declared task/intent text,
  claimed files/symbols (as weak signal, not the primary one), and recent
  commits on active branches not yet opened as PRs.
- IN scope: computing embedding-space proximity between session intents and
  surfacing pairs above a similarity threshold as an advisory note.
- OUT of scope: literal symbol/file conflict detection (that is
  `semantic-conflict-prediction`'s job; the Sentinel should *consume* its
  dependency graph as one input, not reimplement it).
- OUT of scope: reasoning over already-opened PRs or finished diffs (that is
  Lookout's job; if a PR already exists, route there instead).
- OUT of scope: blocking or gating anything. Advisory only, same as every other
  ideation ship.
- OUT of scope: roadmap/code contradiction hunting (that is unSpider's job per
  ADR-0032, when it ships).

**Trigger model:** async, on session-begin and on a periodic sweep (e.g. every
N minutes while 2+ sessions are active) -- never synchronous on a claim, per
the false-positive-risk analysis in
`skills/semantic-conflict-prediction/references/2026-agentic-conflict-research.md`
§ 4(a).

**Tools (read-only, advisory-write only):**

- `pd sessions --all-worktrees` / equivalent MCP read (active session intents,
  claimed files/symbols)
- Embedding service (the repo's existing shared MiniLM-via-`pd embed`
  infrastructure -- see memory note "Hybrid search / shared embedder
  directive": never stand up a second embedder)
- Read access to the dependency graph this skill's algorithm already builds
  (do not re-parse; consume the existing graph as a secondary signal)
- `git log`/branch listing (recent commits on active, not-yet-PR'd branches)
- Write: `pd note` (advisory coordination note) and/or `pd parley call`
  proposal, same actionable-command pattern Lookout uses today -- never a
  freeform prose blob; every emitted action must be a real, paste-able `pd`
  command.

**Output contract:**

```json
{
  "kind": "semantic-proximity-nudge",
  "sessionA": "session-...",
  "sessionB": "session-...",
  "similarity": 0.83,
  "sharedThemeSummary": "Both sessions are modifying authentication-adjacent code (auth.py, session-middleware.ts) with no shared symbols in the dependency graph.",
  "suggestedAction": "pd parley call --topic auth-adjacent-overlap --participants session-A,session-B",
  "confidence": 0.6,
  "severity": "advisory"
}
```

Modeled directly on this skill's existing `ConflictPrediction` interface (see
`SKILL.md` § Confidence Scoring) so downstream consumers (operator UI, `pd
note` feed) can render both symbol-level and semantic-cloud-level signals in
one list, sorted by severity then confidence, rather than inventing a second
incompatible schema.

**Cost/latency/false-positive posture:** see the tradeoff table in
`skills/semantic-conflict-prediction/SKILL.md` § Port Daddy Integration,
row (a). Low cost, async latency, elevated false-positive risk relative to
symbol claims -- advisory-only by design, never a blocking gate, same
philosophy as this skill's existing "Advisory by default" stance (§ Choosing
Between Advisory and Enforced Claims).

---

## Relationship to existing roles (explicit, so this doesn't get built twice)

| Existing thing | What it does | How the Sentinel differs |
|---|---|---|
| `semantic-conflict-prediction` skill (symbol claims) | Structural: same-symbol or dependency-graph-connected conflicts, requires literal overlap | Sentinel fires on *topical* proximity with zero literal overlap; consumes the dependency graph as a secondary signal, does not replace it |
| Lookout ideation ship (PR #721) | Reasons over *already-opened* PRs and recent branches for contradiction/architecture trouble | Sentinel watches *pre-PR*, in-progress session intent; if a PR already exists, that pair should be routed to Lookout, not re-detected by the Sentinel |
| Longshoreman (binder role, ch04/ch05) | Broad governance archetype: parleys, compaction guidance, warns on high-semantic-conflict predictions | Sentinel is a concrete specialization of this archetype, scoped to one signal (semantic-cloud proximity), the same way unSpider specializes it toward contradiction-hunting |
| unSpider (ADR-0032, not yet built) | Structural contradiction/overlap hunting across roadmap and code reality, 8 detector kinds, $0.20/day cap | Sibling ship, not a competitor: unSpider hunts stale/contradictory *facts*; the Sentinel hunts *in-flight proximity* between active agents. They could share the `feedback` queue output lane but should ship as separate detectors. |

## Build sequence (if greenlit)

1. Confirm the shared embedder (`pd embed`) exposes a session-intent-text
   embedding call; do not stand up a second model.
2. Prototype the pairwise proximity sweep against synthetic session-intent
   pairs (known-overlapping vs known-unrelated) to calibrate the similarity
   threshold before wiring it to live sessions.
3. Wire read access to active sessions + the existing dependency graph.
4. Emit the JSON contract above to a `feedback`-style queue; render as an
   advisory `pd note`.
5. Add `sentinel` to `pd-fleet.yml` as `class: ideation`, non-blocking, once
   the executor's ideation-ship `Proposal` schema (from PR #721) is merged --
   reuse that schema/renderer rather than building a second one.
6. Validate against real multi-agent sessions (not synthetic pairs alone) the
   way HalluJudge validated against actual developer preference -- see
   `skills/semantic-conflict-prediction/references/2026-agentic-conflict-research.md`
   § 1.

## TODO

- [ ] Confirm `pd embed` / shared MiniLM embedder API surface for session-intent text.
- [ ] Decide similarity threshold via calibration set, not a guessed constant.
- [ ] Implement the sweep as a scheduled job, not a per-claim synchronous check.
- [ ] Reuse PR #721's ideation `Proposal` schema; do not invent a second output contract.
- [ ] Add `sentinel` to `pd-fleet.yml` only after the above land and pass e2e tests.
- [ ] Operator sign-off on the $/day budget cap (model unSpider's $0.20/day precedent).
