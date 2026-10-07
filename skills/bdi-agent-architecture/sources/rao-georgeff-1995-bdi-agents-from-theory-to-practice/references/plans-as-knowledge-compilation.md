# Plans as practical knowledge compilation

## Plan anatomy

The practical architecture represents means and options as plans, treated as a special form of belief. A plan has an invocation condition, precondition, and body of primitive actions or subgoals. Intentions are implicit conventional runtime stacks of hierarchically related plans; several stacks can coexist, run in parallel, suspend, or be ordered.

Build a library with this check:

1. state each invocation event;
2. state each precondition over current ground beliefs;
3. enumerate body actions/subgoals and their action boundary;
4. identify stack parent/child relationships;
5. make each rejection and exhaustion outcome observable; and
6. replay representative events after adding a plan to detect changed candidate sets.

**Positive fixture.** reach(cp) invokes two plans: short_route requires path_clear; detour requires detour_open; both bodies ultimately post move actions. A new storm_shelter plan is an additional candidate for its matching invocation/context, not proof that old plans are untouched in every runtime.

**Negative fixture.** State that compiled plans are always faster, correct, or optimal. The paper motivates representation choices for practicality but supplies neither a universal speed result nor plan-verification guarantee.

## Useful restriction

The paper’s practical system explicitly represents only current-state ground literals, with no disjunctions or implications. This sacrifices expressive power. An implementation that needs temporal history, quantification, uncertainty, or conflict rules must define those extensions and test their interactions with option filtering.

## Local explanation record

A plan body describes what to do; it does not by itself record why that plan was selected on a particular cycle. A useful local trace links cycle/event identity, belief-snapshot identity, candidate plan revision, invocation match, precondition result, selection-rule revision, and the resulting stack change. This is a proposed instrumentation format, not part of the 1995 interpreter specification.

Constructed example: event `reach(cp)`, snapshot `s7` contains `path_clear=false` and `detour_open=true`, and local selector `first-applicable-v1` sees this ordered library:

| Candidate | Invocation matches? | Precondition | Disposition |
|---|---|---|---|
| `short_route@r2` | yes | `path_clear` is false in `s7` | rejected before selection |
| `detour@r1` | yes | `detour_open` is true in `s7` | selected and pushed onto stack `i4` |

Record the snapshot and rule identifiers with the disposition. Changing the selector or snapshot can change the explanation even with the same plan name. This trace justifies the local selection under its declared inputs; it does not establish that the observations are true, that every alternative was searched, or that the pending action ran. Keep later action/observation results as distinct records.

## Source boundary

Official paper, practical representation section and footnote on lazy generation of possible intended action sequences, read 2026-09-24. It does not define a modern workflow/DAG runtime or automatic plan migration.

Primary source: [Rao–Georgeff 1995, ICMAS pp. 312–319](https://cdn.aaai.org/ICMAS/1995/ICMAS95-042.pdf). Constructed fixtures and local engineering choices are identified above.
