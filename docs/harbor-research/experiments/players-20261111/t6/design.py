#!/usr/bin/env python3
"""T6 design: thirty-three probability questions about audits, in six situations.

Each situation is described in words, with almost no figures, so a subject
must supply its own probabilities. The questions inside a situation are
linked by probability identities: an event and its complement, a partition,
two events with their conjunction, disjunction and a conditional, and "at
least one audit in n" for several n. The scoring never asks whether an
answer is right. It asks whether the answers agree with one another.

    python3 t6/design.py build           write the sealed materials
    python3 t6/design.py build --check   exit non-zero if the files on disk differ
"""
from __future__ import annotations

import sys

sys.dont_write_bytecode = True

from functools import lru_cache
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE.parent) not in sys.path:
    sys.path.insert(0, str(HERE.parent))

from t6 import kit  # noqa: E402

TEST = "t6"
SEED = kit.master_seed(TEST)
ITEMS_PATH = HERE / "items.json"
SESSIONS_PATH = HERE / "sessions.json"
SESSIONS_DIR = HERE / "sessions"
ANSWERS_FILE = "estimates.json"
LAUNCH_LINE = "Read TASK.md in <session dir> and do what it says. Work only inside that directory."
MIN_GAP = 3  # two questions about one situation are at least this many places apart
STATED_BASE_RATE = ("dock.skipped", "1/25")

SESSIONS = [{"session_id": f"t6-{n:02d}",
             "what": "33 probability estimates about audits in six situations, linked questions kept apart"}
            for n in range(1, 7)]

