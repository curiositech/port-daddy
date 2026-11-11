"""T6 controls: scripted agents that act as a subject would.

Each control reads questions.md in a prepared session directory and writes
estimates.json. A scripted agent cannot read English, so it recognizes each
question by its exact wording and looks up the event behind it.

    coherent           holds one fixed joint distribution for each situation and reads
                       every answer off it. Declared: pass.
    random             a number drawn uniformly between 0 and 1 for each question, seeded.
                       Declared: fail.
    rounded            the coherent agent, answering to two decimal places. Declared: pass.
    fifty_fifty        0.5 to every question. Declared: fail.
    conjunction_slip   the coherent agent, except that it rates the detailed conjunction on
                       the north lane above its plain part. Declared: fail.
    base_rate_neglect  the coherent agent, except that on the dock lane it takes a flag to
                       mean a skipped check four times in five. Declared: fail.

The first two are the controls the Book's protocol asks for. Here the
scripted control is a coherent agent, since no payoff is on offer to
maximize. The others show what the rule does with near misses.
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

from t6 import design, kit, score, session  # noqa: E402

AGENTS = ("coherent", "random", "rounded", "fifty_fifty", "conjunction_slip", "base_rate_neglect")
DECLARED = {"coherent": "pass", "random": "fail", "rounded": "pass", "fifty_fifty": "fail",
            "conjunction_slip": "fail", "base_rate_neglect": "fail"}
DECLARED_HOW = {"coherent": "exactly_coherent", "rounded": "coherent_within_tolerance",
                "fifty_fifty": "same_number_for_every_question", "conjunction_slip": "incoherent",
                "base_rate_neglect": "incoherent"}
BENCHMARK_RUNS = 2000
NOISY_RUNS = 400
NOISY_SPREADS = (0.005, 0.01, 0.02, 0.05)

# The coherent agent's beliefs: one distribution over each situation's outcomes,
# or a single-run chance where the situation is a series of independent draws.
BELIEFS = {
    "east": {"not_drawn": F(85, 100), "cleared": F(11, 100), "warned": F(3, 100), "forfeited": F(1, 100)},
    "west": {"both": F(4, 100), "osprey_only": F(11, 100), "tern_only": F(8, 100), "neither": F(77, 100)},
    "south": {"per_run": F(3, 100)},
    "north": {"both": F(5, 100), "found_only": F(7, 100), "forfeit_only": F(3, 100), "neither": F(85, 100)},
    "dock": {"skipped_flagged": F(32, 1000), "skipped_unflagged": F(8, 1000),
             "clean_flagged": F(48, 1000), "clean_unflagged": F(912, 1000)},
    "draw": {"per_run": F(1, 8)},
}


def probability(event: dict, belief: dict) -> F:
    """The probability of a question's event under one belief about its situation."""
    if "at_least_one_in" in event:
        return 1 - (1 - belief["per_run"]) ** event["at_least_one_in"]
    if "none_in" in event:
        return (1 - belief["per_run"]) ** event["none_in"]
    if "given" in event:
        given = sum(belief[a] for a in event["given"])
        joint = sum(belief[a] for a in event["atoms"] if a in event["given"])
        return joint / given
    return sum((belief[a] for a in event["atoms"]), F(0))


def coherent_answers(beliefs: dict = BELIEFS) -> dict[str, F]:
    """Every question's probability, by question id, under the given beliefs."""
    return {q["item_id"]: probability(q["event"], beliefs[q["scenario"]]) for q in design.questions()}


def parse_questions(text: str) -> dict[int, str]:
    """Question number to question id, recognized by situation name and exact wording."""
    names = {sc["name"]: sc["key"] for sc in design.SCENARIOS}
    known = {(q["scenario"], q["text"]): q["item_id"] for q in design.questions()}
    out = {}
    for m in re.finditer(r"^\*\*Question (\d+)\*\* \(([^)]+)\)\. (.+)$", text, flags=re.MULTILINE):
        out[int(m.group(1))] = known[(names[m.group(2)], m.group(3).strip())]
    return out


def answers(agent: str, rng: random.Random) -> dict[str, float]:
    """One agent's estimates by question id."""
    exact = coherent_answers()
    if agent == "random":
        return {item_id: round(rng.random(), 4) for item_id in exact}
    if agent == "fifty_fifty":
        return {item_id: 0.5 for item_id in exact}
    places = 2 if agent == "rounded" else 6
    out = {item_id: round(float(p), places) for item_id, p in exact.items()}
    if agent == "conjunction_slip":
        out["north.both"] = round(out["north.forfeit"] + 0.02, 6)
    elif agent == "base_rate_neglect":
        out["dock.skipped_given_flag"] = 0.8
        out["dock.clean_given_flag"] = 0.2
        out["dock.both"] = round(0.8 * out["dock.flagged"], 6)
    elif agent not in ("coherent", "rounded"):
        raise ValueError(agent)
    return out


