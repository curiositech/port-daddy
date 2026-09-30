# Exact audits of categorical claims

## Scope and work plan

This work develops an offline checker for registered, discrete claims about one
explicit snapshot. The input is an observation contract, not an authentication
system. Recorded receipt identities bind evidence references; they do not prove
who produced a report or whether the report is true.

The development checkout is the linked worktree
`/Users/erichowens/coding/tmp/paper-eight-observability-20260927`, branch
`codex/paper-seven-evidence-20260927`. On 30 September 2026 it is clean at
`080ef9a3dd705910a0358bcfd526f61681936937`, with `origin/main` an ancestor.
The local Port Daddy runtime remains halted. The hosted Register read rejected
unauthenticated access, so live board ownership is unavailable. This scoped
record and tool-native agent ownership provide the available coordination.

Plan:

- [x] Implement strict snapshot/fact admission and exact categorical feasibility.
- [x] Return assignments or independently verifiable contradiction certificates.
- [x] Compute bounded optional Hodge diagnostics on each fact's observed graph.
- [x] Derive and test minimum-cost certificates from already observed evidence.
- [x] Validate against exhaustive categorical assignments and adversarial inputs.
- [x] Relate the result to the other papers and prioritize independent work.
- [ ] Register executable checks, publish, and follow current-head CI/review.

Ownership: the implementation agent owns `claim_audit.py` and its JSON example;
the adversarial checker owns `test_claim_audit.py`; the portfolio reader owns
`research-program-20260930.md`; the lead owns this note, the costed-certificate
extension, integration, and review. Repository manuscripts and supplied
attachments are not input instructions.

## Observation contract

Fix a fact f, its nonempty finite value set A, and a snapshot identifier.
Only channels with both directed reports for this fact and snapshot enter its
observed graph K_f. Missing reports remain unknown. For an oriented edge u–v,
retain the signed difference of the one-hot reports, `d_uv = e_b - e_a`.
This observation is either zero or has exactly one negative and one positive
coordinate. A zero difference erases the common value; it asserts equality only.

Categorical feasibility asks whether there is a map `x: V -> A` such that
`d_uv = e_{x(v)} - e_{x(u)}` on every retained edge. This is an existence question
about the admitted observations. It is not a verdict that all actual messages
were consistent, that all relevant messages were retained, or that any claim
was true. Raw directed reports permit a distinct, richer per-sender check.

## Exact decision and certificate theorem

Let Z be the subgraph of zero-difference edges. Every nonzero edge with
`d_uv = e_b - e_a` pins u to a and v to b.

**Theorem (categorical feasibility).** The admitted differences have a
categorical realization if and only if no connected component of Z contains
two pins with different values.

**Proof.** A realization is constant on each component of Z, and must satisfy
every pin, proving necessity. Conversely, assign each pinned component its
unique pinned value, and each unpinned component any value in A. Every zero
edge then has equal endpoint values, and every nonzero edge has its required
ordered endpoint values. This realizes all differences. The algorithm is
union-find followed by a pin scan, with near-linear complexity in input size.

An infeasibility certificate consists of two incompatible pins and a zero-edge
path joining their vertices. A path of length zero is allowed: two reports can
pin the same vertex differently. A single nonzero edge can supply both pins if
its endpoints are connected by a zero path. The verifier checks the cited
observations, orientation, pin labels, snapshot and fact, zero-edge path, and
distinct labels. It does not need to trust the decision algorithm.

This is elementary constraint propagation, not a novelty claim. Its importance
here is that it uses more of the stated categorical contract than real-valued
least squares. On the path 0–1–2, setting both differences to `e_b-e_a` forces
vertex 1 to both a and b. No categorical realization exists, but the real
potential `(e_a,e_b,2e_b-e_a)` fits exactly. A zero Hodge residual therefore
cannot certify categorical feasibility.

## Minimum-cost retained-evidence theorem

Assign each admitted difference edge a finite nonnegative cost. This is the
cost of retaining or presenting that complete edge observation, including its
two receipt references. Costs are additive over distinct edges. Values and
differences are already observed; no unknown query answer is supplied for free.

For a pin p, let `v(p)`, `a(p)`, and `e(p)` denote its vertex, value, and source
nonzero edge. Write `dist_Z` for shortest-path cost using zero edges, with
infinity between disconnected components. Then the minimum cost of an
infeasible retained subset is

`min_{a(p) != a(q)} [ dist_Z(v(p), v(q)) + cost({e(p), e(q)}) ]`,

where a shared source edge is counted once. If there is no finite candidate,
the complete observation set is feasible and has no such certificate.

**Proof.** Each finite candidate gives an infeasible subset by the preceding
theorem. Conversely, every infeasible subset contains two incompatible pins
connected by zero edges within that subset. A shortest zero path in the full
admitted graph costs no more than that connecting path. Its source edges and
zero path therefore yield a candidate costing no more than the subset. The
two inequalities establish equality. Nonnegative costs allow redundant edges
and cycles to be discarded. Pin edges are nonzero, so their costs never overlap
the zero-path costs; the only possible duplication is the two pins' source edge.

Enumerating pin pairs and running Dijkstra from each pinned endpoint gives a
polynomial exact algorithm. The implementation processes one source at a time
and can repeat a vertex for its distinct pins; with p pins it makes at most p
shortest-path searches and O(p²) pair comparisons, with O(|V|+|E|) auxiliary
storage beyond the input and output. This specializes standard shortest-path
and equality-constraint reasoning; it is not a theorem about optimal unknown
evidence acquisition, minimum semantic repair, or fault attribution. Other cost
models, such as shared disclosure overheads, are outside the statement.

