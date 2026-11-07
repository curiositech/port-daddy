#!/usr/bin/env python3
"""Independent finite checks of the future-fact admission contract.

The oracle uses transitive closure of the adjacency relation (not provider
traversal), intersection of all satisfying truth assignments (not forward Horn
propagation), direct interval comparisons, and bounded integer assignments for
difference constraints. All exhaustive totals are computed and printed here.
No tests establish scheduler fidelity, complete mediation, or deployed safety.
"""
from copy import deepcopy
from itertools import combinations, product
import json
import subprocess
import sys
from pathlib import Path
import unittest

from future_fact_reachability import analyze, replay_witness

BOT = '_BOT_'
FIXTURES = Path(__file__).resolve().parents[3] / 'tests/fixtures/harbor-research/future-admission'


def policy(**changes):
    result = {'facts': [], 'horn': [], 'deontic': [], 'claims': [], 'nvars': 0, 'cons': []}
    result.update(changes)
    return result


def model(labels, edges=(), initial=('s0',)):
    return {
        'schema_version': 1,
        'model_id': 'constructed-finite-contract-case',
        'authority': 'Modeled finite graph only; no deployed scheduler authority.',
        'initial': list(initial),
        'states': [{'id': f's{i}', 'facts': list(facts)} for i, facts in enumerate(labels)],
        'transitions': [
            {'id': f'e{i}', 'source': f's{a}', 'target': f's{b}'}
            for i, (a, b) in enumerate(edges)
        ],
    }


def powerset(items):
    return [frozenset(items[i] for i in range(len(items)) if mask & (1 << i))
            for mask in range(1 << len(items))]


def reachable_oracle(graph):
    """Warshall transitive closure; state identity is never its fact label."""
    ids = [state['id'] for state in graph['states']]
    positions = {sid: i for i, sid in enumerate(ids)}
    relation = [[a == b for b in ids] for a in ids]
    for edge in graph['transitions']:
        relation[positions[edge['source']]][positions[edge['target']]] = True
    for via in range(len(ids)):
        for source in range(len(ids)):
            for target in range(len(ids)):
                relation[source][target] |= relation[source][via] and relation[via][target]
    return {
        sid for sid in ids
        if any(relation[positions[start]][positions[sid]] for start in graph['initial'])
    }


def least_model_oracle(facts, horn):
    atoms = set(facts)
    for body, head in horn:
        atoms.update(body)
        atoms.add(head)
    atoms = sorted(atoms)
    satisfying = [
        candidate for candidate in powerset(atoms)
        if set(facts) <= candidate
        and all(not set(body) <= candidate or head in candidate for body, head in horn)
    ]
    assert satisfying  # Definite rules treat BOT as an atom to be detected below.
    return set.intersection(*(set(candidate) for candidate in satisfying))


def conflict_oracle(pol, state_facts):
    """Return semantic conflict categories; no imported R17/provider helper."""
    closure = least_model_oracle(set(pol['facts']) | set(state_facts), pol['horn'])
    active = [r for r in pol['deontic'] if set(r[0]) <= closure]
    kinds = set()
    if BOT in closure:
        kinds.add('bot')
    for left, right in combinations(active, 2):
        if (left[1] != right[1] and left[2] == right[2]
                and set(left[3]) & set(right[3])
                and max(left[4][0], right[4][0]) <= min(left[4][1], right[4][1])):
            kinds.add('of')
    for left, right in combinations(pol['claims'], 2):
        if (left[0] == right[0] and left[2] != right[2] and (left[3] or right[3])
                and max(left[1][0], right[1][0]) <= min(left[1][1], right[1][1])):
            kinds.add('claims')
    # Integer difference constraints have feasible super-source potentials in
    # [-sum(abs(c)), 0] whenever feasible; fixtures keep this exhaustive box tiny.
    lower = -sum(abs(edge[2]) for edge in pol['cons'])
    feasible = any(
        all(values[j] - values[i] <= bound for i, j, bound in pol['cons'])
        for values in product(range(lower, 1), repeat=pol['nvars'])
    )
    if not feasible:
        kinds.add('temporal')
    return kinds


