"""Measured cells and epistemic boundaries for one Book figure, not runtime proof."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
FIGURE = ROOT / "whitepaper/figures/fig-swk-idempotency-gap.tex"
DATA = ROOT / "docs/harbor-research/experiments/receipt-gap-20260920/experiment-results.json"
OBSERVED_SHA = "e93863430b6b09d7845aa637304e719114e60c9444529deb3fc1ed6cadbc7a38"
POLICIES = ("journal_retry", "journal_hold", "receiver_dedup")
CUTS = ("none", "before_effect", "after_effect", "after_receipt")


def groups(text):
    result, depth, start, escaped = [], 0, None, False
    for index, char in enumerate(text):
        if escaped:
            escaped = False
        elif char == "\\":
            escaped = True
        elif char == "{":
            if depth == 0:
                start = index + 1
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                result.append(text[start:index])
            if depth < 0:
                raise ValueError("Unbalanced TeX")
    if depth:
        raise ValueError("Unclosed TeX")
    return result


def observed_cells(data):
    cases = data["primary_cases"]
    expected = {(p, c) for p in POLICIES for c in CUTS}
    actual = [(case["policy"], case["cut"]) for case in cases]
    if len(actual) != 12 or len(set(actual)) != 12 or set(actual) != expected:
        raise ValueError("Need exactly the 12 enumerated primary cases")
    cells = {}
    for case in cases:
        state = case["after_recovery"]
        if state["units"] != 10 * state["effect_count"]:
            raise ValueError("Synthetic unit/count mismatch")
        cells[(case["policy"], case["cut"])] = (
            state["effect_count"], state["local"][0][1])
    return cells


def figure_cells(source):
    cells, cuts = {}, []
    for line in source.splitlines():
        if not line.strip().startswith(r"\RGRow{"):
            continue
        row = groups(line)
        if len(row) != 6:
            raise ValueError("Malformed result row")
        cut = row[0]
        cuts.append(cut)
        for policy, cell in zip(POLICIES, row[3:]):
            # Retain values while removing only presentational wrappers.
            cell = re.sub(r"\\textcolor\{[^}]+\}", "", cell)
            cell = cell.replace(r"\textbf", "").replace("{", "").replace("}", "")
            match = re.fullmatch(r"(\d+) / (done|pending)", cell)
            if not match:
                raise ValueError("Unknown result-cell grammar: " + cell)
            cells[(policy, cut)] = (int(match[1]), match[2])
    if tuple(cuts) != CUTS:
        raise ValueError("Missing, duplicate or reordered crash schedules")
    return cells


def check_witness(data):
    indexed = {(c["policy"], c["cut"]): c for c in data["primary_cases"]}
    for policy in POLICIES:
        left = indexed[(policy, "before_effect")]["before_recovery"]
        right = indexed[(policy, "after_effect")]["before_recovery"]
        if left["local"] != right["local"] or left["local"][0][1:] != ["pending", None]:
            raise ValueError("The local records are not indistinguishable")
        if (left["effect_count"], right["effect_count"]) != (0, 1):
            raise ValueError("The two histories must conceal distinct outcomes")


class ReceiptGapFigureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = FIGURE.read_text()
        cls.raw = DATA.read_bytes()
        cls.data = json.loads(cls.raw)

    def test_all_twelve_cells_come_from_the_retained_observations(self):
        self.assertEqual(hashlib.sha256(self.raw).hexdigest(), OBSERVED_SHA)
        self.assertEqual(figure_cells(self.source), observed_cells(self.data))

    def test_two_histories_have_equal_local_records_and_distinct_effects(self):
        check_witness(self.data)
        self.assertEqual(self.source.count(r"{78}{40}{white}{pending\\no receipt}"), 2)
        for required in ("{0 effects}", "{1 effect}", "{sender\\\\intent}",
                         "{receiver\\\\effect}", "{sender\\\\receipt}", "{order only}"):
            self.assertIn(required, self.source)

    def test_false_success_and_unresolved_outcomes_are_not_conflated(self):
        cells = observed_cells(self.data)
        self.assertEqual(cells[("journal_retry", "after_effect")], (2, "done"))
        self.assertEqual(cells[("journal_hold", "before_effect")], (0, "pending"))
        self.assertEqual(cells[("journal_hold", "after_effect")], (1, "pending"))
        for cut in CUTS:
            self.assertEqual(cells[("receiver_dedup", cut)], (1, "done"))

    def test_lies_in_cells_and_witness_are_rejected(self):
        false = self.source.replace(r"\textbf{2} / done", r"\textbf{1} / done")
        self.assertNotEqual(figure_cells(false), observed_cells(self.data))
        false = self.source.replace("{0 / pending}", "{0 / done}")
        self.assertNotEqual(figure_cells(false), observed_cells(self.data))
        false = "\n".join(line for line in self.source.splitlines()
                          if not line.strip().startswith(r"\RGRow{before_effect}"))
        with self.assertRaises(ValueError):
            figure_cells(false)
        false_data = copy.deepcopy(self.data)
        case = next(c for c in false_data["primary_cases"]
                    if c["policy"] == "journal_retry" and c["cut"] == "after_effect")
        case["before_recovery"]["local"][0][2] = 1
        with self.assertRaises(ValueError):
            check_witness(false_data)
        false_data = copy.deepcopy(self.data)
        false_data["primary_cases"].pop()
        with self.assertRaises(ValueError):
            observed_cells(false_data)

    def test_scope_and_native_figure_contract(self):
        for required in ("Twelve local SQLite cases", "not a Port Daddy test",
                         "atomically retains", "key, payload, effect and receipt",
                         r"\SGMeasuredFigure{swk-idempotency-gap}"):
            self.assertIn(required, self.source)
        for forbidden in (r"\resizebox", r"\scalebox", r"\tiny", r"\scriptsize"):
            self.assertNotIn(forbidden, self.source)
        chapter = (ROOT / "whitepaper/single-writer-kernel.tex").read_text()
        self.assertIn("not arbitrary tools, key expiry or power loss", chapter)
        self.assertIn("Message identifiers and replay guards do not by themselves", chapter)

    @unittest.skipUnless(os.environ.get("BOOK_RECEIPT_PDF"), "assembled Book not supplied")
    def test_actual_page_contains_both_histories_and_all_outcome_rows(self):
        import fitz
        pdf = Path(os.environ["BOOK_RECEIPT_PDF"])
        aux = pdf.with_suffix(".aux").read_text()
        line = next(line for line in aux.splitlines()
                    if line.startswith(r"\newlabel{swk:fig:swk-idempotency-gap}"))
        fields = groups(groups(line)[1])
        with fitz.open(pdf) as book:
            page = book[book.resolve_names()[fields[3]]["page"]]
            self.assertEqual(page.get_label(), fields[1])
            text = " ".join(page.get_text().split())
            for required in ("Before recovery", "0 effects", "1 effect", "2 / done",
                             "0 / pending", "1 / pending", "After receipt"):
                self.assertIn(required, text)
            self.assertEqual(text.count("no receipt"), 2)

    @unittest.skipUnless("BOOK_FIGURE_EXPECTED_MIGRATION" in os.environ or
                         (os.environ.get("BOOK_RECEIPT_PDF") and
                          os.environ.get("BOOK_RECEIPT_BEFORE_AUX")), "before/after Book not supplied")
    def test_no_number_or_anchor_changes_in_this_batch(self):
        migration_path = os.environ.get("BOOK_FIGURE_EXPECTED_MIGRATION")
        if migration_path is not None:
            self.assertTrue(migration_path.strip(), "Explicit migration path is empty")
            self.assertTrue(os.environ.get("BOOK_RECEIPT_PDF") and os.environ.get("BOOK_RECEIPT_BEFORE_AUX"),
                            "Explicit migration requires before AUX and after Book PDF paths")
        spec = importlib.util.spec_from_file_location("gate", ROOT /
            "scripts/harbor-research/check_book_label_migration.py")
        gate = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(gate)
        before = Path(os.environ["BOOK_RECEIPT_BEFORE_AUX"]).read_bytes()
        after = Path(os.environ["BOOK_RECEIPT_PDF"]).with_suffix(".aux").read_bytes()
        if migration_path is not None:
            report = json.loads(Path(migration_path).read_text())
        else:
            signature = gate.signatures(before)
            report = dict(baseline_aux_sha256=hashlib.sha256(before).hexdigest(),
                          before=signature, after=signature, unresolved={},
                          insertions=[], shifts=[], inserted_records=[])
        verdict = gate.audit(before, after, report)
        self.assertTrue(verdict["ok"], verdict["failures"])


if __name__ == "__main__":
    unittest.main()
