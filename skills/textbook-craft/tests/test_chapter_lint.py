"""Unit tests for chapter_lint.py.

Each test builds a tiny synthetic .tex fixture (and, where the check needs
it, a throwaway directory laid out like the real repo -- whitepaper/figures/
pd-pedagogy.tex at its root -- so find_pd_pedagogy_file's upward search
resolves exactly the way it would from a real chapter) rather than running
against the Book's own chapters, which drift over time as they get fixed.
"""
import importlib.util
import io
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

SCRIPT_PATH = Path(__file__).resolve().parent.parent / "scripts" / "chapter_lint.py"
spec = importlib.util.spec_from_file_location("chapter_lint", SCRIPT_PATH)
chapter_lint = importlib.util.module_from_spec(spec)
sys.modules["chapter_lint"] = chapter_lint
spec.loader.exec_module(chapter_lint)


# A minimal pd-pedagogy.tex stand-in: just enough of the real file's shape
# (an \AtBeginDocument block re-\long\def-ing five names) for
# neutralized_macro_names to parse, without the real file's full apparatus.
MINIMAL_PD_PEDAGOGY = r"""
% minimal stand-in for whitepaper/figures/pd-pedagogy.tex
\AtBeginDocument{
  \long\def\keyidea#1{\par#1\par}%
  \long\def\pitfall#1{\par#1\par}%
  \long\def\scene#1#2{\par#1: #2\par}%
  \long\def\xrefbox#1{\par#1\par}%
  \long\def\pullquote#1{\par#1\par}%
}
"""


