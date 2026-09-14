#!/usr/bin/env python3
"""Fixture-based tests for scripts/harbor-research/build_concept_index.py.

stdlib-only (unittest, tempfile, subprocess, json). Most tests build a tiny
one-chapter repo under a tempdir -- textbook.json, one .tex, a lexicon -- and
run the real generator against it with --repo-root, the same convention as
test_check_library_index.py and test_render_figure_audit.py. Production usage
never passes --repo-root and always reads this repository in place.

Three tests run against THIS repository:
  - the committed index is a fresh build (--check is green),
  - the committed index and its Markdown render agree with the schema's
    required fields,
  - the specimen that motivated the index (SS1.3 of chapter 1) is still
    recorded as a four-domain collision cashed out only in a float caption.
That last one is a regression gate on the FINDING, not on the parser: if a
future edit to single-writer-kernel.tex cashes the metaphor out in prose,
this test fails and should be updated, with the Book's improvement as the
reason.

Run:
    python3 -m unittest discover -s tests/harbor-research
    python3 tests/harbor-research/test_build_concept_index.py
"""
from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "scripts" / "harbor-research" / "build_concept_index.py"
INDEX_REL = Path("docs/harbor-research/concept-index.json")
MD_REL = Path("docs/harbor-research/CONCEPT-INDEX.md")
SCHEMA_REL = Path("docs/harbor-research/concept-index.schema.json")
LEXICON_REL = Path("docs/harbor-research/concept-index.lexicon.json")

# The specimen: whitepaper/single-writer-kernel.tex SS1.3, "The kernel as
# seven organs".
SPECIMEN_SECTION_LABEL = "sec:organs"
SPECIMEN_FILE = "whitepaper/single-writer-kernel.tex"


def run(args: list[str], root: Path | None = None) -> subprocess.CompletedProcess:
    cmd = [sys.executable, str(SCRIPT), *args]
    if root is not None:
        cmd += ["--repo-root", str(root)]
    return subprocess.run(cmd, capture_output=True, text=True)


MINIMAL_LEXICON = {
    "version": 1,
    "metaphor_vehicles": {
        "anatomy": ["organ", "tissue", "connective tissue"],
        "architecture": ["floor", "foundation"],
        "moral": ["discipline"],
        "medicine": ["symptom"],
        "nautical": ["berth"],
    },
    "vehicle_literal_exceptions": {"berth": ["Berth Ltd"]},
    "cash_out_markers": {
        "min_markers": 2,
        "min_sentence_chars": 40,
        "markers": ["SQLite", "WAL", "file", "commit", "table", "row", "daemon"],
    },
    "concept_stopwords": {"phrases": ["the", "a", "is", "of", "and", "very", "quickly"]},
    "concept_aliases": {"organ": ["organs"]},
    "concept_force_include": {"terms": []},
}


def make_repo(tmp: Path, chapter_tex: str, lexicon: dict | None = None,
              extra_chapters: list[tuple[str, str]] | None = None) -> Path:
    """A one-chapter repo the generator can read end to end."""
    (tmp / "whitepaper").mkdir(parents=True, exist_ok=True)
    (tmp / "docs" / "harbor-research").mkdir(parents=True, exist_ok=True)
    (tmp / "whitepaper" / "ch1.tex").write_text(chapter_tex, encoding="utf-8")
    chapters = [{"number": 1, "id": "ch1", "prefix": "c1", "title": "Chapter One",
                 "source": "whitepaper/ch1.tex"}]
    for i, (name, body) in enumerate(extra_chapters or [], start=2):
        (tmp / "whitepaper" / name).write_text(body, encoding="utf-8")
        chapters.append({"number": i, "id": name.replace(".tex", ""),
                         "prefix": "c%d" % i, "title": "Chapter %d" % i,
                         "source": "whitepaper/%s" % name})
    (tmp / "whitepaper" / "textbook.json").write_text(
        json.dumps({"chapters": chapters}), encoding="utf-8")
    (tmp / "docs" / "harbor-research" / "concept-index.lexicon.json").write_text(
        json.dumps(lexicon or MINIMAL_LEXICON), encoding="utf-8")
    return tmp


