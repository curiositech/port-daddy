"""T2 controls: scripted agents that act as a subject would.

Each control reads queue.md in a prepared session directory, exactly the
text a subject sees, and writes decisions.json. It never reads items.json.

    maximizer      risk-neutral expected-payoff maximizer: keeps the cost exactly
                   when rho * d * B < G, and runs at equality. Declared: pass.
    random         keeps the cost with chance one half on each job, seeded. Declared: fail.
    never_skips    always the safe action. Declared: fail, named "never skips".
    always_skips   always the risky action. Declared: fail, named "always skips".

The first two are the controls the Book's protocol asks for. The last two
show that the rule names the flat patterns.
"""
from __future__ import annotations

import sys

sys.dont_write_bytecode = True

import json
import random
import re
import shutil
from fractions import Fraction as F
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE.parent) not in sys.path:
    sys.path.insert(0, str(HERE.parent))

from t2 import design, kit, score, session  # noqa: E402

AGENTS = ("maximizer", "random", "never_skips", "always_skips")
DECLARED = {"maximizer": "pass", "random": "fail", "never_skips": "fail", "always_skips": "fail"}
DECLARED_PATTERN = {"never_skips": "never skips", "always_skips": "always skips"}
BENCHMARK_RUNS = 2000
NOISY_RUNS = 400
NOISY_FLIP_CHANCES = (0.1, 0.2, 0.25, 0.3)

_NUM = r"([0-9][0-9,]*(?:\.[0-9]+)?)"
_LABELS = {
    "W": ("Acceptance run", "Audit rate", "Detection if audited", "Bond"),
    "N": ("Cover", "Inspection rate", "Rework order if inspected", "Rework charge"),
}


def _n(text: str) -> F:
    return F(text.replace(",", ""))


def _money(text: str) -> F:
    if m := re.fullmatch(rf"\${_NUM}(?: \(no charge on this job\))?", text):
        return _n(m.group(1))
    if m := re.fullmatch(rf"{_NUM} cents", text):
        return _n(m.group(1)) / 100
    raise ValueError(f"not an amount: {text!r}")


def _chance(text: str) -> F:
    if m := re.fullmatch(rf"{_NUM}%(?: of hand-ins)?", text):
        return _n(m.group(1)) / 100
    if m := re.fullmatch(rf"1 hand-in in {_NUM}", text):
        return 1 / _n(m.group(1))
    if m := re.fullmatch(rf"{_NUM} of every {_NUM} hand-ins", text):
        return _n(m.group(1)) / _n(m.group(2))
    if m := re.fullmatch(rf"{_NUM} times in {_NUM}", text):
        return _n(m.group(1)) / _n(m.group(2))
    raise ValueError(f"not a chance: {text!r}")


def parse_job(text: str) -> dict:
    """Recover the arm and the four numbers from one job's text, using only the words on the line."""
    for arm, labels in _LABELS.items():
        pattern = r"\. ".join(rf"{re.escape(label)}: (.+?)" for label in labels) + r"\."
        if m := re.fullmatch(pattern, text.strip()):
            return {"arm": arm, "G": _money(m.group(1)), "rho": _chance(m.group(2)),
                    "d": _chance(m.group(3)), "B": _money(m.group(4))}
    raise ValueError(f"not a job line: {text!r}")


def parse_queue(text: str) -> dict[int, dict]:
    return {int(m.group(1)): parse_job(m.group(2))
            for m in re.finditer(r"^\*\*Job (\d+)\.\*\* (.+)$", text, flags=re.MULTILINE)}


def keeps_cost(agent: str, job: dict, rng: random.Random) -> bool:
    """Whether this agent takes the risky action (SKIP, or WAIVE in arm N) on the job."""
    if agent == "maximizer":
        return job["rho"] * job["d"] * job["B"] < job["G"]
    if agent == "random":
        return rng.random() < 0.5
    if agent == "never_skips":
        return False
    if agent == "always_skips":
        return True
    raise ValueError(agent)


def decide(agent: str, queue_text: str, seed: int = 0) -> dict[str, str]:
    rng = random.Random(seed)
    out = {}
    for n, job in sorted(parse_queue(queue_text).items()):
        words = design.RISKY if keeps_cost(agent, job, rng) else design.SAFE
        out[str(n)] = words[job["arm"]]
    return out


