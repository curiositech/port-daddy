"""Explicit editorial declarations must never turn title guesses into waivers."""
import io
import json
from contextlib import redirect_stderr, redirect_stdout

from test_chapter_lint import RepoFixtureTestCase, chapter_lint, write


class TestApparatusMetrics(RepoFixtureTestCase):
    def declaration(self, **selector):
        return {**selector, "role": "review", "reason": "Author-declared closing retrieval prompts"}

    def metadata(self, chapters):
        return write(self.fixture.root / "apparatus.json", json.dumps({"version": 1, "chapters": chapters}))

    def run_cli(self, chapter, *flags):
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            return chapter_lint.main([str(chapter), "--repo-root", str(self.fixture.root), *flags])

    def test_front_matter_is_excluded_from_examples_and_opener_only_when_declared(self):
        source = self.fixture.chapter(r"""\section{A map}\label{sec:map}
\begin{table}map\end{table}
\section{Body} A scene. \begin{pdexample}{One}x\end{pdexample}
\section{Review} Prompts.
""")
        bare = chapter_lint.build_report(source)
        self.assertFalse(bare.floors["worked_example_per_section"]["ok"])
        self.assertFalse(bare.floors["chapter_opener_and_claim_labeling"]["ok"])
        report = chapter_lint.build_report(source, [
            {"label": "sec:map", "role": "front-matter", "reason": "Author-declared navigation"},
            self.declaration(title="Review"),
        ])
        floor = report.floors["worked_example_per_section"]
        self.assertTrue(floor["ok"])
        self.assertEqual((floor["body_sections"], floor["apparatus_sections"]), (1, 2))
        self.assertTrue(report.floors["chapter_opener_and_claim_labeling"]["ok"])
        self.assertEqual([r["role"] for r in report.section_metrics], ["front-matter", "body", "review"])

    def test_no_heading_or_app_namespace_implicitly_exempts_core_teaching(self):
        source = self.fixture.chapter(r"""\section{Threat Model}\label{app:threat}
Security argument.
\section{Conclusion} Derivation.
\section{History and references} Mechanism.
\section{Exercises} Problem solution.
""")
        report = chapter_lint.build_report(source)
        self.assertEqual(report.floors["worked_example_per_section"]["body_sections"], 4)
        self.assertTrue(all(row["role"] == "body" for row in report.section_metrics))

    def test_same_title_apparatus_cannot_lend_example_to_body(self):
        source = self.fixture.chapter(r"""\section{One}\label{sec:body} No example.
\section{One}\label{sec:review}\begin{pdexample}{R}x\end{pdexample}
""")
        report = chapter_lint.build_report(source, [self.declaration(label="sec:review")])
        self.assertFalse(report.floors["worked_example_per_section"]["ok"])
        self.assertEqual([r["worked_examples"] for r in report.section_metrics], [0, 1])

    def test_all_apparatus_or_no_sections_never_vacuously_pass(self):
        source = self.fixture.chapter(r"\section{Review} Prompts.")
        report = chapter_lint.build_report(source, [self.declaration(title="Review")])
        self.assertFalse(report.floors["worked_example_per_section"]["ok"])
        self.assertFalse(report.floors["chapter_opener_and_claim_labeling"]["ok"])
        self.assertFalse(chapter_lint.build_report(self.fixture.chapter("No sections.")).floors["worked_example_per_section"]["ok"])

    def test_claim_honesty_still_applies_inside_apparatus(self):
        source = self.fixture.chapter(r"""\section{Body} Scene.\begin{pdexample}{B}x\end{pdexample}
\section{Review}\begin{theorem}Unlabelled truth.\end{theorem}
""")
        report = chapter_lint.build_report(source, [self.declaration(title="Review")])
        self.assertFalse(report.floors["claims_carry_epistemic_kind"]["ok"])

    def test_invalid_or_stale_declarations_fail_closed(self):
        source = self.fixture.chapter(r"""\section{One}\label{sec:one} Body.
\subsection{Child}\label{sub:child} Body.
\label{eq:inside}
\section{Two} Body.
\section{Two} Body.
""")
        invalid = [
            [self.declaration(label="missing")],
            [self.declaration(title="Two")],
            [self.declaration(label="sub:child")],
            [self.declaration(label="eq:inside")],
            [self.declaration(label="sec:one"), self.declaration(title="One")],
            [{"title": "One", "role": "guess", "reason": "X"}],
            [{"title": "One", "role": "review", "reason": ""}],
            [{"title": "One", "label": "sec:one", "role": "review", "reason": "X"}],
        ]
        for entries in invalid:
            with self.subTest(entries=entries), self.assertRaises(ValueError):
                chapter_lint.build_report(source, entries)

    def test_inline_label_and_comments_are_handled_structurally(self):
        source = self.fixture.chapter(r"""\section{Review\label{sec:review}} Prompt.
% \section{Fake}\label{fake}
\section{Body}% comment
\label{sec:body}
Scene.\begin{pdexample}{B}x\end{pdexample}
""")
        report = chapter_lint.build_report(source, [self.declaration(label="sec:review")])
        self.assertTrue(report.floors["worked_example_per_section"]["ok"])
        self.assertEqual(report.section_metrics[1]["labels"], ["sec:body"])

    def test_symlink_source_alias_resolves_to_same_declarations(self):
        source = self.fixture.chapter(r"\section{Review} Prompts.")
        alias = self.fixture.root / "alias.tex"
        alias.symlink_to(source)
        metadata = self.metadata({"whitepaper/chapter.tex": [self.declaration(title="Review")]})
        with redirect_stdout(io.StringIO()) as out:
            self.assertEqual(chapter_lint.main([str(alias), "--repo-root", str(self.fixture.root), "--apparatus", str(metadata), "--json"]), 0)
        self.assertEqual(json.loads(out.getvalue())["section_metrics"][0]["role"], "review")

    def test_metadata_error_ignores_generous_failure_budget(self):
        source = self.fixture.chapter(r"\section{Body} Prose.")
        metadata = self.metadata({"whitepaper/chapter.tex": [self.declaration(title="Removed")]})
        self.assertEqual(self.run_cli(source, "--apparatus", str(metadata), "--max-blocking", "999"), 2)

    def test_duplicate_json_and_source_aliases_rejected(self):
        source = self.fixture.chapter(r"\section{Body} Prose.")
        metadata = write(self.fixture.root / "bad.json", '{"version":1,"chapters":{},"chapters":{}}')
        self.assertEqual(self.run_cli(source, "--apparatus", str(metadata)), 2)
        (self.fixture.root / "alias.tex").symlink_to(source)
        metadata = self.metadata({"whitepaper/chapter.tex": [], "alias.tex": []})
        self.assertEqual(self.run_cli(source, "--apparatus", str(metadata)), 2)

    def test_missing_or_escaping_source_rejected(self):
        source = self.fixture.chapter(r"\section{Body} Prose.")
        for missing in ["whitepaper/missing.tex", "../outside.tex", str(source)]:
            metadata = self.metadata({missing: []})
            self.assertEqual(self.run_cli(source, "--apparatus", str(metadata)), 2)

    def test_unselected_chapter_stale_selector_is_not_silently_ignored(self):
        source = self.fixture.chapter(r"\section{Body} Prose.")
        self.fixture.chapter(r"\section{Two} Prose.", "two.tex")
        metadata = self.metadata({"whitepaper/two.tex": [self.declaration(title="Deleted")]})
        self.assertEqual(self.run_cli(source, "--apparatus", str(metadata)), 2)

    def test_budget_boundary_and_strict_are_distinct_from_report_only(self):
        source = self.fixture.chapter(r"\section{Body} Prose.")
        failures = sum(chapter_lint.is_blocking(f) for f in chapter_lint.build_report(source).floors.values())
        self.assertGreater(failures, 0)
        self.assertEqual(self.run_cli(source), 0)
        self.assertEqual(self.run_cli(source, "--strict"), 1)
        self.assertEqual(self.run_cli(source, "--max-blocking", str(failures)), 0)
        self.assertEqual(self.run_cli(source, "--max-blocking", str(failures - 1)), 1)
        self.assertEqual(self.run_cli(source, "--max-blocking", "999", "--apparatus", "missing.json"), 2)
        for flags in [("--max-blocking", "-1"), ("--strict", "--max-blocking", "2")]:
            with self.assertRaises(SystemExit) as caught:
                self.run_cli(source, *flags)
            self.assertEqual(caught.exception.code, 2)


