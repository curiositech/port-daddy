"""Arithmetic and model boundary of the payload illustration; not a C1 extension."""
import hashlib
import importlib.util
import itertools
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
FIGURE = ROOT / "website-v2/public/whitepaper/figures/fig-sealed-laundering-fork.tex"
MODEL = ROOT / "skills/harbor-results/scripts/c1_noninterference.py"
MODEL_SHA = "f4e663d3b1bd96bff2d5bbe1304263feae7ab65c028eb85ca8689dee63d15f1b"


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


def record_pairs(source):
    pairs = {}
    for line in source.splitlines():
        if line.strip().startswith(r"\SGDocument{"):
            row = groups(line)
            if len(row) != 6 or row[0] in pairs:
                raise ValueError("Malformed or repeated record")
            match = re.search(r"\((\d+),(\d+)\)", row[-1])
            if not match:
                raise ValueError("Missing world pair")
            pairs[row[0]] = tuple(map(int, match.groups()))
    return pairs


def expected_pairs():
    secrets = (0, 2)
    transformed = tuple(s // 2 for s in secrets)
    return {"original": secrets, "directOut": tuple(s % 2 for s in secrets),
            "transformed": transformed, "changedOut": tuple(t % 2 for t in transformed)}


class LaunderingFigureTests(unittest.TestCase):
    def test_records_encode_exact_arithmetic_in_world_order(self):
        self.assertEqual(record_pairs(FIGURE.read_text()), expected_pairs())

    def test_pair_counterexample_and_nonleaking_controls(self):
        equal_parity = [(a, b) for a, b in itertools.combinations(range(4), 2)
                        if a % 2 == b % 2]
        self.assertEqual(equal_parity, [(0, 2), (1, 3)])
        for a, b in equal_parity:
            self.assertNotEqual((a // 2) % 2, (b // 2) % 2)
            for safe_transform in (lambda s: s, lambda s: s % 2, lambda s: 0):
                self.assertEqual(safe_transform(a) % 2, safe_transform(b) % 2)
        # Nonconstant is not sufficient for laundering: identity is nonconstant.
        self.assertEqual(len(set(range(4))), 4)

    def test_wrong_pairs_or_duplicate_records_cannot_pass(self):
        source = FIGURE.read_text()
        for lie in (source.replace("$(0,0)$", "$(0,1)$"),
                    source.replace("$(0,2)$", "$(2,0)$"),
                    source.replace("$(0,1)$", "$(0,0)$")):
            self.assertNotEqual(record_pairs(lie), expected_pairs())
        with self.assertRaises(ValueError):
            record_pairs(source + "\n" + next(line for line in source.splitlines()
                                               if r"\SGDocument{original}" in line))

    def test_same_gate_and_explicit_model_limit_at_native_size(self):
        source = FIGURE.read_text()
        self.assertEqual(source.count(r"{$g(x)$\\$x\bmod2$}"), 2)
        for required in (r"\SGMeasuredFigure{sealed-laundering-fork}",
                         r"$t=f(s)=\lfloor s/2\rfloor$", r"$(A,B)$",
                         r"\texttt{submit} has no payload",
                         "outside C1's committed-input model", r"$0=0$", r"$0\ne1$"):
            self.assertIn(required, source)
        for forbidden in (r"\resizebox", r"\scalebox", r"\tiny", r"\scriptsize"):
            self.assertNotIn(forbidden, source)
        chapter = (ROOT / "website-v2/public/whitepaper/sealed-harbor.tex").read_text()
        self.assertIn("counterexample to the current model", chapter)
        self.assertIn("This is an arithmetic illustration", chapter)

    def test_original_finite_checker_is_unchanged_and_still_catches_its_mutants(self):
        self.assertEqual(hashlib.sha256(MODEL.read_bytes()).hexdigest(), MODEL_SHA)
        result = subprocess.run([sys.executable, "-B", str(MODEL)], capture_output=True,
                                text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        for expected in ("structure check (schedule independent of secret): PASS",
                         "noninterference modulo declassification: HOLDS",
                         "[m1 leaky gate: releases raw s]   caught:",
                         "[m2 worker bypasses the gate]     caught:",
                         "mutations reverted: noninterference restored"):
            self.assertIn(expected, result.stdout)

    @unittest.skipUnless(os.environ.get("BOOK_PAYLOAD_PDF"), "assembled Book not supplied")
    def test_final_page_contains_both_inputs_outputs_and_model_boundary(self):
        import fitz
        path = Path(os.environ["BOOK_PAYLOAD_PDF"])
        aux = path.with_suffix(".aux").read_text()
        line = next(line for line in aux.splitlines()
                    if line.startswith(r"\newlabel{sealed:fig:sealed-laundering-fork}"))
        fields = groups(groups(line)[1])
        with fitz.open(path) as book:
            page = book[book.resolve_names()[fields[3]]["page"]]
            self.assertEqual(page.get_label(), fields[1])
            text = " ".join(page.get_text().split())
            for expected in ("Committed input", "Worker computes", "Same gate",
                             "Current C1:", "has no payload", "Erin sees"):
                self.assertIn(expected, text)
            for pair, count in (("(0,2)", 1), ("(0,0)", 1), ("(0,1)", 2)):
                self.assertGreaterEqual(text.replace(" ", "").count(pair), count)

    @unittest.skipUnless("BOOK_FIGURE_EXPECTED_MIGRATION" in os.environ or
                         (os.environ.get("BOOK_PAYLOAD_PDF") and
                          os.environ.get("BOOK_PAYLOAD_BEFORE_AUX")), "before/after Book not supplied")
    def test_batch_keeps_all_numbers_and_anchors(self):
        migration_path = os.environ.get("BOOK_FIGURE_EXPECTED_MIGRATION")
        if migration_path is not None:
            self.assertTrue(migration_path.strip(), "Explicit migration path is empty")
            self.assertTrue(os.environ.get("BOOK_PAYLOAD_PDF") and os.environ.get("BOOK_PAYLOAD_BEFORE_AUX"),
                            "Explicit migration requires before AUX and after Book PDF paths")
        spec = importlib.util.spec_from_file_location("gate", ROOT /
            "scripts/harbor-research/check_book_label_migration.py")
        gate = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(gate)
        before = Path(os.environ["BOOK_PAYLOAD_BEFORE_AUX"]).read_bytes()
        after = Path(os.environ["BOOK_PAYLOAD_PDF"]).with_suffix(".aux").read_bytes()
        if migration_path is not None:
            report = json.loads(Path(migration_path).read_text())
        else:
            signatures = gate.signatures(before)
            report = dict(baseline_aux_sha256=hashlib.sha256(before).hexdigest(),
                          before=signatures, after=signatures, unresolved={},
                          insertions=[], shifts=[], inserted_records=[])
        result = gate.audit(before, after, report)
        self.assertTrue(result["ok"], result["failures"])


if __name__ == "__main__":
    unittest.main()
