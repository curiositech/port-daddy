# Consequence comparison under a partial relation

## Source boundary

The primary bodies read are Tufiș and Ganascia, *Normative rational agents – A BDI approach* (RDA2 2012, pp. 37–43) and *Grafting Norms onto the BDI Agent Model* (2015, §§7.2–7.7), accessed 2026-09-24. The distinct 2014 CLAWAR publication was metadata-only. These sources model deliberation, not legal/ethical correctness or authority for an external effect.

Consequences are derivable under declared belief rules. Such derivation is not automatically causal truth. The source relation may leave multiple maximal adverse consequences or alternatives incomparable; it supplies no forced total worst-winner.

## Specify what the relation compares

Distinguish an outcome set from an ordering of individual outcomes. A partial order on individual outcomes does not uniquely determine how to compare two sets of outcomes. Declare any set-lifting rule separately, including treatment of missing outcomes and uncertainty. Do not silently substitute cardinality, expected utility, a numerical sum, or lexicographic priority for the source relation.

Consider a constructed set order: an adverse outcome set `A` is no more adverse than `B` exactly when `A` is a subset of `B`. This is a **local illustrative order**, not a normative or medical ranking. `{lost_record}` is less adverse than `{lost_record, delay}`. `{lost_record}` and `{delay}` are incomparable. Among the three sets, `{lost_record, delay}` is the single greatest adverse set; among only the first two, both are maximal and neither is a greatest element. A partial order can therefore leave several worst alternatives, not one worst consequence.

## Pure comparison record

The comparator below must return one of five explicit relations. `INCOMPARABLE` means the declared relation does not order this pair; `UNKNOWN` means evaluation lacks evidence. They are different results. The record includes actual traces and every compared pair, not just a list of incomparable candidate names.

```python
from itertools import combinations

def compare_modeled_traces(candidates, trace, partial_compare):
    keys = tuple(candidates)  # validated, immutable, hashable candidate identities
    if len(set(keys)) != len(keys):
        raise ValueError("duplicate candidate identity")
    outcomes = {key: trace(key) for key in keys}
    if any(value is None for value in outcomes.values()):
        return {"status": "UNKNOWN_TRACE", "outcomes": outcomes, "comparisons": ()}
    comparisons = []
    allowed = {"LESS_ADVERSE", "EQUIVALENT", "MORE_ADVERSE", "INCOMPARABLE", "UNKNOWN"}
    for left, right in combinations(keys, 2):
        relation = partial_compare(outcomes[left], outcomes[right])
        if relation not in allowed:
            raise ValueError("comparator must return an explicit relation")
        comparisons.append({"left": left, "right": right, "relation": relation})
    relations = {item["relation"] for item in comparisons}
    status = ("NO_CANDIDATES" if not keys else
              "SINGLE_CANDIDATE" if len(keys) == 1 else
              "UNKNOWN_COMPARISON" if "UNKNOWN" in relations else
              "INCOMPARABLE" if "INCOMPARABLE" in relations else "COMPARISON_RECORDED")
    return {"status": status, "outcomes": outcomes, "comparisons": tuple(comparisons)}

def subset_adversity(left, right):
    # Pure set-inclusion example: it assigns no empirical severity or probability.
    if left == right: return "EQUIVALENT"
    if left < right: return "LESS_ADVERSE"
    if right < left: return "MORE_ADVERSE"
    return "INCOMPARABLE"
```

The helper assumes the caller has validated candidate identities and immutable traced outcome sets. It checks relation labels but does not prove the comparator reflexive, antisymmetric, or transitive; test those properties on the modeled domain before calling it a partial order. For a finite domain, include self, reverse-pair, and transitive-triple checks. No status selects a winner or authorizes an action.

## Constructed decision trace

A toy plan `retain_audit` yields `{delay}` and `discard_audit` yields `{lost_record}`. Under subset inclusion their comparison is `INCOMPARABLE`; choosing either requires a separately declared policy. If `retain_audit` instead yields `{delay, lost_record}`, the trace says it is more adverse than `{lost_record}` under this exact local order. That is an ordering of model outputs, not a prediction that a real system loses a record.

A verified hard retention rule first excludes noncompliant candidates in its scope. The comparison then operates on remaining feasible candidates. If none remain, record the conflict; comparison is not permission to bypass the hard rule. Where policy permits deliberative trade-offs, save its identity, input model/version, alternatives, relations, and selected disposition. If incomparable alternatives remain, escalation or an explicitly applicable tie rule is a valid result.

## Unknowns and recovery

- Missing trace: request plan/effect evidence; never replace it with the empty outcome set.
- Unknown comparison: retain the pair for later evidence; do not relabel it incomparable.
- Multiple maximal adverse outcomes: preserve the full antichain unless a declared order extension resolves it.
- Unexpected observed consequence: record model discrepancy and reconsider the plan; a deeper symbolic derivation alone does not establish causal completeness.
- Source toy example: the R781/Travis `feed`/`healed` links are fictional plan assumptions, not clinical, mortality, or real-world ethical claims.

Any external effect still needs independent admission. Deliberation records establish what was modeled and compared, not that the modeled choice was right or executed successfully.