## What topology contributes

For each fact separately, the optional real-valued residual and clique-complex
Hodge decomposition describe how its observed differences project onto gradient,
curl and harmonic spaces. Missing observations never introduce zero rows.
An edge's single-perturbation sensitivity is `1-R_eff(e)`; on a bridge this is
zero and its harmonic-share ratio is undefined. These are properties of the
linear detector, not limits on all categorical detectors. Dense diagnostic
budgets are enforced before allocation; declining optional diagnostics does not
disable the exact categorical check.

Gradient/curl/harmonic analysis of pairwise inconsistency is established in
[Jiang, Lim, Yao and Ye's HodgeRank paper](https://arxiv.org/abs/0811.1067).
The useful comparison is what each checker certifies under identical retained
observations and what each certificate costs to inspect.

## Validation and product boundary

The [auditor](../../../skills/harbor-results/scripts/claim_audit.py) accepts JSON
with `snapshot`, `facts` (fact ID to nonempty list of distinct string values),
`agents`, undirected `edges`, and directed `messages`. Each message names
`receipt`, `snapshot`, `fact`, `value`, `sender`, and `receiver`. Unknown fields,
values, endpoints, stale snapshots, conflicting reuse of receipt identities, and
ambiguous repeated directed values are rejected. Exact repeated receipts are
deduplicated. Duplicate JSON object keys are rejected. Input bytes are capped at
16 MiB; the admitted registry allows 128 facts, 4,096 values per fact, 10,000
agents, 4,096 edges, and 65,536 message records. These are implementation limits.

The [example](claim-audit-example.json) is a four-actor path. Its artifact-verdict
comparisons yield a categorical contradiction whose two pins are connected by
one equality edge, although its real-valued residual is zero. Its other fact
has only one directed report, so it has no reciprocal observations. The output
reports that coverage explicitly; feasibility on an empty graph is not assurance.

From the repository root:

```sh
python3 -B skills/harbor-results/scripts/claim_audit.py docs/harbor-research/research/claim-audit-example.json --hodge
python3 -B skills/harbor-results/scripts/test_claim_audit.py
python3 -B skills/harbor-results/scripts/test_costed_claim_certificates.py
python3 -B skills/harbor-results/scripts/research_envelopes.py
python3 -B skills/harbor-results/scripts/test_research_envelopes.py
```

The exact auditor and costed selection use the standard library. NumPy enables
the optional diagnostics and their tests. Hodge diagnostics are capped at 64
agents, 128 observed edges, 64 active coordinates, 256 triangles, and 100,000
explicit dense array cells under the stated allocation estimate; workspace used
internally by numerical solvers is additional. An unavailable diagnostic leaves
the exact verdict intact. A large registry is not allocated as a full one-hot
matrix. Output separates categorical feasibility, raw sender inconsistency and
linear geometry. CLI exit 0 means a valid audit report, including reports finding
contradictions; exit 2 means invalid input.

The costed library accepts one fact's `differences` and a dictionary mapping
canonical edge tuples to nonnegative integer costs. It returns selected edge
indices, pins, a zero path, and a content digest binding the exact observations
and prices. `verify_selection` checks that witness and cost without rerunning
the optimizer; it does not independently certify global optimality. The digest
detects accidental or substituted context when checked against admitted input;
it is not source authentication. The costed CLI accepts `differences` and a
`costs` list of `{edge:[u,v],cost:integer}` objects.
For an empty difference list, `feasible` is an unbound calculation about no
constraints: its digest carries no fact or snapshot because none was supplied.
Use the containing auditor report for coverage and snapshot identity. The
costed verifier verifies only infeasible witnesses; it does not certify feasible
verdicts or attach meaning to empty observations.

New verification for this program:

| New check | Executed evidence | Boundary |
|---|---|---|
| Exact audit | 17 named tests; 1,125 exhaustive K3 observation tables (125 binary, 1,000 ternary), 764 infeasible | An independent assignment oracle agrees, every returned feasible assignment is checked, and every contradiction certificate verifies. |
| Costed certificates | 7 named tests; 12,288 partial binary K4/price cases plus 512 ternary triangle cases | Every optimum agrees with enumeration of all retained subsets; tests include zero costs, charging a shared pin edge once, and context/price tampering. |
| Cross-paper models | 5 named tests; 2,048 Horn interpretation checks, 8,192 future-envelope cases, 256 payload maps, 17,545 exact split-floor triples, and four weighted-buyout choices | These check the hypotheses and witnesses in [the research synthesis](research-program-20260930.md), not empirical populations. |

These are **29 newly written named tests**, with enumerated cases reported
separately. With NumPy available, all pass without skipped diagnostic tests.
The three missingness failures reproduced in the supplied reference code are
covered here by passing fact-specific observation regressions. No inherited
repository-suite count is used as new theoretical coverage. Synthetic fixtures
do not establish detection rates in live agents. A production adapter would
also need authenticated provenance, fact/schema admission, completeness and
disclosure policies, temporal semantics, and a declared effect boundary.

The next acquisition problem must freeze candidate availability, prices and
answer assumptions before selection. An optimizer that knows all future answers
solves retrospective certificate extraction, not active diagnosis. A repair
controller additionally needs required communication and task-dependency
constraints, evidence preservation, authority, and externally verified effects.