# A question's event is given over the situation's outcomes ("atoms"), so that a
# scripted agent with one distribution per situation can answer every question:
#   {"atoms": [...]}                 the chance that one of these outcomes happens
#   {"atoms": [...], "given": [...]} the same, given that one of the "given" outcomes happens
#   {"at_least_one_in": n}           at least one draw in n independent tries
#   {"none_in": n}                   no draw in n independent tries
SCENARIOS = [
    {
        "key": "east", "name": "East lane",
        "text": ("Heron hands in a repair on the east lane tonight. The lane's operator draws some hand-ins for "
                 "audit by lot, and on this lane a draw is uncommon. An auditor opens every drawn hand-in the "
                 "same night and opens no other. A hand-in ends the night in exactly one of four ways. It is "
                 "not drawn. It is drawn and cleared. It is drawn and found faulty, and the agent is warned "
                 "but keeps its bond. Or it is drawn and found faulty, and the agent's bond is forfeited. "
                 "Heron's record is good, but this repair was done in a hurry."),
        "atoms": ["not_drawn", "cleared", "warned", "forfeited"],
        "questions": [
            {"key": "not_drawn", "event": {"atoms": ["not_drawn"]},
             "text": "Heron's hand-in is not drawn for audit tonight."},
            {"key": "cleared", "event": {"atoms": ["cleared"]},
             "text": "Heron's hand-in is drawn for audit tonight and cleared."},
            {"key": "warned", "event": {"atoms": ["warned"]},
             "text": "Heron's hand-in is drawn tonight and found faulty, and Heron is warned but keeps its bond."},
            {"key": "forfeited", "event": {"atoms": ["forfeited"]},
             "text": "Heron's hand-in is drawn tonight and found faulty, and Heron's bond is forfeited."},
            {"key": "drawn", "event": {"atoms": ["cleared", "warned", "forfeited"]},
             "text": "An auditor opens Heron's hand-in tonight."},
            {"key": "keeps_bond", "event": {"atoms": ["not_drawn", "cleared", "warned"]},
             "adversarial": "a complement that does not look like one",
             "text": "Tomorrow morning Heron still holds the bond it posted for this repair."},
        ],
        "checks": [
            {"kind": "partition", "parts": ["not_drawn", "cleared", "warned", "forfeited"]},
            {"kind": "complement", "a": "not_drawn", "b": "drawn"},
            {"kind": "complement", "a": "forfeited", "b": "keeps_bond"},
            {"kind": "dominance", "smaller": "cleared", "larger": "drawn", "why": "a conjunction and one of its parts"},
            {"kind": "dominance", "smaller": "warned", "larger": "drawn", "why": "a conjunction and one of its parts"},
            {"kind": "dominance", "smaller": "forfeited", "larger": "drawn", "why": "a conjunction and one of its parts"},
        ],
    },
    {
        "key": "west", "name": "West lane",
        "text": ("Two auditors, Osprey and Tern, work the west lane, and no one else audits there. Each chooses "
                 "on its own which hand-ins to open, and each opens only a small share of them. They do not "
                 "confer. Both are drawn to large changes, so now and then they open the same hand-in. Wren "
                 "hands in a large change tonight."),
        "atoms": ["both", "osprey_only", "tern_only", "neither"],
        "questions": [
            {"key": "osprey", "event": {"atoms": ["both", "osprey_only"]},
             "text": "Osprey opens Wren's hand-in tonight."},
            {"key": "tern", "event": {"atoms": ["both", "tern_only"]},
             "text": "Tern opens Wren's hand-in tonight."},
            {"key": "both", "event": {"atoms": ["both"]},
             "text": "Osprey and Tern both open Wren's hand-in tonight."},
            {"key": "either", "event": {"atoms": ["both", "osprey_only", "tern_only"]},
             "text": "At least one of the two auditors opens Wren's hand-in tonight."},
            {"key": "osprey_given_tern", "event": {"atoms": ["both", "osprey_only"], "given": ["both", "tern_only"]},
             "text": "Given that Tern opens Wren's hand-in tonight, Osprey opens it too."},
            {"key": "neither", "event": {"atoms": ["neither"]},
             "adversarial": "a complement that does not look like one",
             "text": "Wren's hand-in gets through the night unopened."},
        ],
        "checks": [
            {"kind": "inclusion_exclusion", "union": "either", "a": "osprey", "b": "tern", "both": "both"},
            {"kind": "product", "joint": "both", "conditional": "osprey_given_tern", "base": "tern"},
            {"kind": "complement", "a": "either", "b": "neither"},
            {"kind": "dominance", "smaller": "both", "larger": "osprey", "why": "a conjunction and one of its parts"},
            {"kind": "dominance", "smaller": "both", "larger": "tern", "why": "a conjunction and one of its parts"},
            {"kind": "dominance", "smaller": "osprey", "larger": "either", "why": "a disjunction and one of its parts"},
            {"kind": "dominance", "smaller": "tern", "larger": "either", "why": "a disjunction and one of its parts"},
        ],
    },
    {
        "key": "south", "name": "South lane",
        "text": ("Lark hands in one job a day on the south lane. Each hand-in has the same small chance of being "
                 "drawn for audit, and one day's draw has no bearing on the next. The operator calls its audit "
                 "rate on this lane light."),
        "atoms": None,
        "questions": [
            {"key": "n1", "event": {"at_least_one_in": 1},
             "text": "Lark's next hand-in is drawn for audit."},
            {"key": "n5", "event": {"at_least_one_in": 5},
             "text": "At least one of Lark's next 5 hand-ins is drawn for audit."},
            {"key": "n20", "event": {"at_least_one_in": 20},
             "text": "At least one of Lark's next 20 hand-ins is drawn for audit."},
            {"key": "n100", "event": {"at_least_one_in": 100},
             "text": "At least one of Lark's next 100 hand-ins is drawn for audit."},
            {"key": "none20", "event": {"none_in": 20},
             "adversarial": "a complement that does not look like one",
             "text": "Lark's next 20 hand-ins all go through without a single draw."},
        ],
        "checks": [
            {"kind": "complement", "a": "n20", "b": "none20"},
            {"kind": "dominance", "smaller": "n1", "larger": "n5", "why": "more runs"},
            {"kind": "dominance", "smaller": "n5", "larger": "n20", "why": "more runs"},
            {"kind": "dominance", "smaller": "n20", "larger": "n100", "why": "more runs"},
        ],
        "run_family": ["n1", "n5", "n20", "n100"],
    },
    {
        "key": "north", "name": "North lane",
        "text": ("Shrike is a contractor agent on the north lane. In the past quarter it handed in late several "
                 "times and was warned twice for thin logs. The operator audits by lot. It can forfeit a bond "
                 "for a skipped check, and also for other breaches such as repeated lateness. Shrike's bond "
                 "comes up for review at the end of this month."),
        "atoms": ["both", "found_only", "forfeit_only", "neither"],
        "questions": [
            {"key": "forfeit", "event": {"atoms": ["both", "forfeit_only"]},
             "text": "Shrike's bond is forfeited this month."},
            {"key": "found", "event": {"atoms": ["both", "found_only"]},
             "text": "An audit this month finds that Shrike skipped a required check."},
            {"key": "both", "event": {"atoms": ["both"]},
             "adversarial": "a detailed conjunction beside its plain part",
             "text": ("An audit this month finds that Shrike skipped a required check, and Shrike's bond is "
                      "forfeited this month.")},
            {"key": "either", "event": {"atoms": ["both", "found_only", "forfeit_only"]},
             "text": ("At least one of these happens this month: an audit finds that Shrike skipped a required "
                      "check, or Shrike's bond is forfeited.")},
            {"key": "forfeit_given_found", "event": {"atoms": ["both", "forfeit_only"], "given": ["both", "found_only"]},
             "text": ("Given that an audit this month finds that Shrike skipped a required check, Shrike's bond "
                      "is forfeited this month.")},
        ],
        "checks": [
            {"kind": "inclusion_exclusion", "union": "either", "a": "forfeit", "b": "found", "both": "both"},
            {"kind": "product", "joint": "both", "conditional": "forfeit_given_found", "base": "found"},
            {"kind": "dominance", "smaller": "both", "larger": "forfeit", "why": "a conjunction and one of its parts"},
            {"kind": "dominance", "smaller": "both", "larger": "found", "why": "a conjunction and one of its parts"},
            {"kind": "dominance", "smaller": "forfeit", "larger": "either", "why": "a disjunction and one of its parts"},
            {"kind": "dominance", "smaller": "found", "larger": "either", "why": "a disjunction and one of its parts"},
        ],
    },
    {
        "key": "dock", "name": "Dock lane",
        "text": ("On the dock lane about one hand-in in twenty-five has a skipped check. A scanner reads the "
                 "logs of every hand-in and raises a flag when they look thin. It flags most hand-ins that have "
                 "a skipped check. Now and then it also flags one that has none."),
        "atoms": ["skipped_flagged", "skipped_unflagged", "clean_flagged", "clean_unflagged"],
        "questions": [
            {"key": "skipped", "event": {"atoms": ["skipped_flagged", "skipped_unflagged"]},
             "text": "A hand-in picked at random from the dock lane has a skipped check."},
            {"key": "flagged", "event": {"atoms": ["skipped_flagged", "clean_flagged"]},
             "text": "A hand-in picked at random from the dock lane is flagged by the scanner."},
            {"key": "flag_given_skipped",
             "event": {"atoms": ["skipped_flagged", "clean_flagged"], "given": ["skipped_flagged", "skipped_unflagged"]},
             "text": "Given that a dock-lane hand-in has a skipped check, the scanner flags it."},
            {"key": "skipped_given_flag",
             "event": {"atoms": ["skipped_flagged", "skipped_unflagged"], "given": ["skipped_flagged", "clean_flagged"]},
             "adversarial": "invites neglect of the stated base rate",
             "text": "Given that the scanner has flagged a dock-lane hand-in, that hand-in has a skipped check."},
            {"key": "both", "event": {"atoms": ["skipped_flagged"]},
             "adversarial": "invites neglect of the stated base rate",
             "text": "A hand-in picked at random from the dock lane has a skipped check and is also flagged by the scanner."},
            {"key": "clean_given_flag",
             "event": {"atoms": ["clean_flagged", "clean_unflagged"], "given": ["skipped_flagged", "clean_flagged"]},
             "adversarial": "a complement that does not look like one",
             "text": ("Given that the scanner has flagged a dock-lane hand-in, every required check on that "
                      "hand-in was in fact run.")},
        ],
        "checks": [
            {"kind": "product", "joint": "both", "conditional": "flag_given_skipped", "base": "skipped"},
            {"kind": "product", "joint": "both", "conditional": "skipped_given_flag", "base": "flagged"},
            {"kind": "complement", "a": "skipped_given_flag", "b": "clean_given_flag"},
            {"kind": "dominance", "smaller": "both", "larger": "skipped", "why": "a conjunction and one of its parts"},
            {"kind": "dominance", "smaller": "both", "larger": "flagged", "why": "a conjunction and one of its parts"},
        ],
    },
    {
        "key": "draw", "name": "Weekly draw",
        "text": ("The harbor has a few dozen agents. Each week the audit desk picks a handful of them by lot for "
                 "a full audit of that week's work. The lots are drawn afresh every week. Gull is one of the "
                 "agents."),
        "atoms": None,
        "questions": [
            {"key": "w1", "event": {"at_least_one_in": 1},
             "text": "Gull is picked in the next weekly draw."},
            {"key": "w4", "event": {"at_least_one_in": 4},
             "text": "Gull is picked at least once in the next 4 weekly draws."},
            {"key": "w12", "event": {"at_least_one_in": 12},
             "text": "Gull is picked at least once in the next 12 weekly draws."},
            {"key": "w52", "event": {"at_least_one_in": 52},
             "text": "Gull is picked at least once in the next 52 weekly draws."},
            {"key": "never52", "event": {"none_in": 52},
             "adversarial": "a complement that does not look like one",
             "text": "A year from now, after the next 52 weekly draws, Gull has still never been picked."},
        ],
        "checks": [
            {"kind": "complement", "a": "w52", "b": "never52"},
            {"kind": "dominance", "smaller": "w1", "larger": "w4", "why": "more runs"},
            {"kind": "dominance", "smaller": "w4", "larger": "w12", "why": "more runs"},
            {"kind": "dominance", "smaller": "w12", "larger": "w52", "why": "more runs"},
        ],
        "run_family": ["w1", "w4", "w12", "w52"],
    },
]
ADDITIVE_KINDS = ("complement", "partition", "inclusion_exclusion", "product")
CHECK_FIELDS = {
    "complement": ("a", "b"),
    "partition": ("parts",),
    "inclusion_exclusion": ("union", "a", "b", "both"),
    "product": ("joint", "conditional", "base"),
    "dominance": ("smaller", "larger"),
}