def act(agent: str, session_directory: Path, seed: int = 0) -> None:
    """Do what a subject does: read the questions, write the estimates file."""
    session_directory = Path(session_directory)
    numbered = parse_questions((session_directory / "questions.md").read_text())
    by_question = answers(agent, random.Random(seed))
    estimates = {str(n): by_question[item_id] for n, item_id in sorted(numbered.items())}
    (session_directory / session.ANSWERS_FILE).write_text(json.dumps(estimates, indent=1) + "\n")


def random_benchmark(runs: int = BENCHMARK_RUNS) -> dict:
    """How often the random agent would pass, from seeded simulated runs of the six sessions."""
    rng = random.Random(kit.derive_seed(design.SEED, "random-benchmark"))
    ids = [s["session_id"] for s in design.SESSIONS]
    n = len(design.questions())
    passes = session_passes = 0
    lowest_mad, fewest_violations = 1.0, 10 ** 6
    for _ in range(runs):
        results = [score.score_answers(sid, {j: round(rng.random(), 4) for j in range(1, n + 1)}) for sid in ids]
        passes += sum(r["session_passes"] for r in results) >= score.MIN_PASSING_SESSIONS
        session_passes += sum(r["session_passes"] for r in results)
        lowest_mad = min([lowest_mad] + [r["mean_absolute_deviation"] for r in results])
        fewest_violations = min([fewest_violations] + [r["dominance_violations"] for r in results])
    return {"simulated_runs": runs, "runs_that_pass": passes,
            "single_sessions_that_pass": session_passes, "single_sessions_simulated": runs * len(ids),
            "lowest_session_mean_absolute_deviation": round(lowest_mad, 4),
            "fewest_dominance_violations_in_a_session": fewest_violations}


def noisy_benchmark(runs: int = NOISY_RUNS) -> dict:
    """How the rule treats a coherent agent whose answers jitter.

    Each answer is the coherent one plus independent normal noise, kept
    inside 0 to 1 and given to two decimal places.
    """
    rng = random.Random(kit.derive_seed(design.SEED, "noisy-benchmark"))
    ids = [s["session_id"] for s in design.SESSIONS]
    exact = {item_id: float(p) for item_id, p in coherent_answers().items()}
    out = {}
    for sd in NOISY_SPREADS:
        passes = session_passes = with_violation = 0
        for _ in range(runs):
            results = []
            for sid in ids:
                raw = {n: round(min(1.0, max(0.0, exact[item_id] + rng.gauss(0, sd))), 2)
                       for n, item_id in enumerate(design.session_order(sid), start=1)}
                results.append(score.score_answers(sid, raw))
            passes += sum(r["session_passes"] for r in results) >= score.MIN_PASSING_SESSIONS
            session_passes += sum(r["session_passes"] for r in results)
            with_violation += sum(r["dominance_violations"] > 0 for r in results)
        out[str(sd)] = {"simulated_runs": runs, "runs_that_pass": passes,
                        "share_of_single_sessions_that_pass": round(session_passes / (runs * len(ids)), 4),
                        "share_of_single_sessions_with_a_violation": round(with_violation / (runs * len(ids)), 4)}
    return out


def dryrun(root: Path = kit.DRYRUN_ROOT / "t6", benchmark_runs: int = BENCHMARK_RUNS,
           noisy_runs: int = NOISY_RUNS) -> dict:
    """Run every control through prepare, act, collect and verdict under root."""
    root = Path(root)
    if root.exists():
        shutil.rmtree(root)
    out: dict = {"test": "T6", "root": str(root), "controls": {}}
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
        if agent in DECLARED_HOW:
            as_declared = as_declared and how == [DECLARED_HOW[agent]]
        ok = ok and as_declared
        out["controls"][agent] = {
            "declared": DECLARED[agent], "verdict": v["verdict"], "as_declared": as_declared,
            "reason": v["reason"], "how_sessions_answered": how,
            "sessions_passing": v.get("sessions_passing"),
            "session_mean_absolute_deviations": v.get("session_mean_absolute_deviations"),
            "dominance_violations": v.get("dominance_violations"),
            "report": score.report(results),
        }
    out["random_benchmark"] = random_benchmark(benchmark_runs)
    out["coherent_agent_with_jitter"] = noisy_benchmark(noisy_runs)
    out["controls_behave_as_declared"] = ok
    return out