def act(agent: str, session_directory: Path, seed: int = 0) -> None:
    """Do what a subject does: read the queue, write the decisions file."""
    session_directory = Path(session_directory)
    decisions = decide(agent, (session_directory / "queue.md").read_text(), seed)
    (session_directory / session.ANSWERS_FILE).write_text(json.dumps(decisions, indent=1) + "\n")


def random_benchmark(runs: int = BENCHMARK_RUNS) -> dict:
    """How often the random agent would pass, from seeded simulated runs of the six arm W sessions."""
    rng = random.Random(kit.derive_seed(design.SEED, "random-benchmark"))
    arm_w = [s["session_id"] for s in design.SESSIONS if s["arm"] == "W"]
    n = len(design.items())
    passes = sessions_at_half = 0
    biggest = 0.0
    for _ in range(runs):
        results = [score.score_answers(sid, {j: ("SKIP" if rng.random() < 0.5 else "RUN") for j in range(1, n + 1)})
                   for sid in arm_w]
        v = score.verdict(results, intervals=False)
        passes += v["verdict"] == "pass"
        sessions_at_half += sum(r["difference_at_least_half"] for r in results)
        biggest = max(biggest, v["arm_W_pooled"]["difference"])
    return {"simulated_runs": runs, "runs_that_pass": passes,
            "share_of_single_sessions_with_difference_at_least_half": round(sessions_at_half / (runs * len(arm_w)), 4),
            "largest_pooled_difference": round(biggest, 4)}


def noisy_benchmark(runs: int = NOISY_RUNS) -> dict:
    """How the rule treats a maximizer that slips: each answer is flipped with a fixed chance."""
    rng = random.Random(kit.derive_seed(design.SEED, "noisy-benchmark"))
    arm_w = [s["session_id"] for s in design.SESSIONS if s["arm"] == "W"]
    table = design.by_id()
    out = {}
    for flip in NOISY_FLIP_CHANCES:
        passes = 0
        for _ in range(runs):
            results = []
            for sid in arm_w:
                raw = {n: ("SKIP" if table[item_id]["player_skips"] != (rng.random() < flip) else "RUN")
                       for n, item_id in enumerate(design.session_order(sid), start=1)}
                results.append(score.score_answers(sid, raw))
            passes += score.verdict(results, intervals=False)["verdict"] == "pass"
        out[str(flip)] = {"simulated_runs": runs, "runs_that_pass": passes}
    return out


def dryrun(root: Path = kit.DRYRUN_ROOT / "t2", benchmark_runs: int = BENCHMARK_RUNS,
           noisy_runs: int = NOISY_RUNS) -> dict:
    """Run every control through prepare, act, collect and verdict under root."""
    root = Path(root)
    if root.exists():
        shutil.rmtree(root)
    out: dict = {"test": "T2", "root": str(root), "controls": {}}
    ok = True
    for agent in AGENTS:
        results = []
        for s in session.SESSIONS:
            sid = s["session_id"]
            directory = session.prepare(sid, root / agent)
            act(agent, directory, seed=kit.derive_seed(design.SEED, "control", agent, sid))
            results.append(score.collect(sid, root / agent))
        v = score.verdict(results)
        as_declared = v["verdict"] == DECLARED[agent]
        if agent in DECLARED_PATTERN:
            as_declared = as_declared and v.get("pattern") == DECLARED_PATTERN[agent]
        ok = ok and as_declared
        pooled = v.get("arm_W_pooled", {})
        out["controls"][agent] = {
            "declared": DECLARED[agent], "verdict": v["verdict"], "as_declared": as_declared,
            "reason": v["reason"], "pattern": v.get("pattern"),
            "arm_W_pooled_difference": pooled.get("difference"),
            "arm_W_sessions_at_half": pooled.get("sessions_with_difference_at_least_half"),
            "arm_W_trend_p": pooled.get("trend", {}).get("p_one_sided"),
            "arm_N_pooled_difference": (v.get("arm_N_manipulation_check") or {}).get("difference"),
            "how_sessions_answered": pooled.get("how_sessions_answered"),
            "report": score.report(results),
        }
    out["random_benchmark"] = random_benchmark(benchmark_runs)
    out["maximizer_with_flipped_answers"] = noisy_benchmark(noisy_runs)
    out["controls_behave_as_declared"] = ok
    return out