def oracle(graph, pol):
    reached = reachable_oracle(graph)
    assert reached, 'Empty reachable families cannot certify safety.'
    fact_sets = {frozenset(pol['facts']) | frozenset(state['facts'])
                 for state in graph['states'] if state['id'] in reached}
    maximal = {facts for facts in fact_sets if not any(facts < other for other in fact_sets)}
    return reached, fact_sets, maximal, any(conflict_oracle(pol, facts) for facts in fact_sets)


def both_fact_conflict():
    return policy(horn=[[['a', 'b'], BOT]])


class FutureFactReachabilityTests(unittest.TestCase):
    def assert_agrees(self, graph, pol):
        expected = oracle(graph, pol)
        original_graph, original_policy = deepcopy(graph), deepcopy(pol)
        result = analyze(graph, pol)
        self.assertEqual(result['status'], 'unsafe' if expected[3] else 'safe')
        self.assertTrue(result['complete'])
        self.assertEqual(set(result['reachable_states']), expected[0])
        self.assertEqual({frozenset(facts) for facts in result['reachable_fact_sets']}, expected[1])
        self.assertEqual({frozenset(facts) for facts in result['maximal_fact_sets']}, expected[2])
        self.assertLessEqual(result['checked_fact_sets'], len(expected[2]))
        if not expected[3]:
            self.assertEqual(result['checked_fact_sets'], len(expected[2]))
        self.assertEqual(graph, original_graph)
        self.assertEqual(pol, original_policy)
        if expected[3]:
            self.assertTrue(replay_witness(graph, pol, result['witness']))
            final = result['witness']['state_ids'][-1]
            labels = next(s['facts'] for s in graph['states'] if s['id'] == final)
            self.assertTrue(conflict_oracle(pol, labels))
        else:
            self.assertIsNone(result['witness'])
        return result

    def test_current_facts_alone_miss_future_activation(self):
        graph = model([[], ['a', 'b']], [(0, 1)])
        pol = both_fact_conflict()
        self.assertFalse(conflict_oracle(pol, []))
        self.assertEqual(self.assert_agrees(graph, pol)['status'], 'unsafe')

    def test_unreachable_union_is_not_a_reachable_future(self):
        graph = model([[], ['a'], ['b']], [(0, 1), (0, 2)])
        pol = both_fact_conflict()
        self.assertTrue(conflict_oracle(pol, ['a', 'b']))
        self.assertEqual(self.assert_agrees(graph, pol)['status'], 'safe')

    def test_unreachable_state_cannot_block_admission(self):
        self.assertEqual(self.assert_agrees(model([[], ['a', 'b']]), both_fact_conflict())['status'], 'safe')

    def test_state_labels_replace_instead_of_accumulating(self):
        graph = model([['a'], ['b']], [(0, 1)])
        self.assertEqual(self.assert_agrees(graph, both_fact_conflict())['status'], 'safe')

    def test_fixed_policy_facts_persist_across_retraction(self):
        pol = both_fact_conflict()
        pol['facts'] = ['a']
        self.assertEqual(self.assert_agrees(model([['a'], ['b']], [(0, 1)]), pol)['status'], 'unsafe')

    def test_equal_labels_do_not_merge_distinct_futures(self):
        graph = model([[], [], ['a', 'b']], [(0, 1), (1, 2)])
        result = self.assert_agrees(graph, both_fact_conflict())
        self.assertEqual(result['witness']['state_ids'], ['s0', 's1', 's2'])

    def test_all_initial_states_contribute(self):
        graph = model([[], ['a', 'b']], initial=('s0', 's1'))
        self.assertEqual(self.assert_agrees(graph, both_fact_conflict())['status'], 'unsafe')

    def test_cycles_terminate_and_reachable_unsafe_branch_survives(self):
        graph = model([[], ['a'], ['a', 'b']], [(0, 0), (0, 1), (1, 0), (1, 2), (2, 2)])
        self.assertEqual(self.assert_agrees(graph, both_fact_conflict())['status'], 'unsafe')

    def test_initial_and_terminal_state_are_checked(self):
        graph = model([['a', 'b']])
        witness = self.assert_agrees(graph, both_fact_conflict())['witness']
        self.assertEqual(witness['state_ids'], ['s0'])
        self.assertEqual(witness['transition_ids'], [])

    def test_small_resource_bounds_cannot_manufacture_safe(self):
        graph = model([[], ['a'], ['a', 'b']], [(0, 1), (1, 2)])
        for bound in [{'max_states': 1}, {'max_states': 2}, {'max_transitions': 0}, {'max_transitions': 1}]:
            with self.subTest(bound=bound):
                result = analyze(graph, both_fact_conflict(), **bound)
                self.assertEqual(result['status'], 'unknown')
                self.assertFalse(result['complete'])
                self.assertIsNone(result['witness'])

    def test_incomplete_unsafe_retains_replayable_witness(self):
        graph = model([['a', 'b'], [], []], [(0, 1), (1, 2)])
        for bound in [{'max_states': 1}, {'max_transitions': 0}]:
            with self.subTest(bound=bound):
                result = analyze(graph, both_fact_conflict(), **bound)
                self.assertEqual(result['status'], 'unsafe')
                self.assertFalse(result['complete'])
                self.assertTrue(replay_witness(graph, both_fact_conflict(), result['witness']))

    def test_omitted_runtime_route_is_outside_model_certificate(self):
        supplied = model([[], ['a', 'b']], [(0, 1)])
        omitted = deepcopy(supplied)
        omitted['transitions'] = []
        pol = both_fact_conflict()
        small = self.assert_agrees(omitted, pol)
        full = self.assert_agrees(supplied, pol)
        self.assertEqual(small['status'], 'safe')
        self.assertEqual(full['status'], 'unsafe')
        self.assertNotEqual(small['model_digest'], full['model_digest'])
        self.assertFalse(replay_witness(omitted, pol, full['witness']))
        self.assertIn('declared', small['proof_scope'].lower())
        self.assertIn('mediation', small['proof_scope'].lower())
        print('model adequacy control: omitted route=safe; supplied route=unsafe; '
              'artifact binding does not establish runtime route coverage')

    def test_zero_state_budget_is_unknown_without_vacuous_safety(self):
        result = analyze(model([[]]), policy(), max_states=0)
        self.assertEqual(result['status'], 'unknown')
        self.assertFalse(result['complete'])
        self.assertEqual(result['reachable_states'], [])
        self.assertEqual(result['checked_fact_sets'], 0)
        self.assertIsNone(result['witness'])

    def test_exact_state_bound_can_complete_at_terminal(self):
        graph = model([[], ['a']], [(0, 1)])
        result = analyze(graph, both_fact_conflict(), max_states=2, max_transitions=1)
        self.assertEqual(result['status'], 'safe')
        self.assertTrue(result['complete'])

    def test_unreachable_edges_do_not_consume_traversal_budget(self):
        graph = model([[], ['a', 'b']], [(1, 1)])
        result = analyze(graph, both_fact_conflict(), max_states=1, max_transitions=0)
        self.assertEqual(result['status'], 'safe')
        self.assertTrue(result['complete'])

    def test_shortest_path_is_not_an_accumulated_fact_witness(self):
        graph = model([['a'], ['b'], ['a', 'b']], [(0, 1), (1, 2), (0, 2)])
        witness = self.assert_agrees(graph, both_fact_conflict())['witness']
        self.assertEqual(witness['state_ids'], ['s0', 's2'])
        self.assertEqual(len(witness['transition_ids']), 1)

    def test_horn_chain_empty_rule_and_cycles(self):
        pol = policy(horn=[[[], 'a'], [['a'], 'b'], [['b'], 'a'], [['b'], BOT]])
        self.assertEqual(self.assert_agrees(model([[]]), pol)['status'], 'unsafe')

    def test_closed_intervals_touch_and_scope_overlap(self):
        pol = policy(deontic=[
            [[], 'O', 'write', ['x', 'y'], [0, 1], 'oblige'],
            [[], 'F', 'write', ['y', 'z'], [1, 2], 'forbid'],
        ])
        self.assertEqual(self.assert_agrees(model([[]]), pol)['status'], 'unsafe')
        pol['deontic'][1][3] = ['z']
        self.assertEqual(self.assert_agrees(model([[]]), pol)['status'], 'safe')

    def test_claims_and_temporal_conflicts_are_fixed_policy_properties(self):
        policies = [
            policy(claims=[['r', [0, 1], 'alice', True], ['r', [1, 2], 'bob', False]]),
            policy(nvars=2, cons=[[0, 1, -1], [1, 0, 0]]),
            policy(nvars=2, cons=[[0, 1, 1], [1, 0, 0]]),
        ]
        for pol in policies:
            with self.subTest(policy=pol):
                self.assert_agrees(model([[], ['a']], [(0, 1)]), pol)

    def test_witness_is_bound_to_exact_model_and_policy(self):
        graph = model([[], ['a', 'b']], [(0, 1)])
        pol = both_fact_conflict()
        witness = self.assert_agrees(graph, pol)['witness']
        changed_model = deepcopy(graph)
        changed_model['authority'] += ' Revised model statement.'
        changed_policy = deepcopy(pol)
        changed_policy['facts'] = ['unrelated_fact']
        self.assertFalse(replay_witness(changed_model, pol, witness))
        self.assertFalse(replay_witness(graph, changed_policy, witness))
        encoded = json.loads(json.dumps(witness))
        self.assertTrue(replay_witness(graph, pol, encoded))

    def test_tampered_witnesses_fail_replay(self):
        graph = model([[], ['a', 'b'], ['a', 'b']], [(0, 1)])
        pol = both_fact_conflict()
        witness = self.assert_agrees(graph, pol)['witness']
        mutations = [
            ('bad-start', lambda w: w.update(state_ids=['s2', 's1'])),
            ('unreachable-final', lambda w: w.update(state_ids=['s0', 's2'])),
            ('missing-edge', lambda w: w.update(transition_ids=[])),
            ('unknown-edge', lambda w: w.update(transition_ids=['absent'])),
            ('wrong-facts', lambda w: w.update(facts=[])),
            ('empty-state-path', lambda w: w.update(state_ids=[])),
            ('extra-field', lambda w: w.update(invented=True)),
            ('missing-checker', lambda w: w.pop('checker')),
            ('false-checker', lambda w: w.update(checker={})),
        ]
        for name, mutate in mutations:
            with self.subTest(mutation=name):
                changed = deepcopy(witness)
                mutate(changed)
                self.assertFalse(replay_witness(graph, pol, changed))
        for malformed in [None, [], 1, 'witness']:
            with self.subTest(malformed=malformed):
                self.assertFalse(replay_witness(graph, pol, malformed))

    def test_invalid_model_schema_fails_closed(self):
        original = model([[], ['a']], [(0, 1)])
        mutations = [
            ('empty-initial', lambda m: m.update(initial=[])),
            ('duplicate-initial', lambda m: m.update(initial=['s0', 's0'])),
            ('unknown-initial', lambda m: m.update(initial=['missing'])),
            ('empty-states', lambda m: m.update(states=[])),
            ('duplicate-state', lambda m: m['states'].append(deepcopy(m['states'][0]))),
            ('duplicate-facts', lambda m: m['states'][0].update(facts=['a', 'a'])),
            ('bad-fact', lambda m: m['states'][0].update(facts=[1])),
            ('missing-label', lambda m: m['states'][0].pop('facts')),
            ('duplicate-transition', lambda m: m['transitions'].append(deepcopy(m['transitions'][0]))),
            ('unknown-source', lambda m: m['transitions'][0].update(source='missing')),
            ('unknown-target', lambda m: m['transitions'][0].update(target='missing')),
            ('transition-fact-change', lambda m: m['transitions'][0].update(facts=['b'])),
            ('extra-model-field', lambda m: m.update(unmodeled=True)),
            ('bool-schema', lambda m: m.update(schema_version=True)),
            ('wrong-schema', lambda m: m.update(schema_version=2)),
            ('missing-authority', lambda m: m.pop('authority')),
        ]
        for name, mutate in mutations:
            with self.subTest(mutation=name):
                graph = deepcopy(original)
                mutate(graph)
                with self.assertRaises(ValueError):
                    analyze(graph, policy())
        print(f'model schema rejection cases: {len(mutations)}')

    def test_invalid_policy_and_bounds_fail_closed(self):
        policies = [
            {**policy(), 'extra': []},
            policy(horn=[[['a'], None]]),
            policy(deontic=[[[], 'P', 'a', ['s'], [0, 1], 'unsupported']]),
            policy(deontic=[[[], 'O', 'a', ['s'], [2, 1], 'reversed']]),
            policy(nvars=1, cons=[[0, 1, 0]]),
            policy(nvars=True),
        ]
        missing = policy()
        del missing['facts']
        policies.append(missing)
        for pol in policies:
            with self.subTest(policy=pol), self.assertRaises(ValueError):
                analyze(model([[]]), pol)
        for bounds in [{'max_states': -1}, {'max_states': True},
                       {'max_transitions': -1}, {'max_transitions': True}]:
            with self.subTest(bounds=bounds), self.assertRaises(ValueError):
                analyze(model([[]]), policy(), **bounds)
        print(f'policy schema rejection cases: {len(policies)}; invalid budget cases: 4')

    def test_decision_and_enumerated_pair_counts_are_different(self):
        rules = [[[], mode, 'publish', ['scope-1', 'scope-2'], [0, 1], f'{mode}-{i}']
                 for mode in ['O', 'F'] for i in range(4)]
        result = self.assert_agrees(model([[]]), policy(deontic=rules))
        checker = result['witness']['checker']
        # Two shared scopes do not double the distinct O/F-pair witness count.
        self.assertEqual(len(checker['of']), 16)
        self.assertEqual(result['checked_fact_sets'], 1)
        same_mode = deepcopy(rules)
        for rule in same_mode:
            rule[1] = 'O'
        self.assertEqual(self.assert_agrees(model([[]]), policy(deontic=same_mode))['status'], 'safe')
        print('dense fixture: 1 unsafe fact-set decision; 16 distinct O/F pairs; '
              '32 shared-scope pair incidences; same-mode control safe; no optimized-scan claim')

    def test_cli_receipts_and_duplicate_json_keys(self):
        runner = Path(__file__).with_name('future_fact_reachability.py')
        requests = [
            ({'model': model([[]]), 'policy': policy()}, 'safe', 0),
            ({'model': model([['a', 'b']]), 'policy': both_fact_conflict()}, 'unsafe', 1),
            ({'model': model([[]]), 'policy': policy(), 'budgets': {'max_states': 0}}, 'unknown', 2),
        ]
        for request, expected_status, expected_code in requests:
            with self.subTest(status=expected_status):
                proc = subprocess.run([sys.executable, '-B', str(runner)], input=json.dumps(request),
                                      capture_output=True, text=True, check=False)
                self.assertEqual(proc.returncode, expected_code, proc.stderr)
                self.assertEqual(json.loads(proc.stdout)['status'], expected_status)
                self.assertEqual(proc.stderr, '')
        proc = subprocess.run([sys.executable, '-B', str(runner)], input='{"model": {}, "model": {}, "policy": {}}',
                              capture_output=True, text=True, check=False)
        self.assertEqual(proc.returncode, 2)
        self.assertEqual(json.loads(proc.stdout)['status'], 'invalid')
        self.assertIn('duplicate', json.loads(proc.stdout)['error'])

    def test_modeled_two_operation_second_promise(self):
        graph = json.loads((FIXTURES / 'two_operation_workflow.model.json').read_text())
        before = json.loads((FIXTURES / 'two_operation_workflow.before-policy.json').read_text())
        admitted = json.loads((FIXTURES / 'two_operation_workflow.admitted-policy.json').read_text())
        self.assertEqual(self.assert_agrees(graph, before)['status'], 'safe')
        for sid in graph['initial']:
            self.assertFalse(conflict_oracle(admitted, next(s['facts'] for s in graph['states'] if s['id'] == sid)))
        result = self.assert_agrees(graph, admitted)
        self.assertEqual(result['status'], 'unsafe')
        self.assertIn('deadline_elapsed', result['witness']['facts'])
        expected = oracle(graph, admitted)
        print('modeled two-operation workflow: '
              f'{len(expected[0])} reachable states, {len(expected[1])} distinct fact sets, '
              f'{len(expected[2])} maximal sets; before=safe, admitted=unsafe; '
              f'witness transitions={len(result["witness"]["transition_ids"])}')

    def test_exhaustive_graph_label_and_horn_policy_combinations(self):
        """Every 2-state directed graph, label, nonempty initial set and listed policy."""
        labels = powerset(['a', 'b'])
        possible_edges = [(0, 0), (0, 1), (1, 0), (1, 1)]
        possible_rules = [[['a'], 'b'], [['b'], 'a'], [['a', 'b'], BOT]]
        initials = [('s0',), ('s1',), ('s0', 's1')]
        total = safe = unsafe = replayed = 0
        # Cache only the independent semantic oracle for repeated tiny policies.
        expected_cache = {}
        for edge_bits, first, second, initial, rule_bits, base, include_deontic in product(
                range(16), labels, labels, initials, range(8), labels, [False, True]):
            edges = [edge for bit, edge in enumerate(possible_edges) if edge_bits & (1 << bit)]
            graph = model([sorted(first), sorted(second)], edges, initial)
            pol = policy(facts=sorted(base), horn=[rule for bit, rule in enumerate(possible_rules) if rule_bits & (1 << bit)], deontic=[
                [['a'], 'O', 'act', ['scope'], [0, 1], 'O-a'],
                [['b'], 'F', 'act', ['scope'], [1, 2], 'F-b'],
            ])
            if not include_deontic:
                pol['deontic'] = []
            reached = reachable_oracle(graph)
            reached_labels = {frozenset(s['facts']) for s in graph['states'] if s['id'] in reached}
            expected = False
            for facts in reached_labels:
                key = (rule_bits, base, facts, include_deontic)
                if key not in expected_cache:
                    expected_cache[key] = bool(conflict_oracle(pol, facts))
                expected |= expected_cache[key]
            result = analyze(graph, pol)
            self.assertEqual(set(result['reachable_states']), reached)
            effective = {facts | base for facts in reached_labels}
            maximal = {facts for facts in effective if not any(facts < other for other in effective)}
            self.assertEqual({frozenset(facts) for facts in result['maximal_fact_sets']}, maximal)
            self.assertTrue(result['complete'], (graph, pol, result))
            self.assertEqual(result['status'], 'unsafe' if expected else 'safe', (graph, pol, result))
            total += 1
            if expected:
                unsafe += 1
                self.assertTrue(replay_witness(graph, pol, result['witness']))
                replayed += 1
            else:
                safe += 1
                self.assertIsNone(result['witness'])
        print(f'exhaustive graph/label/policy decisions: {total}; safe={safe}; unsafe={unsafe}; replayed unsafe witnesses={replayed}; disagreements=0')


if __name__ == '__main__':
    unittest.main(verbosity=2)