def build_index(tmp: Path) -> dict:
    proc = run(["--write"], root=tmp)
    assert proc.returncode == 0, proc.stderr
    return json.loads((tmp / INDEX_REL).read_text(encoding="utf-8"))


def entry(index: dict, cid: str) -> dict | None:
    return next((e for e in index["entries"] if e["id"] == cid), None)


# ---------------------------------------------------------------------------
# The harvest rule
# ---------------------------------------------------------------------------

class TestHarvestRule(unittest.TestCase):
    def test_structural_mark_alone_is_enough(self):
        tex = r"""
\section{Opening}\label{sec:open}
\begin{definition}[Consent grant]\label{def:consent}
A \textbf{consent grant} is an explicit, scoped, revocable authorization.
\end{definition}
A consent grant may be narrowed.
Every \textbf{consent grant} carries a scope.
A third line naming the consent grant.
"""
        with TemporaryDirectory() as d:
            idx = build_index(make_repo(Path(d), tex))
            e = entry(idx, "consent grant")
            self.assertIsNotNone(e, "a term defined in a definition environment is a concept")
            self.assertTrue(e["definition"]["found"])
            self.assertFalse(e["definition"]["judged"],
                             "an environment-backed definition is PARSED, not judged")
            self.assertEqual(e["definition"]["sites"][0]["label"], "def:consent")

    def test_single_emphasis_is_not_enough(self):
        tex = r"""
\section{Opening}\label{sec:open}
This matters \emph{enormously} for the daemon.
It matters enormously again.
And enormously a third time, but it is never a term of art.
"""
        with TemporaryDirectory() as d:
            idx = build_index(make_repo(Path(d), tex))
            self.assertIsNone(entry(idx, "enormously"))
            drop = next(d_ for d_ in idx["dropped_candidates"] if d_["id"] == "enormously")
            self.assertEqual(drop["stage"], "marked")

    def test_two_emphases_are_enough(self):
        tex = r"""
\section{Opening}\label{sec:open}
The \emph{attention queue} is where work waits.
Later the \emph{attention queue} is drained by the operator.
A third attention queue mention.
A fourth attention queue mention, to clear the floor.
"""
        with TemporaryDirectory() as d:
            idx = build_index(make_repo(Path(d), tex))
            self.assertIsNotNone(entry(idx, "attention queue"))

    def test_mention_floor_drops_a_marked_but_rare_term(self):
        tex = r"""
\section{Opening}\label{sec:open}
The \emph{rare widget} appears here.
The \emph{rare widget} appears once more and never again.
"""
        with TemporaryDirectory() as d:
            idx = build_index(make_repo(Path(d), tex))
            self.assertIsNone(entry(idx, "rare widget"))
            drop = next(x for x in idx["dropped_candidates"] if x["id"] == "rare widget")
            self.assertEqual(drop["stage"], "repeated")

    def test_force_include_overrides_the_rule(self):
        lex = dict(MINIMAL_LEXICON, concept_force_include={"terms": ["rare widget"]})
        tex = r"""
\section{Opening}\label{sec:open}
The rare widget appears here and nowhere else.
"""
        with TemporaryDirectory() as d:
            idx = build_index(make_repo(Path(d), tex, lex))
            self.assertIsNotNone(entry(idx, "rare widget"))

    def test_every_drop_carries_a_reason(self):
        tex = r"""
\section{Opening}\label{sec:open}
A \emph{very} \emph{quickly} \emph{revoked} claim; revoked, revoked, revoked.
"""
        with TemporaryDirectory() as d:
            idx = build_index(make_repo(Path(d), tex))
            for drop in idx["dropped_candidates"]:
                self.assertTrue(drop["reason"], drop)
                self.assertIn(drop["stage"], ("marked", "repeated"))


# ---------------------------------------------------------------------------
# Parsing idioms this Book actually uses
# ---------------------------------------------------------------------------

