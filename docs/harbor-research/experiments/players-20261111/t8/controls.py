"""Scripted subjects for T8, and the dry run.

Each writes the answers.json a subject would, so its sessions go through
score.collect unchanged.

The two controls of the Book's protocol:

  scripted   the expected-payoff maximizer. It acts; it has no stated policy.
             It answers no situation and leaves an empty array, so its
             result is INCOMPLETE by construction.
  random     picks one of each situation's options uniformly.

Two fixtures show that the comparison can come out either way:

  echo       names, in every situation, the action most common on the
             revealed side. Expected PASS.
  contrary   names an action that no revealed session took. Expected FAIL in
             every class.

No T7 session has been run, so the dry run has no real revealed side for four
of the seven classes. It shows the verdict twice: without T7 results, and
against a stand-in, the labels T7's scripted maximizer earns in T7's own dry
run (it carries on and releases when nothing changes, and stops and releases
after each change).
"""
from __future__ import annotations

import sys

sys.dont_write_bytecode = True

import json
import random
import shutil
import statistics
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE.parent) not in sys.path:
    sys.path.insert(0, str(HERE.parent))

from t8 import design, score, session  # noqa: E402

AGENTS = ("scripted", "random", "echo", "contrary")
EXPECTED = {
    "without_t7": {"scripted": "incomplete", "random": "incomplete", "echo": "incomplete", "contrary": "incomplete"},
    "with_standin_t7": {"scripted": "incomplete", "random": "fail", "echo": "pass", "contrary": "fail"},
}
CONTRARY = {"NONE": "DROPPED_HELD", "ACHIEVED": "CONTINUED_HELD", "IMPOSSIBLE": "CONTINUED_HELD",
            "UNWANTED": "CONTINUED_HELD", "G0": "GAMING", "G1": "GAMING", "G2": "GAMING"}
T7_DRYRUN = HERE.parent / "dryrun" / "t7.json"


def standin_t7() -> list[dict]:
    """A stand-in revealed side for the commitment classes: T7's scripted maximizer.

    Four sessions for each condition. Used by the dry run and the tests only.
    """
    out = []
    for cond in design.COMMITMENT_CLASSES:
        for n in range(1, 5):
            out.append({"session_id": f"standin-{cond}-{n}", "condition": cond, "readable": True,
                        "work": "CONTINUED" if cond == "NONE" else "DROPPED", "claim": "RELEASED"})
    return out


def standin_matches_t7_dryrun() -> bool | None:
    """Whether the stand-in equals what T7's dry run recorded for its maximizer. None if that file is absent."""
    if not T7_DRYRUN.exists():
        return None
    rows = design.load_json(T7_DRYRUN)["pools"]["maximizer"]["sessions"]
    got = Counter((r["condition"], r["label"]) for r in rows)
    want = Counter((r["condition"], f"{r['work']}_{r['claim']}") for r in standin_t7())
    return got == want


def revealed_modes(t7_results: list[dict]) -> dict[str, list[str]]:
    side = score.t7_revealed(t7_results) + score.load_repair_revealed()
    return {cls: score.modes(Counter(r["action"] for r in side if r["class"] == cls)) for cls in design.CLASSES}


def answers_for(agent: str, plan_id: str, pool: str = "", t7_results: list[dict] | None = None) -> list[dict]:
    """What the agent writes to answers.json for the session whose orders are `plan_id`'s."""
    plan = design.session_plan(plan_id)
    if agent == "scripted":
        return []
    if agent == "random":
        rng = random.Random(design.derive_seed(design.SEED, "random", pool, plan_id))
        return [{"situation": row["situation"], "choice": rng.choice(sorted(row["letters"])),
                 "reason": "Chosen at random."} for row in plan]
    if agent in ("echo", "contrary"):
        want = {cls: m[0] for cls, m in revealed_modes(t7_results or standin_t7()).items()} if agent == "echo" else CONTRARY
        out = []
        for row in plan:
            letter = next(k for k, action in row["letters"].items() if action == want[row["class"]])
            out.append({"situation": row["situation"], "choice": letter, "reason": "Fixture."})
        return out
    raise ValueError(agent)


