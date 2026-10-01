import unittest
from audit_sidenote_baselines import audit


class BaselineAuditTests(unittest.TestCase):
    def test_aligned_notes_pass(self):
        report = audit('PD-MARGIN-CONVERGENCE: complete\n'
                       'PD-MARGIN-BASELINE: id=12, page=vi, offset=0.0pt\n')
        self.assertEqual(report['issues'], [])
        self.assertEqual(report['prose_notes'], 1)

    def test_both_directions_fail_even_if_capacity_passes(self):
        for offset in [-42, 42]:
            report = audit('PD-MARGIN-CONVERGENCE: complete\n'
                           f'PD-MARGIN-BASELINE: id=12, page=2, offset={offset}pt\n')
            self.assertEqual(len(report['displaced']), 1)
            self.assertTrue(report['issues'])

    def test_unmeasured_document_cannot_pass(self):
        self.assertTrue(audit('PD-MARGIN-CONVERGENCE: complete')['issues'])

    def test_transient_geometry_cannot_pass(self):
        self.assertTrue(audit('PD-MARGIN-CONVERGENCE: pending\n'
                              'PD-MARGIN-BASELINE: id=1, page=1, offset=0.0pt')['issues'])


if __name__ == '__main__':
    unittest.main()