class TestParsing(unittest.TestCase):
    def test_comments_never_contribute(self):
        tex = r"""
\section{Opening}\label{sec:open}
% The \emph{ghost term} lives only in a comment.
% ghost term again, and a third ghost term here.
The \textbf{real term} is here.
A second \textbf{real term} line.
A third real term line.
"""
        with TemporaryDirectory() as d:
            idx = build_index(make_repo(Path(d), tex))
            self.assertIsNone(entry(idx, "ghost term"))
            self.assertIsNotNone(entry(idx, "real term"))

    def test_label_and_ref_keys_are_not_prose(self):
        """A Reader's Map row reading `Table~\\ref{tab:comm-organ}` is not a
        use of the concept 'organ'. Before this was fixed the first use of
        'organ' in chapter 1 was recorded as a table of cross-references."""
        tex = r"""
\section{Opening}\label{sec:open}
See Table~\ref{tab:comm-organ} and Figure~\ref{fig:organ-map}.
\section{Body}\label{sec:body}
We organize the kernel into seven \emph{organs}, each a contract.
Each \emph{organ} is a table.
The organ list is short.
A fourth organ mention.
"""
        with TemporaryDirectory() as d:
            idx = build_index(make_repo(Path(d), tex))
            e = entry(idx, "organ")
            self.assertIsNotNone(e)
            self.assertEqual(e["first_use"]["section"], "sec:body",
                             "the \\ref keys in sec:open must not count as mentions")

    def test_phrase_split_across_a_line_break_still_counts(self):
        tex = "\n".join([
            r"\section{Opening}\label{sec:open}",
            r"The \textbf{single writer} decides.",
            r"Everything routes through the single",
            r"writer, which is the whole point.",
            r"The \textbf{single writer} is the whole design.",
            r"A fourth single-writer mention closes the floor.",
        ])
        with TemporaryDirectory() as d:
            idx = build_index(make_repo(Path(d), tex))
            e = entry(idx, "single writer")
            self.assertIsNotNone(e)
            self.assertGreaterEqual(e["mention_count"], 3)

    def test_exercise_and_solution_are_paired(self):
        tex = r"""
\section{Opening}\label{sec:open}
The \textbf{lease sweep} runs lazily.
A second \textbf{lease sweep} line.
A third lease sweep line.
\begin{pdexercise}[kind=Trace,rating=2]{ex:sweep}
Trace what the lease sweep does when two holders expire together.
\end{pdexercise}
\begin{pdsolution}{ex:sweep}
The lease sweep removes both.
\end{pdsolution}
"""
        with TemporaryDirectory() as d:
            idx = build_index(make_repo(Path(d), tex))
            e = entry(idx, "lease sweep")
            self.assertEqual(len(e["exercise_use"]), 1)
            x = e["exercise_use"][0]
            self.assertEqual(x["label"], "ex:sweep")
            self.assertEqual(x["kind"], "Trace")
            self.assertEqual(x["rating"], "2")
            self.assertTrue(x["solution"]["mentions_concept"])

    def test_cites_in_the_same_paragraph_attach(self):
        tex = r"""
\section{Opening}\label{sec:open}
The \textbf{read-poverty} regime \pdcite{simon1971,endsley1995} bites early,
and \textbf{read-poverty} is the reason,
and read-poverty again.
"""
        with TemporaryDirectory() as d:
            idx = build_index(make_repo(Path(d), tex))
            keys = {r["key"] for r in entry(idx, "read-poverty")["references"]}
            self.assertEqual(keys, {"simon1971", "endsley1995"})

    def test_open_problem_tokens_are_parsed_not_judged(self):
        tex = r"""
\section{Opening}\label{sec:open}
The \textbf{ticket lock} would close OP-1 without a scheduler,
because a \textbf{ticket lock} needs no background sweep,
and the ticket lock is fair.
"""
        with TemporaryDirectory() as d:
            idx = build_index(make_repo(Path(d), tex))
            ops = entry(idx, "ticket lock")["open_problems"]
            self.assertEqual(len(ops), 1)
            self.assertEqual(ops[0]["op_ids"], ["OP-1"])
            self.assertFalse(ops[0]["judged"], "an OP-N token is parsed, not judged")

    def test_chapter_list_is_derived_from_textbook_json(self):
        tex = r"""
\section{Opening}\label{sec:open}
The \textbf{shared term} appears.
A second \textbf{shared term} line.
A third shared term line.
"""
        second = r"""
\section{Second}\label{sec:second}
The shared term appears in chapter two as well.
A second \textbf{shared term} line here.
A third shared term line here.
"""
        with TemporaryDirectory() as d:
            idx = build_index(make_repo(Path(d), tex, extra_chapters=[("ch2.tex", second)]))
            self.assertEqual([c["number"] for c in idx["chapters"]], [1, 2])
            self.assertEqual(entry(idx, "shared term")["chapters"], [1, 2])

    def test_a_missing_chapter_source_is_reported_not_skipped(self):
        with TemporaryDirectory() as d:
            tmp = make_repo(Path(d), "\\section{X}\\label{sec:x}\nnothing here.\n")
            book = json.loads((tmp / "whitepaper" / "textbook.json").read_text())
            book["chapters"].append({"number": 2, "id": "gone", "prefix": "g",
                                     "title": "Gone", "source": "whitepaper/gone.tex"})
            (tmp / "whitepaper" / "textbook.json").write_text(json.dumps(book))
            idx = build_index(tmp)
            gone = next(c for c in idx["chapters"] if c["id"] == "gone")
            self.assertTrue(gone["missing"])


