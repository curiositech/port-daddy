"""Boundary tests supplementing the exact finite research enumerations."""

import contextlib
import importlib.util
import io
from pathlib import Path
import unittest


def load_checker():
    path = Path(__file__).with_name('research_envelopes.py')
    spec = importlib.util.spec_from_file_location('research_envelopes_tested', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ResearchEnvelopeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.checker = load_checker()

    def test_import_is_silent(self):
        captured = io.StringIO()
        with contextlib.redirect_stdout(captured):
            load_checker()
        self.assertEqual(captured.getvalue(), '')

    def test_unreachable_union_is_not_current_conflict(self):
        for facts in (set(), {'a'}, {'b'}):
            self.assertFalse(self.checker.conflict(facts, ()))
        self.assertTrue(self.checker.conflict({'a', 'b'}, ()))

    def test_maximal_reachable_sets_keep_exclusive_branches(self):
        family = (set(), {'a'}, {'b'})
        self.assertEqual(self.checker.maximal_reachable(family),
                         frozenset((frozenset({'a'}), frozenset({'b'}))))
        self.assertFalse(any(self.checker.conflict(f, ()) for f in family))
        self.assertTrue(self.checker.conflict({'a', 'b'}, ()))

    def test_maximal_reachable_rejects_empty_family(self):
        with self.assertRaises(AssertionError):
            self.checker.maximal_reachable(())

    def test_inconsistent_horn_constraints_are_not_vacuous_permission(self):
        rules = (((), self.checker.BOTTOM),)
        self.assertTrue(self.checker.conflict(set(), rules))
        self.assertTrue(self.checker.truth_table_conflict(set(), rules))

    def test_payload_confidentiality_is_not_exact_output_correctness(self):
        constant = (0, 0, 0, 0)
        self.assertTrue(self.checker.respects_parity(constant))
        self.assertNotEqual([s % 2 for s in constant], [0, 1, 0, 1])

    def test_finite_counts_and_mutation_witnesses(self):
        result = self.checker.run_checks()
        self.assertEqual(result['envelopes']['independent_oracle_cases'], 2048)
        self.assertEqual(result['envelopes']['envelope_cases'], 8192)
        self.assertEqual(result['reachable_families']['reachable_families'], 130560)
        self.assertEqual(result['reachable_families']['independent_oracle_cases'], 4096)
        self.assertEqual(result['reachable_families']['mutants_caught'],
                         ['current_facts_only', 'unreachable_union_shortcut'])
        self.assertEqual(result['payloads']['leaking'], 192)
        self.assertEqual(result['split_floors']['exact_triples'], 17545)
        self.assertEqual(result['weighted_buyout']['payoffs']['0'], 88)


if __name__ == '__main__':
    unittest.main()
