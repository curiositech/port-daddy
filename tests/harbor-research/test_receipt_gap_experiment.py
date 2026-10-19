"""Offline regression tests; generated SQLite stores stay in repository .cache.

One fresh 36-worker matrix is shared by the tests. Historical run-02 is read-only.
No PD, network, model calls, actual payments, or external receiver is involved.
"""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/harbor-research/receipt_gap_experiment.py"
EVIDENCE = ROOT / "docs/harbor-research/experiments/receipt-gap-20260920"
spec = importlib.util.spec_from_file_location("receipt_gap_experiment", SCRIPT)
experiment = importlib.util.module_from_spec(spec)
spec.loader.exec_module(experiment)
KEY = experiment.KEY
ARCHIVE_HASHES = {
    "original/receipt_gap_experiment.py": "8fcbe645943730e4473a050c6f54710892a502c55ae0ca42513e0002e176a880",
    "original/PROTOCOL.md": "b4e2dc03efbb9842a2a2f41b8bf8bee91fc269d8a9de71959c36e77c44fbadc1",
    "experiment-results.json": "e93863430b6b09d7845aa637304e719114e60c9444529deb3fc1ed6cadbc7a38",
}
EXPECTED = {
    "none": ((1, "done"), (1, "done"), (1, "done")),
    "before_effect": ((1, "done"), (0, "pending"), (1, "done")),
    "after_effect": ((2, "done"), (1, "pending"), (1, "done")),
    "after_receipt": ((1, "done"), (1, "done"), (1, "done")),
}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class ReceiptGapExperimentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cache = ROOT / ".cache/receipt-gap-tests"
        cache.mkdir(parents=True, exist_ok=True)
        # Deliberately retained as identifiable fresh evidence, never run-02.
        cls.scratch = Path(tempfile.mkdtemp(prefix="reproduction-", dir=str(cache)))
        cls.matrix_dir = cls.scratch / "matrix"
        child = subprocess.run(
            [sys.executable, "-B", str(SCRIPT), "--out", str(cls.matrix_dir)],
            capture_output=True, text=True, timeout=190,
            env=dict(os.environ, PYTHONDONTWRITEBYTECODE="1"),
        )
        if child.returncode:
            raise RuntimeError(child.stdout + child.stderr)
        cls.fresh_path = cls.matrix_dir / "experiment-results.json"
        cls.fresh = json.loads(cls.fresh_path.read_text())
        cls.historical = json.loads((EVIDENCE / "experiment-results.json").read_text())
        print("\nFresh reproduction (NOT run-02): " + str(cls.fresh_path), flush=True)
        print("Fresh result SHA256: " + digest(cls.fresh_path), flush=True)

    def new_run(self, suffix=""):
        return experiment.create_run(self.scratch / (self._testMethodName + suffix))

    def invoke(self, *args):
        return subprocess.run(
            [sys.executable, "-B", str(SCRIPT), *map(str, args)],
            capture_output=True, text=True, timeout=8,
            env=dict(os.environ, PYTHONDONTWRITEBYTECODE="1"),
        )

    def test_historical_artifacts_are_byte_exact(self):
        for name, expected in ARCHIVE_HASHES.items():
            with self.subTest(name=name):
                self.assertEqual(digest(EVIDENCE / name), expected)
        self.assertEqual(self.historical["script_sha256"], ARCHIVE_HASHES["original/receipt_gap_experiment.py"])
        self.assertEqual(self.historical["protocol_sha256"], ARCHIVE_HASHES["original/PROTOCOL.md"])

    def test_fresh_run_is_distinct_and_preserves_measured_semantics(self):
        self.assertEqual(self.fresh["run_kind"], "fresh-reproduction")
        self.assertTrue(self.fresh["run_id"])
        self.assertEqual(self.fresh["script_sha256"], digest(SCRIPT))
        self.assertNotEqual(self.fresh["script_sha256"], self.historical["script_sha256"])
        self.assertEqual(self.fresh["reference_run02_sha256"], ARCHIVE_HASHES["experiment-results.json"])
        for field in ("scope", "protocol_sha256", "primary_cases", "mutation_cases",
                      "binding_before", "binding_after", "receipt_oracle_mutations",
                      "restoration_cases", "checks", "pass"):
            with self.subTest(field=field):
                self.assertEqual(self.fresh[field], self.historical[field])
        self.assertEqual(len(self.fresh["checks"]), 22)
        self.assertTrue(all(check["pass"] is True for check in self.fresh["checks"]))

    def test_actual_crashes_and_exact_36_launches(self):
        cases = (self.fresh["primary_cases"] + self.fresh["mutation_cases"]
                 + self.fresh["restoration_cases"])
        self.assertEqual(len(cases), 18)
        self.assertEqual(sum(len(case["exit_codes"]) for case in cases), 36)
        self.assertEqual(self.fresh["declared_child_launches"], 36)
        for case in cases:
            with self.subTest(case=case["name"]):
                self.assertEqual(case["exit_codes"], [0 if case["cut"] == "none" else 70, 0])
        # Durable committed state survives os._exit; these are not mocked crash codes.
        after = next(case for case in cases if case["name"] == "journal_retry__after_effect")
        self.assertEqual(after["before_recovery"]["local"], [[KEY, "pending", None]])
        self.assertEqual(after["before_recovery"]["effects"], [[1, KEY, 10]])

    def test_independent_matrix_from_raw_rows(self):
        self.assertEqual(len(self.fresh["primary_cases"]), 12)
        for case in self.fresh["primary_cases"]:
            count, status = EXPECTED[case["cut"]][experiment.POLICIES.index(case["policy"])]
            state = case["after_recovery"]
            with self.subTest(case=case["name"]):
                self.assertEqual(len(state["effects"]), count)
                self.assertEqual(sum(row[2] for row in state["effects"]), 10 * count)
                self.assertEqual(state["effect_count"], count)
                self.assertEqual(state["units"], 10 * count)
                self.assertEqual(state["local"][0][:2], [KEY, status])
                if status == "done":
                    receipt = state["local"][0][2]
                    self.assertEqual([row for row in state["effects"] if row[0] == receipt],
                                     [[receipt, KEY, 10]])
                else:
                    self.assertIsNone(state["local"][0][2])

    def test_compact_matrix_is_exact_derived_projection(self):
        matrix = json.loads((EVIDENCE / "matrix.json").read_text())
        self.assertEqual(matrix["source_sha256"], ARCHIVE_HASHES["experiment-results.json"])
        self.assertEqual([row["cut"] for row in matrix["rows"]], list(experiment.CUTS))
        lookup = {(c["cut"], c["policy"]): c for c in self.historical["primary_cases"]}
        for row in matrix["rows"]:
            self.assertEqual(set(row["policies"]), set(experiment.POLICIES))
            for policy, cell in row["policies"].items():
                state = lookup[row["cut"], policy]["after_recovery"]
                self.assertEqual(cell, {
                    "effects": len(state["effects"]),
                    "units": sum(item[2] for item in state["effects"]),
                    "sender_state": state["local"][0][1],
                    "receipt": state["local"][0][2],
                })

    def test_equal_sender_histories_have_different_receiver_effects(self):
        pair = [c["before_recovery"] for c in self.fresh["primary_cases"]
                if c["policy"] == "journal_retry" and c["cut"] in ("before_effect", "after_effect")]
        self.assertEqual(pair[0]["local"], pair[1]["local"])
        self.assertEqual([len(s["effects"]) for s in pair], [0, 1])

    def test_recovery_cannot_read_controller_or_receiver_snapshot(self):
        run = self.new_run()
        real_connect = experiment.connect
        for policy in experiment.POLICIES:
            traces = []
            for hidden_effect in (False, True):
                case = run / (policy + str(hidden_effect))
                experiment.initialize(case)
                with real_connect(case / "sender.sqlite") as db:
                    db.execute("INSERT INTO ops VALUES (?, 'pending', NULL)", (KEY,))
                if hidden_effect:
                    experiment.receiver(case, 10, policy == "receiver_dedup")
                accesses = []

                def sender_only(path):
                    self.assertEqual(Path(path), case / "sender.sqlite",
                                     "recovery illegally read the receiver/observer database")
                    accesses.append(Path(path).name)
                    return real_connect(path)

                with mock.patch.object(experiment, "connect", side_effect=sender_only), \
                     mock.patch.object(experiment, "snapshot", side_effect=AssertionError("observer leak")), \
                     mock.patch.object(experiment, "receiver", return_value=42) as request:
                    experiment.worker(case, policy, "none", resume=True)
                if policy == "journal_hold":
                    request.assert_not_called()
                    expected_local = [(KEY, "pending", None)]
                else:
                    request.assert_called_once_with(case, 10, policy == "receiver_dedup")
                    expected_local = [(KEY, "done", 42)]
                with real_connect(case / "sender.sqlite") as db:
                    self.assertEqual(db.execute("SELECT key,state,receipt FROM ops").fetchall(), expected_local)
                traces.append((accesses, request.call_count))
            self.assertEqual(traces[0], traces[1])
        # The mock receiver is an API stub here, not an OS security boundary.
        # Actual atomic receiver behavior is covered by the independent crash matrix.

    def test_intact_and_restored_dedup_join_all_records(self):
        cases = [c for c in self.fresh["primary_cases"] if c["policy"] == "receiver_dedup"]
        cases += self.fresh["restoration_cases"]
        self.assertEqual(len(cases), 8)
        for case in cases:
            state = case["after_recovery"]
            with self.subTest(case=case["name"]):
                self.assertEqual(state["local"], [[KEY, "done", 1]])
                self.assertEqual(state["effects"], [[1, KEY, 10]])
                self.assertEqual(state["keys"], [[KEY, 10, 1]])
                self.assertTrue(experiment.receiver_contract(state))

    def test_binding_conflict_rejects_without_state_change(self):
        case = self.new_run() / "binding"
        experiment.initialize(case)
        self.assertEqual(experiment.receiver(case, 10, True), 1)
        before = experiment.snapshot(case)
        self.assertEqual(experiment.receiver(case, 10, True), 1)
        self.assertEqual(experiment.snapshot(case), before)
        with self.assertRaisesRegex(ValueError, "^key_payload_conflict$"):
            experiment.receiver(case, 11, True)
        self.assertEqual(experiment.snapshot(case), before)
        # Deliberately disabled binding accepts the wrong payload, reusing receipt 1.
        self.assertEqual(experiment.receiver(case, 11, True, check_binding=False), 1)
        self.assertEqual(experiment.snapshot(case), before)
        self.assertNotEqual(before["effects"][0][2], 11)

    def test_receiver_effect_and_key_rollback_together(self):
        case = self.new_run() / "atomic"
        experiment.initialize(case)
        with experiment.connect(case / "receiver.sqlite") as db:
            db.execute("CREATE TRIGGER deny_key BEFORE INSERT ON keys "
                       "BEGIN SELECT RAISE(ABORT, 'injected_key_failure'); END")
        with self.assertRaisesRegex(sqlite3.IntegrityError, "injected_key_failure"):
            experiment.receiver(case, 10, True)
        state = experiment.snapshot(case)
        self.assertEqual(state["effects"], [])
        self.assertEqual(state["keys"], [])
        with experiment.connect(case / "receiver.sqlite") as db:
            db.execute("DROP TRIGGER deny_key")
        self.assertEqual(experiment.receiver(case, 10, True), 1)

    def test_known_mutants_expose_duplicate_and_false_completion(self):
        forget, early = [c["after_recovery"] for c in self.fresh["mutation_cases"]]
        self.assertEqual(forget["effects"], [[1, KEY, 10], [2, KEY, 10]])
        self.assertEqual(forget["keys"], [[KEY, 10, 2]])
        self.assertFalse(experiment.receiver_contract(forget))
        self.assertEqual(early["local"], [[KEY, "done", 999]])
        self.assertEqual(early["effects"], [])
        self.assertFalse(experiment.receipt_matches(early))
        self.assertEqual(self.fresh["binding_before"], self.fresh["binding_after"])

    def test_all_nine_known_oracle_lies_are_rejected(self):
        valid = self.historical["restoration_cases"][0]["after_recovery"]
        self.assertTrue(experiment.receiver_contract(valid))
        mutations = (
            ("local_receipt", "local", 2, 999), ("local_key", "local", 0, "other-key"),
            ("effect_receipt", "effects", 0, 999), ("effect_key", "effects", 1, "other-key"),
            ("effect_payload", "effects", 2, 11), ("retained_key", "keys", 0, "other-key"),
            ("retained_payload", "keys", 1, 11), ("retained_receipt", "keys", 2, 999),
        )
        for name, table, column, value in mutations:
            with self.subTest(name=name):
                lie = copy.deepcopy(valid)
                lie[table][0][column] = value
                self.assertFalse(experiment.receiver_contract(lie))
                self.assertTrue(self.fresh["receipt_oracle_mutations"][name])
        missing = copy.deepcopy(valid)
        missing["keys"] = []
        self.assertFalse(experiment.receiver_contract(missing))
        self.assertEqual(len(self.fresh["receipt_oracle_mutations"]), 9)
        self.assertTrue(all(self.fresh["receipt_oracle_mutations"].values()))

    def test_checker_rejects_forged_summary_and_boolean_receipt(self):
        valid = self.fresh["restoration_cases"][0]["after_recovery"]
        lie = copy.deepcopy(valid)
        lie["effects"].append([2, KEY, 10])  # Leave the cached count/units at 1/10.
        self.assertFalse(experiment.receiver_contract(lie))
        lie = copy.deepcopy(valid)
        lie["local"][0][2] = True  # bool is an int subclass, not an issued receipt.
        self.assertFalse(experiment.receiver_contract(lie))

    def test_hold_preserves_at_most_once_without_useful_recovery(self):
        cases = [c for c in self.fresh["primary_cases"] if c["policy"] == "journal_hold"]
        self.assertTrue(all(len(c["after_recovery"]["effects"]) <= 1 for c in cases))
        pending = [c for c in cases if c["cut"] in ("before_effect", "after_effect")]
        self.assertEqual([c["after_recovery"]["local"][0][1] for c in pending], ["pending", "pending"])
        self.assertEqual([len(c["after_recovery"]["effects"]) for c in pending], [0, 1])
        # Unknown is not certified failure or success; safety alone is not progress.

    def test_existing_run_and_unmarked_worker_refused_without_writes(self):
        result_hash = digest(self.fresh_path)
        child = self.invoke("--out", self.matrix_dir)
        self.assertNotEqual(child.returncode, 0)
        self.assertEqual(digest(self.fresh_path), result_hash)
        unmarked = self.scratch / "unmarked"
        unmarked.mkdir()
        for name in ("sender.sqlite", "receiver.sqlite"):
            with sqlite3.connect(str(unmarked / name)) as db:
                db.execute("CREATE TABLE untouched (x INTEGER)")
        before = {p.name: digest(p) for p in unmarked.iterdir()}
        child = self.invoke("--worker", unmarked, "--policy", "journal_retry")
        self.assertNotEqual(child.returncode, 0)
        self.assertIn("marker", child.stderr)
        self.assertEqual({p.name: digest(p) for p in unmarked.iterdir()}, before)

    def test_source_paths_broad_roots_and_mixed_cli_are_refused(self):
        for target in (ROOT, ROOT / "scripts/harbor-research",
                       EVIDENCE / "would-be-run", ROOT / ".cache", Path.home() / "coding/tmp"):
            with self.subTest(target=target):
                with self.assertRaises(ValueError):
                    experiment.scratch_path(target)
        self.assertFalse((EVIDENCE / "would-be-run").exists())
        child = self.invoke("--out", self.scratch / "mixed", "--worker", self.matrix_dir)
        self.assertNotEqual(child.returncode, 0)
        self.assertFalse((self.scratch / "mixed").exists())
        child = self.invoke("--out", self.scratch / "flags", "--early-done")
        self.assertNotEqual(child.returncode, 0)
        self.assertFalse((self.scratch / "flags").exists())

    def test_symlink_aliases_and_wrong_run_marker_refused(self):
        run = self.new_run()
        case = run / "real"
        experiment.initialize(case)
        alias = run / "alias"
        alias.symlink_to(case, target_is_directory=True)
        with self.assertRaises(ValueError):
            experiment.validate_case(alias)
        # Make a deliberately bad fixture; changing a marker must not touch its DBs.
        marker = case / experiment.CASE_MARKER
        data = json.loads(marker.read_text())
        data["run_id"] = "different-run"
        marker.write_text(json.dumps(data))
        before = digest(case / "sender.sqlite")
        child = self.invoke("--worker", case, "--policy", "journal_retry")
        self.assertNotEqual(child.returncode, 0)
        self.assertEqual(digest(case / "sender.sqlite"), before)

    def test_aliased_database_and_sqlite_sidecar_refused(self):
        run = self.new_run()
        case = run / "real"
        experiment.initialize(case)
        other = run / "other"
        experiment.initialize(other)
        receiver_path = case / "receiver.sqlite"
        receiver_path.rename(case / "original-receiver.sqlite")
        receiver_path.symlink_to(other / "receiver.sqlite")
        before = digest(other / "receiver.sqlite")
        with self.assertRaisesRegex(ValueError, "aliased synthetic database"):
            experiment.validate_case(case)
        self.assertEqual(digest(other / "receiver.sqlite"), before)
        # A linked journal also fails before sqlite3 opens a file.
        (other / "sender.sqlite-journal").symlink_to(case / "original-receiver.sqlite")
        with self.assertRaisesRegex(ValueError, "aliased SQLite sidecar"):
            experiment.validate_case(other)

    def test_worker_timeout_is_five_seconds_and_not_retried(self):
        case = self.matrix_dir / "receiver_dedup__none"
        with mock.patch.object(experiment.subprocess, "run",
                               side_effect=subprocess.TimeoutExpired("worker", 5)) as call:
            with self.assertRaises(subprocess.TimeoutExpired):
                experiment.launch(case, "receiver_dedup", "none", resume=True)
            call.assert_called_once()
            self.assertEqual(call.call_args.kwargs["timeout"], 5)


if __name__ == "__main__":
    unittest.main()