# ---------------------------------------------------------------------------
# Metaphor
# ---------------------------------------------------------------------------

class TestMetaphor(unittest.TestCase):
    MIXED = r"""
\section{The kernel as seven organs}\label{sec:organs}
We organize the kernel into seven \emph{organs}, each a contract. That is the
symptom of treating it as a store, and naming the organs surfaces the
connective tissue a list hides.
Each \emph{organ} holds a contract for the layer above it.
The organs are seven, and no more.

\begin{table}[H]
\caption{The seven organs. All seven are disciplines over one SQLite/WAL
file: one commit history, not seven stores.}
\label{tab:seven-organs}
\end{table}

The substrate organ is the floor; the other six are tables with
\emph{discipline} over the same file.
That \emph{discipline} is not enforced by the schema.
A third line naming the discipline the six organs hold.
"""

    def test_mixed_metaphor_is_found_at_section_scope(self):
        with TemporaryDirectory() as d:
            idx = build_index(make_repo(Path(d), self.MIXED))
            sec = next(p for p in idx["metaphor_passages"]
                       if p["scope"] == "section" and p["section"] == "sec:organs")
            self.assertTrue(sec["mixed"])
            self.assertEqual(set(sec["domains"]),
                             {"anatomy", "medicine", "architecture", "moral"})
            terms = {v["term"] for v in sec["vehicles"]}
            self.assertLessEqual({"organ", "symptom", "floor", "discipline"}, terms)

    def test_cash_out_only_in_a_float_caption_is_flagged(self):
        with TemporaryDirectory() as d:
            idx = build_index(make_repo(Path(d), self.MIXED))
            sec = next(p for p in idx["metaphor_passages"]
                       if p["scope"] == "section" and p["section"] == "sec:organs")
            self.assertFalse(sec["cash_out"]["in_prose"])
            self.assertTrue(sec["cash_out"]["only_in_float_caption"])
            self.assertTrue(sec["cash_out"]["judged"],
                            "cash_out is a heuristic and must say so")
            kinds = {c["kind"] for c in sec["cash_out"]["candidates"]}
            self.assertIn("float-caption", kinds)

    def test_a_passage_record_does_not_depend_on_which_concept_reached_it(self):
        """The section's vehicle set is the union over its own paragraphs. It
        was once the union over the paragraphs where one concept happened to
        be mentioned, which made SS1.3 report two domains instead of four."""
        with TemporaryDirectory() as d:
            idx = build_index(make_repo(Path(d), self.MIXED))
            sec_id = next(p["id"] for p in idx["metaphor_passages"]
                          if p["scope"] == "section" and p["section"] == "sec:organs")
            referring = [e for e in idx["entries"]
                         if sec_id in e["metaphor"]["combinations"]["section"]]
            self.assertGreater(len(referring), 1, "fixture should have >1 concept there")
            counts = {e["metaphor"]["max_domains_in_one_section"] for e in referring}
            self.assertEqual(counts, {4},
                             "every concept in the section sees the same four domains")

    def test_a_literal_sentence_that_still_uses_a_vehicle_is_not_a_cash_out(self):
        with TemporaryDirectory() as d:
            idx = build_index(make_repo(Path(d), self.MIXED))
            sec = next(p for p in idx["metaphor_passages"]
                       if p["scope"] == "section" and p["section"] == "sec:organs")
            caption = next(c for c in sec["cash_out"]["candidates"]
                           if c["kind"] == "float-caption" and "SQLite" in c["text"])
            self.assertIn("discipline", caption["still_figurative"])

    def test_a_cashed_out_metaphor_reads_as_cashed_out(self):
        tex = r"""
\section{Plain}\label{sec:plain}
We call the substrate the \emph{floor}.
It is one append-only table in a single SQLite file, one row per commit, written by the daemon alone.
The \emph{floor} is read on every start.
A third floor line.
"""
        with TemporaryDirectory() as d:
            idx = build_index(make_repo(Path(d), tex))
            sec = next(p for p in idx["metaphor_passages"]
                       if p["scope"] == "section" and p["section"] == "sec:plain")
            self.assertTrue(sec["cash_out"]["in_prose"])
            self.assertFalse(sec["cash_out"]["only_in_float_caption"])

    def test_literal_exception_suppresses_and_records(self):
        lex = dict(MINIMAL_LEXICON)
        tex = r"""
\section{Opening}\label{sec:open}
The \textbf{harbour slot} is leased from Berth Ltd, a berth vendor.
A second \textbf{harbour slot} line.
A third harbour slot line.
"""
        with TemporaryDirectory() as d:
            idx = build_index(make_repo(Path(d), tex, lex))
            e = entry(idx, "harbour slot")
            self.assertTrue(any(s["vehicle"] == "berth" for s in e["metaphor"]["suppressed"]),
                            "a suppressed vehicle is recorded, not silently dropped")

    def test_a_negation_is_not_a_cash_out(self):
        """'It is not a database.' scored as a cash-out before the length and
        marker floors were added."""
        tex = r"""
\section{Opening}\label{sec:open}
The kernel has \emph{organs}.
It is not a database.
The organs are seven.
Each organ holds a contract.
"""
        with TemporaryDirectory() as d:
            idx = build_index(make_repo(Path(d), tex))
            secs = [p for p in idx["metaphor_passages"] if p["scope"] == "section"]
            for s in secs:
                for c in s["cash_out"]["candidates"]:
                    self.assertNotEqual(c["text"].strip(), "It is not a database.")


