#!/usr/bin/env python3
"""Offline crash-window witness. All databases are synthetic sidecar artifacts."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys

KEY = "principal-1:payment-1"
POLICIES = ("journal_retry", "journal_hold", "receiver_dedup")
CUTS = ("none", "before_effect", "after_effect", "after_receipt")


def connect(path):
    db = sqlite3.connect(str(path))
    db.execute("PRAGMA synchronous=FULL")
    return db


def initialize(case):
    case.mkdir()
    with connect(case / "sender.sqlite") as db:
        db.execute("CREATE TABLE ops (key TEXT PRIMARY KEY, state TEXT, receipt INTEGER)")
    with connect(case / "receiver.sqlite") as db:
        db.execute("CREATE TABLE effects (id INTEGER PRIMARY KEY, key TEXT, units INTEGER)")
        db.execute("CREATE TABLE keys (key TEXT PRIMARY KEY, units INTEGER, receipt INTEGER)")


def receiver(case, units, dedup, check_binding=True):
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
    if key != KEY or status != "done" or not isinstance(receipt, int):
        return False
    matches = [row for row in state["effects"] if row[0] == receipt]
    if matches != [(receipt, KEY, expected_units)]:
        return False
    if retained_key and state["keys"] != [(KEY, expected_units, receipt)]:
        return False
    return True


def receiver_contract(state):
    return (state["effect_count"] == 1 and state["units"] == 10 and
            receipt_matches(state, retained_key=True))


def launch(case, policy, cut, resume=False, early_done=False):
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
              "protocol_sha256": hashlib.sha256((Path(__file__).parent / "PROTOCOL.md").read_bytes()).hexdigest(),
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
    parser.add_argument("--out", type=Path)
    parser.add_argument("--worker", type=Path, help=argparse.SUPPRESS)
    parser.add_argument("--policy", choices=POLICIES)
    parser.add_argument("--cut", choices=CUTS, default="none")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--early-done", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    target = args.worker or args.out
    if target is None:
        parser.error("--out is required")
    target = target.resolve()
    if root not in target.parents:
        parser.error("all outputs must remain inside this sidecar directory")
    if args.worker:
        if not args.policy or not (target / "sender.sqlite").is_file():
            parser.error("invalid worker case")
        worker(target, args.policy, args.cut, args.resume, args.early_done)
        return 0
    target.mkdir()  # Refuse any existing output directory; never erase a run.
    return evaluate(target)


if __name__ == "__main__":
    sys.exit(main())