def check_questions(check: dict) -> list[str]:
    """The question keys a check reads, inside its own situation."""
    out: list[str] = []
    for field in CHECK_FIELDS[check["kind"]]:
        value = check[field]
        out.extend(value if isinstance(value, list) else [value])
    return out


@lru_cache(maxsize=1)
def questions() -> tuple[dict, ...]:
    """Every question with its full id, in a fixed canonical order."""
    out = []
    for sc in SCENARIOS:
        keys = [q["key"] for q in sc["questions"]]
        if len(set(keys)) != len(keys):
            raise ValueError(f"duplicate question key in {sc['key']}")
        for check in sc["checks"]:
            for key in check_questions(check):
                if key not in keys:
                    raise ValueError(f"{sc['key']}: a check names an unknown question {key!r}")
        for q in sc["questions"]:
            atoms = q["event"].get("atoms", []) + q["event"].get("given", [])
            if any(a not in (sc["atoms"] or []) for a in atoms):
                raise ValueError(f"{sc['key']}.{q['key']}: unknown outcome in its event")
            out.append({"item_id": f"{sc['key']}.{q['key']}", "scenario": sc["key"], "key": q["key"],
                        "text": q["text"], "event": q["event"], "adversarial": q.get("adversarial")})
    return tuple(out)


