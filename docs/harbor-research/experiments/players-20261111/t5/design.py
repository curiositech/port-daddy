#!/usr/bin/env python3
"""T5 design: build the 16 change requests with their ground truth, and check them.

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
RANDOM_PANELS = 2_000


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

N_FLAWS, N_REVIEWERS = 12, 5

# Each scenario: a name, and for each of the 12 flaws the chance that one reviewer catches it.
# "copies" is five copies of one reviewer: a flaw is caught by all or by none.
SCENARIOS = [
    ("independent, every flaw caught with chance 0.3", {"rates": [0.3] * 12}),
    ("independent, every flaw caught with chance 0.6", {"rates": [0.6] * 12}),
    ("independent, every flaw caught with chance 0.9", {"rates": [0.9] * 12}),
    ("independent given the flaw, catch chance falling by tier from 0.9 to 0.3",
     {"rates": [0.9] * 4 + [0.6] * 4 + [0.3] * 4}),
    ("the Book's shared-rate model, mean 0.6 and theta 0.5", {"beta": (0.6, 0.4)}),
    ("one flaw nobody sees, the other eleven caught with chance 0.9", {"rates": [0.9] * 11 + [0.0]}),
    ("four flaws nobody sees, the other eight caught with chance 0.9", {"rates": [0.9] * 8 + [0.0] * 4}),
    ("five copies of one reviewer who catches 0.6 of flaws", {"copies": 0.6}),
]


def _panel(rng: random.Random, spec: dict) -> list[int]:
    """Catches per flaw for one simulated panel."""
    if "copies" in spec:
        return [N_REVIEWERS if rng.random() < spec["copies"] else 0 for _ in range(N_FLAWS)]
    rates = spec["rates"] if "rates" in spec else [rng.betavariate(*spec["beta"]) for _ in range(N_FLAWS)]
    return [sum(rng.random() < r for _ in range(N_REVIEWERS)) for r in rates]


def _population_k(spec: dict) -> float:
    """k-effective of the population the panels are drawn from."""
    k = N_REVIEWERS
    if "copies" in spec:
        return 1.0
    if "beta" in spec:
        a, b = spec["beta"]
        return math.log(math.prod((b + j) / (a + b + j) for j in range(k))) / math.log(b / (a + b))
    rates = spec["rates"]
    all_miss = sum((1 - r) ** k for r in rates) / len(rates)
    return math.log(all_miss) / math.log(sum(1 - r for r in rates) / len(rates))


def random_control_benchmark(built: list[dict]) -> dict:
    """What the rule returns for panels of five random reviewers (controls.random_agent).

    A random reviewer rejects a change with chance one half and then names one
    uniformly drawn line of one uniformly drawn changed file. Its chance of a
    catch on each flawed change follows from the sealed files."""
    chances = {}
    for b in built:
        flaw = b["truth"]["flaw"]
        if flaw is None:
            continue
        chance = 0.0
        for path in b["touched"]:
            n_lines = len(b["after"][path].splitlines())
            window = set()
            for place in [flaw] + flaw["also"]:
                if place["file"] == path:
                    lo, hi = place["lines"]
                    window |= set(range(max(1, lo - score.LINE_TOLERANCE), min(n_lines, hi + score.LINE_TOLERANCE) + 1))
            chance += len(window) / n_lines / len(b["touched"])
        chances[b["key"]] = 0.5 * chance
    rng = random.Random(derive_seed(SEED, "power", "random-control"))
    tally = {"pass": 0, "fail": 0, "incomplete": 0}
    caught = 0
    for panel in range(RANDOM_PANELS):
        catches = [sum(rng.random() < c for _ in range(N_REVIEWERS)) for c in chances.values()]
        caught += sum(catches)
        stats = score.k_effective(catches, N_REVIEWERS, derive_seed(SEED, "power", "random-control", str(panel)), 200)
        tally[score.decide(stats)[0]] += 1
    return {
        "panels": RANDOM_PANELS,
        "chance_of_a_catch_by_change": {k: round(v, 4) for k, v in chances.items()},
        "mean_catches_per_panel_of_60": round(caught / RANDOM_PANELS, 2),
        "verdict_shares": {v: round(c / RANDOM_PANELS, 3) for v, c in tally.items()},
        "false_alarm_rate_expected": 0.5,
    }


def build_power(built: list[dict]) -> dict:
    scenarios = []
    for name, spec in SCENARIOS:
        rng = random.Random(derive_seed(SEED, "power", name))
        truth = _population_k(spec)
        tally = {"pass": 0, "fail": 0, "incomplete": 0}
        by_bootstrap = {"pass": 0, "fail": 0, "incomplete": 0}
        covered = with_interval = lower_bound_only = 0
        for panel in range(POWER_PANELS):
            catches = _panel(rng, spec)
            stats = score.k_effective(catches, N_REVIEWERS, derive_seed(SEED, "power", name, str(panel)), POWER_BOOT)
            tally[score.decide(stats)[0]] += 1
            lower_bound_only += stats["state"] == "lower_bound_only"
            which = "bootstrap_interval" if stats["state"] == "estimated" else "interval"
            by_bootstrap[score.decide(stats, which)[0]] += 1
            if "interval" in stats:
                with_interval += 1
                lo, hi = stats["interval"][0], score._upper(stats["interval"])
                covered += lo - 1e-9 <= truth <= hi + 1e-9
        scenarios.append({
            "scenario": name, "panels": POWER_PANELS, "k_effective_of_the_population": round(truth, 2),
            "verdict_shares": {v: round(c / POWER_PANELS, 3) for v, c in tally.items()},
            "interval_holds_the_population_value": round(covered / with_interval, 3) if with_interval else None,
            "share_with_no_flaw_missed_by_all": round(lower_bound_only / POWER_PANELS, 3),
            "verdict_shares_had_the_bootstrap_decided": {v: round(c / POWER_PANELS, 3) for v, c in by_bootstrap.items()},
        })
    return {
        "note": ("How often the sealed rule returns each verdict for five reviewers on 12 flaws, by simulation, "
                 "and how often its interval holds the k-effective of the population the flaws were drawn from. "
                 "Shares carry sampling error of about 0.02 to 0.03. The last column is what the percentile "
                 "bootstrap would return if it decided, with 1,000 resamples per panel; it does not decide."),
        "scenarios": scenarios,
        "random_control": random_control_benchmark(built),
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
    files[POWER_PATH] = dump_json(build_power(built))
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
