#!/usr/bin/env python3
"""Offline SQLite crash witness; fresh reproductions are NOT historical run-02.

Only synthetic stores under repository .cache or external ~/coding/tmp are used.
The sender's recovery policy has no observer input. This is an interface-level
separation, not a sandbox isolating the mock receiver into another OS process.
"""
import argparse
import copy
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import uuid

KEY = "principal-1:payment-1"
POLICIES = ("journal_retry", "journal_hold", "receiver_dedup")
CUTS = ("none", "before_effect", "after_effect", "after_receipt")
ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / "docs/harbor-research/experiments/receipt-gap-20260920"
PROTOCOL = EVIDENCE / "original/PROTOCOL.md"
REFERENCE_SHA256 = "e93863430b6b09d7845aa637304e719114e60c9444529deb3fc1ed6cadbc7a38"
RUN_MARKER = ".receipt-gap-run.json"
CASE_MARKER = ".receipt-gap-case.json"
FORMAT = "receipt-gap-synthetic-sqlite-v1"


def scratch_path(path):
    """Reject source paths, symlink aliases, and broad scratch roots before writes.

    These guards prevent accidental reuse of unrelated stores. They are not a
    hostile-filesystem security boundary (no protection against concurrent races).
    """
    lexical = Path(path).expanduser().absolute()
    target = lexical.resolve()
    scratch = (Path.home() / "coding/tmp").resolve()
    cache = ROOT / ".cache"
    if lexical != target:
        raise ValueError("scratch path must not contain symlink aliases or '..'")
    if cache not in target.parents and not (scratch in target.parents and
                                           ROOT != target and ROOT not in target.parents):
        raise ValueError("use a fresh directory under repository .cache or external ~/coding/tmp")
    return target