# ---------------------------------------------------------------------------
# First use, the \pdgloss anchor
# ---------------------------------------------------------------------------

class TestFirstUse(unittest.TestCase):
    def test_a_first_use_inside_a_table_is_not_the_gloss_anchor(self):
        tex = r"""
\section{Map}\label{sec:map}
\begin{table}[H]
\caption{Reader's map.}
\label{tab:map}
here for the economy & the continuity organs & later \\
\end{table}

\section{Body}\label{sec:body}
We organize the kernel into seven \emph{organs}, each a contract.
Each \emph{organ} holds a contract.
The organ list is short.
"""
        with TemporaryDirectory() as d:
            idx = build_index(make_repo(Path(d), tex))
            fu = entry(idx, "organ")["first_use"]
            self.assertTrue(fu["appears_first_inside_a_float"])
            self.assertEqual(fu["section"], "sec:map")
            self.assertEqual(fu["first_in_prose"]["section"], "sec:body")
            self.assertTrue(fu["pdgloss_anchor"].endswith(":%d" % fu["first_in_prose"]["line"]))

    def test_every_entry_has_a_first_use(self):
        with TemporaryDirectory() as d:
            idx = build_index(make_repo(Path(d), TestMetaphor.MIXED))
            for e in idx["entries"]:
                self.assertIsNotNone(e["first_use"], e["id"])


