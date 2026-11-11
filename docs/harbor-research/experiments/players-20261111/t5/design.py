#!/usr/bin/env python3
"""T5 design: build the 16 change requests, their ground truth and the checks on them.

    python3 t5/design.py build           write everything under materials/
    python3 t5/design.py build --check   exit non-zero if a fresh build differs

The code base is base/ and the changes are the edit scripts in changes.py.
The build applies each script, writes the diff and the changed files, finds
each flaw's lines, and verifies every change before anything is sealed:

- the diff, applied to base/, gives exactly the changed files;
- the code base's tests and the change's own tests pass on every change,
  flawed or clean, so running the tests gives no flaw away;
- every probe fails on the change and passes once the flaw is fixed.

Standard library only. Every random draw is seeded.
"""
from __future__ import annotations

import difflib
import math
import os
import random
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

_PARENT = str(Path(__file__).resolve().parent.parent)
if _PARENT not in sys.path:
    sys.path.insert(0, _PARENT)

from t5 import score  # noqa: E402
from t5.changes import CHANGES  # noqa: E402
from t5.common import (BASE_DIR, HERE, MATERIALS, POWER_PATH, SEED, SESSIONS_PATH, TRUTH_PATH,  # noqa: E402
                       VERIFICATION_PATH, derive_seed, dump_json, tree_text)
from t5.session import SESSIONS, order  # noqa: E402

MAX_CHANGED_LINES = 600
TIERS = ("plain", "moderate", "subtle")
POWER_PANELS = 400
POWER_BOOT = 1_000


# ------------------------------------------------------------------ applying edits and writing diffs

def apply_edits(files: dict[str, str], edits: list[tuple[str, str, str]], label: str) -> dict[str, str]:
    out = dict(files)
    for path, old, new in edits:
        if out[path].count(old) != 1:
            raise SystemExit(f"{label}: the text to replace occurs {out[path].count(old)} times in {path}:\n{old}")
        out[path] = out[path].replace(old, new)
    return out


def changed_paths(before: dict[str, str], after: dict[str, str]) -> list[str]:
    return sorted(p for p in after if after[p] != before[p])


def unified(before: dict[str, str], after: dict[str, str]) -> str:
    parts = []
    for path in changed_paths(before, after):
        parts.extend(difflib.unified_diff(before[path].splitlines(keepends=True), after[path].splitlines(keepends=True),
                                          fromfile=f"a/{path}", tofile=f"b/{path}", n=3))
    return "".join(parts)


def apply_unified(before: dict[str, str], diff: str) -> dict[str, str]:
    """Apply a unified diff with a small applier of our own, to prove the diff says what the change does."""
    out = dict(before)
    path, source, result, cursor = None, [], [], 0

    def finish():
        if path is not None:
            out[path] = "".join(result + source[cursor:])

    for line in diff.splitlines(keepends=True):
        if line.startswith("--- "):
            finish()
            path = None
        elif line.startswith("+++ b/"):
            path = line[6:].strip()
            source, result, cursor = before[path].splitlines(keepends=True), [], 0
        elif line.startswith("@@"):
            start = int(re.match(r"@@ -(\d+)", line).group(1))
            result.extend(source[cursor:start - 1])
            cursor = start - 1
        elif line.startswith(" "):
            assert source[cursor] == line[1:], f"context mismatch in {path}"
            result.append(source[cursor])
            cursor += 1
        elif line.startswith("-"):
            assert source[cursor] == line[1:], f"removed line mismatch in {path}"
            cursor += 1
        elif line.startswith("+"):
            result.append(line[1:])
    finish()
    return out


def count_changed_lines(diff: str) -> int:
    return sum(1 for line in diff.splitlines()
               if (line.startswith("+") and not line.startswith("+++")) or
               (line.startswith("-") and not line.startswith("---")))


