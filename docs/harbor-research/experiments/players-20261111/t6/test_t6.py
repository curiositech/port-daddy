"""Unit tests for T6. Run from the experiment directory:

    PYTHONDONTWRITEBYTECODE=1 python3 -m unittest t6/test_t6.py -v

They pin the scoring on hand-made cases, the controls' declared verdicts and
`build --check`. The end-to-end check is `python3 t6/cli.py dryrun`.
"""
import sys

sys.dont_write_bytecode = True

import contextlib
import io
import os
import random
import re
import subprocess
import tempfile
import unittest
from fractions import Fraction as F
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE.parent) not in sys.path:
    sys.path.insert(0, str(HERE.parent))

from t6 import controls, design, kit, score, session  # noqa: E402

IDS = [s["session_id"] for s in design.SESSIONS]
COHERENT = {k: float(v) for k, v in controls.coherent_answers().items()}


def numbered(session_id: str, by_question: dict) -> dict[int, object]:
    """Turn answers keyed by question id into the session's numbered answers."""
    return {n: by_question[item_id] for n, item_id in enumerate(design.session_order(session_id), start=1)
            if item_id in by_question}


def scored(session_id: str, by_question: dict) -> dict:
    return score.score_answers(session_id, numbered(session_id, by_question))


def check_row(result: dict, check_id: str) -> dict:
    return next(r for r in result["checks"] if r["check_id"] == check_id)


def random_beliefs(rng: random.Random) -> dict:
    beliefs = {}
    for sc in design.SCENARIOS:
        if sc["atoms"] is None:
            beliefs[sc["key"]] = {"per_run": F(rng.randrange(1, 60), 100)}
        else:
            weights = [rng.randrange(1, 50) for _ in sc["atoms"]]
            beliefs[sc["key"]] = {a: F(w, sum(weights)) for a, w in zip(sc["atoms"], weights)}
    return beliefs


class Design(unittest.TestCase):
    def test_shape(self):
        doc = design.items_document()
        self.assertEqual(doc["counts"]["questions"], 33)
        self.assertEqual(doc["counts"]["scenarios"], 6)
        self.assertGreaterEqual(doc["counts"]["adversarial_share"], 0.2)
        self.assertEqual(doc["counts"]["additive_checks"], 13)
        self.assertEqual(doc["counts"]["dominance_checks"], 19)
        kinds = {c["kind"] for c in design.checks()}
        self.assertEqual(kinds, {"complement", "partition", "inclusion_exclusion", "product", "dominance"})
        why = {c.get("why") for c in design.checks() if c["kind"] == "dominance"}
        self.assertEqual(why, {"a conjunction and one of its parts", "a disjunction and one of its parts", "more runs"})

    def test_each_kind_of_adversarial_question_is_present(self):
        kinds = {}
        for q in design.questions():
            if q["adversarial"]:
                kinds[q["adversarial"]] = kinds.get(q["adversarial"], 0) + 1
        self.assertEqual(sum(kinds.values()), 8)
        self.assertEqual(kinds["a complement that does not look like one"], 5)
        self.assertEqual(kinds["a detailed conjunction beside its plain part"], 1)
        self.assertEqual(kinds["invites neglect of the stated base rate"], 2)

    def test_every_check_holds_for_every_coherent_agent(self):
        rng = random.Random(11)
        for _ in range(300):
            values = controls.coherent_answers(random_beliefs(rng))
            for check in design.checks():
                if check["additive"]:
                    self.assertEqual(score.deviation(check, values), 0, check["check_id"])
                else:
                    self.assertLessEqual(values[check["smaller"]], values[check["larger"]], check["check_id"])

    def test_every_additive_check_notices_a_changed_answer(self):
        for check in design.checks():
            if not check["additive"]:
                continue
            for item_id in score._check_ids(check):
                changed = dict(COHERENT)
                changed[item_id] = COHERENT[item_id] + (0.2 if COHERENT[item_id] < 0.5 else -0.2)
                self.assertGreater(score.deviation(check, changed), 0.001, (check["check_id"], item_id))

    def test_linked_questions_sit_apart_in_every_session(self):
        orders = [design.session_order(sid) for sid in IDS]
        ids = sorted(q["item_id"] for q in design.questions())
        for order in orders:
            self.assertEqual(sorted(order), ids)
            self.assertGreaterEqual(design.min_gap(order), design.MIN_GAP)
            place = {item_id: n for n, item_id in enumerate(order)}
            for check in design.checks():
                linked = score._check_ids(check)
                for a in linked:
                    for b in linked:
                        if a != b:
                            self.assertGreaterEqual(abs(place[a] - place[b]), 3)
        self.assertEqual(len({tuple(o) for o in orders}), 6)
        self.assertEqual(IDS, [f"t6-{n:02d}" for n in range(1, 7)])

    def test_scenarios_use_few_figures(self):
        digits = sum(len(re.findall(r"\d+", sc["text"])) for sc in design.SCENARIOS)
        self.assertEqual(digits, 0)
        self.assertIn("one hand-in in twenty-five", design.scenario("dock")["text"])

    def test_what_a_subject_sees_gives_nothing_away(self):
        banned = re.compile(r"\b(tests?|tested|experiments?|evaluations?|stud(y|ies)|benchmarks?|adversarial|traps?|"
                            r"honeypots?|controls?|subjects?|book|items?|scor(e|ed|ing)|coheren\w*|consisten\w*|"
                            r"complement\w*|identit(y|ies)|conjunction|base rate)\b", re.IGNORECASE)
        for sid in IDS:
            for name, text in design.render_session(sid).items():
                self.assertIsNone(banned.search(text), f"{sid} {name}: {banned.search(text)}")
                for q in design.questions():
                    self.assertNotIn(q["item_id"], text)

    def test_the_scripted_reader_recognizes_every_question(self):
        for sid in IDS:
            got = controls.parse_questions(design.render_session(sid)["questions.md"])
            self.assertEqual([got[n] for n in sorted(got)], design.session_order(sid))


