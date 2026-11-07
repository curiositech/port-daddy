#!/usr/bin/env python3
"""Fail-closed tests for TLC evidence interpretation, without invoking Java."""
import unittest

import check_atomic_admission_model as checker


def output_for(case):
    if case == 'bound':
        return ('Model checking completed. No error has been found.\n'
                '998 states generated, 602 distinct states found, 0 states left on queue.\n')
    chunks = [f'Error: Invariant {checker.CASES[case][2]} is violated.\n',
              'Error: The behavior up to this point is:\n']
    for number, (action, state) in enumerate(checker.expected_trace(case), 1):
        chunks.append(f'State {number}: <{action}>\n')
        for key, value in state.items():
            value = 'TRUE' if value is True else 'FALSE' if value is False else str(value)
            chunks.append(f'/\\ {key} = {value}\n')
    chunks.append('8 states generated, 6 distinct states found, 1 states left on queue.\n')
    return ''.join(chunks)


class EvidenceGateTest(unittest.TestCase):
    def test_all_fixed_witness_schemas(self):
        self.assertEqual(len(checker.CASES), 31)
        for case in checker.CASES:
            with self.subTest(case=case):
                checker.validate_output(case, 0 if case == 'bound' else 12, output_for(case))

    def test_vacuous_and_partial_exploration_fail(self):
        for text in [output_for('bound').replace('602', '0'),
                     output_for('bound').replace('0 states left', '1 states left'),
                     output_for('bound').replace('602', '601')]:
            with self.subTest(text=text), self.assertRaises(checker.GateError):
                checker.validate_output('bound', 0, text)

    def test_wrong_exit_invariant_and_tool_error_fail(self):
        output = output_for('mutant_aba')
        cases = [(0, output), (1, output),
                 (12, output.replace('SafeAdmission', 'TypeOK')),
                 (12, output + 'Error: Successor state is not completely specified.\n')]
        for code, text in cases:
            with self.subTest(code=code), self.assertRaises(checker.GateError):
                checker.validate_output('mutant_aba', code, text)

    def test_wrong_exact_witness_fails(self):
        text = output_for('mutant_aba').replace('/\\ writes = 2', '/\\ writes = 1')
        with self.assertRaises(checker.GateError):
            checker.validate_output('mutant_aba', 12, text)

    def test_missing_duplicate_unsupported_and_wrong_type_assignments_fail(self):
        output = output_for('accepted')
        texts = [output.replace('/\\ token = 0\n', '', 1),
                 output.replace('/\\ token = 0\n', '/\\ token = 0\n/\\ token = 0\n', 1),
                 output.replace('/\\ token = 0\n', '/\\ token = null\n', 1),
                 output.replace('/\\ token = 0\n', '/\\ token = FALSE\n', 1)]
        for text in texts:
            with self.subTest(text=text[:80]), self.assertRaises(checker.GateError):
                checker.validate_output('accepted', 12, text)

    def test_nonconsecutive_states_fail(self):
        with self.assertRaises(checker.GateError):
            checker.validate_output('stale', 12, output_for('stale').replace('State 2:', 'State 5:'))

    def test_missing_duplicate_summary_fail(self):
        text = output_for('bound')
        for corrupt in [text.splitlines()[0], text + text.splitlines()[-1] + '\n']:
            with self.subTest(text=corrupt), self.assertRaises(checker.GateError):
                checker.validate_output('bound', 0, corrupt)

    def test_conflicting_verdict_and_stderr_fail(self):
        with self.assertRaises(checker.GateError):
            checker.validate_output('unsafe', 12, output_for('unsafe') + 'No error has been found\n')
        with self.assertRaises(checker.GateError):
            checker.validate_output('bound', 0, output_for('bound'), 'runtime warning\n')

    def test_positive_and_replay_controls_are_nonvacuous(self):
        accepted = checker.expected_trace('accepted')[-1][1]
        replay = checker.expected_trace('replay')[-1][1]
        self.assertEqual(accepted['effectCount'], 1)
        self.assertFalse(accepted['badEffect'])
        self.assertEqual(replay['effectCount'], 1)
        self.assertTrue(replay['rejected'])
        no_op = checker.expected_trace('no_op_replay')[-1][1]
        self.assertEqual(no_op['revision'], 0)
        self.assertEqual(no_op['effectCount'], 1)
        self.assertTrue(no_op['rejected'])
        for case in checker.CASES:
            if case.startswith('mutant_'):
                self.assertTrue(checker.expected_trace(case)[-1][1]['badEffect'], case)


if __name__ == '__main__':
    unittest.main()