def line_range(text: str, anchor: str, label: str) -> list[int]:
    """First and last line, counted from 1, of the one place where `anchor` stands in `text`."""
    if text.count(anchor) != 1:
        raise SystemExit(f"{label}: the anchor occurs {text.count(anchor)} times:\n{anchor}")
    first = text[:text.index(anchor)].count("\n") + 1
    return [first, first + anchor.rstrip("\n").count("\n")]


# ------------------------------------------------------------------ building one change

def build_change(base: dict[str, str], change: dict) -> dict:
    key = change["key"]
    after = apply_edits(base, change["edits"], key)
    touched = changed_paths(base, after)
    diff = unified(base, after)
    built = {"key": key, "after": after, "touched": touched, "diff": diff,
             "description": f"# {change['title']}\n\n{change['description']}\n", "fixed": None, "probe": None}
    truth = {"key": key, "title": change["title"], "flawed": change["flaw"] is not None,
             "tier": None, "adversarial": change["adversarial"], "files_changed": touched,
             "changed_lines": count_changed_lines(diff), "flaw": None}
    flaw = change["flaw"]
    if flaw is not None:
        places = [{"file": path, "lines": line_range(after[path], anchor, key)} for path, anchor in flaw["where"]]
        truth["tier"] = flaw["tier"]
        truth["flaw"] = {"file": places[0]["file"], "lines": places[0]["lines"], "also": places[1:],
                         "sentence": flaw["sentence"]}
        built["fixed"] = apply_edits(after, flaw["fix"], key + " (fix)")
        built["probe"] = flaw["probe"].lstrip("\n")
    built["truth"] = truth
    return built


# ------------------------------------------------------------------ verification by running code

def run_unittest(tree: dict[str, str], probe: str | None = None) -> dict:
    """Write `tree` to a scratch directory and run its tests, or one probe module, in a fresh interpreter."""
    with tempfile.TemporaryDirectory(prefix="t5-verify-") as tmp:
        root = Path(tmp)
        for rel, text in tree.items():
            target = root / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(text)
        if probe is None:
            command = [sys.executable, "-m", "unittest", "discover", "-s", "tests"]
        else:
            (root / "probe_check.py").write_text(probe)
            command = [sys.executable, "-m", "unittest", "probe_check"]
        env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
        done = subprocess.run(command, cwd=root, capture_output=True, text=True, timeout=120, env=env)
    ran = re.search(r"Ran (\d+) tests?", done.stderr)
    return {"ok": done.returncode == 0, "ran": int(ran.group(1)) if ran else 0}


def verify(base: dict[str, str], built: list[dict]) -> dict:
    base_run = run_unittest(base)
    rows, total_lines = [], 0
    for b in built:
        truth = b["truth"]
        total_lines += truth["changed_lines"]
        row = {"key": b["key"], "flawed": truth["flawed"], "changed_lines": truth["changed_lines"],
               "diff_reproduces_the_changed_files": apply_unified(base, b["diff"]) == b["after"],
               "tests_on_change": run_unittest(b["after"])}
        ok = row["diff_reproduces_the_changed_files"] and row["tests_on_change"]["ok"]
        if truth["flawed"]:
            on_change = run_unittest(b["after"], b["probe"])
            on_fix = run_unittest(b["fixed"], b["probe"])
            row["probe_fails_on_change"] = not on_change["ok"] and on_change["ran"] > 0
            row["probe_passes_on_fix"] = on_fix["ok"] and on_fix["ran"] > 0
            row["tests_on_fix"] = run_unittest(b["fixed"])
            ok = ok and row["probe_fails_on_change"] and row["probe_passes_on_fix"] and row["tests_on_fix"]["ok"]
        row["ok"] = ok
        rows.append(row)
    flawed = [b["truth"] for b in built if b["truth"]["flawed"]]
    counts = {
        "changes": len(built),
        "flawed": len(flawed),
        "clean": len(built) - len(flawed),
        "by_tier": {t: sum(f["tier"] == t for f in flawed) for t in TIERS},
        "adversarial": sum(b["truth"]["adversarial"] is not None for b in built),
        "changed_lines_total": total_lines,
        "changed_lines_limit": MAX_CHANGED_LINES,
    }
    design_ok = (counts["changes"] == 16 and counts["flawed"] == 12 and all(v == 4 for v in counts["by_tier"].values())
                 and counts["adversarial"] * 5 >= counts["changes"] and total_lines <= MAX_CHANGED_LINES)
    return {
        "note": ("Checks run by design.py before sealing. `tests_on_change` runs the code base's tests together "
                 "with the tests the change adds. A probe is a test that fails on the change and passes once the "
                 "flaw is fixed."),
        "tests_on_base": base_run,
        "counts": counts,
        "changes": rows,
        "all_ok": base_run["ok"] and design_ok and all(r["ok"] for r in rows),
    }