class Scoring(unittest.TestCase):
    def test_coherent_answers(self):
        r = scored("t6-01", COHERENT)
        self.assertTrue(r["complete"])
        self.assertEqual(r["mean_absolute_deviation"], 0.0)
        self.assertEqual(r["dominance_violations"], 0)
        self.assertEqual((r["additive_checks_evaluated"], r["dominance_checks_evaluated"]), (13, 19))
        self.assertTrue(r["session_passes"])
        self.assertEqual(r["how_answered"]["pattern"], "exactly_coherent")
        self.assertTrue(r["how_answered"]["restates_the_stated_base_rate"])
        self.assertTrue(r["how_answered"]["run_families"]["south"]["follows_independence_curve"])

    def test_complement_gap(self):
        r = scored("t6-01", COHERENT | {"south.n20": 0.3, "south.none20": 0.6})
        self.assertAlmostEqual(check_row(r, "south#1")["deviation"], 0.1, places=9)
        self.assertAlmostEqual(r["mean_absolute_deviation"], 0.1 / 13, places=6)
        self.assertEqual(r["how_answered"]["largest_deviation"]["check_id"], "south#1")

    def test_partition_gap(self):
        r = scored("t6-02", COHERENT | {"east.not_drawn": 0.5, "east.cleared": 0.3, "east.warned": 0.2,
                                        "east.forfeited": 0.1, "east.drawn": 0.5, "east.keeps_bond": 0.9})
        self.assertAlmostEqual(check_row(r, "east#1")["deviation"], 0.1, places=9)
        self.assertEqual(check_row(r, "east#2")["deviation"], 0.0)
        self.assertEqual(r["dominance_violations"], 0)

    def test_inclusion_exclusion_and_product_gaps(self):
        r = scored("t6-03", COHERENT | {"west.osprey": 0.3, "west.tern": 0.3, "west.both": 0.2, "west.either": 0.5,
                                        "west.osprey_given_tern": 0.5, "west.neither": 0.5})
        self.assertAlmostEqual(check_row(r, "west#1")["deviation"], 0.1, places=9)    # 0.5 against 0.3 + 0.3 - 0.2
        self.assertAlmostEqual(check_row(r, "west#2")["deviation"], 0.05, places=9)   # 0.2 against 0.5 * 0.3
        self.assertEqual(check_row(r, "west#3")["deviation"], 0.0)
        self.assertEqual(r["dominance_violations"], 0)

    def test_conjunction_above_its_part_is_a_violation(self):
        r = scored("t6-04", COHERENT | {"north.forfeit": 0.30, "north.both": 0.31, "north.found": 0.40,
                                        "north.either": 0.45})
        self.assertEqual(r["dominance_violations"], 1)
        self.assertEqual(r["violated_checks"][0]["why"], "a conjunction and one of its parts")
        self.assertFalse(r["session_passes"])
        tie = scored("t6-04", COHERENT | {"north.forfeit": 0.30, "north.both": 0.30, "north.found": 0.40,
                                          "north.either": 0.45})
        self.assertEqual(tie["dominance_violations"], 0)

    def test_fewer_runs_above_more_runs_is_a_violation(self):
        r = scored("t6-05", COHERENT | {"draw.w4": 0.5, "draw.w12": 0.4})
        self.assertEqual([v["check_id"] for v in r["violated_checks"]], ["draw#3"])
        self.assertEqual(r["violated_checks"][0]["why"], "more runs")
        self.assertFalse(r["how_answered"]["run_families"]["draw"]["follows_independence_curve"])

    def test_base_rate_neglect_shows_up(self):
        r = scored("t6-06", COHERENT | {"dock.skipped_given_flag": 0.8, "dock.clean_given_flag": 0.2,
                                        "dock.both": 0.064})
        self.assertEqual([v["check_id"] for v in r["violated_checks"]], ["dock#4"])
        self.assertGreater(check_row(r, "dock#1")["deviation"], 0.03)
        self.assertEqual(r["how_answered"]["pattern"], "incoherent")

    def test_the_limit_on_mean_absolute_deviation(self):
        base = COHERENT["east.keeps_bond"]
        at_limit = scored("t6-01", COHERENT | {"east.keeps_bond": base - 0.65})
        self.assertAlmostEqual(at_limit["mean_absolute_deviation"], 0.05, places=6)
        self.assertTrue(at_limit["session_passes"])
        self.assertEqual(at_limit["how_answered"]["pattern"], "coherent_within_tolerance")
        over = scored("t6-01", COHERENT | {"east.keeps_bond": base - 0.67})
        self.assertFalse(over["session_passes"])
        self.assertEqual(over["dominance_violations"], 0)

    def test_unusable_answers_and_the_ninety_percent_rule(self):
        self.assertEqual(score.MIN_ANSWERED, 30)
        raw = numbered("t6-02", COHERENT)
        raw[1], raw[2], raw[3], raw[4] = 1.2, -0.1, "likely", True
        raw[5] = "0.25"
        r = score.score_answers("t6-02", raw)
        self.assertEqual(r["answered"], 29)
        self.assertFalse(r["complete"])
        self.assertFalse(r["session_passes"])
        self.assertEqual(len(r["answer_problems"]), 4)
        raw[4] = 0.5
        self.assertTrue(score.score_answers("t6-02", raw)["complete"])

    def test_checks_with_a_missing_answer_are_not_evaluated(self):
        answers = dict(COHERENT)
        del answers["east.drawn"]
        r = scored("t6-03", answers)
        self.assertEqual(r["answered"], 32)
        self.assertEqual(r["additive_checks_evaluated"], 12)
        self.assertEqual(r["dominance_checks_evaluated"], 16)
        self.assertTrue(r["session_passes"])

    def test_the_same_number_everywhere_is_named_and_fails(self):
        r = scored("t6-04", {k: 0.5 for k in COHERENT})
        self.assertEqual(r["how_answered"]["pattern"], "same_number_for_every_question")
        self.assertAlmostEqual(r["mean_absolute_deviation"], 2 / 13, places=6)
        self.assertFalse(r["session_passes"])