# ---------------------------------------------------------------------------
# The staleness check (the mechanism that keeps the index current)
# ---------------------------------------------------------------------------

class TestStalenessCheck(unittest.TestCase):
    def test_check_is_green_right_after_write(self):
        with TemporaryDirectory() as d:
            tmp = make_repo(Path(d), TestMetaphor.MIXED)
            self.assertEqual(run(["--write"], root=tmp).returncode, 0)
            self.assertEqual(run(["--check"], root=tmp).returncode, 0)

    def test_check_fires_when_a_source_changes(self):
        with TemporaryDirectory() as d:
            tmp = make_repo(Path(d), TestMetaphor.MIXED)
            run(["--write"], root=tmp)
            tex = tmp / "whitepaper" / "ch1.tex"
            tex.write_text(tex.read_text() + "\nA \\textbf{new concept} lands. "
                                             "new concept, new concept.\n", encoding="utf-8")
            proc = run(["--check"], root=tmp)
            self.assertEqual(proc.returncode, 1)
            self.assertIn("stale", proc.stderr)

    def test_check_fires_when_the_index_is_hand_edited(self):
        with TemporaryDirectory() as d:
            tmp = make_repo(Path(d), TestMetaphor.MIXED)
            run(["--write"], root=tmp)
            data = json.loads((tmp / INDEX_REL).read_text())
            data["entries"][0]["mention_count"] = 999
            (tmp / INDEX_REL).write_text(json.dumps(data, indent=2) + "\n")
            self.assertEqual(run(["--check"], root=tmp).returncode, 1)

    def test_check_fires_when_the_lexicon_changes(self):
        with TemporaryDirectory() as d:
            tmp = make_repo(Path(d), TestMetaphor.MIXED)
            run(["--write"], root=tmp)
            lex = json.loads((tmp / LEXICON_REL).read_text())
            lex["metaphor_vehicles"]["nautical"].append("store")
            (tmp / LEXICON_REL).write_text(json.dumps(lex))
            self.assertEqual(run(["--check"], root=tmp).returncode, 1)

    def test_build_is_deterministic(self):
        with TemporaryDirectory() as d:
            tmp = make_repo(Path(d), TestMetaphor.MIXED)
            run(["--write"], root=tmp)
            first = (tmp / INDEX_REL).read_bytes()
            run(["--write"], root=tmp)
            self.assertEqual(first, (tmp / INDEX_REL).read_bytes())

    def test_query_exits_nonzero_for_an_unknown_term(self):
        with TemporaryDirectory() as d:
            tmp = make_repo(Path(d), TestMetaphor.MIXED)
            self.assertEqual(run(["--query", "nonesuch"], root=tmp).returncode, 1)


# ---------------------------------------------------------------------------
# Against this repository
# ---------------------------------------------------------------------------