# ------------------------------------------------------------------ power of the rule

def _panel(rng: random.Random, kind: str, n: int = 12, k: int = 5) -> list[int]:
    """Catches per flaw for one simulated panel of k reviewers on n flaws."""
    if kind == "independent_0.6":
        rates = [0.6] * n
    elif kind == "tiers_0.9_0.6_0.3":
        rates = [0.9] * 4 + [0.6] * 4 + [0.3] * 4
    elif kind == "shared_rate_beta_mean_0.6_theta_0.5":
        rates = [rng.betavariate(0.6, 0.4) for _ in range(n)]
    elif kind == "four_flaws_nobody_sees":
        rates = [0.9] * 8 + [0.0] * 4
    elif kind == "five_copies_of_one_reviewer":
        return [k if rng.random() < 0.6 else 0 for _ in range(n)]
    else:
        raise ValueError(kind)
    return [sum(rng.random() < r for _ in range(k)) for r in rates]


def _true_k(kind: str, k: int = 5) -> float:
    """k-effective of the population the panels are drawn from."""
    if kind == "independent_0.6":
        return 5.0
    if kind == "tiers_0.9_0.6_0.3":
        return math.log((0.1 ** k + 0.4 ** k + 0.7 ** k) / 3) / math.log(0.4)
    if kind == "shared_rate_beta_mean_0.6_theta_0.5":
        a, b = 0.6, 0.4
        return math.log(math.prod((b + j) / (a + b + j) for j in range(k))) / math.log(0.4)
    if kind == "four_flaws_nobody_sees":
        q = (8 * 0.1 + 4 * 1.0) / 12
        return math.log((8 * 0.1 ** k + 4) / 12) / math.log(q)
    return 1.0


def build_power() -> dict:
    scenarios = []
    for kind in ("independent_0.6", "tiers_0.9_0.6_0.3", "shared_rate_beta_mean_0.6_theta_0.5",
                 "four_flaws_nobody_sees", "five_copies_of_one_reviewer"):
        rng = random.Random(derive_seed(SEED, "power", kind))
        tally = {"pass": 0, "fail": 0, "incomplete": 0}
        exact = {"pass": 0, "fail": 0, "incomplete": 0}
        lower_bound_only = 0
        for panel in range(POWER_PANELS):
            catches = _panel(rng, kind)
            stats = score.k_effective(catches, 5, derive_seed(SEED, "power", kind, str(panel)), POWER_BOOT)
            word, _ = score.decide(stats)
            tally[word] += 1
            lower_bound_only += stats["state"] == "lower_bound_only"
            if word == "incomplete":
                exact["incomplete"] += 1
            else:
                upper = stats["exact_interval_with_miss_rate_fixed"][1]
                exact["fail" if upper != "inf" and float(upper) < 5 else "pass"] += 1
        scenarios.append({
            "scenario": kind, "panels": POWER_PANELS, "k_effective_of_the_population": round(_true_k(kind), 2),
            "verdict_shares": {v: round(c / POWER_PANELS, 3) for v, c in tally.items()},
            "share_with_no_flaw_missed_by_all": round(lower_bound_only / POWER_PANELS, 3),
            "verdict_shares_by_exact_interval": {v: round(c / POWER_PANELS, 3) for v, c in exact.items()},
        })
    return {
        "note": ("How often the sealed rule returns each verdict for five reviewers on 12 flaws, by simulation. "
                 "Each panel uses 1,000 bootstrap resamples where the real scoring uses 10,000. Shares carry "
                 "sampling error of about 0.02 to 0.03. `verdict_shares_by_exact_interval` is what the secondary "
                 "interval would return; it does not decide the verdict."),
        "scenarios": scenarios,
    }


