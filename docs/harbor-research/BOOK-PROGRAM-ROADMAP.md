# The Book Program — Roadmap

**Read this before doing anything else on Book/whitepaper/figure work.** This
file exists because the effort has repeatedly lost state across context
resets and, worse, across *parallel agent sessions that don't see each
other's work* — confirmed 2026-09-16: at least three independent branches
(`claude/figure-stack-map-redraw`, `claude/fig-swk-stack-map-style-fix`, and
others) converged on byte-identical fixes for the same file because nobody
checked whether the problem was already solved elsewhere. Before starting
any task below, **check the live task list (TaskList) and `git branch -r`
for a branch that might already have done it.**

Standing rules (do not relitigate these — they are settled):

- The Book is the only published whitepaper edition (ADR-0143). Never
  produce a standalone chapter PDF that isn't a literal excerpt of the Book.
- Zero tolerance for LaTeX build errors/warnings.
- Never run a standalone single-chapter LaTeX build "to verify" something —
  only trust CI, or a real Book build via `generate-mega-whitepaper.mjs`, or
  a real `workflow_dispatch(refresh_book=true)`.
- Never hand-edit a generated file. Regenerate it via its real tool.
- Use isolated git worktrees for PR-landing work.
- Record durable architectural decisions as ADRs (`docs/adr/`).
- When a visual-style judgment call has two legitimate answers, bring the
  user visual evidence and ask — don't unilaterally pick.

## Where things actually stand (evidence-checked 2026-09-16, not vibes)

| Claim | Status | Evidence |
|---|---|---|
| Book-only CI builds, R2 mirror, blocking on failure | **Done on PR #10265, not yet merged to main** | ADR-0144, `scripts/publish-book-to-r2.mjs` (proposed — lands with PR #10265), wired into `.github/workflows/whitepaper-build.yml`, PR #10265 |
| `fig-swk-stack-map.tex` typography matches house style | **Done, merged to main** | commit `d5cb38bda`; `git diff origin/main origin/claude/fig-swk-stack-map-style-fix -- whitepaper/figures/fig-swk-stack-map.tex` is empty. The fix replaced hand-rolled `\footnotesize\scshape`/`\bfseries`/`\itshape` literals with `pd kind tag`/`pd badge`/`\pdfiglabelitalic`/`\pdfiglabelbold` from `whitepaper/figures/pd-figure-language.tex` — the same macros `fig-anchor-four-phases.tex`, `fig-he-three-sided.tex`, `fig-anchor-delegation-inline.tex` already use. **This is the macro/typography fix only** — do not re-do it. |
| `fig-swk-stack-map`'s visual redraw (layout/content, not macros) | **Not done** | Separate from the row above. User explicitly still wants this. Task #13. |
| Move every figure/table/plot caption to the margin, automatically | **Built, not merged** | `scripts/harbor-research/captions_to_margin.py` (proposed — lives only on the branch below, not yet on main) exists and works on `origin/claude/one-margin-system` (PR #10208, commit `fe89712f7` "move every float caption and footnote into the margin"). That branch is 181 commits behind main, 14 ahead — stale, needs rebase, not a rewrite. Task #11. |
| Agent (Fable) judgment of figure pixels/legibility | **Not started** | Task #14. |
| Agent judgment of marginalia inclusion + rendering | **Not started as agent judgment.** `captions_to_margin.py` is deterministic/rule-based, not agent-judged — confirm this when auditing it for task #11. |
| Vertical-center-by-default caption layout | **Not confirmed either way** — check whether #10208's tool already does this before building a second system. Task #17. |
| Corpus authority map / skill-governance metadata pass | **Does not exist in the repo at all** (grepped, zero hits). Needs to be built from the ground up, or the user needs to point at what #9973 originally meant by these terms. Task #22. |
| "The genius critique" | **No artifact by this name found anywhere in the repo.** Until the user points at what this refers to, treat it as pointing at the Fable-judgment pipeline (task #14) — that is the closest concept in their own spec. |
| tufte-evidence-design skill actually run against the Book | **Started 2026-09-16**: `skills/tufte-evidence-design/scripts/margin_lint.py` run repo-wide → 0 enforced findings, 10 advisory (`\footnote` in body, not yet converted to sidenotes, across 8 chapter files). `skills/tufte-evidence-design/scripts/ink_audit.py` run against a stack-map render → no chartjunk flags, but that render predates today and should be re-taken once the visual redraw (task #13) lands. |
| 89 open PRs, heavy duplication | **Confirmed, not yet triaged.** Task #12. |

## Priority order (why this order)

1. **#11 — rescue PR #10208.** It's the single highest-leverage unmerged
   asset in the whole backlog: it already does the automatic caption-to-
   margin move the user is demanding, it's just stale. Landing it answers
   one of the user's loudest complaints for the cost of a rebase, not a
   rewrite.
2. **#12 — PR sprawl triage.** Every other task risks re-duplicating work
   that's sitting unmerged on some other branch, the way the stack-map fix
   was independently solved 3+ times. Do a first pass here before building
   anything new.
3. **#2, #4 — un-stick the two PRs whose CI regressed** (#10252, #10226)
   since they were previously reported "done" and are not.
4. **#13 — the actual stack-map redraw**, now that the macro fix is
   confirmed landed and won't be confused with this.
5. **#16 — land #9973's figure content** with the user's explicit main-
   preference rulings.
6. **#21 — house-style sweep** across all figure `.tex` files, using
   `d5cb38bda` as the template for what "fixed" looks like.
7. **#14, #15 — the Fable+Sonnet judgment pipeline and nano-banana figure
   generation.** Biggest net-new build. Do this after the above so it
   judges a Book that isn't mid-reshuffle.
8. **#17, #22, #18 — layout rule, corpus-authority-map, foundlings review.**
   Feed into #14's pipeline once it exists.
9. **#19, #20 — repo de-frag and the general R2 manifest-of-pointers
   system.** Largest, least urgent relative to reader-facing quality; do
   after the Book itself is in good shape so there's less churn to move.

## Open questions for the user (do not block on these — proceed on best judgment, flag when you hit them)

- What exactly is "the genius critique"? No matching artifact exists in the
  repo under that name.
- What is the "new mermaid-write skill" referenced for the Fable's toolkit?
  Not yet identified among installed skills — closest candidates are the
  `Mermaid_Chart` MCP tool and the `artifact-diagramming` skill, but neither
  was confirmed as the intended one.
- What did #9973's "corpus authority map" and "skill-governance metadata
  pass" actually consist of? No trace in the current repo.

## Keeping this file honest

Update the evidence table above whenever a task's status changes — don't
let it drift back into "marked completed, actually regressed" the way the
pre-existing task list did for #10252 and #10226. When in doubt, re-check
live CI/branch state rather than trusting a prior session's summary,
including this file's own prior version.
