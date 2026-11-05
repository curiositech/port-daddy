#!/usr/bin/env python3
"""Fail if a required harness or its non-vacuity obligations did not pass."""
import re
import sys
from pathlib import Path

EXPECTED = {
    "proof_constant_time_behavior": 0,
    "proof_decoded_claims_policy": 7,
    "proof_decoded_channel_authority": 3,
    "proof_decoded_delegation_two_hops": 5,
    "proof_capability_attenuation": 2,
}


def check(text):
    blocks = re.split(r"Checking harness ([\w:]+)\.\.\.\n", text)
    seen = {}
    for index in range(1, len(blocks), 2):
        name = blocks[index].split("::")[-1]
        if name not in EXPECTED:
            continue
        if name in seen:
            raise ValueError(f"duplicate harness output: {name}")
        block = blocks[index + 1]
        if "VERIFICATION:- SUCCESSFUL" not in block or "VERIFICATION:- FAILED" in block:
            raise ValueError(f"harness did not verify: {name}")
        covers = re.findall(r"(\d+) of (\d+) cover properties satisfied", block)
        if EXPECTED[name]:
            if covers != [(str(EXPECTED[name]), str(EXPECTED[name]))]:
                raise ValueError(f"missing or unsatisfied cover obligations in {name}: {covers}")
        elif covers:
            raise ValueError(f"unexpected coverage contract in {name}")
        seen[name] = True
    if set(seen) != set(EXPECTED):
        raise ValueError(f"missing harnesses: {sorted(set(EXPECTED) - set(seen))}")
    if "Complete - 5 successfully verified harnesses, 0 failures, 5 total." not in text:
        raise ValueError("missing exact five-harness success summary")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: check-kani-log.py kani.log")
    try:
        check(Path(sys.argv[1]).read_text())
    except ValueError as error:
        raise SystemExit(f"FAIL: {error}")
    print("PASS: five harnesses verified; all 17 acceptance/rejection cover obligations satisfied")
