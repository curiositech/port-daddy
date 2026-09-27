# Chapter lint apparatus declarations

## Explicit apparatus declarations

Section roles are explicit editorial declarations, not inferred classifications. The checker
accepts a versioned JSON sidecar through `--apparatus FILE`, with paths
relative to `--repo-root` (symlink aliases resolve to the same source):

```json
{
  "version": 1,
  "chapters": {
    "whitepaper/chapter.tex": [
      {"label": "sec:reader-map", "role": "front-matter", "reason": "Author-declared navigation"},
      {"title": "Review of the key ideas", "role": "review", "reason": "Author-declared retrieval prompts"}
    ]
  }
}
```

Use a heading's stable `label` where available. An exact `title` selector is
allowed for an existing unlabelled heading, but must select one top-level
section. The allowed roles are `front-matter`, `review`, `exercises`,
`references`, and `appendix`. Each declaration requires a reason. Titles,
`app:` labels, and `\appendix` alone grant no exemption: a threat model,
handoff, proof or teaching appendix remains body unless its author declares
otherwise. This mechanism does not replace the existing separate close,
exercise-placement, or interlude checks, whose heuristic limits still apply.
Claims in declared apparatus still require epistemic labels.

Missing or ambiguous selectors, repeated declarations, duplicate JSON keys,
missing source files and paths outside the repository exit 2. Every declared
chapter is validated even when a command selects only one. Reports expose
body/apparatus counts and every excluded section; JSON `section_metrics`
also includes each heading's labels, role and individual example count.
Without `--apparatus`, every section counts as body.

`--max-blocking N` is a nonnegative aggregate failure-count ceiling, mutually
exclusive with `--strict`. It keeps existing failures visible and exits 1
only above the ceiling; input/metadata errors still exit 2. It can allow one
new failure to offset one repaired failure, so it is not a per-floor debt
allowlist or chapter approval. Remeasure current source with the accepted
apparatus declarations before setting a CI budget; an old report is not a
baseline. The active Book policy in `whitepaper/chapter-apparatus.json`
selects only the eight authored recap sections and eight grouped exercise
collections. Comparative literature sections and all substantive teaching,
proof, status, threat-model, handoff and conclusion sections stay body.
Widening these exemptions requires an explicit editorial decision.

At main `cf07690b03a3f6082092fc9760155f36c7d47256`, the selected policy
measures 117 body sections (77 without a counted worked example), 15
blocking failures, 6 advisory failures and 8 REVIEW rows. Those failures
remain visible; CI fails above 15. Three actual CLI-process regression tests
prove a ceiling breach exits 1, a stale selector exits 2, and an unlabelled
claim inside declared apparatus still fails the gate.