class TestCorpusGatePipeline(RepoFixtureTestCase):
    """Run the actual CLI boundary used by library-checks on a tiny corpus."""

    def setUp(self):
        super().setUp()
        self.source = self.fixture.chapter(r"""\input{figures/pd-pedagogy}
\section{Body} A scene.\begin{pdexample}{B}1+1=2.\end{pdexample}
\section{Review of the key ideas}\label{sec:review} Revisit the result.
\section{Exercises}\label{sec:exercises}\begin{pdexercise}{ex:1}Check it.\end{pdexercise}
\section{Related work} Context.\begin{pdexample}{R}x\end{pdexample}
\section{Limitations} Boundary.\begin{pdexample}{L}x\end{pdexample}
""")
        write(self.fixture.root / "whitepaper/textbook.json", json.dumps({
            "chapters": [{"source": "whitepaper/chapter.tex"}]
        }))
        self.metadata = write(self.fixture.root / "whitepaper/chapter-apparatus.json", json.dumps({
            "version": 1, "chapters": {"whitepaper/chapter.tex": [
                {"label": "sec:review", "role": "review", "reason": "Authored recap"},
                {"label": "sec:exercises", "role": "exercises", "reason": "Authored practice"},
            ]}
        }))

    def gate(self):
        import subprocess
        import sys
        return subprocess.run([
            sys.executable, str(chapter_lint.__file__), "--repo-root", str(self.fixture.root),
            "--apparatus", str(self.metadata), "--max-blocking", "0", "--json",
        ], capture_output=True, text=True, check=False)

    def test_breached_budget_fails_the_cli_process_and_keeps_failure_visible(self):
        self.assertEqual(self.gate().returncode, 0)
        self.source.write_text(self.source.read_text().replace(r"\begin{pdexample}{B}1+1=2.\end{pdexample}", ""))
        result = self.gate()
        self.assertEqual(result.returncode, 1, result.stderr)
        report = json.loads(result.stdout)
        self.assertFalse(report["floors"]["worked_example_per_section"]["ok"])

    def test_stale_selector_fails_the_cli_process_as_invalid_input(self):
        self.source.write_text(self.source.read_text().replace(r"\label{sec:review}", r"\label{sec:renamed}"))
        result = self.gate()
        self.assertEqual(result.returncode, 2)
        self.assertIn("matched 0 top-level sections", result.stderr)

    def test_apparatus_claim_still_breaches_the_cli_gate(self):
        self.assertEqual(self.gate().returncode, 0)
        self.source.write_text(self.source.read_text().replace(
            "Revisit the result.", r"Revisit the result.\begin{theorem}Unlabelled claim.\end{theorem}"
        ))
        result = self.gate()
        self.assertEqual(result.returncode, 1, result.stderr)
        report = json.loads(result.stdout)
        self.assertTrue(report["floors"]["worked_example_per_section"]["ok"])
        self.assertFalse(report["floors"]["claims_carry_epistemic_kind"]["ok"])
