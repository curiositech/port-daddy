# M8: Semantic-Conflict-Predictor Architecture Recommendation

Status: recommendation, decision requested. Written as part of the M8 research
pass (skill update + agent proposal); this is the "where does it live" call the
task brief asked for, parallel to the M7 cascade-fork precedent (shared
library, not a hard runtime dependency) as characterized in that brief. I could
not locate the M7 ADR/decision text itself in this checkout to cite directly --
noting that honestly rather than inventing a citation -- but the pattern it
describes (shared algorithm library, no hard runtime coupling) is a sound one
to apply here regardless, argued from first principles below.

## The question

`skills/semantic-conflict-prediction` currently exists in two places:

- `~/coding/port-daddy/skills/semantic-conflict-prediction/SKILL.md` (this
  repo, local copy, 1220 lines pre-update)
- `/opt/homebrew/Cellar/windags/2.7.0/libexec/skills/semantic-conflict-prediction/SKILL.md`
  (the windags Homebrew package, shared/distributed copy, 1201 lines)

Where should the **algorithm** (tree-sitter parsing, symbol claims, dependency
graph, conflict prediction, the 2026 research extensions) and the
**integration** (Port Daddy API shape, `pd session symbols claim`, Arbiter
invariant wiring, the Lookout/Skipper evaluation) live going forward?

## Drift found (honest accounting)

Diffing the two copies today:

- **Frontmatter format differs** but is cosmetic: windags uses a flat
  top-level `category`/`tags`/`pairs-with`; the port-daddy copy carries *both*
  the flat top-level fields *and* a duplicate nested `metadata:` block with the
  same content. This duplicate-schema pattern is **not unique to this skill**
  -- `multi-agent-coordination` in this repo has the identical redundancy, so
  it reads as a repo-wide artifact of a prior tag-migration pass, not a defect
  introduced by this skill specifically. Left as-is; not this packet's job to
  fix repo-wide frontmatter conventions.
- **Body content is materially identical** (~1200 lines either side, diff is
  frontmatter-only pre-update). No algorithmic drift.
- **Supporting files differ for real:** windags carries a `references/`
  directory (`tree-sitter-foundations.md`, `dependency-graph-recipes.md`,
  `coordination-integration.md`, `INDEX.md`), a `diagrams/` directory, a
  `CHANGELOG.md`, and an `affordance-scorecard.json`. The port-daddy copy had
  none of these before this update. **Caveat, checked directly:** the windags
  `references/*.md` files are 9-13 lines each -- thin auto-generated stubs
  from a windags tooling pass (its own `CHANGELOG.md` calls this a "folder
  affordance pass" and claims the oversized skill was "rewritten into a lean
  activation file," which is not accurate -- the file is still ~1200 lines).
  So: real structural drift exists, but the windags side of that drift is
  mostly automation scaffolding, not hand-authored depth worth pulling in
  wholesale. This update adds a *real*, substantive `references/` file to the
  port-daddy copy (`2026-agentic-conflict-research.md`) rather than porting
  windags' stub files over.

## Recommendation: split, algorithm shared / integration local

**Position:** the tree-sitter/AST/dependency-graph/conflict-prediction
*algorithm* content (everything through "Conflict Prediction Algorithm" and
the 2026 research-extensions section) is domain knowledge that has zero
Port-Daddy-specific dependency -- it applies to any coordination daemon. That
belongs in the **shared, windags-distributed skill**, same as the rest of the
skill's current content already does. The *integration* content -- the `pd
session symbols claim` API shape, the Arbiter invariant, the CLI verbs, the
Lookout/Skipper evaluation and the new work-packet agent proposal -- is
Port-Daddy-specific and should stay **local to this repo**, the same
"shared library, not a hard runtime dependency" shape used for the M7 cascade
fork.

Concretely:

1. **Do not fork the skill into two divergent files.** The current
   single-SKILL.md-with-both-halves structure is fine for now; splitting the
   file itself into "algorithm skill" + "integration skill" is more
   reorganization than this research pass earns. What matters is keeping the
   *conceptual* boundary honest so a future split is cheap: algorithm sections
   stay portable prose with no Port-Daddy-only assumptions baked into the
   general algorithm description; the `## Integration with Port Daddy` and
   `## Port Daddy Integration: Cross-PR Watch...` sections stay explicitly
   scoped to this repo's concrete surfaces (`pd-fleet.yml`, `apps/
   fleet-executor`, `pd session symbols claim`) and are the sections that
   would move first if a hard split ever happens.
2. **The new agent proposal (Semantic Intent Skipper) is Port-Daddy-local by
   construction** -- it's defined against this repo's fleet/ideation-ship
   pattern, `pd embed`, and `pd-fleet.yml`. It should not be pushed upstream
   into windags; windags has no fleet-executor, no ideation-ship schema, and
   no `pd embed`. If windags ever wants an equivalent concept for its own
   coordination substrate, that's a separate design exercise, not a port.
3. **The 2026 research digest (`references/2026-agentic-conflict-research.md`)
   is algorithm-adjacent and portable** -- HalluJudge's verification-tier
   pattern and the diff-correction empirical result apply to any AST-diff
   conflict predictor, not just Port Daddy's. This file is a reasonable
   candidate to sync upstream to windags on the next skill-sync pass (not done
   in this packet -- flagging the opportunity, not executing a cross-repo
   sync as part of an ephemeral research branch).
4. **Do not attempt to reconcile the windags `references/`/`diagrams/`/
   `CHANGELOG.md`/`affordance-scorecard.json` scaffolding in this pass.**
   Those are windags-tooling artifacts (auto-generated, thin) unrelated to the
   M8 research content; reconciling them is a skill-hygiene/mirror-check task,
   not an M8 research task. Noting the gap here so it doesn't get
   rediscovered as "mystery drift" next time someone diffs the two copies.

## What this recommendation is NOT

- Not a decision to fork `semantic-conflict-prediction` into two skills today.
- Not a decision to push the new research/agent-proposal content into the
  windags Homebrew package as part of this branch.
- Not a claim to have found or read the M7 cascade-fork ADR text directly in
  this checkout -- the parallel is argued by analogy from the pattern
  described in the task brief, not from a located source document. If that
  ADR exists in a sibling repo/branch, a follow-up pass should cite it
  directly rather than relying on this packet's restatement.
