"""Pure, synthetic-fixture scorer; no I/O, agents, subjects, or event replay.

NONE is observed absence within the fixed horizon. Python None is unavailable
truth. They are deliberately different. Registration/leakage must be enforced
upstream: this function cannot establish when a forecast was actually sealed.
"""
import math


def score_three(classes, predictions, truth, abstain=(False, False, False)):
    """Normalized multiclass Brier loss with fixed three-slot denominator.

    Returns an identified interval if any truth is unavailable; never silently
    averages only the observable slots. An explicit abstention is a registered
    uniform forecast, not a missing observation or an omitted denominator.
    """
    if len(classes) < 3 or len(set(classes)) != len(classes):
        raise ValueError('unique class universe required')
    if not {'OTHER', 'NONE'} <= set(classes) or None in classes:
        raise ValueError('OTHER/NONE required; None reserved for unavailable truth')
    if any(len(x) != 3 for x in (predictions, truth, abstain)):
        raise ValueError('exactly three ranked slots required')
    losses = []
    for p, actual, withheld in zip(predictions, truth, abstain):
        if not isinstance(withheld, bool) or set(p) != set(classes):
            raise ValueError('all registered classes and boolean abstention required')
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool)
                   and math.isfinite(v) and 0 <= v <= 1 for v in p.values()):
            raise ValueError('finite probabilities in [0,1] required')
        if not math.isclose(sum(p.values()), 1, abs_tol=1e-9, rel_tol=0):
            raise ValueError('probabilities must sum to one')
        if withheld and not all(math.isclose(v, 1/len(classes), abs_tol=1e-9, rel_tol=0)
                                for v in p.values()):
            raise ValueError('explicit abstention is the preregistered uniform forecast')
        if actual is not None and actual not in classes:
            raise ValueError('truth outside the locked class universe')
        losses.append(None if actual is None else
                      sum((p[c] - int(c == actual)) ** 2 for c in classes) / 2)
    # A observed NONE means this and every later rank is absent in the horizon.
    for rank, actual in enumerate(truth):
        if actual == 'NONE' and any(x != 'NONE' for x in truth[rank:]):
            raise ValueError('NONE must form an observed terminal suffix')
    # The same visible work item cannot be merged twice; OTHER may repeat.
    visible = [x for x in truth if x not in (None, 'NONE', 'OTHER')]
    if len(visible) != len(set(visible)):
        raise ValueError('duplicate visible ground-truth landing')
    known = [x for x in losses if x is not None]
    lower = sum(known) / 3
    upper = (sum(known) + 3-len(known)) / 3
    return {'loss': lower if len(known) == 3 else None,
            'loss_bounds': (lower, upper), 'denominator_slots': 3,
            'known_slots': len(known), 'abstention_slots': sum(abstain)}