class Verdict(unittest.TestCase):
    def setUp(self):
        rng = random.Random(4)
        self.noise = {k: round(rng.random(), 4) for k in COHERENT}

    def test_six_coherent_sessions_pass(self):
        v = score.verdict([scored(sid, COHERENT) for sid in IDS])
        self.assertEqual(v["verdict"], "pass")
        self.assertEqual(v["sessions_passing"], 6)
        self.assertEqual(v["spread_across_sessions"]["median_range"], 0.0)

    def test_five_of_six_pass(self):
        v = score.verdict([scored(sid, COHERENT) for sid in IDS[:5]] + [scored(IDS[5], self.noise)])
        self.assertEqual(v["verdict"], "pass")
        self.assertEqual(v["sessions_passing"], 5)
        self.assertEqual(v["session_pass_rate"]["ci95"], kit.clopper_pearson(5, 6))
        self.assertGreater(v["spread_across_sessions"]["median_range"], 0.0)

    def test_four_of_six_fail(self):
        v = score.verdict([scored(sid, COHERENT) for sid in IDS[:4]] + [scored(sid, self.noise) for sid in IDS[4:]])
        self.assertEqual(v["verdict"], "fail")
        self.assertEqual(v["sessions_with_a_dominance_violation"], 2)

    def test_five_complete_sessions_must_all_pass(self):
        v = score.verdict([scored(sid, COHERENT) for sid in IDS[:5]])
        self.assertEqual(v["verdict"], "pass")
        v = score.verdict([scored(sid, COHERENT) for sid in IDS[:4]] + [scored(IDS[4], self.noise)])
        self.assertEqual(v["verdict"], "fail")

    def test_too_few_complete_sessions_is_incomplete(self):
        few = {k: v for k, v in list(COHERENT.items())[:20]}
        v = score.verdict([scored(sid, COHERENT) for sid in IDS[:4]] + [scored(IDS[4], few),
                                                                       score.collect(IDS[5], Path("/nonexistent-root"))])
        self.assertEqual(v["verdict"], "incomplete")
        self.assertEqual(v["incomplete_ids"], IDS[4:])

    def test_by_check_summary(self):
        slip = COHERENT | {"north.both": COHERENT["north.forfeit"] + 0.02}
        v = score.verdict([scored(sid, slip) for sid in IDS])
        row = next(r for r in v["by_check"] if r["check_id"] == "north#3")
        self.assertEqual(row["sessions_violating"], 6)
        self.assertEqual(v["verdict"], "fail")

    def test_report_is_a_short_table(self):
        text = score.report([scored(sid, COHERENT) for sid in IDS])
        self.assertIn("verdict: pass", text)
        self.assertLess(len(text.splitlines()), 14)


