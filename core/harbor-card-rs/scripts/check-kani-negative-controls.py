#!/usr/bin/env python3
"""Run three deliberately broken copies; none may pass its actual harness.

Mutants live under the crate's excluded .cache directory. Production sources are never
modified. A compile error or resource failure is not a successful negative control.
"""
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / ".cache" / "kani-negative-controls"
MUTANTS = [
    (
        "expiry-removed",
        "if now_ts > claims.exp {",
        "if false {",
        "proof_decoded_claims_policy",
        "decoded policy matches temporal contract",
    ),
    (
        "ceiling-removed",
        "(Some(r), Some(s)) => s <= r,",
        "(Some(_r), Some(_s)) => true,",
        "proof_decoded_delegation_two_hops",
        "rate ceiling preserved",
    ),
    # The pattern-cover rule before the fix compared the root prefix with the
    # sub-pattern's spelling, so `**` covered `*` and `a**` covered `a*`. The
    # widened pattern domain must find that, or it cannot tell the rules apart.
    (
        "covers-spelling-prefix",
        "let reached = sub_pattern.strip_suffix('*').unwrap_or(sub_pattern);",
        "let reached = sub_pattern;",
        "proof_decoded_delegation_two_hops",
        "attenuated grant stays inside its parent",
    ),
]


def main():
    if not OUT.resolve().is_relative_to(ROOT):
        raise SystemExit("negative controls must remain inside the crate")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "receipt.json").unlink(missing_ok=True)
    source_files = [ROOT / "Cargo.toml", ROOT / "Cargo.lock", *sorted((ROOT / "src").glob("*.rs"))]
    source_hashes = {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
                     for path in source_files}
    version = subprocess.check_output(["cargo", "kani", "--version"], text=True).strip()
    receipt = []
    for name, old, new, harness, expected in MUTANTS:
        directory = OUT / name
        directory.mkdir(exist_ok=True)
        for filename in ["Cargo.toml", "Cargo.lock"]:
            shutil.copy2(ROOT / filename, directory / filename)
        for folder in ["src", "benches"]:
            shutil.copytree(ROOT / folder, directory / folder, dirs_exist_ok=True)
        source = directory / "src" / "lib.rs"
        text = source.read_text()
        if text.count(old) != 1:
            raise SystemExit(f"{name}: mutation site must be unique")
        source.write_text(text.replace(old, new))
        log = OUT / f"{name}.log"
        with log.open("w") as stream:
            run = subprocess.Popen(
                ["cargo", "kani", "--lib", "--harness", harness],
                cwd=directory, stdout=stream, stderr=subprocess.STDOUT,
                start_new_session=True,
            )
            try:
                run.wait(timeout=600)
            except subprocess.TimeoutExpired:
                # Stop the solver children too; a killed cargo parent alone
                # can leave CBMC consuming CPU after a failed control.
                os.killpg(run.pid, signal.SIGKILL)
                run.wait()
                raise SystemExit(f"{name}: timed out; no counterexample evidence")
        output = log.read_text()
        # Match the named failed assertion, not just a nonzero subprocess exit.
        failed = [b for b in re.split(r"\nCheck \d+:", output)
                  if "Status: FAILURE" in b and expected in b]
        if run.returncode == 0 or "VERIFICATION:- FAILED" not in output or not failed:
            raise SystemExit(f"{name}: expected assertion was not disproved; inspect {log}")
        receipt.append({"mutant": name, "harness": harness,
                        "expectedAssertion": expected, "exitCode": run.returncode,
                        "result": "counterexample found", "kaniVersion": version,
                        "sourceSha256": source_hashes})
        print(f"PASS: {name} has a counterexample to {expected}", flush=True)
    (OUT / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")


if __name__ == "__main__":
    main()
