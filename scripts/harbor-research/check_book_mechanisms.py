#!/usr/bin/env python3
"""Independent finite witnesses for the Book's mechanism and residual claims.

No live runtime. numpy is the sole third-party dependency. A small Node probe
checks the actual capped-settlement simulation against enumerated cashflows.
These checks verify examples and model consistency, not deployment behavior.
"""
import itertools
import json
from pathlib import Path
import subprocess

import numpy as np

ROOT = Path(__file__).resolve().parents[2]


def close(actual, expected):
    assert abs(actual - expected) < 1e-9, (actual, expected)


def check_cashflows():
    # Enumerate the two terminal outcomes independently of the printed formula.
    q, p, deposit, coverage = 10, .1, 110, 20
    capped = sum(prob * (q - penalty) for prob, penalty in
                 [(1-p, 0), (p, min(deposit, coverage))])
    full = sum(prob * (q - penalty) for prob, penalty in
               [(1-p, 0), (p, deposit)])
    close(capped, 8)
    close(full, -1)
    # A low-price counterexample to any universal insufficiency of capped bonds.
    close(1 - .1 * min(20, 20), -1)
    # Check complete coverage, including losses above the insured layer.
    for total in range(21):
        for insured in range(total + 1):
            for loss in range(31):
                insurer = min(loss, insured)
                principal = min(max(loss-insured, 0), total-insured)
                assert insurer + principal == min(loss, total)
    assert min(90, 80) + min(90-80, 100-80) == 90
    probe = r"""
import {runAuction} from './proofs/bonded/pareto/simulation-sybil.mjs';
const insurer = [{id: 0, alpha: 0}];
const loss = runAuction({mu:10,var:0,lossProb:1}, insurer, 1, 110, () => .5);
const safe = runAuction({mu:10,var:0,lossProb:0}, insurer, 1, 110, () => .5);
console.log(JSON.stringify({loss, safe}));
"""
    out = json.loads(subprocess.check_output(
        ['node', '--input-type=module', '-e', probe], cwd=ROOT, text=True))
    assert out['loss']['premium'] == out['safe']['premium'] == 10
    assert out['loss']['depositSlashed'] == out['loss']['coverage'] == 15
    assert out['safe']['depositSlashed'] == 0
    close(.9*out['safe']['premium'] + .1*(out['loss']['premium']-15), 8.5)
    return {'capped_profit': capped, 'full_forfeiture_profit': full,
            'waterfall': 'exhaustive B<=20, d<=30; B=100,c=80,d=90 pays 90',
            'actual_simulation': 'premium retained on default, slash capped'}


def check_whitewashing():
    gaps = [10 - .1*(10+18*t) for t in range(1, 6)]
    w = sum(gaps)
    discounted = sum(.9**t * gap for t, gap in enumerate(gaps, 1))
    close(w, 18)
    close(discounted, 14.65938)
    # Detection event enumeration: gain is received regardless of detection.
    gain = .9*15 + .1*(15-w)
    close(gain, 13.2)
    assert 15-discounted > 0
    # Same issue for a terminal judge's bribe and bond.
    close(.9*10 + .1*(10-50), 5)
    close(.7*10 + .3*(10-50), -5)
    return {'undiscounted_cost': w, 'discounted_cost': discounted,
            'gain_with_10pct_detection': gain}


def residual(n, edges, values):
    incidence = np.zeros((len(edges), n))
    for i, (u, v) in enumerate(edges):
        incidence[i, u], incidence[i, v] = 1, -1
    if not edges:
        return 0.
    fitted = incidence @ np.linalg.lstsq(incidence, values, rcond=1e-10)[0]
    return float(np.linalg.norm(values-fitted))


def check_repair_support():
    # Solve each correction support separately against its cycle-sum constraint.
    norms = []
    for allowed in (3, 2, 1):
        solution = np.linalg.lstsq(np.ones((1, allowed)), [1.], rcond=None)[0]
        close(sum(solution), 1.)
        norms.append(float(np.linalg.norm(solution)))
    for value, expected in zip(norms, [1/np.sqrt(3), 1/np.sqrt(2), 1]):
        close(value, expected)
    close(residual(3, [(0,1),(1,2),(2,0)], np.array([1.,0.,0.])), norms[0])
    return {'unrestricted_two_edges_one_edge': norms}


def check_equal_information():
    # Enumerate all labeled four-vertex graphs, senders, and binary per-neighbor
    # reports. Both methods receive the exact same scalar sender packets.
    pairs = list(itertools.combinations(range(4), 2))
    total = direct_only = 0
    for mask in range(1, 1 << len(pairs)):
        edges = [e for i, e in enumerate(pairs) if mask & (1 << i)]
        for sender in range(4):
            neighbors = [v if u == sender else u for u, v in edges
                         if sender in (u, v)]
            for values in itertools.product([0., 1.], repeat=len(neighbors)):
                reports = dict(zip(neighbors, values))
                claims = {v: [] for v in range(4)}
                g = []
                for u, v in edges:
                    left = reports[v] if u == sender else 0.
                    right = reports[u] if v == sender else 0.
                    claims[u].append(left)
                    claims[v].append(right)
                    g.append(left-right)
                direct = any(vals and max(vals) != min(vals) for vals in claims.values())
                detected = residual(4, edges, np.array(g)) > 1e-8
                assert not detected or direct
                direct_only += bool(direct and not detected)
                total += 1
    assert direct_only > 0
    # Independently instantiate a split view that projection loses.
    edges = [(0,1), (0,2), (0,3), (1,2)]
    close(residual(4, edges, np.array([1.,1.,0.,0.])), 0)
    return {'finite_cases': total, 'residual_only': 0,
            'direct_only': direct_only, 'triangle_leaf_blind_spot': True}


def check_assurance():
    # Enumerate a joint distribution, then contrast identical marginals with
    # perfect dependence and detected-but-suppressed reports.
    probabilities = (.6, .7, .8)
    outcomes = []
    for reports in itertools.product((False, True), repeat=3):
        mass = 1.
        for report, chance in zip(reports, probabilities):
            mass *= chance if report else 1-chance
        outcomes.append((reports, mass))
    close(sum(mass for _, mass in outcomes), 1)
    no_report = sum(mass for reports, mass in outcomes if not any(reports))
    close(no_report, .024)
    assert no_report <= .4**3
    shared_failure = .4
    assert shared_failure > .4**3
    suppressed_failure = sum(mass for _, mass in outcomes)
    assert suppressed_failure == 1
    # At equality, the two modeled payoffs tie; honesty is not forced.
    honest, misreport = 0, 10 - .25*.8*50
    assert honest == misreport
    return {'independent_joint_events': len(outcomes),
            'heterogeneous_miss': no_report, 'shared_miss': shared_failure,
            'suppressed_report_miss': suppressed_failure,
            'weak_deterrence_allows_tie': True}


def main():
    results = {'cashflows': check_cashflows(), 'whitewashing': check_whitewashing(),
               'repair_support': check_repair_support(),
               'equal_information': check_equal_information(), 'assurance': check_assurance()}
    print(json.dumps({'status': 'PASS', 'checks': results}, indent=2))


if __name__ == '__main__':
    main()