class TestThisRepository(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.index = json.loads((REPO_ROOT / INDEX_REL).read_text(encoding="utf-8"))

    def test_committed_index_is_a_fresh_build(self):
        proc = run(["--check"])
        self.assertEqual(proc.returncode, 0,
                         "run build_concept_index.py --write and commit both outputs\n"
                         + proc.stderr)

    def test_markdown_render_exists_and_is_not_hand_edited(self):
        md = (REPO_ROOT / MD_REL).read_text(encoding="utf-8")
        self.assertIn("Never hand-edit this file", md)

    def test_every_chapter_in_textbook_json_is_indexed(self):
        book = json.loads((REPO_ROOT / "whitepaper" / "textbook.json").read_text())
        self.assertEqual([c["number"] for c in self.index["chapters"]],
                         sorted(c["number"] for c in book["chapters"]))
        for c in self.index["chapters"]:
            self.assertFalse(c["missing"], "%s has no source on disk" % c["id"])
            self.assertTrue(c["files"], "%s resolved to no files" % c["id"])

    def test_required_top_level_keys_match_the_schema(self):
        schema = json.loads((REPO_ROOT / SCHEMA_REL).read_text(encoding="utf-8"))
        for key in schema["required"]:
            self.assertIn(key, self.index)

    def test_library_index_join_is_derived_and_resolves(self):
        lib = json.loads((REPO_ROOT / "docs" / "harbor-research" / "library-index.json")
                         .read_text(encoding="utf-8"))
        known = {e["id"] for e in lib["entries"]}
        joined = 0
        for e in self.index["entries"]:
            for rid in e["library_index_ids"]:
                self.assertIn(rid, known,
                              "%s claims library-index id %s, which does not exist"
                              % (e["id"], rid))
                joined += 1
        self.assertGreater(joined, 0, "the join to library-index.json found nothing")

    def test_every_entry_carries_its_provenance(self):
        for e in self.index["entries"]:
            self.assertIn("judged", e["definition"])
            self.assertIsInstance(e["mention_count"], int)
            for pid in e["metaphor"]["combinations"]["section"]:
                self.assertTrue(pid.startswith("s:"), pid)
            for pid in e["metaphor"]["combinations"]["paragraph"]:
                self.assertTrue(pid.startswith("p:"), pid)

    def test_every_passage_id_referenced_by_an_entry_exists(self):
        known = {p["id"] for p in self.index["metaphor_passages"]}
        for e in self.index["entries"]:
            for scope in ("paragraph", "section", "mixed_sections"):
                for pid in e["metaphor"]["combinations"][scope]:
                    self.assertIn(pid, known, "%s -> %s" % (e["id"], pid))

    def test_every_float_label_an_entry_names_exists_or_is_marked_referenced(self):
        known = {f["label"] for f in self.index["floats"] if f.get("label")}
        for e in self.index["entries"]:
            for f in e["floats"]:
                if f["kind"] != "referenced":
                    self.assertIn(f["label"], known, "%s -> %s" % (e["id"], f["label"]))

    def test_the_specimen_is_still_a_four_domain_uncashed_collision(self):
        """whitepaper/single-writer-kernel.tex SS1.3 'The kernel as seven organs'.

        If this fails because the chapter now cashes its metaphor out in
        prose, that is the Book improving: update the assertion and say so."""
        sec = next((p for p in self.index["metaphor_passages"]
                    if p["scope"] == "section"
                    and p["file"] == SPECIMEN_FILE
                    and p["section"] == SPECIMEN_SECTION_LABEL), None)
        self.assertIsNotNone(sec, "the specimen section is no longer indexed")
        self.assertTrue(sec["mixed"])
        self.assertGreaterEqual(sec["domain_count"], 4)
        self.assertEqual(set(sec["domains"]),
                         {"anatomy", "architecture", "medicine", "moral"})
        terms = {v["term"] for v in sec["vehicles"]}
        for expected in ("organ", "symptom", "connective tissue", "floor", "discipline"):
            self.assertIn(expected, terms)
        self.assertFalse(sec["cash_out"]["in_prose"],
                         "the metaphor is still never cashed out in the prose")
        self.assertTrue(sec["cash_out"]["only_in_float_caption"],
                        "the one literal sentence is still only in the table caption")
        caption = [c for c in sec["cash_out"]["candidates"]
                   if c["kind"] == "float-caption" and "SQLite" in c["text"]]
        self.assertTrue(caption, "the SQLite/WAL sentence is no longer in the caption")
        self.assertEqual(caption[0]["label"], "tab:swk-seven-organs")

    def test_the_organ_entry_points_at_the_specimen(self):
        e = entry(self.index, "organ")
        self.assertIsNotNone(e, "the concept 'organ' must have an entry")
        self.assertIn("s:single-writer-kernel:", " ".join(
            e["metaphor"]["combinations"]["mixed_sections"]))
        self.assertTrue(e["metaphor"]["is_vehicle"])
        self.assertEqual(e["metaphor"]["domain"], "anatomy")
        self.assertGreaterEqual(e["metaphor"]["max_domains_in_one_section"], 4)


if __name__ == "__main__":
    unittest.main()
