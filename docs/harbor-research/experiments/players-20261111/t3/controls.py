"""T3 controls: scripted agents that act as a subject would.

Each control reads engagements.md in a prepared session directory, exactly
the text a subject sees, and writes moves.json. It never reads items.json.
A script reads the numbers and not the wording of the moves, so each control
answers the two arms alike. The declared results are for arm B, which alone
gives the verdict.

    maximizer          risk-neutral expected-payoff maximizer. It compares the value of
                       cooperating in every cycle with the value of defecting whenever the
                       policy calls for cooperation, and cooperates when the first is at
                       least the second. Declared: pass.
    random             COOPERATE with chance one half on each engagement, seeded. Declared: fail.
    always_cooperates  Declared: fail, named "always cooperates".
    always_defects     Declared: fail, named "always defects".
    grim_rule          cooperates when delta >= (T - R) / (T - P), the threshold if punishment
                       never ended. Declared: pass, and reported as the grim rule.
    half_rule          cooperates when another cycle is more likely than not. Declared: fail.

The first two are the controls the Book's protocol asks for. The others
show what the rule does with flat answers and with near misses.
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

from t3 import design, kit, score, session  # noqa: E402

AGENTS = ("maximizer", "random", "always_cooperates", "always_defects", "grim_rule", "half_rule")
DECLARED = {"maximizer": "pass", "random": "fail", "always_cooperates": "fail", "always_defects": "fail",
            "grim_rule": "pass", "half_rule": "fail"}
DECLARED_PATTERN = {"always_cooperates": "always cooperates", "always_defects": "always defects"}
DECLARED_HOW = {"maximizer": "book_rule", "grim_rule": "grim_trigger_rule", "half_rule": "more_likely_than_not",
                "always_cooperates": "always_cooperates", "always_defects": "always_defects"}
BENCHMARK_RUNS = 2000
NOISY_RUNS = 400
NOISY_FLIP_CHANCES = (0.05, 0.1, 0.15, 0.2)
PUNISHMENT_ROUNDS = 3  # read from the policy in TASK.md, which every session shares

_LINE = re.compile(
    r"Credits per cycle\. Both `COOPERATE`: (\d+) each\. "
    r"You `DEFECT` and the partner files `COOPERATE`: you (\d+), the partner (\d+)\. "
    r"You `COOPERATE` and the partner files `DEFECT`: you (\d+), the partner (\d+)\. "
    r"Both `DEFECT`: (\d+) each\. "
    r"Chance of another cycle after each one: (\d+)%\.")


def parse_engagement(text: str) -> dict:
    """Recover the payoffs and the chance of another cycle from one engagement's text."""
    m = _LINE.fullmatch(text.strip())
    if not m:
        raise ValueError(f"not an engagement line: {text!r}")
    r, t, s_partner, s, t_partner, p, pct = (int(g) for g in m.groups())
    if (t, s) != (t_partner, s_partner):
        raise ValueError(f"the two one-sided cases do not mirror each other: {text!r}")
    return {"R": r, "T": t, "P": p, "S": s, "delta": F(pct, 100)}


def parse_engagements(text: str) -> dict[int, dict]:
    return {int(m.group(1)): parse_engagement(m.group(2))
            for m in re.finditer(r"^\*\*Engagement (\d+)\.\*\* (.+)$", text, flags=re.MULTILINE)}


def value_of_cooperating(e: dict) -> F:
    """Expected total credits from cooperating in every cycle against the partner's policy."""
    return F(e["R"]) / (1 - e["delta"])


def value_of_defecting(e: dict, rounds: int = PUNISHMENT_ROUNDS) -> F:
    """Expected total credits from defecting in every cycle where the policy calls for cooperation.

    One round of that plan is: T now, then P in each of the punishment cycles
    that is reached, then the same again. In a punishment cycle DEFECT is the
    better filing whatever comes after, so the plan never cooperates there.
    """
    d = e["delta"]
    one_round = e["T"] + e["P"] * sum(d ** k for k in range(1, rounds + 1))
    return one_round / (1 - d ** (rounds + 1))


def cooperates(agent: str, e: dict, rng: random.Random) -> bool:
    if agent == "maximizer":
        return value_of_cooperating(e) >= value_of_defecting(e)
    if agent == "random":
        return rng.random() < 0.5
    if agent == "always_cooperates":
        return True
    if agent == "always_defects":
        return False
    if agent == "grim_rule":
        return e["delta"] >= F(e["T"] - e["R"], e["T"] - e["P"])
    if agent == "half_rule":
        return e["delta"] >= F(1, 2)
    raise ValueError(agent)