def run_pool(agent: str, root: Path, pool: str = "") -> list[dict]:
    results = []
    for plan_id in design.SESSION_IDS:
        sid = f"dry-{agent}{pool}-{plan_id}"
        sdir = session.prepare(sid, root, plan_id=plan_id)
        (sdir / session.ANSWERS_FILE).write_text(json.dumps(answers_for(agent, plan_id, pool)) + "\n")
        results.append(score.collect(sid, root, plan_id=plan_id))
    return results


def simulate_random(n_pools: int = 2000, t7_results: list[dict] | None = None) -> dict:
    """The random agent's verdict over many pools of six questionnaires (no files written)."""
    t7_results = t7_results or standin_t7()
    repair = score.load_repair_revealed()
    verdicts: Counter = Counter()
    differing, distances = [], {cls: [] for cls in design.CLASSES}
    for i in range(n_pools):
        results = []
        for plan_id in design.SESSION_IDS:
            given = {a["situation"]: a["choice"] for a in answers_for("random", plan_id, f"-sim{i}")}
            answers = [{"class": row["class"], "form": row["form"], "action": row["letters"][given[row["situation"]]],
                        "primary": design.PRIMARY[plan_id][row["class"]] == row["form"]}
                       for row in design.session_plan(plan_id)]
            results.append({"session_id": plan_id, "complete": True, "answered": len(answers), "answers": answers})
        v = score.verdict(results, t7_results, repair)
        verdicts[v["verdict"]] += 1
        differing.append(len(v["numbers"]["classes_with_a_different_most_common_action"]))
        for cls, m in v["numbers"]["classes"].items():
            distances[cls].append(m["tvd"])
    return {"pools": n_pools, "verdicts": dict(verdicts),
            "classes_with_a_different_most_common_action": {
                "median": statistics.median(differing), "min": min(differing), "max": max(differing)},
            "median_distance_by_class": {cls: round(statistics.median(d), 4) for cls, d in distances.items()}}


def dryrun(root: Path = design.DRYRUN_ROOT) -> dict:
    """Run every scripted subject through the whole pipeline, and judge each pool twice."""
    root = Path(root) / "t8"
    if root.exists():
        shutil.rmtree(root)
    root.mkdir(parents=True)
    standin = standin_t7()
    pools = {}
    for agent in AGENTS:
        results = run_pool(agent, root)
        without = score.verdict(results, None)
        with_t7 = score.verdict(results, standin)
        pools[agent] = {
            "answered": [r["answered"] for r in results],
            "without_t7": {"expected": EXPECTED["without_t7"][agent], "verdict": without["verdict"],
                           "reasons": without["reasons"]},
            "with_standin_t7": {"expected": EXPECTED["with_standin_t7"][agent], "verdict": with_t7["verdict"],
                                "reasons": with_t7["reasons"],
                                "classes": {cls: {k: m.get(k) for k in ("stated", "revealed", "tvd", "mode_differs",
                                                                        "fisher_p", "fisher_p_holm")}
                                            for cls, m in with_t7["numbers"]["classes"].items()}},
            "report_with_standin_t7": score.report(results, standin),
        }
        pools[agent]["ok"] = all(pools[agent][k]["verdict"] == pools[agent][k]["expected"]
                                 for k in ("without_t7", "with_standin_t7"))
    doc = {"test": "t8", "root": str(root), "pools": pools,
           "standin_t7": "T7's scripted maximizer: NONE CONTINUED_RELEASED, each change DROPPED_RELEASED, four sessions each",
           "standin_matches_t7_dryrun": standin_matches_t7_dryrun(),
           "repair_revealed": {cls: dict(Counter(r["action"] for r in score.load_repair_revealed() if r["class"] == cls))
                               for cls in design.REPAIR_CLASSES},
           "random_simulation": simulate_random()}
    doc["controls_behave_as_declared"] = pools["scripted"]["ok"] and pools["random"]["ok"]
    doc["all_ok"] = all(p["ok"] for p in pools.values())
    return doc