def read_marker(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_nlink != 1:
        raise ValueError("missing or aliased synthetic-fixture marker")
    marker = json.loads(path.read_text())
    if (marker.get("format") != FORMAT or not isinstance(marker.get("run_id"), str)
            or not marker["run_id"]):
        raise ValueError("invalid synthetic-fixture marker")
    return marker


def create_run(path):
    target = scratch_path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.mkdir()  # Never reuse, empty, or erase any existing directory.
    marker = {"format": FORMAT, "run_id": str(uuid.uuid4()), "run_kind": "fresh-reproduction"}
    (target / RUN_MARKER).write_text(json.dumps(marker, indent=2) + "\n")
    return target


def validate_case(case):
    case = scratch_path(case)
    run = read_marker(case.parent / RUN_MARKER)
    marker = read_marker(case / CASE_MARKER)
    if marker["run_id"] != run["run_id"]:
        raise ValueError("case does not belong to this synthetic run")
    for name in ("sender.sqlite", "receiver.sqlite"):
        db = case / name
        if db.is_symlink() or not db.is_file() or db.stat().st_nlink != 1:
            raise ValueError("missing or aliased synthetic database")
        for suffix in ("-journal", "-wal", "-shm"):
            sidecar = case / (name + suffix)
            if sidecar.is_symlink() or (sidecar.exists() and sidecar.stat().st_nlink != 1):
                raise ValueError("aliased SQLite sidecar")
    return case


@contextmanager
def connect(path):
    db = sqlite3.connect(str(path))
    try:
        db.execute("PRAGMA synchronous=FULL")
        with db:
            yield db
    finally:
        db.close()


def initialize(case):
    case = scratch_path(case)
    run = read_marker(case.parent / RUN_MARKER)
    case.mkdir()
    (case / CASE_MARKER).write_text(json.dumps(run, indent=2) + "\n")
    with connect(case / "sender.sqlite") as db:
        db.execute("CREATE TABLE ops (key TEXT PRIMARY KEY, state TEXT, receipt INTEGER)")
    with connect(case / "receiver.sqlite") as db:
        db.execute("CREATE TABLE effects (id INTEGER PRIMARY KEY, key TEXT, units INTEGER)")
        db.execute("CREATE TABLE keys (key TEXT PRIMARY KEY, units INTEGER, receipt INTEGER)")


def receiver(case, units, dedup, check_binding=True):
    validate_case(case)
    with connect(case / "receiver.sqlite") as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT units,receipt FROM keys WHERE key=?", (KEY,)).fetchone()
        if dedup and row:
            if check_binding and row[0] != units:
                raise ValueError("key_payload_conflict")
            return row[1]
        receipt = db.execute("INSERT INTO effects(key,units) VALUES (?,?)", (KEY, units)).lastrowid
        if dedup:
            db.execute("INSERT INTO keys VALUES (?,?,?)", (KEY, units, receipt))
        return receipt


def worker(case, policy, cut, resume, early_done=False):
    validate_case(case)
    with connect(case / "sender.sqlite") as db:
        row = db.execute("SELECT state,receipt FROM ops WHERE key=?", (KEY,)).fetchone()
        if row and row[0] == "done":
            return
        if row and resume and policy == "journal_hold":
            return  # Unknown remains unknown; no oracle read of receiver state.
        db.execute("INSERT OR IGNORE INTO ops VALUES (?, 'pending', NULL)", (KEY,))
        if early_done:
            db.execute("UPDATE ops SET state='done',receipt=999 WHERE key=?", (KEY,))
    if cut == "before_effect":
        os._exit(70)
    receipt = receiver(case, 10, policy == "receiver_dedup")
    if cut == "after_effect":
        os._exit(70)
    with connect(case / "sender.sqlite") as db:
        db.execute("UPDATE ops SET state='done',receipt=? WHERE key=?", (receipt, KEY))
    if cut == "after_receipt":
        os._exit(70)


def snapshot(case):
    validate_case(case)
    with connect(case / "sender.sqlite") as db:
        local = db.execute("SELECT key,state,receipt FROM ops ORDER BY key").fetchall()
    with connect(case / "receiver.sqlite") as db:
        effects = db.execute("SELECT id,key,units FROM effects ORDER BY id").fetchall()
        keys = db.execute("SELECT key,units,receipt FROM keys ORDER BY key").fetchall()
    return {"local": local, "effects": effects, "keys": keys,
            "effect_count": len(effects), "units": sum(row[2] for row in effects)}


def receipt_matches(state, expected_units=10, retained_key=False):
    """Independent post-run oracle: join receipt, effect, key, and payload."""
    if len(state["local"]) != 1:
        return False
    key, status, receipt = state["local"][0]
    if key != KEY or status != "done" or type(receipt) is not int:
        return False
    matches = [tuple(row) for row in state["effects"] if row[0] == receipt]
    if matches != [(receipt, KEY, expected_units)]:
        return False
    if retained_key and [tuple(row) for row in state["keys"]] != [(KEY, expected_units, receipt)]:
        return False
    return True


def receiver_contract(state):
    return (len(state["effects"]) == state["effect_count"] == 1 and
            sum(row[2] for row in state["effects"]) == state["units"] == 10 and
            receipt_matches(state, retained_key=True))


def launch(case, policy, cut, resume=False, early_done=False):
    validate_case(case)
    cmd = [sys.executable, str(Path(__file__).resolve()), "--worker", str(case),
           "--policy", policy, "--cut", cut]
    if resume:
        cmd.append("--resume")
    if early_done:
        cmd.append("--early-done")
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
    expected = 0 if cut == "none" else 70
    if result.returncode != expected:
        raise RuntimeError({"expected": expected, "actual": result.returncode,
                            "stderr": result.stderr, "case": str(case)})
    return result.returncode


def run_case(out, name, policy, cut, early_done=False, forget_key=False):
    case = out / name
    initialize(case)
    first = launch(case, policy, cut, early_done=early_done)
    before = snapshot(case)
    if forget_key:
        with connect(case / "receiver.sqlite") as db:
            db.execute("DELETE FROM keys WHERE key=?", (KEY,))
    second = launch(case, policy, "none", resume=True)
    return {"name": name, "policy": policy, "cut": cut,
            "exit_codes": [first, second], "before_recovery": before,
            "after_recovery": snapshot(case)}


def evaluate(out):
    run = read_marker(out / RUN_MARKER)
    cases = [run_case(out, policy + "__" + cut, policy, cut)
             for policy in POLICIES for cut in CUTS]
    checks = []
    for case in cases:
        state = case["after_recovery"]
        expected_count = 1
        expected_state = "done"
        if case["policy"] == "journal_retry" and case["cut"] == "after_effect":
            expected_count = 2
        if case["policy"] == "journal_hold" and case["cut"] in ("before_effect", "after_effect"):
            expected_count = int(case["cut"] == "after_effect")
            expected_state = "pending"
        checks.append({"name": case["name"], "pass":
                       state["effect_count"] == expected_count and
                       state["units"] == 10 * expected_count and
                       state["local"][0][1] == expected_state and
                       (receipt_matches(state, retained_key=case["policy"] == "receiver_dedup")
                        if expected_state == "done" else state["local"][0][2] is None)})
    pair = [case["before_recovery"] for case in cases
            if case["policy"] == "journal_retry" and case["cut"] in ("before_effect", "after_effect")]
    checks.append({"name": "equal_sender_state_different_effects", "pass":
                   pair[0]["local"] == pair[1]["local"] and
                   [row["effect_count"] for row in pair] == [0, 1]})
    mutants = [run_case(out, "mutant_forget_key", "receiver_dedup", "after_effect", forget_key=True),
               run_case(out, "mutant_done_before_effect", "journal_retry", "before_effect", early_done=True)]
    checks.append({"name": "forget_key_caught", "pass": mutants[0]["after_recovery"]["effect_count"] == 2})
    early = mutants[1]["after_recovery"]
    checks.append({"name": "false_completion_caught", "pass":
                   early["effect_count"] == 0 and early["local"][0][1] == "done"})
    binding = out / "payload_binding"
    initialize(binding)
    receiver(binding, 10, True)
    original = snapshot(binding)
    rejected = False
    try:
        receiver(binding, 11, True)
    except ValueError as error:
        rejected = str(error) == "key_payload_conflict"
    checks.append({"name": "payload_conflict_rejected_unchanged", "pass":
                   rejected and snapshot(binding) == original})
    mutated = receiver(binding, 11, True, check_binding=False)
    checks.append({"name": "payload_binding_mutant_caught", "pass": mutated == 1})
    restored = [run_case(out, "restored__" + cut, "receiver_dedup", cut) for cut in CUTS]
    for case in restored:
        checks.append({"name": case["name"] + "__receipt_effect_key_payload",
                       "pass": receiver_contract(case["after_recovery"])})
    # Mutate every link the stronger oracle claims to check. No database writes.
    valid = restored[0]["after_recovery"]
    corruptions = {}
    for name, table, column, value in (
            ("local_receipt", "local", 2, 999),
            ("local_key", "local", 0, "other-key"),
            ("effect_receipt", "effects", 0, 999),
            ("effect_key", "effects", 1, "other-key"),
            ("effect_payload", "effects", 2, 11),
            ("retained_key", "keys", 0, "other-key"),
            ("retained_payload", "keys", 1, 11),
            ("retained_receipt", "keys", 2, 999)):
        damaged = copy.deepcopy(valid)
        row = list(damaged[table][0])
        row[column] = value
        damaged[table][0] = tuple(row)
        corruptions[name] = not receiver_contract(damaged)
    missing_key = copy.deepcopy(valid)
    missing_key["keys"] = []
    corruptions["missing_retained_key"] = not receiver_contract(missing_key)
    checks.append({"name": "receipt_oracle_mutations_caught", "pass": all(corruptions.values())})
    result = {"scope": "Synthetic SQLite receiver; finite process-crash matrix, not runtime proof",
              "script_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              "protocol_sha256": hashlib.sha256(PROTOCOL.read_bytes()).hexdigest(),
              "run_kind": "fresh-reproduction", "run_id": run["run_id"],
              "reference_run02_sha256": REFERENCE_SHA256,
              "declared_child_launches": 36,
              "python": sys.version, "sqlite": sqlite3.sqlite_version,
              "primary_cases": cases, "mutation_cases": mutants,
              "binding_before": original, "binding_after": snapshot(binding),
              "receipt_oracle_mutations": corruptions,
              "restoration_cases": restored, "checks": checks,
              "pass": all(c["pass"] for c in checks)}
    (out / "experiment-results.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"pass": result["pass"], "primary_cases": len(cases),
                      "checks": len(checks), "output": str(out / "experiment-results.json")}))
    return 0 if result["pass"] else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    target_group = parser.add_mutually_exclusive_group(required=True)
    target_group.add_argument("--out", type=Path)
    target_group.add_argument("--worker", type=Path, help=argparse.SUPPRESS)
    parser.add_argument("--policy", choices=POLICIES)
    parser.add_argument("--cut", choices=CUTS, default="none")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--early-done", action="store_true")
    args = parser.parse_args()
    try:
        if args.worker:
            if not args.policy:
                parser.error("invalid worker policy")
            target = validate_case(args.worker)
            worker(target, args.policy, args.cut, args.resume, args.early_done)
            return 0
        if args.policy or args.resume or args.early_done or args.cut != "none":
            parser.error("worker options cannot be used with --out")
        target = create_run(args.out)
    except (ValueError, OSError) as error:
        parser.error(str(error))
    return evaluate(target)


if __name__ == "__main__":
    sys.exit(main())
