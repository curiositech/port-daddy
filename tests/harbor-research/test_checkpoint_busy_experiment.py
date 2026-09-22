"""Read-only verification of two archived synthetic checkpoint runs."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
ARCHIVE = ROOT / 'docs/harbor-research/experiments/checkpoint-busy-20260920'
spec = importlib.util.spec_from_file_location('checkpoint_busy', ARCHIVE / 'checkpoint_busy.py')
subject = importlib.util.module_from_spec(spec); spec.loader.exec_module(subject)


class CheckpointWitness(unittest.TestCase):
    def test_both_finite_witnesses_and_preserved_bytes(self):
        for run in ('run-01', 'run-02'):
            directory = ARCHIVE / run
            witness = json.loads((directory / 'results.json').read_text())
            subject.validate_witness(witness)
            self.assertEqual(witness['runner_sha256'], hashlib.sha256((ARCHIVE / 'checkpoint_busy.py').read_bytes()).hexdigest())
            for path, meta in witness['pre_close_file_witnesses'].items():
                data = (directory / path).read_bytes()
                self.assertEqual(len(data), meta['bytes'])
                self.assertEqual(hashlib.sha256(data).hexdigest(), meta['sha256'])
            self.assertEqual(hashlib.sha256((directory / 'synthetic.sqlite3').read_bytes()).hexdigest(), witness['database_after_close_sha256'])

    def test_no_busy_result_or_missing_wal_means_completion(self):
        for value in (None, [], [1,4,3], [0,4,3], [0,-1,-1], [False,4,4]):
            self.assertFalse(subject.checkpoint_complete(value))
        self.assertTrue(subject.checkpoint_complete([0,4,4]))

    def test_false_durable_ack_is_rejected(self):
        witness = json.loads((ARCHIVE / 'run-02/results.json').read_text())
        for key in ('durability_verified', 'process_crash_tested', 'power_loss_tested'):
            mutant = copy.deepcopy(witness); mutant[key] = True
            with self.assertRaises(AssertionError): subject.validate_witness(mutant)
        mutant = copy.deepcopy(witness)
        mutant['checkpoint_attempts'][0]['completion_verified'] = True
        with self.assertRaises(AssertionError): subject.validate_witness(mutant)


if __name__ == '__main__':
    unittest.main()