def write(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


class RepoFixture:
    """A throwaway directory rooted like the repo, with a real (if minimal)
    whitepaper/figures/pd-pedagogy.tex, so a chapter placed under
    <root>/whitepaper/ resolves find_pd_pedagogy_file the same way a real
    chapter does."""

    def __init__(self, pd_pedagogy_text: str = MINIMAL_PD_PEDAGOGY):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        write(self.root / "whitepaper" / "figures" / "pd-pedagogy.tex", pd_pedagogy_text)

    def chapter(self, body: str, name: str = "chapter.tex") -> Path:
        return write(self.root / "whitepaper" / name, body)

    def cleanup(self):
        self._tmp.cleanup()


class RepoFixtureTestCase(unittest.TestCase):
    def setUp(self):
        self.fixture = RepoFixture()

    def tearDown(self):
        self.fixture.cleanup()


# ---------------------------------------------------------------------------
# Item 1: strip TeX comments before every regex pass.
# ---------------------------------------------------------------------------
class TestCommentStripping(unittest.TestCase):
    def test_unescaped_percent_comment_is_dropped(self):
        text = "line one\n% a commented-out \\Built tag\nline two\n"
        stripped = chapter_lint.strip_comments(text)
        self.assertNotIn("Built", stripped)
        self.assertIn("line one", stripped)
        self.assertIn("line two", stripped)

    def test_escaped_percent_is_not_a_comment(self):
        text = "a rate of 5\\% and it is \\Built\n"
        stripped = chapter_lint.strip_comments(text)
        self.assertIn("5\\%", stripped)
        self.assertIn("\\Built", stripped)

    def test_newlines_and_line_numbers_survive(self):
        text = "\\section{A}\n% pure noise, ignore me\n\\begin{theorem}\nBody \\Built.\n\\end{theorem}\n"
        stripped = chapter_lint.strip_comments(text)
        self.assertEqual(stripped.count("\n"), text.count("\n"))
        pos = stripped.index("\\begin{theorem}")
        self.assertEqual(chapter_lint.line_of(stripped, pos), 3)

    def test_commented_out_macro_call_is_invisible_to_claim_scan(self):
        text = "% \\begin{theorem}[dead]\n%\\end{theorem}\n\\begin{theorem}[live]\nReal. \\Built.\n\\end{theorem}\n"
        stripped = chapter_lint.strip_comments(text)
        sections = chapter_lint.parse_sections(stripped)
        claims = chapter_lint.find_claims(stripped, sections)
        self.assertEqual(len(claims), 1)
        self.assertEqual(claims[0].title, "live")


# ---------------------------------------------------------------------------
# Item 2: the epistemic-kind tag must sit inside the claim's own body.
# ---------------------------------------------------------------------------
class TestEpistemicTagScopedToBody(unittest.TestCase):
    def test_tag_before_the_claim_does_not_count(self):
        text = "\\Built\n\\begin{theorem}[T]\nNo tag word appears inside this body at all.\n\\end{theorem}\n"
        sections = chapter_lint.parse_sections(text)
        claims = chapter_lint.find_claims(text, sections)
        self.assertEqual(len(claims), 1)
        self.assertFalse(claims[0].tagged)

    def test_tag_inside_the_body_counts(self):
        text = "\\begin{property}[P]\nHolds under WAL. \\Built.\n\\end{property}\n"
        sections = chapter_lint.parse_sections(text)
        claims = chapter_lint.find_claims(text, sections)
        self.assertEqual(len(claims), 1)
        self.assertTrue(claims[0].tagged)
        self.assertEqual(claims[0].tag_found, "Built")

    def test_a_neighbors_tag_is_not_borrowed_across_the_boundary(self):
        # A short, untagged claim sandwiched directly before a tagged one --
        # a fixed ±char window around \begin can bleed the neighbor's tag
        # into this claim; balanced_env_body must not.
        text = (
            "\\begin{lemma}[Short]\nX holds.\n\\end{lemma}\n"
            "\\begin{theorem}[Main]\nY holds. \\Designed.\n\\end{theorem}\n"
        )
        sections = chapter_lint.parse_sections(text)
        claims = chapter_lint.find_claims(text, sections)
        self.assertEqual(len(claims), 2)
        self.assertFalse(claims[0].tagged, "the lemma has no tag of its own")
        self.assertTrue(claims[1].tagged)

    def test_pdclaim_kind_argument_is_always_its_own_tag(self):
        text = "\\begin{pdclaim}{Theorem}{The kernel is single-writer}\nBody.\n\\end{pdclaim}\n"
        sections = chapter_lint.parse_sections(text)
        claims = chapter_lint.find_claims(text, sections)
        self.assertEqual(len(claims), 1)
        self.assertTrue(claims[0].tagged)
        self.assertEqual(claims[0].tag_found, "Theorem")

    def test_balanced_env_body_handles_nesting_of_the_same_name(self):
        text = "\\begin{theorem}[Outer]\nA. \\begin{theorem}[Inner]\nB.\\end{theorem} C. \\Built.\n\\end{theorem}\n"
        body, end = chapter_lint.balanced_env_body(text, "theorem", text.index("[Outer]") + len("[Outer]"))
        self.assertIn("Inner", body)
        self.assertIn("\\Built", body)
        self.assertEqual(text[end - len("\\end{theorem}") : end], "\\end{theorem}")


# ---------------------------------------------------------------------------
# Item 3: trust pd-pedagogy.tex, not the import line.
# ---------------------------------------------------------------------------
class TestPdPedagogyDrivenDeadMacros(RepoFixtureTestCase):
    def test_neutralized_macro_passes_even_with_no_import_at_all(self):
        chapter = self.fixture.chapter(
            "\\newcommand{\\keyidea}[1]{\\begin{tikzpicture}\\node[fill=pdblue]{#1};\\end{tikzpicture}}\n"
            "\\begin{document}\n\\section{One}\nProse.\n\\section{Exercises}\n\\end{document}\n"
        )
        report = chapter_lint.build_report(chapter)
        self.assertTrue(report.floors["no_tinted_box_macros"]["ok"])
        # ...and the import floor correctly still fails on its own account.
        self.assertFalse(report.floors["imports_pd_pedagogy_twin"]["ok"])

    def test_unneutralized_macro_fails_even_with_the_import_present(self):
        chapter = self.fixture.chapter(
            "\\input{figures/pd-pedagogy}\n"
            "\\newcommand{\\exercises}[1]{\\begin{tikzpicture}\\node[fill=pdgold]{#1};\\end{tikzpicture}}\n"
            "\\begin{document}\n\\section{One}\nProse.\n\\section{Exercises}\n\\end{document}\n"
        )
        report = chapter_lint.build_report(chapter)
        self.assertTrue(report.floors["imports_pd_pedagogy_twin"]["ok"])
        self.assertFalse(report.floors["no_tinted_box_macros"]["ok"])
        self.assertIn("\\exercises", report.floors["no_tinted_box_macros"]["detail"])

    def test_a_single_definition_is_counted_once(self):
        # TINTED_BOX_MACROS listed "scene" twice, so legible-swarm.tex's one
        # \newcommand{\scene} was reported as two macros.
        self.assertEqual(len(set(chapter_lint.TINTED_BOX_MACROS)), len(chapter_lint.TINTED_BOX_MACROS))
        chapter = self.fixture.chapter(
            "\\newcommand{\\scene}[2]{\\begin{tikzpicture}\\node[fill=pdblue]{#1 #2};\\end{tikzpicture}}\n"
            "\\begin{document}\n\\section{One}\nProse.\n\\end{document}\n"
        )
        report = chapter_lint.build_report(chapter)
        self.assertEqual([t["macro"] for t in report.tinted_box_macros], ["\\scene"])

    def test_macro_that_does_not_draw_fill_is_never_flagged(self):
        chapter = self.fixture.chapter(
            "\\newcommand{\\keyidea}[1]{\\textbf{#1}}\n"
            "\\begin{document}\n\\section{One}\nProse.\n\\end{document}\n"
        )
        report = chapter_lint.build_report(chapter)
        self.assertEqual(report.tinted_box_macros, [])
        self.assertTrue(report.floors["no_tinted_box_macros"]["ok"])

    def test_find_pd_pedagogy_file_walks_upward_from_the_chapter(self):
        chapter = self.fixture.chapter("\\section{One}\n")
        found = chapter_lint.find_pd_pedagogy_file(chapter)
        self.assertEqual(found, self.fixture.root / "whitepaper" / "figures" / "pd-pedagogy.tex")

    def test_find_pd_pedagogy_file_returns_none_when_absent(self):
        with tempfile.TemporaryDirectory() as tmp:
            chapter = write(Path(tmp) / "lonely" / "chapter.tex", "x")
            self.assertIsNone(chapter_lint.find_pd_pedagogy_file(chapter))

    def test_neutralized_macro_names_degrades_to_empty_set_when_file_missing(self):
        self.assertEqual(chapter_lint.neutralized_macro_names(None), set())
        self.assertEqual(chapter_lint.neutralized_macro_names(Path("/no/such/pd-pedagogy.tex")), set())

    def test_neutralized_macro_names_parses_the_real_committed_file(self):
        real_path = Path(__file__).resolve().parents[3] / "whitepaper" / "figures" / "pd-pedagogy.tex"
        names = chapter_lint.neutralized_macro_names(real_path)
        # \pdthesis joined the block when the 21 section theses stopped
        # pretending to be pull quotes; \pullquote stays as its alias so no
        # chapter breaks on the rename.
        self.assertEqual(names, {"keyidea", "pitfall", "scene", "xrefbox", "pullquote", "pdthesis"})
        # The file has more than one \AtBeginDocument block -- the margin
        # apparatus opens one of its own, earlier in the file, to hook
        # \section -- so a parser that reads only the first one returns
        # nothing and every fill-drawing macro reads as live.
        self.assertGreater(len(names), 1)
        # ...and \exercises, the old fill= tinted box, is deliberately absent.
        self.assertNotIn("exercises", names)


# ---------------------------------------------------------------------------
# Item 4: exercises belong in the chapter-end Exercises section (advisory).
# ---------------------------------------------------------------------------
class TestExercisesAtChapterEnd(RepoFixtureTestCase):
    def test_cluster_inside_the_closing_exercises_section_passes(self):
        chapter = self.fixture.chapter(
            "\\input{figures/pd-pedagogy}\n\\begin{document}\n"
            "\\section{Intro}\nProse.\n"
            "\\section{Exercises}\n\\pdexercisesfor{\\S1}{Intro}\n"
            "\\begin{pdexercise}{ex:1}Do X.\\end{pdexercise}\n"
            "\\section{History and references}\nMore.\n\\end{document}\n"
        )
        report = chapter_lint.build_report(chapter)
        floor = report.floors["exercises_at_chapter_end"]
        self.assertTrue(floor["ok"])
        self.assertTrue(floor["advisory"])

    def test_mid_body_cluster_fails_and_is_advisory_not_blocking(self):
        chapter = self.fixture.chapter(
            "\\input{figures/pd-pedagogy}\n\\begin{document}\n"
            "\\section{Intro}\nProse.\n"
            "\\exercises{Do X.}\n"
            "\\section{Conclusion}\nMore.\n\\end{document}\n"
        )
        report = chapter_lint.build_report(chapter)
        floor = report.floors["exercises_at_chapter_end"]
        self.assertFalse(floor["ok"])
        self.assertTrue(floor["advisory"])
        self.assertFalse(chapter_lint.is_blocking(floor))

    def test_an_earlier_unrelated_section_named_exercises_does_not_fool_it(self):
        # Two sections mention "exercises" in some form; only the LAST one
        # is the chapter's real closing-sequence Exercises section.
        chapter = self.fixture.chapter(
            "\\input{figures/pd-pedagogy}\n\\begin{document}\n"
            "\\section{Notes on past exercises}\n\\exercises{An early, unrelated cluster.}\n"
            "\\section{Exercises}\n\\pdexercisesfor{\\S1}{Notes}\n"
            "\\begin{pdexercise}{ex:1}Do Y.\\end{pdexercise}\n\\end{document}\n"
        )
        report = chapter_lint.build_report(chapter)
        clusters = report.exercise_clusters
        self.assertFalse(clusters[0]["in_exercises_section"])
        self.assertTrue(clusters[1]["in_exercises_section"])


# ---------------------------------------------------------------------------
# Item 5: every chapter must \input the pedagogy twin.
# ---------------------------------------------------------------------------
class TestImportsPdPedagogyTwinFloor(RepoFixtureTestCase):
    def test_fails_without_any_input(self):
        chapter = self.fixture.chapter("\\begin{document}\n\\section{One}\nProse.\n\\end{document}\n")
        report = chapter_lint.build_report(chapter)
        floor = report.floors["imports_pd_pedagogy_twin"]
        self.assertFalse(floor["ok"])
        self.assertTrue(chapter_lint.is_blocking(floor))

    def test_passes_with_the_input(self):
        chapter = self.fixture.chapter(
            "\\input{figures/pd-pedagogy}\n\\begin{document}\n\\section{One}\nProse.\n\\end{document}\n"
        )
        report = chapter_lint.build_report(chapter)
        self.assertTrue(report.floors["imports_pd_pedagogy_twin"]["ok"])


# ---------------------------------------------------------------------------
# Item 6: the chapter opens with a scene/epigraph; its claims are labelled.
# ---------------------------------------------------------------------------
class TestOpenerKind(unittest.TestCase):
    def _top_sections(self, text):
        sections = chapter_lint.parse_sections(text)
        return text, [s for s in sections if s.kind == "section"]

    def test_prose_opener(self):
        text, top = self._top_sections("\\section{One}\nA failure scene, in prose.\n")
        self.assertEqual(chapter_lint.find_opener_kind(text, top), "prose")

    def test_epigraph_macro_opener(self):
        text, top = self._top_sections("\\section{One}\n\\epigraph{Quote}{Source}\nProse.\n")
        self.assertEqual(chapter_lint.find_opener_kind(text, top), "epigraph")

    def test_table_opener_is_flagged(self):
        text, top = self._top_sections("\\section{One}\n\\begin{table}\nstuff\n\\end{table}\n")
        self.assertEqual(chapter_lint.find_opener_kind(text, top), "table")

    def test_claim_opener_is_flagged(self):
        text, top = self._top_sections("\\section{One}\n\\begin{theorem}[T]\nHolds.\n\\end{theorem}\n")
        self.assertEqual(chapter_lint.find_opener_kind(text, top), "claim")

    def test_label_immediately_after_the_heading_is_skipped(self):
        text, top = self._top_sections("\\section{One}\\label{sec:one}\nProse right after the label.\n")
        self.assertEqual(chapter_lint.find_opener_kind(text, top), "prose")

    def test_no_top_level_section_returns_none(self):
        text, top = self._top_sections("Just some preamble text, no sections at all.\n")
        self.assertIsNone(chapter_lint.find_opener_kind(text, top))


class TestChapterOpenerAndClaimLabelingFloor(RepoFixtureTestCase):
    def test_advisory_and_fails_when_opener_is_a_cold_claim(self):
        chapter = self.fixture.chapter(
            "\\input{figures/pd-pedagogy}\n\\begin{document}\n"
            "\\section{One}\n\\begin{theorem}[T]\nHolds.\n\\end{theorem}\n"
            "\\section{Exercises}\n\\end{document}\n"
        )
        report = chapter_lint.build_report(chapter)
        floor = report.floors["chapter_opener_and_claim_labeling"]
        self.assertFalse(floor["ok"])
        self.assertTrue(floor["advisory"])
        self.assertFalse(chapter_lint.is_blocking(floor))

    def test_passes_with_a_prose_opener_and_every_claim_tagged(self):
        chapter = self.fixture.chapter(
            "\\input{figures/pd-pedagogy}\n\\begin{document}\n"
            "\\section{One}\nA scene in prose.\n"
            "\\begin{theorem}[T]\nHolds. \\Built.\n\\end{theorem}\n"
            "\\section{Exercises}\n\\end{document}\n"
        )
        report = chapter_lint.build_report(chapter)
        self.assertTrue(report.floors["chapter_opener_and_claim_labeling"]["ok"])


# ---------------------------------------------------------------------------
# The apparatus exclusion: the worked-example floor is a BODY-section floor.
#
# SKILL.md §Pacing rules exempts apparatus by name ("outside an Exercises
# section, which is expected to be prose-only"), and this floor is that rule's
# source-level proxy -- but it used to ask every top-level \section for a
# worked example, including Exercises, the Review, Limitations and the
# Reader's Map. 54 of the 138 sections it flagged across the Book were
# apparatus.
# ---------------------------------------------------------------------------
class TestApparatusExclusionList(unittest.TestCase):
    """There is exactly ONE definition of the apparatus vocabulary and every
    consumer reads it. Two lists that must agree with nothing checking they do
    is the defect this change exists to not re-create."""

    def test_chapter_close_keywords_are_the_same_objects_not_copies(self):
        for key in chapter_lint.CHAPTER_CLOSE_KEYS:
            self.assertIs(
                chapter_lint.CHAPTER_CLOSE_KEYWORDS[key],
                chapter_lint.APPARATUS_SECTION_PATTERNS[key],
                f"{key} must BE the apparatus pattern, not a second copy of it",
            )

    def test_exercises_title_re_is_the_same_object_not_a_copy(self):
        self.assertIs(
            chapter_lint.EXERCISES_SECTION_TITLE_RE,
            chapter_lint.APPARATUS_SECTION_PATTERNS["exercises"],
        )

    def test_every_chapter_close_key_exists_in_the_one_list(self):
        for key in chapter_lint.CHAPTER_CLOSE_KEYS:
            self.assertIn(key, chapter_lint.APPARATUS_SECTION_PATTERNS)

    def test_the_module_defines_no_second_apparatus_pattern_dict(self):
        # A future edit that adds `APPARATUS_KEYWORDS = {...}` or re-compiles
        # an exercises/review/limitations pattern beside the one list would
        # pass every behavioural test above while re-introducing the drift.
        # Read the source and insist the vocabulary is compiled in one place.
        source = SCRIPT_PATH.read_text(encoding="utf-8")
        for word in ("exercises?", "review of the key ideas", "history and references"):
            self.assertEqual(
                source.count(word), 1,
                f"the apparatus token {word!r} is compiled more than once -- "
                "it belongs in APPARATUS_SECTION_PATTERNS and nowhere else",
            )


class TestApparatusClassification(unittest.TestCase):
    def _section(self, title, label=""):
        return chapter_lint.Section(kind="section", title=title, start=0, line=1, label=label)

    def test_apparatus_titles_are_recognised(self):
        cases = {
            "Exercises": "exercises",
            "Review of the key ideas": "review",
            "Related work": "history_and_references",
            "Further reading and prior art": "history_and_references",
            "Limitations and boundaries": "boundary_or_handoff",
            "Threat model and the limits of mediation": "boundary_or_handoff",
            "Open problems": "boundary_or_handoff",
            "Scope Boundary Checklist": "boundary_or_handoff",
            "Reader's Map": "readers_map",
            "How to read this paper (Reader's Map)": "readers_map",
            "Formal Verification Status": "verification_status",
            "Full ProVerif Models": "formal_models",
            "TLA+ Specification (draft)": "formal_models",
            "Notation and the nomenclature key": "notation",
            "Appendix A: the long tables": "appendix",
        }
        for title, expected in cases.items():
            with self.subTest(title=title):
                self.assertEqual(chapter_lint.apparatus_kind(self._section(title)), expected)

    def test_body_titles_are_not_apparatus(self):
        # Real titles from the Book's chapters that a looser pattern set
        # swallowed or nearly swallowed.
        for title in (
            # The bare token `boundary` used to match this -- a core body
            # section, the fourth of sealed-harbor's ten. It is the exact
            # false positive that made an independent hand-count of the
            # Book's apparatus come out one too high for that chapter.
            "The gate sits on the only enforceable boundary",
            # `formal models?` would swallow this; it is the section that
            # DEVELOPS the model, not the appendix that dumps its source.
            "Formal Model",
            # "Limits" is not "limitations".
            "The Limits of Decisive Allocation",
            # "open ... problem" is not "open problems".
            "A gluing analogy for the open federation problem",
            "Introduction: the swarm is a state of nature",
            "Cross-Harbor Capability Transfer",
            "Worked Example",
        ):
            with self.subTest(title=title):
                self.assertIsNone(chapter_lint.apparatus_kind(self._section(title)))

    def test_an_app_namespaced_label_is_apparatus_whatever_the_title_says(self):
        # "Phase 2: Asymmetric Ed25519" is 57 lines of dumped ProVerif source
        # in anchor-protocol-whitepaper.tex. Nothing in its title says so; its
        # \label{app:phase2} does. The structural signal is author-declared
        # and is why this is not a pure title heuristic.
        s = self._section("Phase 2: Asymmetric Ed25519", label="app:phase2")
        self.assertEqual(chapter_lint.apparatus_kind(s), "appendix")
        self.assertTrue(chapter_lint.is_apparatus_section(s))

    def test_a_sec_namespaced_label_does_not_make_a_body_section_apparatus(self):
        s = self._section("Cross-Harbor Settlement", label="sec:fh-settlement")
        self.assertIsNone(chapter_lint.apparatus_kind(s))

    def test_latex_in_a_title_does_not_hide_an_apparatus_match(self):
        # "Limitations \& Boundaries" as it is actually written in the source.
        self.assertEqual(
            chapter_lint.apparatus_kind(self._section("Limitations \\& Boundaries")),
            "boundary_or_handoff",
        )
        self.assertEqual(
            chapter_lint.normalize_section_title("Tokens: the swarm's COGS \\emph{and} its engine"),
            "Tokens: the swarm's COGS and its engine",
        )

    def test_heading_label_is_read_from_the_heading_not_from_the_body(self):
        text = "\\section{Cross-Harbor Settlement}\\label{sec:fh-settlement}\nProse.\n\\label{app:not-mine}\n"
        top = [s for s in chapter_lint.parse_sections(text) if s.kind == "section"]
        self.assertEqual(top[0].label, "sec:fh-settlement")

    def test_narrowing_boundary_still_finds_every_real_close_section(self):
        # The narrowing from a bare `boundary` to `scope boundary|boundaries`
        # must not cost chapter_close_apparatus a single match: each of these
        # is the phrase one of the Book's eight chapters actually relies on.
        pat = chapter_lint.APPARATUS_SECTION_PATTERNS["boundary_or_handoff"]
        for title in (
            "Limitations and boundaries",
            "Limitations \\& Boundaries",
            "Limitations and Open Questions",
            "Discussion and Limitations",
            "Threat Model",
            "Threat model and the limits of mediation",
            "Open problems",
            "The open problems, as a map",
            "What this chapter hands the market",
            "Adjacency contract: what the kernel assumes and provides",
            "Scope Boundary Checklist",
        ):
            with self.subTest(title=title):
                self.assertTrue(pat.search(chapter_lint.normalize_section_title(title)))


class TestWorkedExampleFloorExcludesApparatus(RepoFixtureTestCase):
    def test_an_apparatus_only_section_does_not_trip_the_floor(self):
        # One body section with an example; every other section is apparatus
        # and prose-only. The floor must pass.
        chapter = self.fixture.chapter(
            "\\input{figures/pd-pedagogy}\n\\begin{document}\n"
            "\\section{Reader's Map}\\label{sec:readers-map}\nA map, in prose.\n"
            "\\section{The argument}\\label{sec:arg}\nProse.\n"
            "\\begin{pdexample}{One}\n1+1=2.\n\\end{pdexample}\n"
            "\\section{Review of the key ideas}\nProse only.\n"
            "\\section{Exercises}\\label{sec:ex}\nProse only.\n"
            "\\section{Related work}\nProse only.\n"
            "\\section{Limitations and boundaries}\nProse only.\n"
            "\\section{Full ProVerif Models}\\label{app:proverif}\nProse only.\n"
            "\\section{Phase 2: Asymmetric Ed25519}\\label{app:phase2}\nDumped source.\n"
            "\\end{document}\n"
        )
        report = chapter_lint.build_report(chapter)
        floor = report.floors["worked_example_per_section"]
        self.assertTrue(floor["ok"], floor["detail"])
        self.assertEqual(len(report.apparatus_sections), 7)
        self.assertIn("1 top-level body sections", floor["detail"])

    def test_a_body_section_without_an_example_still_fails(self):
        # The floor must not be softened into uselessness: a real body
        # section with no worked example is still a blocking failure.
        chapter = self.fixture.chapter(
            "\\input{figures/pd-pedagogy}\n\\begin{document}\n"
            "\\section{Reader's Map}\nA map.\n"
            "\\section{The argument}\\label{sec:arg}\nProse, and no example anywhere.\n"
            "\\section{Exercises}\nProse only.\n"
            "\\end{document}\n"
        )
        report = chapter_lint.build_report(chapter)
        floor = report.floors["worked_example_per_section"]
        self.assertFalse(floor["ok"])
        self.assertTrue(chapter_lint.is_blocking(floor))
        self.assertIn("The argument", floor["detail"])
        # ...and names neither exempted section as a failure.
        self.assertNotIn("Reader's Map", floor["detail"])
        self.assertNotIn("Exercises;", floor["detail"])

    def test_a_body_section_whose_title_merely_mentions_a_boundary_still_fails(self):
        # sealed-harbor.tex §4. The exemption must not reach it.
        chapter = self.fixture.chapter(
            "\\input{figures/pd-pedagogy}\n\\begin{document}\n"
            "\\section{The gate sits on the only enforceable boundary}\\label{sec:enforceability}\n"
            "Prose, no example.\n"
            "\\section{Exercises}\nProse.\n\\end{document}\n"
        )
        report = chapter_lint.build_report(chapter)
        floor = report.floors["worked_example_per_section"]
        self.assertFalse(floor["ok"])
        self.assertIn("enforceable boundary", floor["detail"])

    def test_the_report_names_every_exemption_and_why(self):
        chapter = self.fixture.chapter(
            "\\input{figures/pd-pedagogy}\n\\begin{document}\n"
            "\\section{Body}\\label{sec:b}\nProse.\n\\begin{pdexample}{E}\nx.\n\\end{pdexample}\n"
            "\\section{Implementation \\& status}\\label{app:status}\nA table.\n"
            "\\end{document}\n"
        )
        report = chapter_lint.build_report(chapter)
        self.assertEqual(
            [(a["title"], a["apparatus_kind"]) for a in report.apparatus_sections],
            [("Implementation \\& status", "appendix")],
        )
        out = chapter_lint.render_text(report)
        self.assertIn("Apparatus sections (exempt from the worked-example floor): 1", out)
        self.assertIn("by label app:status", out)

    def test_a_chapter_of_nothing_but_apparatus_passes_vacuously(self):
        chapter = self.fixture.chapter(
            "\\input{figures/pd-pedagogy}\n\\begin{document}\n"
            "\\section{Review of the key ideas}\nProse.\n"
            "\\section{Exercises}\nProse.\n\\end{document}\n"
        )
        report = chapter_lint.build_report(chapter)
        self.assertTrue(report.floors["worked_example_per_section"]["ok"])


class TestOpenerFloorSkipsLeadingApparatus(unittest.TestCase):
    """The same blind spot, in chapter_opener_and_claim_labeling: six of the
    Book's eight chapters open with a Reader's Map, so the floor was reading
    the first line of the map rather than the first line of the argument."""

    def test_a_leading_readers_map_is_skipped(self):
        text = (
            "\\section{Reader's Map}\\label{sec:readers-map}\nA map, in prose.\n"
            "\\section{The argument}\\label{sec:arg}\n\\begin{table}\nx\n\\end{table}\n"
        )
        top = [s for s in chapter_lint.parse_sections(text) if s.kind == "section"]
        # Measured at the Reader's Map this reads "prose" and the cold table
        # in the chapter's real opening section goes unseen.
        self.assertEqual(chapter_lint.find_opener_kind(text, top), "table")

    def test_a_chapter_with_no_body_section_at_all_returns_none(self):
        text = "\\section{Exercises}\nProse.\n"
        top = [s for s in chapter_lint.parse_sections(text) if s.kind == "section"]
        self.assertIsNone(chapter_lint.find_opener_kind(text, top))


# ---------------------------------------------------------------------------
# The ratchet: --max-blocking, the honest middle between --strict (which no
# chapter passes today) and continue-on-error (which measures nothing).
# ---------------------------------------------------------------------------
class TestRatchet(RepoFixtureTestCase):
    def _failing_chapter(self, name="chapter.tex"):
        # Exactly one blocking failure: the missing \input{figures/pd-pedagogy}.
        # Every other blocking floor is satisfied, so the ratchet arithmetic
        # below is not measuring an accident of the fixture.
        return self.fixture.chapter(
            "\\begin{document}\n\\section{One}\\label{sec:one}\nProse.\n"
            "\\begin{pdexample}{E}\nx.\n\\end{pdexample}\n"
            "\\section{Review of the key ideas}\nProse.\n"
            "\\section{Related work}\nProse.\n"
            "\\section{Limitations and boundaries}\nProse.\n"
            "\\end{document}\n",
            name=name,
        )

    def test_the_fixture_really_has_exactly_one_blocking_failure(self):
        report = chapter_lint.build_report(self._failing_chapter())
        blocking = [n for n, f in report.floors.items() if chapter_lint.is_blocking(f)]
        self.assertEqual(blocking, ["imports_pd_pedagogy_twin"])

    def _run(self, argv):
        buf, err = io.StringIO(), io.StringIO()
        with redirect_stdout(buf), redirect_stderr(err):
            status = chapter_lint.main(argv)
        return status, buf.getvalue(), err.getvalue()

    def test_at_the_budget_exits_zero(self):
        status, _, _ = self._run([str(self._failing_chapter()), "--max-blocking", "1"])
        self.assertEqual(status, 0)

    def test_above_the_budget_exits_one(self):
        c1 = self._failing_chapter()
        c2 = self._failing_chapter(name="chapter2.tex")
        status, _, err = self._run([str(c1), str(c2), "--max-blocking", "1"])
        self.assertEqual(status, 1)
        self.assertIn("above the ratchet", err)

    def test_below_the_budget_passes_and_says_to_lower_it(self):
        status, _, err = self._run([str(self._failing_chapter()), "--max-blocking", "5"])
        self.assertEqual(status, 0)
        self.assertIn("Lower the ratchet to 1", err)

    def test_the_ratchet_is_independent_of_strict(self):
        # --strict still fails on one blocking floor even inside budget.
        status, _, _ = self._run([str(self._failing_chapter()), "--max-blocking", "5", "--strict"])
        self.assertEqual(status, 1)


# ---------------------------------------------------------------------------
# Items 7/8: multi-chapter consolidated report and advisory-aware --strict.
# ---------------------------------------------------------------------------
class TestConsolidatedReportAndStrictExit(RepoFixtureTestCase):
    def _fully_compliant_chapter(self):
        # Every BLOCKING floor passes; only the advisory
        # exercises_at_chapter_end floor fails (a mid-body \exercises
        # cluster, no Exercises section at all).
        return self.fixture.chapter(
            "\\input{figures/pd-pedagogy}\n\\begin{document}\n"
            "\\section{One}\nProse opening.\n"
            "\\begin{pdexample}{First}\n1+1=2.\n\\end{pdexample}\n"
            "\\exercises{Do the thing.}\n"
            "\\section{Review of the key ideas}\nProse.\n\\begin{pdexample}{R}\nx.\n\\end{pdexample}\n"
            "\\section{Related work}\nProse.\n\\begin{pdexample}{RW}\nx.\n\\end{pdexample}\n"
            "\\section{Limitations}\nProse.\n\\begin{pdexample}{L}\nx.\n\\end{pdexample}\n"
            "\\end{document}\n"
        )

    def test_only_the_advisory_floor_fails(self):
        report = chapter_lint.build_report(self._fully_compliant_chapter())
        blocking = [name for name, f in report.floors.items() if chapter_lint.is_blocking(f)]
        self.assertEqual(blocking, [])
        self.assertFalse(report.floors["exercises_at_chapter_end"]["ok"])

    def test_strict_exits_zero_when_only_advisory_floors_fail(self):
        chapter = self._fully_compliant_chapter()
        buf = io.StringIO()
        with redirect_stdout(buf):
            status = chapter_lint.main([str(chapter), "--strict"])
        self.assertEqual(status, 0)

    def test_strict_exits_nonzero_when_a_blocking_floor_fails(self):
        chapter = self.fixture.chapter("\\section{One}\nProse, no pd-pedagogy import at all.\n")
        buf = io.StringIO()
        with redirect_stdout(buf):
            status = chapter_lint.main([str(chapter), "--strict"])
        self.assertEqual(status, 1)

    def test_missing_file_exits_two(self):
        buf = io.StringIO()
        with redirect_stdout(buf):
            status = chapter_lint.main([str(self.fixture.root / "whitepaper" / "no-such-chapter.tex")])
        self.assertEqual(status, 2)

    def test_single_chapter_default_is_the_single_chapter_report(self):
        chapter = self._fully_compliant_chapter()
        buf = io.StringIO()
        with redirect_stdout(buf):
            chapter_lint.main([str(chapter)])
        out = buf.getvalue()
        self.assertTrue(out.startswith("chapter_lint: "))
        self.assertNotIn("floor row(s)", out)

    def test_multiple_chapters_produce_one_consolidated_table(self):
        c1 = self._fully_compliant_chapter()
        c2 = self.fixture.chapter(self._fully_compliant_chapter().read_text(), name="chapter2.tex")
        buf = io.StringIO()
        with redirect_stdout(buf):
            status = chapter_lint.main([str(c1), str(c2)])
        out = buf.getvalue()
        self.assertEqual(status, 0)
        self.assertIn(str(c1), out)
        self.assertIn(str(c2), out)
        self.assertIn("2 chapter(s)", out)
        self.assertIn("floor row(s)", out)

    def test_table_flag_forces_consolidated_mode_for_one_chapter(self):
        chapter = self._fully_compliant_chapter()
        buf = io.StringIO()
        with redirect_stdout(buf):
            chapter_lint.main([str(chapter), "--table"])
        self.assertIn("floor row(s)", buf.getvalue())

    def test_consolidated_json_is_a_list_of_reports(self):
        c1 = self._fully_compliant_chapter()
        c2 = self.fixture.chapter(self._fully_compliant_chapter().read_text(), name="chapter2.tex")
        buf = io.StringIO()
        with redirect_stdout(buf):
            chapter_lint.main([str(c1), str(c2), "--json"])
        import json

        data = json.loads(buf.getvalue())
        self.assertIsInstance(data, list)
        self.assertEqual(len(data), 2)
        self.assertIn("floors", data[0])


if __name__ == "__main__":
    unittest.main()