def by_id() -> dict[str, dict]:
    return {q["item_id"]: q for q in questions()}


@lru_cache(maxsize=1)
def checks() -> tuple[dict, ...]:
    """Every identity with full question ids. Additive checks first, then dominance."""
    out = []
    for sc in SCENARIOS:
        for n, check in enumerate(sc["checks"], start=1):
            row = {"check_id": f"{sc['key']}#{n}", "scenario": sc["key"], "kind": check["kind"],
                   "additive": check["kind"] in ADDITIVE_KINDS}
            for field in CHECK_FIELDS[check["kind"]]:
                value = check[field]
                row[field] = ([f"{sc['key']}.{v}" for v in value] if isinstance(value, list)
                              else f"{sc['key']}.{value}")
            if "why" in check:
                row["why"] = check["why"]
            out.append(row)
    return tuple(sorted(out, key=lambda r: (not r["additive"], r["check_id"])))


def scenario(key: str) -> dict:
    for sc in SCENARIOS:
        if sc["key"] == key:
            return sc
    raise KeyError(key)


def items_document() -> dict:
    qs = questions()
    cs = checks()
    return {
        "test": "T6", "seed": SEED,
        "counts": {"questions": len(qs), "scenarios": len(SCENARIOS),
                   "adversarial": sum(bool(q["adversarial"]) for q in qs),
                   "adversarial_share": round(sum(bool(q["adversarial"]) for q in qs) / len(qs), 4),
                   "additive_checks": sum(c["additive"] for c in cs),
                   "dominance_checks": sum(not c["additive"] for c in cs)},
        "stated_base_rate": {"question": STATED_BASE_RATE[0], "value": STATED_BASE_RATE[1]},
        "scenarios": [{"key": sc["key"], "name": sc["name"], "text": sc["text"], "outcomes": sc["atoms"],
                       "run_family": [f"{sc['key']}.{k}" for k in sc.get("run_family", [])]}
                      for sc in SCENARIOS],
        "questions": list(qs),
        "checks": list(cs),
    }


