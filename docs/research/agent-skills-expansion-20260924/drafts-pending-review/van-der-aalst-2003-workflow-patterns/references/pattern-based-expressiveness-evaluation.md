# Pattern-based conformance evaluation

Start with a required workflow trace, rather than a feature checklist. Pin an engine
version/configuration; construct an input that activates the pattern; capture events;
then compare them with the expected activation and terminal rules. A result can show
native semantics, a documented encoding that passes the stated fixture, an unsupported requirement, or simply
insufficient evidence.

Evaluate combinations actually used by the workflow. For example, an OR-split plus
synchronizing merge needs a durable activated-set record. Do not generalize from the
2003 comparison of products current at the end of 2001 to contemporary systems.

## Reproducible evaluation record

Record `engine`, exact version/configuration, pattern/version, input fixture, permitted
event orders, expected successor count, reset condition, inspected primitive/encoding,
observed trace and evidence location. Record native-vs-encoded as an implementation fact;
record pass/fail/unknown independently for the tested scope. This prevents a single
successful run from becoming a universal conformance claim.

Constructed structured OR fixture: possible branches are `{B,C,E}`, selected set is
`{B,C}`. Observe B completion: successor count remains zero. Observe C completion:
count becomes one. E's absence cannot block the merge. A repeated observation of B
must not count as completion of C. The duplicate-handling rule is an explicit transport
profile layered on the control-flow example.

## Compare suitability separately

Compare two correct encodings on authoring/review effort, observability, recovery,
resource use and migration burden. Declare workloads, sample sizes and baselines for
measured claims. A smaller implementation may be easier to maintain, but “ten times
more code” is not a universal threshold for unsupported semantics. A feature-rich engine
can be unsuitable for a modest workload; a constrained engine can serve it well.

A bounded test suite provides counterexamples and evidence for tested cases. A claim
covering all traces requires a suitably scoped proof, model check or other argument,
including the implementation's relation to the model. Keep those proof obligations
separate from the fixture report.