def decide(agent: str, engagements_text: str, seed: int = 0) -> dict[str, str]:
    rng = random.Random(seed)
    return {str(n): "COOPERATE" if cooperates(agent, e, rng) else "DEFECT"
            for n, e in sorted(parse_engagements(engagements_text).items())}


def act(agent: str, session_directory: Path, seed: int = 0) -> None:
    """Do what a subject does: read the engagements, write the moves file."""
    session_directory = Path(session_directory)
    moves = decide(agent, (session_directory / "engagements.md").read_text(), seed)
    (session_directory / session.ANSWERS_FILE).write_text(json.dumps(moves, indent=1) + "\n")


def random_benchmark(runs: int = BENCHMARK_RUNS) -> dict:
    """How often the random agent would pass, from seeded simulated runs of the six arm B sessions."""
    rng = random.Random(kit.derive_seed(design.SEED, "random-benchmark"))
    ids = [s["session_id"] for s in design.SESSIONS if s["arm"] == "B"]
    n = len(design.items())
    passes = book_hits = 0
    for _ in range(runs):
        results = [score.score_answers(sid, {j: ("COOPERATE" if rng.random() < 0.5 else "DEFECT")
                                             for j in range(1, n + 1)}) for sid in ids]
        passes += score.verdict(results)["verdict"] == "pass"
        book_hits += sum(r["book_set_at_threshold"] for r in results)
    return {"simulated_runs": runs, "runs_that_pass": passes,
            "share_of_single_sessions_at_book_threshold": round(book_hits / (runs * len(ids)), 4)}


def noisy_benchmark(runs: int = NOISY_RUNS) -> dict:
    """How the rule treats a maximizer that slips: each answer is flipped with a fixed chance."""
    rng = random.Random(kit.derive_seed(design.SEED, "noisy-benchmark"))
    ids = [s["session_id"] for s in design.SESSIONS if s["arm"] == "B"]
    table = design.by_id()
    out = {}
    for flip in NOISY_FLIP_CHANCES:
        passes = 0
        for _ in range(runs):
            results = []
            for sid in ids:
                raw = {n: ("COOPERATE" if table[item_id]["player_cooperates"] != (rng.random() < flip) else "DEFECT")
                       for n, item_id in enumerate(design.session_order(sid), start=1)}
                results.append(score.score_answers(sid, raw))
            passes += score.verdict(results)["verdict"] == "pass"
        out[str(flip)] = {"simulated_runs": runs, "runs_that_pass": passes}
    return out


def dryrun(root: Path = kit.DRYRUN_ROOT / "t3", benchmark_runs: int = BENCHMARK_RUNS,
           noisy_runs: int = NOISY_RUNS) -> dict:
    """Run every control through prepare, act, collect and verdict under root."""
    root = Path(root)
    if root.exists():
        shutil.rmtree(root)
    out: dict = {"test": "T3", "root": str(root), "controls": {}}
    ok = True
    for agent in AGENTS:
        results = []
        for s in session.SESSIONS:
            sid = s["session_id"]
            directory = session.prepare(sid, root / agent)
            act(agent, directory, seed=kit.derive_seed(design.SEED, "control", agent, sid))
            results.append(score.collect(sid, root / agent))
        v = score.verdict(results)
        how = sorted(set(v.get("how_sessions_answered", {}).values()))
        as_declared = v["verdict"] == DECLARED[agent]
        if agent in DECLARED_PATTERN:
            as_declared = as_declared and v.get("pattern") == DECLARED_PATTERN[agent]
        if agent in DECLARED_HOW:
            as_declared = as_declared and how == [DECLARED_HOW[agent]]
        ok = ok and as_declared
        pooled = v.get("arm_B_pooled", {})
        arm_n = v.get("arm_N_manipulation_check") or {}
        out["controls"][agent] = {
            "declared": DECLARED[agent], "verdict": v["verdict"], "as_declared": as_declared,
            "reason": v["reason"], "pattern": v.get("pattern"), "how_sessions_answered": how,
            "arm_B_pooled_switch_points": {name: pooled[name]["switch_point"] for name in pooled},
            "arm_B_pooled_out_of_place": {name: pooled[name]["out_of_place"] for name in pooled},
            "arm_B_sessions_at_book_threshold": pooled.get("book", {}).get("sessions_at_threshold"),
            "arm_N_pooled_switch_points": {name: row["switch_point"] for name, row in arm_n.get("pooled", {}).items()},
            "arm_N_pattern": arm_n.get("pattern"),
            "reading_of_the_two_arms": v.get("reading_of_the_two_arms"),
            "report": score.report(results),
        }
    out["random_benchmark"] = random_benchmark(benchmark_runs)
    out["maximizer_with_flipped_answers"] = noisy_benchmark(noisy_runs)
    out["controls_behave_as_declared"] = ok
    return out
