from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = (
    Path(__file__).resolve().parents[1] / "scripts" / "check_atlas_coverage.py"
)
SPEC = importlib.util.spec_from_file_location("check_atlas_coverage", SCRIPT)
assert SPEC and SPEC.loader
coverage = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = coverage
SPEC.loader.exec_module(coverage)


class AtlasCoverageTests(unittest.TestCase):
    def test_strip_tex_comments_preserves_escaped_percent(self) -> None:
        source = "value \\% stays % comment goes\n\\label{fig:x}\n"
        self.assertEqual(
            coverage.strip_tex_comments(source),
            "value \\% stays \n\\label{fig:x}\n",
        )

    def test_walk_tex_follows_nested_inputs_once(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "sections").mkdir()
            (root / "root.tex").write_text(
                "\\input{sections/a}\n\\input{sections/a}\n", encoding="utf-8"
            )
            (root / "sections/a.tex").write_text(
                "\\include{b}\n", encoding="utf-8"
            )
            (root / "sections/b.tex").write_text("body\n", encoding="utf-8")
            walked = coverage.walk_tex(root / "root.tex")
            self.assertEqual(
                [path.name for path, _ in walked], ["root.tex", "a.tex", "b.tex"]
            )

    def test_walk_tex_fails_closed_on_unsupported_exhibit_environment(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for environment in ("wrapfigure", "sidewaysfigure", "algorithm"):
                with self.subTest(environment=environment):
                    source = root / f"{environment}.tex"
                    source.write_text(
                        f"\\begin{{{environment}}}x\\end{{{environment}}}\n",
                        encoding="utf-8",
                    )
                    with self.assertRaisesRegex(
                        ValueError, "unsupported TeX construct"
                    ):
                        coverage.walk_tex(source)

    def test_walk_tex_fails_closed_on_unsupported_inclusion_directive(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            directives = (
                "subfile",
                "import",
                "subimport",
                "inputfrom",
                "subinputfrom",
                "includefrom",
                "subincludefrom",
            )
            for directive in directives:
                with self.subTest(directive=directive):
                    source = root / f"{directive}.tex"
                    source.write_text(f"\\{directive}{{chapter}}\n", encoding="utf-8")
                    with self.assertRaisesRegex(
                        ValueError, "unsupported TeX construct"
                    ):
                        coverage.walk_tex(source)

    def test_figure_label_prefers_source_label(self) -> None:
        block = "\\caption{Example}\\label{fig:example}"
        self.assertEqual(coverage.figure_label(block, Path("paper.tex")), "fig:example")

    def test_figure_label_accepts_algorithm_listing_label(self) -> None:
        block = "\\begin{lstlisting}[label={alg:acquire}] code \\end{lstlisting}"
        self.assertEqual(coverage.figure_label(block, Path("paper.tex")), "alg:acquire")

    def test_figure_label_rejects_unlabeled_environment(self) -> None:
        with self.assertRaisesRegex(ValueError, "unlabeled figure"):
            coverage.figure_label("\\caption{No label}", Path("paper.tex"))

    def test_compare_reports_missing_stale_and_duplicates(self) -> None:
        figures = [
            coverage.SourceFigure("I/fig:a", Path("a.tex")),
            coverage.SourceFigure("I/fig:b", Path("b.tex")),
        ]
        report = coverage.compare(figures, ["I/fig:a", "I/fig:a", "I/fig:stale"])
        self.assertEqual(report["missing_from_atlas"], ["I/fig:b"])
        self.assertEqual(report["stale_in_atlas"], ["I/fig:stale"])
        self.assertEqual(report["duplicate_atlas_ids"], ["I/fig:a"])
        self.assertFalse(coverage.is_clean(report))

    def test_atlas_row_requires_all_five_semantic_fields(self) -> None:
        row = coverage.parse_atlas_row(
            "| `I/fig:x` | question | grammar | must encode |  |", 7
        )
        self.assertEqual(
            coverage.incomplete_atlas_rows([row]), ["I/fig:x:reject"]
        )

    def test_canonical_root_sets_match_build_and_mega_inputs(self) -> None:
        repo_root = Path(__file__).resolve().parents[3]
        self.assertEqual(coverage.canonical_root_drift(repo_root), [])

    def test_canonical_root_parity_rejects_swapped_volume_mapping(self) -> None:
        repo_root = Path(__file__).resolve().parents[3]
        swapped = dict(coverage.CANONICAL_ROOTS)
        swapped["I"], swapped["II"] = swapped["II"], swapped["I"]
        drift = coverage.canonical_root_drift(repo_root, swapped)
        self.assertTrue(any(item.startswith("mega-generator:I:") for item in drift))
        self.assertTrue(any(item.startswith("mega-generator:II:") for item in drift))

    def test_live_atlas_covers_all_canonical_sources(self) -> None:
        repo_root = Path(__file__).resolve().parents[3]
        figures = coverage.extract_source_figures(repo_root)
        atlas = (
            repo_root
            / "skills/whitepaper-figure-system/references/semantic-figure-atlas.md"
        )
        rows = coverage.extract_atlas_rows(atlas)
        atlas_ids = [row.atlas_id for row in rows]
        report = coverage.compare(
            figures,
            atlas_ids,
            atlas_row_issues=coverage.incomplete_atlas_rows(rows),
            root_drift=coverage.canonical_root_drift(repo_root),
        )
        self.assertEqual(report["source_count"], 81)
        self.assertEqual(report["atlas_count"], 81)
        self.assertTrue(coverage.is_clean(report), report)

        for removed in atlas_ids:
            with self.subTest(removed=removed):
                missing_one = coverage.compare(
                    figures,
                    [atlas_id for atlas_id in atlas_ids if atlas_id != removed],
                )
                self.assertFalse(coverage.is_clean(missing_one))
                self.assertEqual(missing_one["missing_from_atlas"], [removed])


if __name__ == "__main__":
    unittest.main()
