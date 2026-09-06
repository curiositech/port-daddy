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
    @staticmethod
    def live_atlas(repo_root: Path) -> Path:
        return (
            repo_root
            / "skills/whitepaper-figure-system/references/semantic-figure-atlas.md"
        )

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
        roots = coverage.canonical_roots_from_textbook(repo_root)
        self.assertEqual(len(roots), 8)
        self.assertEqual(coverage.canonical_root_drift(repo_root, roots), [])

    def test_canonical_root_parity_rejects_swapped_volume_mapping(self) -> None:
        repo_root = Path(__file__).resolve().parents[3]
        swapped = coverage.extract_atlas_volume_roots(self.live_atlas(repo_root))
        swapped["I"], swapped["II"] = swapped["II"], swapped["I"]
        drift = coverage.canonical_root_drift(repo_root, swapped)
        self.assertTrue(any(item.startswith("mega-generator:I:") for item in drift))
        self.assertTrue(any(item.startswith("mega-generator:II:") for item in drift))

    def test_atlas_roots_reject_duplicate_or_noncanonical_declarations(self) -> None:
        canonical = ["I", "II", "III", "IV", "V", "VI", "VII"]
        unique_paths = [f"paper-{index}.tex" for index in range(7)]
        cases = {
            "duplicate-volume": (canonical + ["I"], unique_paths + ["paper-8.tex"]),
            "wrong-volume-set": (canonical[:-1] + ["VIII"], unique_paths),
            "duplicate-root-path": (canonical, unique_paths[:-1] + [unique_paths[0]]),
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, (volumes, paths) in cases.items():
                with self.subTest(name=name):
                    atlas = root / f"{name}.md"
                    atlas.write_text(
                        "\n".join(
                            f"## Volume {volume}: Paper\n\n"
                            f"Canonical root: `{path}`"
                            for volume, path in zip(volumes, paths, strict=True)
                        ),
                        encoding="utf-8",
                    )
                    with self.assertRaisesRegex(ValueError, "exactly one canonical root"):
                        coverage.extract_atlas_volume_roots(atlas)

    def test_reuse_contract_parser_rejects_malformed_candidate_row(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            atlas = Path(directory) / "atlas.md"
            atlas.write_text(
                "## Cross-volume reuse contracts\n\n"
                "| Contract | Members | Requirement |\n"
                "|---|---|---|\n"
                "| Valid | `I/fig:a`, `II/fig:b` | same relation |\n"
                "| Malformed | only two fields |\n",
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ValueError, "expected exactly 3"):
                coverage.extract_reuse_contracts(atlas)

    def test_reuse_contract_parser_rejects_blank_or_partial_cells(self) -> None:
        invalid_rows = (
            "| | `I/fig:a`, `II/fig:b` | same relation |",
            "| Mixed | `I/fig:a`, `II/fig:b`, bogus-token | same relation |",
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for index, invalid in enumerate(invalid_rows):
                with self.subTest(invalid=invalid):
                    atlas = root / f"invalid-{index}.md"
                    atlas.write_text(
                        "## Cross-volume reuse contracts\n\n"
                        "| Contract | Members | Requirement |\n"
                        "|---|---|---|\n"
                        f"{invalid}\n",
                        encoding="utf-8",
                    )
                    with self.assertRaisesRegex(ValueError, "blank|invalid members"):
                        coverage.extract_reuse_contracts(atlas)

    def test_reuse_contracts_require_live_atlas_and_source_members(self) -> None:
        contracts = [
            coverage.ReuseContract(
                "Shared view", ("I/fig:a", "II/fig:b"), "same typed relation"
            )
        ]
        self.assertEqual(
            coverage.reuse_contract_issues(
                contracts,
                ["I/fig:a", "II/fig:b"],
                ["I/fig:a", "II/fig:b"],
            ),
            [],
        )
        self.assertEqual(
            coverage.reuse_contract_issues(
                contracts,
                ["I/fig:a"],
                ["I/fig:a", "II/fig:b"],
            ),
            ["Shared view:member-missing-from-atlas=II/fig:b"],
        )

    def test_reuse_contracts_reject_same_volume_and_structural_gaps(self) -> None:
        contracts = [
            coverage.ReuseContract("Local only", ("I/fig:a", "I/fig:b"), "same"),
            coverage.ReuseContract("Single", ("II/fig:c",), ""),
            coverage.ReuseContract(
                "Duplicate member", ("III/fig:d", "III/fig:d"), "same"
            ),
        ]
        issues = coverage.reuse_contract_issues(
            contracts,
            ["I/fig:a", "I/fig:b", "II/fig:c", "III/fig:d"],
            ["I/fig:a", "I/fig:b", "II/fig:c"],
        )
        for expected in (
            "Local only:not-cross-volume",
            "Single:fewer-than-two-members",
            "Single:missing-requirement",
            "Single:not-cross-volume",
            "Duplicate member:duplicate-member",
            "Duplicate member:member-missing-from-source=III/fig:d",
        ):
            with self.subTest(expected=expected):
                self.assertIn(expected, issues)

    def test_live_atlas_covers_all_canonical_sources(self) -> None:
        repo_root = Path(__file__).resolve().parents[3]
        atlas = self.live_atlas(repo_root)
        roots = coverage.extract_atlas_volume_roots(atlas)
        figures = coverage.extract_source_figures(repo_root, roots)
        rows = coverage.extract_atlas_rows(atlas)
        atlas_ids = [row.atlas_id for row in rows]
        source_ids = [figure.atlas_id for figure in figures]
        contracts = coverage.extract_reuse_contracts(atlas)
        report = coverage.compare(
            figures,
            atlas_ids,
            atlas_row_issues=coverage.incomplete_atlas_rows(rows),
            root_drift=coverage.canonical_root_drift(repo_root, roots),
            reuse_issues=coverage.reuse_contract_issues(
                contracts, atlas_ids, source_ids
            ),
        )
        self.assertEqual(report["source_count"], 66)
        self.assertEqual(report["atlas_count"], 87)
        self.assertEqual(len(contracts), 8)
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