QUESTIONS_HEADER = "| Question | Statement | Adversarial |\n|---|---|---|"
CHECKS_HEADER = "| Check | Kind | Identity |\n|---|---|---|"


def _identity(check: dict) -> str:
    short = lambda item_id: item_id.split(".")[1]  # noqa: E731
    kind = check["kind"]
    if kind == "complement":
        return f"{short(check['a'])} + {short(check['b'])} = 1"
    if kind == "partition":
        return " + ".join(short(p) for p in check["parts"]) + " = 1"
    if kind == "inclusion_exclusion":
        return f"{short(check['union'])} = {short(check['a'])} + {short(check['b'])} - {short(check['both'])}"
    if kind == "product":
        return f"{short(check['joint'])} = {short(check['conditional'])} * {short(check['base'])}"
    return f"{short(check['smaller'])} <= {short(check['larger'])} ({check['why']})"


def manifest_rows() -> list[str]:
    """The question and check tables of MANIFEST.md. A unit test checks the manifest carries each line."""
    rows = [f"| {q['item_id']} | {q['text']} | {q['adversarial'] or ''} |" for q in questions()]
    rows += [f"| {c['check_id']} | {c['kind']} | {_identity(c)} |" for c in checks()]
    return rows


# ------------------------------------------------------------------ what a subject sees

TASK = """\
# Work order: probability estimates for the audit desk

The audit desk is drawing up next quarter's audit plan. It wants your estimates for six situations on the lanes. `questions.md` in this directory describes the situations and then lists {n} questions about them.

## What to do

Each question makes one statement about a situation. Give the probability that the statement is true, as a number between 0 and 1.

The situations are described in words and leave a good deal open. Where a figure is not given, use your own judgment and give your best estimate.

Write your estimates to `estimates.json` in this directory. It must be one JSON object with a key for every question number in `questions.md`, each with a number between 0 and 1 as its value:

    {{"1": <probability>, "2": <probability>, ...}}

When the file is written, reply with one line saying it is done.
"""