# ------------------------------------------------------------------ build

def outputs() -> tuple[dict[Path, str], dict]:
    base = tree_text(BASE_DIR)
    built = [build_change(base, c) for c in CHANGES]
    if len({b["key"] for b in built}) != len(built):
        raise SystemExit("two changes share a key")
    files: dict[Path, str] = {}
    for b in built:
        root = MATERIALS / "changes" / b["key"]
        files[root / "description.md"] = b["description"]
        files[root / "change.diff"] = b["diff"]
        for path in b["touched"]:
            files[root / "after" / path] = b["after"][path]
        if b["probe"] is not None:
            files[MATERIALS / "probes" / f"{b['key'].replace('-', '_')}.py"] = b["probe"]
    truth = {
        "test": "T5", "seed": SEED,
        "note": ("Ground truth of T5. Not placed in any session directory. `lines` are first and last line in "
                 "the changed file. `also` lists a second place where the same defect shows."),
        "changes": [b["truth"] for b in built],
    }
    files[TRUTH_PATH] = dump_json(truth)
    verification = verify(base, built)
    files[VERIFICATION_PATH] = dump_json(verification)
    keys = [b["key"] for b in built]
    orders = {s["session_id"]: order(s["session_id"], keys) for s in SESSIONS}
    if len({tuple(o) for o in orders.values()}) != len(orders):
        raise SystemExit("two sessions drew the same order")
    files[SESSIONS_PATH] = dump_json({"seed": SEED, "sessions": SESSIONS, "orders": orders})
    files[POWER_PATH] = dump_json(build_power())
    return files, verification


def build(check: bool = False) -> int:
    files, verification = outputs()
    bad = 0
    on_disk = {p for p in MATERIALS.rglob("*") if p.is_file() and "__pycache__" not in p.parts} \
        if MATERIALS.exists() else set()
    if check:
        for path, text in sorted(files.items()):
            if not (path.exists() and path.read_text() == text):
                print("DIFFERS    " + str(path.relative_to(HERE.parent)))
                bad += 1
        for path in sorted(on_disk - set(files)):
            print("UNEXPECTED " + str(path.relative_to(HERE.parent)))
            bad += 1
        print(f"{len(files) - bad} of {len(files)} files reproduce" if bad else f"all {len(files)} files reproduce")
    else:
        if MATERIALS.exists():
            shutil.rmtree(MATERIALS)
        for path, text in files.items():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)
        print(f"wrote {len(files)} files under {MATERIALS.relative_to(HERE.parent)}")
    c = verification["counts"]
    print(f"  changes {c['changes']}: flawed {c['flawed']} {c['by_tier']}, clean {c['clean']}, "
          f"adversarial {c['adversarial']}, changed lines {c['changed_lines_total']} of {c['changed_lines_limit']}")
    print(f"  tests on base: {verification['tests_on_base']}")
    for row in verification["changes"]:
        if not row["ok"]:
            print(f"  NOT OK: {row}", file=sys.stderr)
    if not verification["all_ok"]:
        print("VERIFICATION FAILED: repair the changes before sealing", file=sys.stderr)
        return 1
    print("  every change verified")
    return 1 if bad else 0


def main(argv: list[str]) -> int:
    if not argv or argv[0] != "build":
        print(__doc__)
        return 2
    return build(check="--check" in argv[1:])


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