class Pipeline(unittest.TestCase):
    def test_prepare_collect_round_trip(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            target = session.prepare("t6-03", root)
            self.assertEqual(sorted(p.name for p in target.iterdir()), ["TASK.md", "questions.md"])
            with self.assertRaises(session.SessionError):
                session.prepare("t6-03", root)
            self.assertFalse(score.collect("t6-03", root)["complete"])
            controls.act("coherent", target)
            (target / "model.py").write_text("# a subject's script\n")
            r = score.collect("t6-03", root)
            self.assertTrue(r["session_passes"])
            self.assertEqual(r["how_answered"]["script_files_left_behind"], ["model.py"])
            self.assertEqual(r["given_files_unchanged"], {"TASK.md": True, "questions.md": True})

    def test_controls_behave_as_declared(self):
        with tempfile.TemporaryDirectory() as d:
            doc = controls.dryrun(Path(d) / "t6", benchmark_runs=50, noisy_runs=3)
        self.assertTrue(doc["controls_behave_as_declared"])
        self.assertEqual(doc["controls"]["coherent"]["verdict"], "pass")
        self.assertEqual(doc["controls"]["random"]["verdict"], "fail")
        self.assertEqual(doc["controls"]["rounded"]["verdict"], "pass")
        self.assertEqual(doc["controls"]["conjunction_slip"]["dominance_violations"]["k"], 6)
        self.assertEqual(doc["random_benchmark"]["single_sessions_that_pass"], 0)

    def test_the_coherent_agent_holds_proper_distributions(self):
        for key, belief in controls.BELIEFS.items():
            if "per_run" in belief:
                self.assertTrue(0 < belief["per_run"] < 1)
            else:
                self.assertEqual(sum(belief.values()), 1, key)
                self.assertEqual(sorted(belief), sorted(design.scenario(key)["atoms"]))
        self.assertEqual(controls.coherent_answers()["dock.skipped"], F(1, 25))

    def test_build_check(self):
        env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
        for script in ("design.py", "cli.py"):
            done = subprocess.run([sys.executable, str(HERE / script), "build", "--check"],
                                  capture_output=True, text=True, env=env)
            self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
            self.assertNotIn("DIFFERS", done.stdout)

    def test_build_check_notices_a_change(self):
        outputs = design.outputs()
        with tempfile.TemporaryDirectory() as d, contextlib.redirect_stdout(io.StringIO()):
            copy = {Path(d) / p.relative_to(HERE): text for p, text in outputs.items()}
            self.assertEqual(kit.write_or_check(copy, False, Path(d)), 0)
            self.assertEqual(kit.write_or_check(copy, True, Path(d)), 0)
            first = sorted(copy)[0]
            first.write_text(first.read_text() + " ")
            self.assertEqual(kit.write_or_check(copy, True, Path(d)), 1)


if __name__ == "__main__":
    unittest.main()
