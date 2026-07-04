# Ambition Archaeology Classification

Use this when you need to classify an older public or internal product
promise against the current binder, or when you're writing the ambition
archaeology section of a `binder-aor-log:` run.

Source of truth: `docs/architecture/agent-harbor-technical-binder/16-binder-architect-of-record.md`
and `docs/architecture/agent-harbor-technical-binder/work-packets/harbor-architect-baseline-ambition-archaeology.md`.

## Why this exists

Internal consistency is not enough. A binder can be perfectly tidy and still
lose the soul of the product by quietly dropping every ambition that didn't
make it into the current chapter set. Ambition archaeology is the discipline
of never letting an old promise disappear without a recorded fate.

## Where to look

Scan the older ambition corpus, not just current binder chapters:

- website pages, product data, examples, tutorials, docs, and blog entries;
- public casts, GIFs, screenshots, and example catalogues;
- older master plans, marketing/monetization notes, phone integration plans,
  and recovery maps;
- named product/design documents for adjacent surfaces (editor, control
  center, console, distribution tooling);
- whitepapers, manifesto talks, north-star research, and proof artifacts;
- ADRs and old recovery/idea troves;
- skill examples and integration examples that imply a product promise.

If the source corpus is huge, sample it deliberately and record which
portions were actually read — an archaeology pass that silently skims is
worse than one that names its own gaps.

## The six-way classification

Every ambition family gets exactly one classification. `null` is never a
resting state — it means the sweep has not reached that ambition yet.

| Classification | Meaning | What it requires |
| --- | --- | --- |
| `absorbed` | The binder covers it with a term, owner, gate, and milestone. | A citation to the binder section that now owns it. |
| `superseded` | The binder deliberately replaced it. | An explicit statement of why the old path is no longer canon. |
| `deferred` | Still desired, but behind named prerequisites. | The named prerequisites, not just "later." |
| `contradicted` | The binder currently says something incompatible with it. | A contradiction-register entry, not a silent drop. |
| `orphaned` | The ambition appears in public/internal material but has no binder home. | A proposed destination: new chapter, new section, or an explicit decision to route it elsewhere. |
| `rejected` | Explicitly not part of the product going forward. | A rationale — reject on purpose, not by omission. |

Do not blindly preserve every old idea (some were scaffolding); do not erase
a big ambition merely because it's hard (some are still the point). The job
is to give each one a status and a reason, not to defend or discard on
instinct.

## What a completed sweep looks like

A sweep is not complete because it produced a long table. It is complete
enough only when every ambition family in scope has:

1. a classification from the six-way taxonomy above;
2. a source citation (file, and a line anchor where possible);
3. a proposed or actual binder destination (section, new chapter, ADR,
   rejected-ideas note, or named operator decision);
4. a rationale a future reader can evaluate without re-doing the archaeology.

## Cadence

Run a sweep whenever the source corpus changes meaningfully, and at least
once per baseline cycle. A stale sweep (no `ambitionCorpus` entries, or a
corpus that hasn't grown while the product has) is itself a finding —
see the `ambition-corpus-not-yet-swept` finding in
`scripts/binder_coverage_audit.mjs`.

## Reporting shape

When the classification table feeds `scripts/binder_coverage_audit.mjs`,
each entry needs exactly `{ name, classification }`. The narrative behind
the classification — the rationale, the prerequisites, the citation — lives
in the binder chapter or the archaeology work-packet output file; the
scorer only checks that the decision was actually made, not the quality of
the rationale prose (that judgment stays human/agent, not keyword-matched).