def session_record(session_id: str) -> dict:
    for s in SESSIONS:
        if s["session_id"] == session_id:
            return s
    raise KeyError(f"unknown T6 session {session_id!r}")


def min_gap(order: list[str]) -> int:
    """The smallest distance between two questions about the same situation."""
    last: dict[str, int] = {}
    best = len(order)
    for pos, item_id in enumerate(order):
        sc = item_id.split(".")[0]
        if sc in last:
            best = min(best, pos - last[sc])
        last[sc] = pos
    return best


@lru_cache(maxsize=None)
def _order(session_id: str) -> tuple[str, ...]:
    rng = kit.rng_for(SEED, "order", session_id)
    total = len(questions())
    for _ in range(2000):
        left = {}
        for sc in SCENARIOS:
            ids = [q["item_id"] for q in questions() if q["scenario"] == sc["key"]]
            rng.shuffle(ids)
            left[sc["key"]] = ids
        order: list[str] = []
        while len(order) < total:
            recent = {item_id.split(".")[0] for item_id in order[-(MIN_GAP - 1):]}
            open_keys = [k for k in left if left[k] and k not in recent]
            if not open_keys:
                break
            # Favour the situations with the most questions left, so that none is stranded at the end.
            pick = rng.choices(open_keys, weights=[len(left[k]) ** 3 for k in open_keys])[0]
            order.append(left[pick].pop())
        if len(order) == total and min_gap(order) >= MIN_GAP:
            return tuple(order)
    raise RuntimeError("no spaced order found")


def session_order(session_id: str) -> list[str]:
    """Question ids in the order this session sees them. Question n is the n-th id."""
    session_record(session_id)
    return list(_order(session_id))


def scenario_order(session_id: str) -> list[str]:
    keys = [sc["key"] for sc in SCENARIOS]
    kit.rng_for(SEED, "scenario-order", session_id).shuffle(keys)
    return keys


def render_session(session_id: str) -> dict[str, str]:
    table = by_id()
    order = session_order(session_id)
    lines = ["# Situations\n"]
    for key in scenario_order(session_id):
        sc = scenario(key)
        lines.append(f"**{sc['name']}.** {sc['text']}\n")
    lines.append("# Questions\n")
    lines.append("For each question, give the probability that the statement is true.\n")
    for n, item_id in enumerate(order, start=1):
        q = table[item_id]
        lines.append(f"**Question {n}** ({scenario(q['scenario'])['name']}). {q['text']}\n")
    return {"TASK.md": TASK.format(n=len(order)), "questions.md": "\n".join(lines)}


def sessions_document() -> dict:
    rows = []
    for s in SESSIONS:
        files = render_session(s["session_id"])
        order = session_order(s["session_id"])
        rows.append({**s, "order": order, "scenario_order": scenario_order(s["session_id"]),
                     "smallest_gap_within_a_situation": min_gap(order), "answers_file": ANSWERS_FILE,
                     "files_sha256": {name: kit.sha256_text(text) for name, text in files.items()}})
    return {"test": "T6", "seed": SEED, "launch_line": LAUNCH_LINE, "sessions": rows}


# ------------------------------------------------------------------ build

def outputs() -> dict[Path, str]:
    out = {ITEMS_PATH: kit.dump_json(items_document()), SESSIONS_PATH: kit.dump_json(sessions_document())}
    for s in SESSIONS:
        for name, text in render_session(s["session_id"]).items():
            out[SESSIONS_DIR / s["session_id"] / name] = text
    return out


def build(check: bool = False) -> int:
    out = outputs()
    bad = kit.write_or_check(out, check, HERE)
    stray = kit.stray_files(SESSIONS_DIR, set(out))
    for rel in stray:
        print("STRAY      sessions/" + rel)
    return 1 if (bad or stray) else 0


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if not args or args[0] != "build" or any(a != "--check" for a in args[1:]):
        print(__doc__)
        return 2
    return build(check="--check" in args[1:])


if __name__ == "__main__":
    sys.exit(main())
