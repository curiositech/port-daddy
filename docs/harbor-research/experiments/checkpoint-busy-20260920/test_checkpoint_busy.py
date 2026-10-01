"""Readback and deliberate-lie tests; these open NO SQLite connections."""
import ast
import copy
import hashlib
import io
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import checkpoint_busy as subject

HERE = Path(__file__).resolve().parent


class SafetyAndContract(unittest.TestCase):
    def test_existing_run_is_rejected_without_opening_sqlite(self):
        with self.assertRaises(FileExistsError):
            subject.resolve_new_run(HERE, "run-01")

    def test_paths_and_traversal_are_rejected(self):
        for name in ("../real", "/real", "run-01/child", ".", "run-1", "run-01.sqlite3"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                subject.resolve_new_run(HERE, name)

    def test_symlink_lab_is_rejected(self):
        with patch.object(Path, "is_symlink", return_value=True):
            with self.assertRaises(ValueError):
                subject.resolve_new_run(HERE, "run-02")

    def test_exactly_two_explicit_connect_calls_and_exclusive_creation(self):
        source = (HERE / "checkpoint_busy.py").read_text()
        tree = ast.parse(source)
        connects = [n for n in ast.walk(tree) if isinstance(n, ast.Call)
                    and isinstance(n.func, ast.Attribute) and n.func.attr == "connect"
                    and isinstance(n.func.value, ast.Name) and n.func.value.id == "sqlite3"]
        self.assertEqual(len(connects), 2)
        self.assertIn("os.O_CREAT | os.O_EXCL", source)
        self.assertIn('db.as_uri() + "?mode=rw"', source)
        self.assertIn("exist_ok=False", source)
        self.assertNotIn("subprocess", source)

    def test_issued_is_not_a_completion_or_durability_witness(self):
        # A command may have been issued in all these cases; that is insufficient.
        for result in (None, [], [1, 4, 3], [0, 4, 3], [0, -1, -1], [False, 4, 4]):
            with self.subTest(result=result):
                self.assertFalse(subject.checkpoint_complete(result))
        self.assertTrue(subject.checkpoint_complete([0, 4, 4]))


class MeasuredReadback(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.witness = json.loads((HERE / "run-01/results.json").read_text())

    def test_finite_readback_assertions(self):
        subject.validate_witness(self.witness)

    def test_source_and_preserved_bytes_hashes(self):
        self.assertEqual(hashlib.sha256((HERE / "checkpoint_busy.py").read_bytes()).hexdigest(), self.witness["runner_sha256"])
        for path, meta in self.witness["pre_close_file_witnesses"].items():
            data = (HERE / "run-01" / path).read_bytes()
            self.assertEqual(len(data), meta["bytes"])
            self.assertEqual(hashlib.sha256(data).hexdigest(), meta["sha256"])
        self.assertEqual(hashlib.sha256((HERE / "run-01/synthetic.sqlite3").read_bytes()).hexdigest(), self.witness["database_after_close_sha256"])

    def test_observer_snapshot_then_release_order(self):
        events = self.witness["commands"]
        attempts = [e for e in events if e["sql"] == "PRAGMA main.wal_checkpoint(FULL);"]
        self.assertEqual(len(attempts), 2)
        release = next(e["sequence"] for e in events if e["connection"] == "reader" and e["sql"] == "ROLLBACK;")
        self.assertLess(attempts[0]["sequence"], release)
        self.assertLess(release, attempts[1]["sequence"])
        self.assertEqual(attempts[0]["rows"][0], self.witness["checkpoint_attempts"][0]["triple"])
        self.assertEqual(attempts[1]["rows"][0], self.witness["checkpoint_attempts"][1]["triple"])
        # Reader runs no data writes; its observation cursor has been consumed.
        reader_sql = [e["sql"] for e in events if e["connection"] == "reader"]
        self.assertFalse(any(s.startswith(("INSERT", "UPDATE", "DELETE", "CREATE")) for s in reader_sql))

    def test_reject_falsely_fresh_pinned_reader(self):
        mutant = copy.deepcopy(self.witness)
        mutant["observations"]["reader_after_writer_commit"] = subject.LATEST
        with self.assertRaises(AssertionError):
            subject.validate_witness(mutant)

    def test_reject_issued_equals_verified_ack(self):
        mutant = copy.deepcopy(self.witness)
        mutant["checkpoint_attempts"][0]["completion_verified"] = True
        with self.assertRaises(AssertionError):
            subject.validate_witness(mutant)

    def test_reject_promoting_completion_to_durability_proof(self):
        mutant = copy.deepcopy(self.witness)
        mutant["durability_verified"] = True
        with self.assertRaises(AssertionError):
            subject.validate_witness(mutant)

    def test_reject_changed_connection_settings(self):
        mutant = copy.deepcopy(self.witness)
        mutant["settings"]["reader"]["wal_autocheckpoint"] = 1000
        with self.assertRaises(AssertionError):
            subject.validate_witness(mutant)


if __name__ == "__main__":
    stream = io.StringIO()
    suite = unittest.defaultTestLoader.loadTestsFromModule(sys.modules[__name__])
    result = unittest.TextTestRunner(stream=stream, verbosity=2).run(suite)
    record = {"tests_run": result.testsRun, "passed": result.wasSuccessful(),
              "failures": len(result.failures), "errors": len(result.errors),
              "log": stream.getvalue(), "sqlite_connections_opened_by_tests": 0,
              "tests_source_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              "measured_results_sha256": hashlib.sha256((HERE / "run-01/results.json").read_bytes()).hexdigest()}
    subject.write_json_new(HERE / "tests-results.json", record)
    print(stream.getvalue())
    sys.exit(0 if result.wasSuccessful() else 1)
