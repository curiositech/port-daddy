#!/usr/bin/env python3
"""build_concept_index.py -- the Book's inverted index of concepts, with
metaphor tracking.

`docs/harbor-research/library-index.json` answers "where does each *result*
live?" (R1-R17, theorem labels, figures, scripts, key numbers). Nothing
answered the reader's question: **where does each *idea* live, and what is
the Book pretending it is?** This builds that, mechanically, from the eight
chapter sources `whitepaper/textbook.json` names -- never from a hand-kept
list -- and joins every entry back to the library index by shared label, so
the two indices cannot drift into disagreement: `library_index_ids` on a
concept entry is *derived*, never typed.

Stdlib-only, deterministic, offline. It reads only `.tex` already on disk
(no TeX run, no PDF), resolves `\\input`/`\\include` so a figure fragment's
caption counts as part of its chapter, and sorts every list so two runs over
the same sources are byte-identical.

Reused rather than re-invented (same import idiom as
scripts/harbor-research/check_library_index.py): check_citations' REPO_ROOT,
INPUT_RE, CITE_RE, split_keys and -- especially -- its comment-aware
`strip_comments`, which is the one piece of LaTeX parsing this repo has
already got right three times.

WHAT A CONCEPT IS
    A term the Book *defines or relies on*, not every noun. The harvest is
    mechanical and stated in one rule, so its misses are countable:

      a term is a concept iff it is (marked) AND (repeated)

    MARKED: it appears at least once as the whole content of an \\emph{...}
      or \\textbf{...}, or as a definition environment's title, or as a
      \\pdclaim{Definition}{...} title, or in a \\pdgloss{Term}{...} call
      (none today -- this index is the anchor that says where to put them),
      or as a section/subsection title.
    REPEATED: its normalised surface form occurs >= --min-mentions times
      (default 3) in comment-stripped prose across the Book.

    Both halves are needed. "Marked" alone indexes every rhetorical italic;
    "repeated" alone indexes every English noun.

PARSED vs JUDGED
    Every field carries its provenance. `parsed` fields are a regex over the
    source and are reproducible; `judged` fields apply a heuristic the
    README states in words, and a human is expected to overrule them by
    editing the lexicon, not the output. The two judged fields are
    `definition.judged` (is this a definition or a mention?) and
    `metaphor.*.cash_out` (is this metaphor ever redeemed for a literal
    statement?). Both are stamped in the JSON itself, per entry.

Usage:
    python3 scripts/harbor-research/build_concept_index.py --write
    python3 scripts/harbor-research/build_concept_index.py --check
    python3 scripts/harbor-research/build_concept_index.py --query organ
    python3 scripts/harbor-research/build_concept_index.py --coverage

Exit status: --check exits 1 if the committed index or its Markdown render
is stale (i.e. does not match a fresh build from the sources); --write always
writes and exits 0; --query exits 1 if the term has no entry. Neither
--check nor --write nor --query: prints the coverage report and exits 0.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import defaultdict

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

import check_citations as cc  # noqa: E402  (reused: REPO_ROOT, INPUT_RE, CITE_RE, split_keys, strip_comments)

REPO_ROOT = cc.REPO_ROOT  # overridable below for tests, via --repo-root

TEXTBOOK_REL = "whitepaper/textbook.json"
LIBRARY_INDEX_REL = "docs/harbor-research/library-index.json"
LEXICON_REL = "docs/harbor-research/concept-index.lexicon.json"
INDEX_REL = "docs/harbor-research/concept-index.json"
MD_REL = "docs/harbor-research/CONCEPT-INDEX.md"

DEFAULT_MIN_MENTIONS = 3
SCHEMA_VERSION = 1

# --------------------------------------------------------------------------
# LaTeX surface patterns. All of these run over text that has already been
# through cc.strip_comments, line by line, so a `%` comment never contributes
# a mention, a metaphor, or a concept.
# --------------------------------------------------------------------------

SECTION_RE = re.compile(r"\\(sub)*section\*?\s*\{")
LABEL_RE = re.compile(r"\\label\{([^}]+)\}")
EMPH_RE = re.compile(r"\\(?:emph|textbf|textit)\s*\{")
PDGLOSS_RE = re.compile(r"\\pdgloss\s*\{")
CAPTION_RE = re.compile(r"\\caption\s*\{")
DEF_ENV_RE = re.compile(r"\\begin\{(definition|property|remark)\}\s*(?:\[([^\]]*)\])?")
PDCLAIM_RE = re.compile(r"\\begin\{pdclaim\}\s*\{([^}]*)\}\s*\{")
THM_ENV_RE = re.compile(r"\\begin\{(theorem|lemma|proposition|corollary|conjecture)\}\s*(?:\[([^\]]*)\])?")
PDEXERCISE_RE = re.compile(r"\\begin\{pdexercise\}\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}")
PDSOLUTION_RE = re.compile(r"\\begin\{pdsolution\}\s*\{([^}]*)\}")
FLOAT_BEGIN_RE = re.compile(r"\\begin\{(table\*?|figure\*?|xltabular|longtable)\}")
FLOAT_END_RE = re.compile(r"\\end\{(table\*?|figure\*?|xltabular|longtable)\}")
OP_TOKEN_RE = re.compile(r"\bOP-\d+\b")
CONTROL_WORD_RE = re.compile(r"\\[a-zA-Z@]+\*?")

# Definitional cues: the sentence shapes this Book actually uses to define a
# term in running prose. Used only for the `judged` half of definition
# detection; an environment-backed definition needs no cue.
DEFINITION_CUE_RE = re.compile(
    r"\b(?:is|are)\s+(?:the|a|an)\b"
    r"|\bwe\s+(?:call|name|write|say|define|mean|term)\b"
    r"|\bcall(?:ed)?\s+(?:it|this|these)\b"
    r"|\bis\s+defined\s+as\b|\bdefined\s+to\s+be\b"
    r"|\bby\s+\w+\s+we\s+mean\b"
    r"|\bmeans\s+(?:the|a|an|that)\b"
    r"|\bdenotes?\b|\bstands\s+for\b",
    re.IGNORECASE,
)

# Explanation cues: a passage that explains rather than merely uses.
EXPLANATION_CUE_RE = re.compile(
    r"\bbecause\b|\bthat\s+is\b|\bin\s+other\s+words\b|\bthe\s+reason\b"
    r"|\bintuitively\b|\bwhy\s+(?:this|that|it)\b|\bthe\s+point\s+is\b"
    r"|\bto\s+see\s+(?:this|why)\b|\bwhich\s+is\s+to\s+say\b|\bput\s+another\s+way\b"
    r"|\bthe\s+idea\s+is\b|\bconsider\b|\bfor\s+instance\b|\bfor\s+example\b",
    re.IGNORECASE,
)

OPEN_PROBLEM_CUE_RE = re.compile(
    r"\bopen\s+problems?\b|\bremains?\s+open\b|\bwe\s+do\s+not\s+know\b"
    r"|\bunresolved\b|\bnot\s+(?:yet\s+)?settled\b|\bwe\s+cannot\s+(?:yet\s+)?say\b"
    r"|\bis\s+(?:an\s+)?open\s+question\b|\bstill\s+open\b|\bno\s+one\s+knows\b",
    re.IGNORECASE,
)


def rel(path: str) -> str:
    return os.path.relpath(path, REPO_ROOT)


def abspath(rel_path: str) -> str:
    return os.path.join(REPO_ROOT, rel_path)


def read_json(rel_path: str):
    with open(abspath(rel_path), encoding="utf-8") as fh:
        return json.load(fh)


# --------------------------------------------------------------------------
# Brace-balanced argument reading. `\emph{a \texttt{b} c}` must yield
# "a \texttt{b} c", not "a \texttt{b". re alone cannot do this, and the two
# existing linters both punt on it; the concept harvest cannot.
# --------------------------------------------------------------------------

def read_braced(text: str, open_idx: int) -> tuple[str, int]:
    """text[open_idx] must be '{'. Returns (contents, index just past '}')."""
    assert text[open_idx] == "{"
    depth = 0
    i = open_idx
    n = len(text)
    while i < n:
        ch = text[i]
        if ch == "\\":
            i += 2
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[open_idx + 1:i], i + 1
        i += 1
    return text[open_idx + 1:], n


# Macros whose ARGUMENT is a key, not prose. Keeping them is how a Reader's
# Map row reading `Table~\ref{tab:swk-comm-organ}` became the *first use* of
# the concept "organ" on the first build of this index -- a label is not a
# sentence, and a reader never sees it.
KEY_MACRO_RE = re.compile(
    r"\\(?:label|ref|pageref|eqref|autoref|cref|Cref|vref|nameref"
    r"|cite|pdcite|nocite|citep|citet|bibitem"
    r"|input|include|includegraphics|url|pdprovedon|pdchapterprefix"
    r"|hypertarget|hyperlink|phantomsection|pdglossanchor)\*?\s*(?=\{)")


def strip_key_macros(raw: str) -> str:
    out = []
    i = 0
    n = len(raw)
    while i < n:
        m = KEY_MACRO_RE.search(raw, i)
        if not m:
            out.append(raw[i:])
            break
        out.append(raw[i:m.start()])
        j = raw.index("{", m.end() - 1)
        _body, after = read_braced(raw, j)
        i = after
    return "".join(out)


def detex(raw: str) -> str:
    """Macro names out, their arguments' text kept -- margin_lint.py's
    TEX_CONTROL_WORD_RE idiom, extended to drop the braces too so
    `\\textbf{substrate organ}` reads as the words a reader sees, and to drop
    key-macro arguments entirely so a `\\label` never reads as prose."""
    out = CONTROL_WORD_RE.sub(" ", strip_key_macros(raw))
    out = out.replace("{", " ").replace("}", " ").replace("$", " ")
    out = out.replace("~", " ").replace("\\", " ")
    out = re.sub(r"[ \t]+", " ", out)
    return out.strip()


def normalise_term(raw: str) -> str:
    """Surface form -> concept id. Lowercase, de-TeX'd, punctuation-trimmed."""
    t = detex(raw).lower()
    t = t.replace("---", " ").replace("--", " ")
    t = re.sub(r"[^a-z0-9 \-/']+", " ", t)
    t = re.sub(r"\s+", " ", t).strip(" -/'")
    return t


# --------------------------------------------------------------------------
# One parsed source file.
# --------------------------------------------------------------------------

class SourceFile:
    """A .tex file, comment-stripped once, with the maps every pass needs:
    line -> section, line -> paragraph, line -> enclosing float/exercise."""

    def __init__(self, path: str, chapter: dict):
        self.path = path
        self.relpath = rel(path)
        self.chapter = chapter
        with open(path, encoding="utf-8", errors="replace") as fh:
            raw_lines = fh.read().split("\n")
        # 1-based: code[0] is a sentinel so code[n] is source line n.
        self.code = [""] + [cc.strip_comments(ln) for ln in raw_lines]
        self.prose = [""] + [detex(ln) for ln in self.code[1:]]
        self.prose_lower = [p.lower() for p in self.prose]
        self.nlines = len(self.code) - 1
        # Hyphens are NOT word characters here. They were, once, and the
        # effect was that "read-poverty" tokenised as a single word, so
        # find_mentions' head-word prefilter ("read") never matched and every
        # hyphenated concept in the Book scored zero mentions.
        self.words = set()
        for p in self.prose_lower[1:]:
            self.words.update(re.findall(r"[a-z0-9']+", p))
        self._map_sections()
        self._map_paragraphs()
        self._map_floats()
        self._map_exercises()
        self._map_definition_envs()

    # -- sections ---------------------------------------------------------
    def _map_sections(self) -> None:
        self.sections: list[dict] = []
        joined_cache = {}
        for n in range(1, self.nlines + 1):
            line = self.code[n]
            m = SECTION_RE.search(line)
            if not m:
                continue
            depth = line.count("sub", m.start(), m.end())
            open_idx = line.index("{", m.end() - 1)
            title, _ = read_braced(line, open_idx)
            # The \label may be on this line or the next few.
            label = None
            for k in range(n, min(n + 4, self.nlines + 1)):
                lm = LABEL_RE.search(self.code[k])
                if lm and lm.group(1).startswith(("sec:", "app:")):
                    label = lm.group(1)
                    break
            self.sections.append({
                "line": n, "depth": depth, "title": detex(title), "label": label,
            })
        self.section_of = [None] * (self.nlines + 2)
        cur = None
        si = 0
        for n in range(1, self.nlines + 1):
            while si < len(self.sections) and self.sections[si]["line"] == n:
                cur = self.sections[si]
                si += 1
            self.section_of[n] = cur
        del joined_cache

    # -- paragraphs -------------------------------------------------------
    def _map_paragraphs(self) -> None:
        """A paragraph is a maximal run of non-blank comment-stripped lines.
        A sectioning command, a float boundary, and \\par each end one --
        which is what a reader sees, and is why the specimen's two halves
        (before and after Table 1.1) are two paragraphs at paragraph scope
        and one collision at section scope."""
        self.paragraphs: list[dict] = []
        self.paragraph_of = [None] * (self.nlines + 2)
        start = None
        for n in range(1, self.nlines + 2):
            line = self.code[n] if n <= self.nlines else ""
            breaks = (
                not line.strip()
                or SECTION_RE.search(line)
                or FLOAT_BEGIN_RE.search(line)
                or FLOAT_END_RE.search(line)
                or r"\par" in line
                or line.lstrip().startswith(r"\begin{")
                or line.lstrip().startswith(r"\end{")
                or line.lstrip().startswith(r"\item")
            )
            if breaks:
                if start is not None and n - 1 >= start:
                    self._close_paragraph(start, n - 1)
                start = None
                if line.strip() and not (not line.strip()):
                    # a structural line is its own one-line paragraph only if
                    # it carries prose (an \item does; \begin{table} does not)
                    if line.lstrip().startswith(r"\item") and detex(line).strip():
                        self._close_paragraph(n, n)
            else:
                if start is None:
                    start = n
        if start is not None:
            self._close_paragraph(start, self.nlines)
        self.paragraphs.sort(key=lambda p: p["start"])
        for p in self.paragraphs:
            for n in range(p["start"], p["end"] + 1):
                if self.paragraph_of[n] is None:
                    self.paragraph_of[n] = p

    def _close_paragraph(self, start: int, end: int) -> None:
        """Joins the paragraph's prose lines AND keeps a char-offset -> line
        map, so a phrase broken across a source line break ("single\\nwriter")
        is still found and still attributed to the right line. Searching line
        by line, as the two existing linters do, silently loses those."""
        pieces = []
        offsets = []
        pos = 0
        for n in range(start, end + 1):
            p = self.prose[n]
            if not p:
                continue
            offsets.append((pos, n))
            pieces.append(p)
            pos += len(p) + 1
        text = " ".join(pieces).strip()
        if not text:
            return
        self.paragraphs.append({
            "start": start, "end": end, "text": text, "lower": text.lower(),
            "offsets": offsets,
            "words": set(re.findall(r"[a-z0-9']+", text.lower())),
        })

    @staticmethod
    def line_at(para: dict, offset: int) -> int:
        line = para["start"]
        for off, n in para["offsets"]:
            if off > offset:
                break
            line = n
        return line

    # -- floats (tables, figures) and their captions ----------------------
    def _map_floats(self) -> None:
        self.floats: list[dict] = []
        self.float_of = [None] * (self.nlines + 2)
        stack: list[dict] = []
        for n in range(1, self.nlines + 1):
            line = self.code[n]
            for m in FLOAT_BEGIN_RE.finditer(line):
                stack.append({"kind": m.group(1).rstrip("*"), "start": n,
                              "caption": None, "caption_line": None, "label": None})
            if stack:
                cm = CAPTION_RE.search(line)
                if cm and stack[-1]["caption"] is None:
                    # a caption can run over lines; join forward until balanced
                    chunk = line[line.index("{", cm.end() - 1):]
                    k = n
                    while chunk.count("{") > chunk.count("}") and k < self.nlines:
                        k += 1
                        chunk += "\n" + self.code[k]
                    body, _ = read_braced(chunk, 0)
                    stack[-1]["caption"] = detex(body)
                    stack[-1]["caption_line"] = n
                    stack[-1]["caption_end"] = k
                lm = LABEL_RE.search(line)
                if lm and stack[-1]["label"] is None:
                    stack[-1]["label"] = lm.group(1)
            for _m in FLOAT_END_RE.finditer(line):
                if stack:
                    fl = stack.pop()
                    fl["end"] = n
                    self.floats.append(fl)
        for fl in self.floats:
            for n in range(fl["start"], fl.get("end", fl["start"]) + 1):
                self.float_of[n] = fl
        self.floats.sort(key=lambda f: f["start"])

    # -- definition environments ------------------------------------------
    def _map_definition_envs(self) -> None:
        """Spans of `definition`, and of `pdclaim{Definition}{...}`. A term
        emphasised INSIDE one of these is defined there -- parsed, not judged
        -- which is how the Book actually writes a definition: the environment
        carries a prose title ("Consent grant"), and the defined term is the
        \\textbf inside the body ("a \\textbf{consent grant} is ...")."""
        self.def_envs: list[dict] = []
        self.def_env_of = [None] * (self.nlines + 2)
        open_env = None
        for n in range(1, self.nlines + 1):
            line = self.code[n]
            if open_env is None:
                m = DEF_ENV_RE.search(line)
                pm = PDCLAIM_RE.search(line)
                if m and m.group(1) == "definition":
                    open_env = {"env": "definition", "title": detex(m.group(2) or ""),
                                "start": n, "label": None}
                elif pm and pm.group(1).strip().lower().startswith("def"):
                    body, _ = read_braced(line, line.index("{", pm.end() - 1))
                    open_env = {"env": "pdclaim", "title": detex(body),
                                "start": n, "label": None}
                if open_env:
                    lm = LABEL_RE.search(line)
                    if lm:
                        open_env["label"] = lm.group(1)
                    continue
            else:
                if open_env["label"] is None:
                    lm = LABEL_RE.search(line)
                    if lm:
                        open_env["label"] = lm.group(1)
                if r"\end{definition}" in line or r"\end{pdclaim}" in line:
                    open_env["end"] = n
                    self.def_envs.append(open_env)
                    open_env = None
        for d in self.def_envs:
            for n in range(d["start"], d.get("end", d["start"]) + 1):
                self.def_env_of[n] = d

    # -- exercises and their solutions ------------------------------------
    def _map_exercises(self) -> None:
        self.exercises: list[dict] = []
        self.solutions: list[dict] = []
        cur = None
        for n in range(1, self.nlines + 1):
            line = self.code[n]
            m = PDEXERCISE_RE.search(line)
            if m:
                cur = {"label": m.group(2).strip(), "opts": (m.group(1) or "").strip(),
                       "start": n, "end": n, "text": "", "kind": "exercise"}
                self.exercises.append(cur)
                continue
            s = PDSOLUTION_RE.search(line)
            if s:
                cur = {"label": s.group(1).strip(), "start": n, "end": n,
                       "text": "", "kind": "solution"}
                self.solutions.append(cur)
                continue
            if r"\end{pdexercise}" in line or r"\end{pdsolution}" in line:
                cur = None
                continue
            if cur is not None:
                cur["end"] = n
                cur["text"] += " " + self.prose[n]
        for e in self.exercises + self.solutions:
            e["text"] = e["text"].strip()
            e["lower"] = e["text"].lower()


# --------------------------------------------------------------------------
# Corpus assembly: chapters from textbook.json, files from \input resolution.
# --------------------------------------------------------------------------

def resolve_inputs(top_path: str, seen: set[str], depth: int = 0) -> list[str]:
    ap = os.path.normpath(top_path)
    if ap in seen or depth > 15 or not os.path.isfile(ap):
        return []
    seen.add(ap)
    found = [ap]
    file_dir = os.path.dirname(ap)
    with open(ap, encoding="utf-8", errors="replace") as fh:
        for raw_line in fh:
            code = cc.strip_comments(raw_line.rstrip("\n"))
            for m in cc.INPUT_RE.finditer(code):
                target = m.group(1).strip()
                if not target.lower().endswith(".tex"):
                    target += ".tex"
                found.extend(resolve_inputs(os.path.join(file_dir, target), seen, depth + 1))
    return found


# Shared preamble/apparatus files every chapter \inputs. They carry macro
# definitions, not chapter prose: a concept "defined" in pd-pedagogy.tex is a
# LaTeX macro, not an idea, and indexing them would give every chapter the
# same 40 phantom mentions.
SHARED_INPUT_STEMS = {
    "pd-palette", "pd-pedagogy", "pd-figure-language", "pd-textbook-map",
    "pd-hyperlinks", "pd-cite-shortforms", "pd-discharges", "pd-marginalia",
}


def load_corpus(min_mentions: int) -> tuple[list[dict], list[SourceFile]]:
    textbook = read_json(TEXTBOOK_REL)
    chapters = []
    files: list[SourceFile] = []
    for ch in sorted(textbook["chapters"], key=lambda c: c["number"]):
        src = abspath(ch["source"])
        if not os.path.isfile(src):
            chapters.append({**ch, "missing": True})
            continue
        seen: set[str] = set()
        paths = resolve_inputs(src, seen)
        kept = [p for p in paths
                if os.path.splitext(os.path.basename(p))[0] not in SHARED_INPUT_STEMS]
        meta = {
            "number": ch["number"], "id": ch["id"], "prefix": ch["prefix"],
            "title": ch["title"], "source": ch["source"],
            "files": [rel(p) for p in kept],
        }
        chapters.append(meta)
        for p in kept:
            files.append(SourceFile(p, meta))
    return chapters, files


# --------------------------------------------------------------------------
# Pass 1 -- harvest concept candidates (the MARKED half of the rule).
# --------------------------------------------------------------------------

def harvest_marks(files: list[SourceFile]) -> dict[str, list[dict]]:
    """concept id -> list of mark records (each says how it was marked)."""
    marks: dict[str, list[dict]] = defaultdict(list)

    def add(term: str, kind: str, sf: SourceFile, line: int, extra=None) -> None:
        cid = normalise_term(term)
        if not cid:
            return
        rec = {"kind": kind, "file": sf.relpath, "line": line,
               "chapter": sf.chapter["number"], "surface": detex(term).strip()}
        if extra:
            rec.update(extra)
        marks[cid].append(rec)

    for sf in files:
        for n in range(1, sf.nlines + 1):
            line = sf.code[n]
            if not line.strip():
                continue
            for m in EMPH_RE.finditer(line):
                try:
                    body, _ = read_braced(line, line.index("{", m.end() - 1))
                except ValueError:
                    continue
                denv = sf.def_env_of[n]
                if denv is not None:
                    add(body, "definition-env-body", sf, n,
                        {"env": denv["env"], "label": denv.get("label"),
                         "env_title": denv.get("title")})
                else:
                    add(body, "emphasis", sf, n)
            for m in PDGLOSS_RE.finditer(line):
                try:
                    body, _ = read_braced(line, line.index("{", m.end() - 1))
                except ValueError:
                    continue
                add(body, "pdgloss", sf, n)
            for m in DEF_ENV_RE.finditer(line):
                if m.group(2):
                    denv = sf.def_env_of[n]
                    add(m.group(2), "definition-env", sf, n,
                        {"env": m.group(1), "label": (denv or {}).get("label")})
            for m in THM_ENV_RE.finditer(line):
                if m.group(2):
                    lm = LABEL_RE.search(line)
                    add(m.group(2), "claim-env", sf, n,
                        {"env": m.group(1), "label": lm.group(1) if lm else None})
            for m in PDCLAIM_RE.finditer(line):
                try:
                    body, _ = read_braced(line, line.index("{", m.end() - 1))
                except ValueError:
                    continue
                kind = "definition-env" if m.group(1).strip().lower().startswith("def") else "claim-env"
                denv = sf.def_env_of[n] if kind == "definition-env" else None
                add(body, kind, sf, n, {"env": "pdclaim", "claim_kind": m.group(1).strip(),
                                        "label": (denv or {}).get("label")})
        for sec in sf.sections:
            add(sec["title"], "section-title", sf, sec["line"],
                {"label": sec["label"], "depth": sec["depth"]})
        for fl in sf.floats:
            if fl.get("caption") and fl.get("label"):
                add(fl["caption"].split(".")[0], "caption-head", sf,
                    fl.get("caption_line") or fl["start"], {"label": fl["label"]})
    return marks


# A structural mark is the Book asserting "this is a term", not merely
# stressing a word. Plain \emph / \textbf is the Book's stress idiom AND its
# term idiom, which is why a bare emphasis is never enough on its own.
STRUCTURAL_MARKS = frozenset({
    "definition-env", "definition-env-body", "pdgloss",
    "claim-env", "section-title", "caption-head",
})

# Single words in these shapes are verbs or adverbs, not concepts
# ("revoked", "propagates", "recompute" as a bare \emph is stress). A
# structural mark overrides this -- a definition environment may well define
# a participle.
VERBISH_SUFFIXES = ("ed", "ing", "ly")


def plausible_concept(cid: str, stopwords: set[str]) -> tuple[bool, str]:
    """-> (keep, reason-if-dropped). Every rejection is recorded in the
    index's `dropped_candidates`, so a miss is countable rather than silent."""
    if not cid:
        return False, "empty after normalisation"
    if cid in stopwords:
        return False, "stopword phrase"
    words = cid.split()
    if not (1 <= len(words) <= 4):
        return False, "%d words (concepts are 1-4)" % len(words)
    if len(cid) < 4:
        return False, "shorter than 4 characters"
    if not re.fullmatch(r"[a-z][a-z0-9 \-/']*", cid):
        return False, "not a plain lowercase word or phrase"
    if words[-1] in stopwords:
        return False, "ends in a function word"
    if all(w in stopwords for w in words):
        return False, "every word is a function word"
    return True, ""


def concept_admitted(cid: str, marks: list[dict], stopwords: set[str]) -> tuple[bool, str]:
    """The MARKED half of the harvest rule, as one function so the README and
    the code cannot disagree about it."""
    ok, why = plausible_concept(cid, stopwords)
    if not ok:
        return False, why
    structural = {m["kind"] for m in marks} & STRUCTURAL_MARKS
    if structural:
        return True, ""
    words = cid.split()
    if len(words) == 1 and cid.endswith(VERBISH_SUFFIXES):
        return False, "single verb/adverb form, emphasised but never defined or titled"
    if len(marks) < 2:
        return False, "marked once, by emphasis only (stress, not a term of art)"
    return True, ""


# --------------------------------------------------------------------------
# Pass 2 -- mentions (the REPEATED half), and everything keyed off them.
# --------------------------------------------------------------------------

def term_regex(cid: str, aliases: list[str]) -> re.Pattern:
    forms = sorted({cid, *aliases}, key=lambda s: (-len(s), s))
    alts = []
    for f in forms:
        # tolerate hyphen/space variance ("single writer" ~ "single-writer")
        parts = [re.escape(p) for p in re.split(r"[ \-]", f) if p]
        alts.append(r"[\s\-]+".join(parts) + r"(?:s|es)?")
    return re.compile(r"(?<![a-z0-9])(?:" + "|".join(alts) + r")(?![a-z0-9])", re.IGNORECASE)


def find_mentions(files: list[SourceFile], cid: str, aliases: list[str]) -> list[dict]:
    """Every use site, one record per (file, line). Searches paragraph text
    rather than single lines so a phrase split across a line break counts,
    and prefilters on the head word so the scan is cheap enough for CI."""
    rx = term_regex(cid, aliases)
    head = re.split(r"[ \-]", cid)[0].lower()
    head_forms = {head, head + "s", head + "es"}
    out: list[dict] = []
    for sf in files:
        if not (head_forms & sf.words):
            continue
        for para in sf.paragraphs:
            if not (head_forms & para["words"]):
                continue
            hit_lines = set()
            for m in rx.finditer(para["text"]):
                hit_lines.add(SourceFile.line_at(para, m.start()))
            for n in sorted(hit_lines):
                sec = sf.section_of[n]
                fl = sf.float_of[n]
                out.append({
                    "file": sf.relpath,
                    "line": n,
                    "chapter": sf.chapter["number"],
                    "section": (sec or {}).get("label"),
                    "section_title": (sec or {}).get("title"),
                    "context": "float:" + fl["kind"] if fl else "prose",
                })
    out.sort(key=lambda m: (m["chapter"], m["file"], m["line"]))
    return out


# --------------------------------------------------------------------------
# Pass 3 -- metaphor.
# --------------------------------------------------------------------------

class Lexicon:
    def __init__(self, data: dict):
        self.raw = data
        self.vehicle_domain: dict[str, str] = {}
        for domain, vehicles in sorted(data["metaphor_vehicles"].items()):
            if domain.startswith("$"):
                continue
            for v in vehicles:
                self.vehicle_domain[v.lower()] = domain
        self.exceptions = {k.lower(): v for k, v in data.get("vehicle_literal_exceptions", {}).items()
                           if not k.startswith("$")}
        co = data["cash_out_markers"]
        self.cash_min = int(co.get("min_markers", 1))
        self.cash_min_chars = int(co.get("min_sentence_chars", 40))
        self.cash_markers = [m for m in co["markers"]]
        self.cash_rx = re.compile(
            r"(?<![A-Za-z0-9])(?:" + "|".join(re.escape(m) for m in
                                              sorted(self.cash_markers, key=len, reverse=True))
            + r")(?![A-Za-z0-9])")
        self.stopwords = set(data["concept_stopwords"]["phrases"])
        self.aliases = {k: v for k, v in data.get("concept_aliases", {}).items()
                        if not k.startswith("$")}
        self.force = list(data.get("concept_force_include", {}).get("terms", []))
        self._vrx = {v: re.compile(r"(?<![a-z0-9])" + r"[\s\-]+".join(re.escape(p) for p in v.split())
                                   + r"(?:s|es)?(?![a-z0-9])", re.IGNORECASE)
                     for v in self.vehicle_domain}
        # One combined pass finds the candidates; the per-vehicle regexes then
        # only run on the few that could match. Without this the metaphor pass
        # is ~180 regex scans per paragraph per concept and the build takes
        # minutes instead of seconds.
        self._any_vehicle_rx = re.compile(
            "|".join(r"(?<![a-z0-9])" + r"[\s\-]+".join(re.escape(p) for p in v.split())
                     + r"(?:s|es)?(?![a-z0-9])"
                     for v in sorted(self.vehicle_domain, key=len, reverse=True)),
            re.IGNORECASE)
        self._vehicles_cache: dict[str, list[tuple[str, str]]] = {}
        self._suppressed_cache: dict[str, list[tuple[str, str]]] = {}

    def _scan(self, text: str) -> tuple[list, list]:
        hits, supp = [], []
        if self._any_vehicle_rx.search(text):
            for v, rx in self._vrx.items():
                if not rx.search(text):
                    continue
                exc = [e for e in self.exceptions.get(v, []) if e in text]
                if exc:
                    supp.append((v, exc[0]))
                else:
                    hits.append((v, self.vehicle_domain[v]))
        return sorted(set(hits)), sorted(set(supp))

    def vehicles_in(self, text: str) -> list[tuple[str, str]]:
        """-> sorted [(vehicle, domain)] found in text, exceptions applied."""
        got = self._vehicles_cache.get(text)
        if got is None:
            got, supp = self._scan(text)
            self._vehicles_cache[text] = got
            self._suppressed_cache[text] = supp
        return got

    def suppressed_in(self, text: str) -> list[tuple[str, str]]:
        if text not in self._suppressed_cache:
            self.vehicles_in(text)
        return self._suppressed_cache[text]

    def is_cash_out(self, sentence: str) -> bool:
        """A sentence redeems a metaphor when it names mechanism, at length,
        and (checked by the caller via `still_figurative`) does not itself
        reach for another vehicle. JUDGED, not parsed -- the length floor and
        the marker count are both tuned by hand, and a bare negation ("It is
        not a database.") is exactly what the floor is there to reject."""
        if len(sentence) < self.cash_min_chars:
            return False
        return len(set(self.cash_rx.findall(sentence))) >= self.cash_min


SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?:;])\s+")


_CASH_CACHE: dict[tuple, list[dict]] = {}


def cash_out_candidates(lex: Lexicon, sf: SourceFile, start: int, end: int,
                        vehicles: set[str]) -> list[dict]:
    """Sentences in [start,end] that state literally what the vehicles gesture
    at: a mechanism named, no vehicle of its own. Each records whether it sits
    in prose or in a float's caption -- the distinction the specimen turns on.

    The span scan is cached; only `still_figurative`, which is the only part
    that depends on the calling concept's vehicle set, is recomputed."""
    key = (sf.relpath, start, end)
    raw = _CASH_CACHE.get(key)
    if raw is None:
        hi = min(end, sf.nlines)
        # Blocks a reader reads as a unit, not source lines: a sentence that
        # runs over three lines is one sentence, and a float's caption is one
        # block wherever its \caption happens to start.
        blocks: list[tuple[str, int, str, str | None]] = []  # (kind, line, text, label)
        for fl in sf.floats:
            if not (start <= fl["start"] <= hi):
                continue
            if fl.get("caption"):
                blocks.append(("float-caption", fl.get("caption_line") or fl["start"],
                               fl["caption"], fl.get("label")))
        for para in sf.paragraphs:
            if not (start <= para["start"] <= hi):
                continue
            fl = sf.float_of[para["start"]]
            if fl is None:
                blocks.append(("prose", para["start"], para["text"], None))
            elif not (fl.get("caption_line") is not None
                      and para["start"] <= fl.get("caption_end", fl["caption_line"])
                      and para["end"] >= fl["caption_line"]):
                # a paragraph that IS the caption is already a float-caption
                # block; emitting it twice double-counts one sentence
                blocks.append(("float-body", para["start"], para["text"], fl.get("label")))
        raw = []
        for kind, line, text, label in blocks:
            for sent in SENTENCE_SPLIT_RE.split(text):
                sent = sent.strip()
                if not lex.is_cash_out(sent):
                    continue
                own = {v for v, _d in lex.vehicles_in(sent)}
                raw.append({
                    "file": sf.relpath, "line": line, "kind": kind,
                    "label": label,
                    "text": sent[:300],
                    "_own": sorted(own),
                })
        raw.sort(key=lambda c: (c["line"], c["kind"], c["text"]))
        _CASH_CACHE[key] = raw
    out = []
    for c in raw:
        own = set(c["_own"])
        out.append({k: v for k, v in c.items() if k != "_own"} |
                   {"still_figurative": sorted(own & vehicles) or sorted(own)})
    return out


class PassageRegistry:
    """A mixed-metaphor passage is a fact about the PASSAGE, not about any one
    concept that happens to sit in it.

    Two things follow, and the first build of this file got both wrong. (1)
    Each passage is recorded ONCE and referred to by id; writing it into every
    concept that sits in it produced a 33 MB index and the same
    two-lists-that-must-agree defect this repo keeps regrowing. (2) Each
    passage's vehicle set is computed from the PASSAGE, not from the mentions
    of whichever concept reached it first -- otherwise the section record for
    §1.3 came out holding two domains when the section holds four, because
    the concept that registered it was only mentioned in half the paragraphs.
    """

    def __init__(self) -> None:
        self.by_id: dict[str, dict] = {}
        self.paragraph_at: dict[tuple, str] = {}   # (file, para_start) -> id
        self.section_at: dict[tuple, str] = {}     # (file, section_line) -> id

    @staticmethod
    def _key(scope: str, relpath: str, lo: int, hi: int) -> str:
        stem = os.path.splitext(os.path.basename(relpath))[0]
        return "%s:%s:%d-%d" % (scope[0], stem, lo, hi)

    def add(self, rec: dict) -> str:
        pid = self._key(rec["scope"], rec["file"], rec["line_start"], rec["line_end"])
        prev = self.by_id.get(pid)
        if prev is not None and prev["file"] != rec["file"]:
            pid = "%s:%s:%d-%d" % (rec["scope"][0], rec["file"],
                                   rec["line_start"], rec["line_end"])
        self.by_id.setdefault(pid, dict(rec, id=pid))
        return pid

    def table(self) -> list[dict]:
        return [self.by_id[k] for k in sorted(self.by_id)]


def _passage_record(lex: Lexicon, sf: SourceFile, scope: str, lo: int, hi: int,
                    vehicles: list[tuple[str, str]]) -> dict:
    domains = sorted({d for _v, d in vehicles})
    cash = cash_out_candidates(lex, sf, lo, hi, {v for v, _d in vehicles})
    seen = set()
    deduped = []
    for c in cash:
        k = (c["line"], c["text"])
        if k in seen:
            continue
        seen.add(k)
        deduped.append(c)
    in_prose = any(c["kind"] == "prose" and not c["still_figurative"] for c in deduped)
    sec = sf.section_of[lo]
    return {
        "scope": scope,
        "file": sf.relpath,
        "chapter": sf.chapter["number"],
        "section": (sec or {}).get("label"),
        "section_title": (sec or {}).get("title"),
        "line_start": lo,
        "line_end": hi,
        "line_span": hi - lo + 1,
        "vehicles": [{"term": v, "domain": d} for v, d in vehicles],
        "domains": domains,
        "domain_count": len(domains),
        "mixed": len(domains) >= 2,
        "cash_out": {
            "judged": True,
            "in_prose": in_prose,
            "only_in_float_caption": (bool(deduped) and not in_prose
                                      and any(c["kind"] == "float-caption" for c in deduped)),
            "candidates": deduped[:6],
        },
    }


def _worst_first(c: dict) -> tuple:
    """Rank a metaphor passage by how much it costs a reader.

    1. Never cashed out anywhere beats cashed out in prose.
    2. Among those, cashed out ONLY in a float caption is worst: the author
       DID write the literal sentence and then put it where a prose reader
       will not meet it. That is the specimen this index was built for.
    3. Then most domains, then TIGHTEST. Without the span tiebreak a
       chapter's 400-line Exercises block wins every time -- sixty exercises
       accumulate vehicles by sheer length, which is a long section, not a
       mixed metaphor.
    """
    co = c["cash_out"]
    return (co["in_prose"], not co.get("only_in_float_caption"),
            -c["domain_count"], c["line_span"], c["id"])


def build_passages(lex: Lexicon, files: list[SourceFile]) -> PassageRegistry:
    """Every paragraph, and every section, that reaches for at least one
    metaphor vehicle -- computed once over the corpus, before any concept is
    considered."""
    reg = PassageRegistry()
    for sf in files:
        per_section: dict[int, set] = {}
        for para in sf.paragraphs:
            vehicles = lex.vehicles_in(para["text"])
            if not vehicles:
                continue
            pid = reg.add(_passage_record(lex, sf, "paragraph",
                                          para["start"], para["end"], sorted(vehicles)))
            reg.paragraph_at[(sf.relpath, para["start"])] = pid
            sec = sf.section_of[para["start"]]
            per_section.setdefault(sec["line"] if sec else para["start"], set()).update(vehicles)
        for i, sec in enumerate(sf.sections):
            vehicles = per_section.get(sec["line"])
            if not vehicles:
                continue
            hi = (sf.sections[i + 1]["line"] - 1) if i + 1 < len(sf.sections) else sf.nlines
            sid = reg.add(_passage_record(lex, sf, "section", sec["line"], hi,
                                          sorted(vehicles)))
            reg.section_at[(sf.relpath, sec["line"])] = sid
        # paragraphs before the file's first \section have no section record
        for lo, vset in per_section.items():
            if any(s["line"] == lo for s in sf.sections) or not vset:
                continue
            para = sf.paragraph_of[lo]
            sid = reg.add(_passage_record(lex, sf, "section", lo,
                                          para["end"] if para else lo, sorted(vset)))
            reg.section_at[(sf.relpath, lo)] = sid
    return reg


def metaphor_for(lex: Lexicon, files: list[SourceFile], cid: str,
                 aliases: list[str], mentions: list[dict],
                 registry: PassageRegistry) -> dict:
    """The metaphor record for one concept, in two halves: this concept AS a
    vehicle, and the passages it shares with other vehicles. The passages
    themselves live in the shared table; this only says which ones it is in."""
    by_file = {sf.relpath: sf for sf in files}
    forms = sorted({cid, *aliases})
    is_vehicle = next((f for f in forms if f in lex.vehicle_domain), None)

    occurrences: list[dict] = []
    suppressed: list[dict] = []
    para_ids: list[str] = []
    sect_ids: list[str] = []
    seen_paras: set[tuple] = set()

    for m in mentions:
        sf = by_file.get(m["file"])
        if sf is None:
            continue
        para = sf.paragraph_of[m["line"]]
        if para is None:
            continue
        if is_vehicle:
            occurrences.append({"file": sf.relpath, "line": m["line"],
                                "chapter": m["chapter"]})
        key = (sf.relpath, para["start"])
        if key in seen_paras:
            continue
        seen_paras.add(key)
        for v, why in lex.suppressed_in(para["text"]):
            suppressed.append({"vehicle": v, "file": sf.relpath,
                               "line": para["start"], "reason_marker": why})
        pid = registry.paragraph_at.get(key)
        if pid and pid not in para_ids:
            para_ids.append(pid)
        sec = sf.section_of[para["start"]]
        sid = registry.section_at.get((sf.relpath, sec["line"] if sec else para["start"]))
        if sid and sid not in sect_ids:
            sect_ids.append(sid)

    para_ids.sort()
    sect_ids.sort()
    paras = [registry.by_id[i] for i in para_ids]
    sects = [registry.by_id[i] for i in sect_ids]
    mixed_sections = [c["id"] for c in sects if c["mixed"]]
    return {
        "is_vehicle": bool(is_vehicle),
        "vehicle": is_vehicle,
        "domain": lex.vehicle_domain.get(is_vehicle) if is_vehicle else None,
        "occurrence_count": len(occurrences),
        "occurrences": group_mentions(occurrences),
        "suppressed": suppressed[:12],
        "max_domains_in_one_paragraph": max([c["domain_count"] for c in paras] + [0]),
        "max_domains_in_one_section": max([c["domain_count"] for c in sects] + [0]),
        # Ids into the top-level `metaphor_passages` table.
        "combinations": {
            "paragraph": para_ids,
            "section": sect_ids,
            "mixed_sections": mixed_sections,
            "mixed_paragraph_count": sum(1 for c in paras if c["mixed"]),
            # Worst = never cashed out first, then most domains, then
            # TIGHTEST. Without the span tiebreak a chapter's 400-line
            # Exercises block wins every time: sixty exercises accumulate
            # vehicles by sheer length, which is not a mixed metaphor, it is a
            # long section. The collision worth reading is the dense one.
            "worst_section": next(
                (c["id"] for c in sorted(sects, key=_worst_first) if c["mixed"]), None),
        },
    }



# --------------------------------------------------------------------------
# Pass 4 -- the per-concept apparatus fields.
# --------------------------------------------------------------------------

def group_mentions(mentions: list[dict]) -> list[dict]:
    """Every use site, grouped by file. A mention is (file, line) and nothing
    else: its section, and whether it sits in a float, are properties of the
    LINE, and live once in the top-level `sections` and `floats` tables rather
    than being restated 29,000 times."""
    by_file: dict[tuple, list[int]] = {}
    for m in mentions:
        by_file.setdefault((m["chapter"], m["file"]), []).append(m["line"])
    return [{"chapter": ch, "file": f, "lines": sorted(set(lines))}
            for (ch, f), lines in sorted(by_file.items())]


def build_entry(lex: Lexicon, files: list[SourceFile], chapters: list[dict],
                cid: str, marks: list[dict], libindex: dict,
                registry: PassageRegistry) -> dict:
    by_file = {sf.relpath: sf for sf in files}
    aliases = lex.aliases.get(cid, [])
    mentions = find_mentions(files, cid, aliases)
    rx = term_regex(cid, aliases)

    # -- definition ------------------------------------------------------
    definitions = []
    for mk in marks:
        if mk["kind"] == "definition-env-body":
            definitions.append({**mk, "judged": False,
                                "why": "emphasised inside a %s environment%s"
                                       % (mk.get("env", "definition"),
                                          " (%s)" % mk["label"] if mk.get("label") else "")})
        elif mk["kind"] in ("definition-env", "pdgloss"):
            definitions.append({**mk, "judged": False,
                                "why": "the term is the title of a %s" % mk.get("env", "gloss")})
    if not definitions:
        for m in mentions:
            sf = by_file[m["file"]]
            para = sf.paragraph_of[m["line"]]
            if para is None:
                continue
            emph_here = any(k["file"] == m["file"] and para["start"] <= k["line"] <= para["end"]
                            and k["kind"] == "emphasis" for k in marks)
            if not emph_here:
                continue
            for sent in SENTENCE_SPLIT_RE.split(para["text"]):
                if rx.search(sent) and DEFINITION_CUE_RE.search(sent):
                    definitions.append({
                        "kind": "prose-definition", "file": m["file"], "line": m["line"],
                        "chapter": m["chapter"], "section": m["section"],
                        "surface": cid, "judged": True,
                        "why": "emphasised in a sentence carrying a definitional cue",
                        "text": sent.strip()[:200],
                    })
                    break
            if definitions:
                break
    # A parsed (environment-backed) definition outranks a judged prose one
    # however late in the Book it sits: "where is this actually defined?" is
    # answered by the definition environment when there is one.
    definitions.sort(key=lambda d: (bool(d.get("judged")), not d.get("label"),
                                    d.get("chapter", 99), d["file"], d["line"]))

    # -- first use (the \pdgloss anchor) ---------------------------------
    # Two of them, deliberately. `first` is the earliest mention anywhere, in
    # Book reading order. `first_in_prose` skips mentions that land inside a
    # table or figure -- a Reader's Map row naming a term four sections before
    # the prose introduces it is a real first appearance a reader meets, but
    # it is NOT where a gloss belongs. `pdgloss_anchor` points at the prose one
    # when there is one.
    def _use_record(fm: dict, with_sentence: bool) -> dict:
        sf = by_file[fm["file"]]
        para = sf.paragraph_of[fm["line"]]
        rec = {
            "file": fm["file"], "line": fm["line"], "chapter": fm["chapter"],
            "section": fm["section"], "context": fm["context"],
            "already_marked": any(k["file"] == fm["file"] and k["line"] == fm["line"]
                                  for k in marks),
        }
        if with_sentence:
            rec["sentence"] = (next((s.strip() for s in SENTENCE_SPLIT_RE.split(para["text"])
                                     if rx.search(s)), "")[:220] if para else "")
        return rec

    first_use = None
    if mentions:
        prose_first = next((m for m in mentions if m["context"] == "prose"), None)
        anchor = prose_first or mentions[0]
        first_use = _use_record(mentions[0], mentions[0] is anchor)
        first_use["first_in_prose"] = (
            _use_record(prose_first, True) if prose_first and prose_first is not mentions[0]
            else None)
        first_use["appears_first_inside_a_float"] = mentions[0]["context"] != "prose"
        first_use["pdgloss_anchor"] = "%s:%d" % (anchor["file"], anchor["line"])

    # -- explanation passages --------------------------------------------
    explanation = []
    seen = set()
    for m in mentions:
        sf = by_file[m["file"]]
        para = sf.paragraph_of[m["line"]]
        if para is None or (m["file"], para["start"]) in seen:
            continue
        seen.add((m["file"], para["start"]))
        hits = len(rx.findall(para["text"]))
        cues = len(EXPLANATION_CUE_RE.findall(para["text"]))
        if cues == 0 or hits < 1:
            continue
        if hits < 2 and cues < 2:
            continue
        explanation.append({
            "file": m["file"], "line_start": para["start"], "line_end": para["end"],
            "chapter": m["chapter"], "section": m["section"],
            "mentions_in_paragraph": hits, "explanation_cues": cues,
            "judged": True,
            "excerpt": para["text"][:180],
        })
    explanation.sort(key=lambda e: (-e["mentions_in_paragraph"], e["chapter"], e["line_start"]))
    explanation = explanation[:5]

    # -- open problems -----------------------------------------------------
    open_problems = []
    for m in mentions:
        sf = by_file[m["file"]]
        para = sf.paragraph_of[m["line"]]
        if para is None:
            continue
        sec_label = (m["section"] or "")
        in_op_section = "openproblem" in sec_label or "openproblem" in (m["section_title"] or "").lower().replace(" ", "")
        cue = OPEN_PROBLEM_CUE_RE.search(para["text"])
        ops = sorted(set(OP_TOKEN_RE.findall(para["text"])))
        op_label = None
        for n in range(para["start"], para["end"] + 1):
            lm = LABEL_RE.search(sf.code[n])
            if lm and lm.group(1).startswith("op:"):
                op_label = lm.group(1)
        if not (in_op_section or cue or ops or op_label):
            continue
        open_problems.append({
            "file": m["file"], "line": para["start"], "chapter": m["chapter"],
            "section": m["section"], "op_ids": ops,
            "op_label": op_label,
            "in_open_problems_section": bool(in_op_section),
            "cue": cue.group(0) if cue else None,
            "judged": not bool(op_label or ops),
        })
    dedup = {}
    for op in open_problems:
        dedup.setdefault((op["file"], op["line"]), op)
    open_problems = sorted(dedup.values(), key=lambda o: (o["chapter"], o["file"], o["line"]))

    # -- figures, plots, tables -------------------------------------------
    floats = []
    for sf in files:
        for fl in sf.floats:
            if not fl.get("label"):
                continue
            cap = fl.get("caption") or ""
            in_caption = bool(rx.search(cap))
            body_hit = any(rx.search(sf.prose[n]) for n in
                           range(fl["start"], min(fl.get("end", fl["start"]), sf.nlines) + 1))
            if not (in_caption or body_hit):
                continue
            # The caption itself lives once, in the top-level `floats` table,
            # keyed by this same label; copying it here would restate 60 KB of
            # captions across 284 entries.
            floats.append({
                "label": fl["label"], "kind": fl["kind"],
                "chapter": sf.chapter["number"], "in_caption": in_caption,
            })
    # cross-references from prose that mentions the concept
    ref_labels = set()
    for m in mentions:
        sf = by_file[m["file"]]
        para = sf.paragraph_of[m["line"]]
        if para is None:
            continue
        for n in range(para["start"], para["end"] + 1):
            for lm in re.finditer(r"\\(?:page)?ref\{([^}]+)\}", sf.code[n]):
                if lm.group(1).startswith(("fig:", "tab:", "plate:")):
                    ref_labels.add(lm.group(1))
    known = {f["label"] for f in floats}
    for lab in sorted(ref_labels - known):
        floats.append({"label": lab, "kind": "referenced",
                       "chapter": None, "in_caption": False})
    floats.sort(key=lambda f: (f["chapter"] if f["chapter"] is not None else 99,
                               f["label"]))

    # -- references (\pdcite keys in the same paragraph) ------------------
    cites: dict[str, list] = defaultdict(list)
    for m in mentions:
        sf = by_file[m["file"]]
        para = sf.paragraph_of[m["line"]]
        if para is None:
            continue
        for n in range(para["start"], para["end"] + 1):
            for cm in cc.CITE_RE.finditer(sf.code[n]):
                for key in cc.split_keys(cm.group(1)):
                    site = "%s:%d" % (sf.relpath, n)
                    if site not in cites[key]:
                        cites[key].append(site)
    # key + how many paragraphs attach it. WHERE is the union of this concept's
    # mentions and that key's own \pdcite sites, both already in this file.
    references = [{"key": k, "sites": len(v)} for k, v in sorted(cites.items())]

    # -- exercise use ------------------------------------------------------
    exercises = []
    for sf in files:
        sols = {s["label"]: s for s in sf.solutions}
        for ex in sf.exercises:
            if not rx.search(ex["text"]):
                continue
            opts = dict(kv.split("=", 1) for kv in
                        (p.strip() for p in ex["opts"].split(",")) if "=" in kv)
            sol = sols.get(ex["label"])
            exercises.append({
                "label": ex["label"],
                "file": sf.relpath, "line": ex["start"],
                "chapter": sf.chapter["number"],
                "kind": opts.get("kind"), "rating": opts.get("rating"),
                "solution": ({"file": sf.relpath, "line": sol["start"],
                              "mentions_concept": bool(rx.search(sol["text"]))}
                             if sol else None),
            })
    exercises.sort(key=lambda e: (e["chapter"], e["label"]))

    # -- join to the library index (derived, never typed) ------------------
    entry_labels = {f["label"] for f in floats if f["label"]}
    entry_labels |= {d.get("label") for d in marks if d.get("label")}
    entry_labels |= {m["section"] for m in mentions if m["section"]}
    lib_ids = []
    for e in libindex.get("entries", []):
        locs = ([e["standalone"]] if e.get("standalone") else []) + list(e.get("chapters") or [])
        labs = {l for loc in locs for l in (loc.get("labels") or [])}
        if labs & entry_labels:
            lib_ids.append(e["id"])
    lib_ids = sorted(set(lib_ids))

    chapters_touched = sorted({m["chapter"] for m in mentions})
    return {
        "id": cid,
        "surface_forms": sorted({m["surface"] for m in marks if m.get("surface")} | {cid} | set(aliases)),
        "marks": [{"kind": k["kind"], "file": k["file"], "line": k["line"],
                   "chapter": k["chapter"], "surface": k.get("surface"),
                   "label": k.get("label")}
                  for k in sorted(marks, key=lambda k: (k["chapter"], k["file"], k["line"]))][:12],
        "mark_kinds": sorted({k["kind"] for k in marks}),
        "chapters": chapters_touched,
        "chapter_span": [chapters_touched[0], chapters_touched[-1]] if chapters_touched else [],
        "mention_count": len(mentions),
        "first_use": first_use,
        "definition": {
            "found": bool(definitions),
            "judged": bool(definitions and definitions[0].get("judged")),
            "sites": definitions[:3],
        },
        "explanation": explanation,
        "open_problems": open_problems,
        "floats": floats,
        "references": references,
        "exercise_use": exercises,
        "library_index_ids": lib_ids,
        "metaphor": metaphor_for(lex, files, cid, aliases, mentions, registry),
        "mentions": group_mentions(mentions),
    }


# --------------------------------------------------------------------------
# Build.
# --------------------------------------------------------------------------

# Stated in the artifact itself, because a coverage number without its
# exclusions is a claim, not a measurement.
PARSER_LIMITS = [
    "A concept whose every appearance is unmarked (never emphasised, never a "
    "definition/claim title, never a section title) is invisible to the harvest. "
    "Promote it by hand with concept_force_include[] in the lexicon.",
    "Anaphora is not resolved: 'it', 'the former', 'that discipline' are not "
    "counted as mentions of the concept they refer to, so mention counts are a "
    "floor, not a total.",
    "A metaphor is only seen if its vehicle is in the lexicon's "
    "metaphor_vehicles table. An unlisted vehicle is silently absent -- which is "
    "why the table is a committed, reviewable file and not a constant in the script.",
    "cash_out is judged by a marker count and a length floor, not by "
    "understanding. A sentence that redeems a metaphor in plain words with no "
    "mechanism noun ('all seven are the same thing seen seven ways') does not "
    "score, and a table of mechanism nouns near a metaphor scores when it "
    "explains nothing.",
    "Shared preamble files (pd-pedagogy.tex and friends) are excluded entirely: "
    "a term 'defined' there is a LaTeX macro, not an idea.",
    "Chapters 2, 3, 5, 6, 7 and 8 live under website-v2/public/whitepaper/ and "
    "are read from there, per whitepaper/textbook.json's `source` field; a "
    "chapter whose source path is wrong in textbook.json is reported as "
    "`missing` in `chapters[]` rather than silently skipped.",
]


def sections_table(files: list[SourceFile]) -> list[dict]:
    out = []
    for sf in files:
        for i, sec in enumerate(sf.sections):
            end = (sf.sections[i + 1]["line"] - 1) if i + 1 < len(sf.sections) else sf.nlines
            out.append({"file": sf.relpath, "chapter": sf.chapter["number"],
                        "line": sec["line"], "end": end, "depth": sec["depth"],
                        "label": sec["label"], "title": sec["title"]})
    out.sort(key=lambda s: (s["chapter"], s["file"], s["line"]))
    return out


def floats_table(files: list[SourceFile]) -> list[dict]:
    out = []
    for sf in files:
        for fl in sf.floats:
            out.append({"file": sf.relpath, "chapter": sf.chapter["number"],
                        "kind": fl["kind"], "label": fl.get("label"),
                        "start": fl["start"], "end": fl.get("end", fl["start"]),
                        "caption": (fl.get("caption") or "")[:400] or None})
    out.sort(key=lambda f: (f["chapter"], f["file"], f["start"]))
    return out


def build(min_mentions: int = DEFAULT_MIN_MENTIONS) -> dict:
    lex = Lexicon(read_json(LEXICON_REL))
    libindex = read_json(LIBRARY_INDEX_REL) if os.path.isfile(abspath(LIBRARY_INDEX_REL)) else {}
    chapters, files = load_corpus(min_mentions)
    marks = harvest_marks(files)

    # fold aliases into their canonical id before the harvest rule is applied
    alias_of = {}
    for canon, forms in lex.aliases.items():
        for f in forms:
            alias_of[normalise_term(f)] = canon
    folded: dict[str, list] = defaultdict(list)
    for cid, mk in marks.items():
        folded[alias_of.get(cid, cid)].extend(mk)
    forced = {normalise_term(t) for t in lex.force}
    for t in forced:
        folded.setdefault(t, [])

    registry = build_passages(lex, files)
    entries = []
    dropped: list[dict] = []
    for cid in sorted(folded):
        if cid in forced:
            ok, why = True, ""
        else:
            ok, why = concept_admitted(cid, folded[cid], lex.stopwords)
        if not ok:
            dropped.append({"id": cid, "marks": len(folded[cid]),
                            "mark_kinds": sorted({m["kind"] for m in folded[cid]}),
                            "reason": why, "stage": "marked"})
            continue
        entry = build_entry(lex, files, chapters, cid, folded[cid], libindex, registry)
        if entry["mention_count"] < min_mentions and cid not in forced:
            dropped.append({"id": cid, "marks": len(folded[cid]),
                            "mark_kinds": sorted({m["kind"] for m in folded[cid]}),
                            "reason": "only %d mention(s); the floor is %d"
                                      % (entry["mention_count"], min_mentions),
                            "stage": "repeated"})
            continue
        entries.append(entry)
    dropped.sort(key=lambda d: d["id"])

    with_def = sum(1 for e in entries if e["definition"]["found"])
    parsed_def = sum(1 for e in entries if e["definition"]["found"] and not e["definition"]["judged"])
    with_first = sum(1 for e in entries if e["first_use"])
    vehicles = sum(1 for e in entries if e["metaphor"]["is_vehicle"])
    mixed_para = sum(1 for e in entries
                     if e["metaphor"]["combinations"]["mixed_paragraph_count"])
    # Distinct PASSAGES, not (concept, passage) pairs: eight concepts meeting
    # in one bad section is one piece of damage to repair, not eight. The
    # registry already holds each passage once, so these are just counts.
    passages = registry.table()
    uncashed_sections = [c for c in passages if c["scope"] == "section"
                         and c["mixed"] and not c["cash_out"]["in_prose"]]
    caption_only_sections = [c for c in passages if c["scope"] == "section"
                             and c["mixed"] and c["cash_out"].get("only_in_float_caption")]
    mixed_paragraphs = [c for c in passages if c["scope"] == "paragraph" and c["mixed"]]

    return {
        "$schema": "./concept-index.schema.json",
        "version": SCHEMA_VERSION,
        "generated_by": "scripts/harbor-research/build_concept_index.py",
        "generator_contract": (
            "Regenerate-and-diff. Never hand-edit this file; edit "
            "docs/harbor-research/concept-index.lexicon.json (the judgement calls) or "
            "the chapter sources (the facts), then run --write. See "
            "docs/harbor-research/concept-index.README.md."
        ),
        "harvest_rule": (
            "A concept is a term that is MARKED (emphasised, or the title of a "
            "definition/claim environment, or a \\pdgloss term, or a section title, "
            "or a float caption head) AND REPEATED (>= %d mentions in comment-stripped "
            "prose across the Book)." % min_mentions
        ),
        "min_mentions": min_mentions,
        "chapters": [{"number": c["number"], "id": c["id"], "prefix": c.get("prefix"),
                      "title": c.get("title"), "source": c.get("source"),
                      "files": c.get("files", []), "missing": c.get("missing", False)}
                     for c in chapters],
        "metaphor_domains": sorted({d for d in lex.vehicle_domain.values()}),
        # ---- normalised fact tables ----------------------------------------
        # A mention is (file, line). What SECTION a line is in, whether it sits
        # inside a FLOAT, and what METAPHOR PASSAGE covers it are properties of
        # the line, recorded once here and referenced by every entry.
        "sections": sections_table(files),
        "floats": floats_table(files),
        "metaphor_passages": passages,
        "coverage": {
            "concepts": len(entries),
            "concepts_with_definition": with_def,
            "definitions_parsed": parsed_def,
            "definitions_judged": with_def - parsed_def,
            "concepts_without_definition": len(entries) - with_def,
            "concepts_with_first_use": with_first,
            "concepts_that_are_metaphor_vehicles": vehicles,
            "concepts_in_a_mixed_metaphor_paragraph": mixed_para,
            "metaphor_passages_recorded": len(passages),
            "distinct_mixed_metaphor_paragraphs": len(mixed_paragraphs),
            "mixed_metaphor_sections_never_cashed_out_in_prose": len(uncashed_sections),
            "mixed_metaphor_sections_cashed_out_only_in_a_float_caption": len(caption_only_sections),
            "total_mentions": sum(e["mention_count"] for e in entries),
            "concepts_joined_to_the_library_index": sum(1 for e in entries if e["library_index_ids"]),
            "candidates_dropped": len(dropped),
            "candidates_dropped_as_unmarked": sum(1 for d in dropped if d["stage"] == "marked"),
            "candidates_dropped_below_mention_floor": sum(1 for d in dropped if d["stage"] == "repeated"),
            "source_files_scanned": len({f.relpath for f in files}),
            "source_lines_scanned": sum(f.nlines for f in files),
            "sections_scanned": sum(len(f.sections) for f in files),
            "exercises_scanned": sum(len(f.exercises) for f in files),
        },
        "parser_gave_up_on": PARSER_LIMITS,
        "entries": entries,
        "dropped_candidates": dropped,
    }


# --------------------------------------------------------------------------
# Markdown render (the human face; --check keeps it honest).
# --------------------------------------------------------------------------

def render_md(index: dict) -> str:
    L = []
    L.append("# The Book's concept index")
    L.append("")
    L.append("Generated by `scripts/harbor-research/build_concept_index.py --write`.")
    L.append("**Never hand-edit this file** -- edit the sources or")
    L.append("`docs/harbor-research/concept-index.lexicon.json` and regenerate.")
    L.append("Machine-readable copy: `docs/harbor-research/concept-index.json`.")
    L.append("")
    cov = index["coverage"]
    L.append("## Coverage")
    L.append("")
    L.append("| measure | value |")
    L.append("| --- | ---: |")
    for k in sorted(cov):
        L.append("| %s | %s |" % (k.replace("_", " "), cov[k]))
    L.append("")
    L.append("## Mixed metaphor, never cashed out in prose")
    L.append("")
    L.append("One row per SECTION where two or more source domains meet and no literal")
    L.append("sentence in that section's prose redeems them -- not one row per concept,")
    L.append("because eight concepts in one bad section is one repair, not eight. `judged`.")
    L.append("")
    L.append("| passage | chapter | section | domains | cash-out only in a float caption | concepts |")
    L.append("| --- | ---: | --- | --- | --- | --- |")
    passages = {p["id"]: p for p in index["metaphor_passages"]}
    concepts_in = defaultdict(list)
    for e in index["entries"]:
        for pid in e["metaphor"]["combinations"]["mixed_sections"]:
            concepts_in[pid].append(e["id"])
    rows = [p for p in index["metaphor_passages"]
            if p["scope"] == "section" and p["mixed"] and not p["cash_out"]["in_prose"]]
    rows.sort(key=_worst_first)
    for p in rows[:60]:
        L.append("| `%s` | %s | %s | %s | %s | %s |" % (
            p["id"], p["chapter"],
            p["section"] or (p["section_title"] or "-"),
            ", ".join(p["domains"]),
            "**yes**" if p["cash_out"].get("only_in_float_caption") else "no",
            ", ".join("`%s`" % c for c in sorted(concepts_in.get(p["id"], []))[:6]) or "-"))
    L.append("")
    L.append("## Entries")
    L.append("")
    L.append("| concept | ch. | mentions | definition | first use | vehicle | max domains / para | library index |")
    L.append("| --- | --- | ---: | --- | --- | --- | ---: | --- |")
    for e in index["entries"]:
        d = e["definition"]
        dtxt = "none"
        if d["found"]:
            s = d["sites"][0]
            dtxt = "%s:%d%s" % (s["file"].split("/")[-1], s["line"],
                                " (judged)" if d["judged"] else "")
        fu = e["first_use"]
        futxt = "%s:%d" % (fu["file"].split("/")[-1], fu["line"]) if fu else "none"
        L.append("| `%s` | %s | %d | %s | %s | %s | %d | %s |" % (
            e["id"],
            "-".join(str(x) for x in e["chapter_span"]) or "-",
            e["mention_count"], dtxt, futxt,
            (e["metaphor"]["vehicle"] + " (" + (e["metaphor"]["domain"] or "") + ")")
            if e["metaphor"]["is_vehicle"] else "-",
            e["metaphor"]["max_domains_in_one_paragraph"],
            ", ".join(e["library_index_ids"]) or "-"))
    L.append("")
    return "\n".join(L)


def dumps(index: dict) -> str:
    return json.dumps(index, indent=2, ensure_ascii=False, sort_keys=False) + "\n"


# --------------------------------------------------------------------------
# --query
# --------------------------------------------------------------------------

def print_entry(entry: dict, passages: dict[str, dict],
                floats_by_label: dict[str, dict] | None = None) -> None:
    floats_by_label = floats_by_label or {}

    def head(t):
        print("\n" + t)
        print("-" * len(t))
    print("=" * 72)
    print("CONCEPT  %s" % entry["id"])
    print("=" * 72)
    print("surface forms       : %s" % ", ".join(entry["surface_forms"]))
    print("chapters            : %s" % entry["chapters"])
    print("mentions            : %d" % entry["mention_count"])
    print("library index ids   : %s" % (", ".join(entry["library_index_ids"]) or "(none)"))
    fu = entry["first_use"]
    if fu:
        head("FIRST USE")
        print("  earliest anywhere   : %s:%d  (ch.%s, %s) [%s]" % (
            fu["file"], fu["line"], fu["chapter"], fu["section"] or "(unlabelled)",
            fu["context"]))
        if fu.get("sentence"):
            print("    %s" % fu["sentence"][:200])
        fp = fu.get("first_in_prose")
        if fp:
            print("  earliest in prose   : %s:%d  (ch.%s, %s)" % (
                fp["file"], fp["line"], fp["chapter"], fp["section"] or "(unlabelled)"))
            print("    %s" % fp.get("sentence", "")[:200])
        print("  \\pdgloss anchor     : %s" % fu["pdgloss_anchor"])
        print("  already marked here : %s" % (fp or fu)["already_marked"])
    d = entry["definition"]
    head("DEFINITION  (found=%s judged=%s)" % (d["found"], d["judged"]))
    for s in d["sites"]:
        print("  %s:%d  [%s] %s" % (s["file"], s["line"], s["kind"], s.get("why", "")))
        if s.get("text"):
            print("      %s" % s["text"])
    if not d["sites"]:
        print("  (none located)")
    met = entry["metaphor"]
    head("METAPHOR")
    print("  is a vehicle        : %s" % met["is_vehicle"])
    print("  vehicle / domain    : %s / %s" % (met["vehicle"], met["domain"]))
    print("  occurrences         : %d" % met["occurrence_count"])
    print("  max domains / para  : %d" % met["max_domains_in_one_paragraph"])
    print("  max domains / sect  : %d" % met["max_domains_in_one_section"])
    print("  worst section       : %s" % met["combinations"]["worst_section"])
    for scope, key in (("paragraph", "paragraph"), ("section", "mixed_sections")):
        combos = [p for p in (passages[i] for i in met["combinations"][key]) if p["mixed"]]
        if not combos:
            continue
        head("METAPHOR COMBINATIONS -- %s scope (%d mixed)" % (scope, len(combos)))
        for c in sorted(combos, key=_worst_first)[:6]:
            print("  [%s]  %s:%d-%d  ch.%s  %s -- %s" % (
                c["id"], c["file"], c["line_start"], c["line_end"], c["chapter"],
                c["section"] or "(unlabelled)", c["section_title"]))
            print("    domains (%d): %s" % (c["domain_count"], ", ".join(c["domains"])))
            print("    vehicles   : %s" % ", ".join(
                "%s[%s]" % (v["term"], v["domain"]) for v in c["vehicles"]))
            co = c["cash_out"]
            print("    cashed out in prose: %s   (judged)" % co["in_prose"])
            if co.get("only_in_float_caption"):
                print("    >>> ONLY literal statement is in a FLOAT CAPTION, not the prose <<<")
            for cand in co["candidates"][:3]:
                print("      [%s %s] %s:%d  %s" % (
                    cand["kind"], cand.get("label") or "-", cand["file"], cand["line"],
                    cand["text"][:150]))
    if entry["open_problems"]:
        head("OPEN PROBLEMS (%d)" % len(entry["open_problems"]))
        for op in entry["open_problems"][:6]:
            print("  %s:%d  ch.%s %s  ops=%s judged=%s" % (
                op["file"], op["line"], op["chapter"], op["section"],
                op["op_ids"] or op["op_label"] or "-", op["judged"]))
    if entry["floats"]:
        head("FIGURES / PLOTS / TABLES (%d)" % len(entry["floats"]))
        for f in entry["floats"][:12]:
            cap = (floats_by_label.get(f["label"], {}).get("caption") or "")
            print("  %-34s %-10s %s%s" % (f["label"], f["kind"],
                                          "[in caption] " if f["in_caption"] else "",
                                          cap.replace("\n", " ")[:80]))
    if entry["references"]:
        head("REFERENCES (%d \\pdcite keys)" % len(entry["references"]))
        print("  " + ", ".join("%s(%d)" % (r["key"], r["sites"])
                               for r in sorted(entry["references"],
                                               key=lambda r: (-r["sites"], r["key"]))[:24]))
    if entry["exercise_use"]:
        head("EXERCISE USE (%d)" % len(entry["exercise_use"]))
        for x in entry["exercise_use"][:12]:
            sol = x["solution"]
            print("  %-30s ch.%s kind=%-6s rating=%s  solution=%s" % (
                x["label"], x["chapter"], x["kind"], x["rating"],
                ("%s:%d%s" % (sol["file"].split("/")[-1], sol["line"],
                              "" if sol["mentions_concept"] else " (solution never names it)"))
                if sol else "none"))
    if entry["explanation"]:
        head("EXPLANATION PASSAGES (%d, judged)" % len(entry["explanation"]))
        for e in entry["explanation"][:4]:
            print("  %s:%d-%d  hits=%d cues=%d" % (
                e["file"], e["line_start"], e["line_end"],
                e["mentions_in_paragraph"], e["explanation_cues"]))
    head("MENTIONS (%d, grouped by file)" % entry["mention_count"])
    for g in entry["mentions"]:
        lines = ", ".join(str(n) for n in g["lines"][:18])
        if len(g["lines"]) > 18:
            lines += ", ... (%d more)" % (len(g["lines"]) - 18)
        print("  ch.%s %s" % (g["chapter"], g["file"]))
        print("      %s" % lines)
    print()


def print_coverage(index: dict) -> None:
    print("concept index -- coverage")
    for k, v in index["coverage"].items():
        print("  %-52s %s" % (k.replace("_", " "), v))
    print("\n  chapters indexed:")
    for c in index["chapters"]:
        print("    %d  %-22s %2d files  %s" % (c["number"], c["id"], len(c["files"]),
                                               "MISSING" if c["missing"] else ""))


def main() -> int:
    global REPO_ROOT
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--check", action="store_true",
                        help="fail if the committed index or its Markdown render is stale")
    parser.add_argument("--write", action="store_true",
                        help="(re)write concept-index.json and CONCEPT-INDEX.md")
    parser.add_argument("--query", metavar="TERM", default=None,
                        help="print one concept's entry from a fresh build")
    parser.add_argument("--coverage", action="store_true",
                        help="print the coverage report only")
    parser.add_argument("--min-mentions", type=int, default=DEFAULT_MIN_MENTIONS,
                        help=argparse.SUPPRESS)
    parser.add_argument("--repo-root", default=None, help=argparse.SUPPRESS)
    args = parser.parse_args()

    if args.repo_root:
        REPO_ROOT = os.path.abspath(args.repo_root)
        cc.REPO_ROOT = REPO_ROOT

    index = build(args.min_mentions)

    if args.query:
        cid = normalise_term(args.query)
        lex = Lexicon(read_json(LEXICON_REL))
        cid = {normalise_term(f): k for k, v in lex.aliases.items() for f in v}.get(cid, cid)
        passages = {p["id"]: p for p in index["metaphor_passages"]}
        for e in index["entries"]:
            if e["id"] == cid or args.query.lower() in e["surface_forms"]:
                print_entry(e, passages,
                            {f["label"]: f for f in index["floats"] if f.get("label")})
                return 0
        print("no entry for %r (normalised: %r)" % (args.query, cid), file=sys.stderr)
        drop = next((d for d in index["dropped_candidates"] if d["id"] == cid), None)
        if drop:
            print("it was harvested and then dropped: %s" % drop["reason"], file=sys.stderr)
            print("promote it with concept_force_include[] in %s" % LEXICON_REL, file=sys.stderr)
        near = [e["id"] for e in index["entries"] if cid in e["id"] or e["id"] in cid]
        if near:
            print("did you mean: %s" % ", ".join(near[:10]), file=sys.stderr)
        return 1

    payload = dumps(index)
    md = render_md(index)

    if args.write:
        with open(abspath(INDEX_REL), "w", encoding="utf-8") as fh:
            fh.write(payload)
        with open(abspath(MD_REL), "w", encoding="utf-8") as fh:
            fh.write(md)
        print("wrote %s (%d concepts) and %s" % (INDEX_REL, len(index["entries"]), MD_REL))

    rc = 0
    if args.check:
        for relp, fresh in ((INDEX_REL, payload), (MD_REL, md)):
            p = abspath(relp)
            if not os.path.isfile(p):
                print("FAIL %s does not exist; run --write" % relp, file=sys.stderr)
                rc = 1
                continue
            with open(p, encoding="utf-8") as fh:
                on_disk = fh.read()
            if on_disk != fresh:
                print("FAIL %s is stale: it does not match a fresh build from the "
                      "chapter sources." % relp, file=sys.stderr)
                print("     Regenerate with: python3 %s --write"
                      % "scripts/harbor-research/build_concept_index.py", file=sys.stderr)
                _first_diff(on_disk, fresh, relp)
                rc = 1
        if rc == 0:
            print("ok  %s and %s are a fresh build of the %d chapter sources "
                  "(%d concepts)" % (INDEX_REL, MD_REL, len(index["chapters"]),
                                     len(index["entries"])))

    if args.coverage or not (args.write or args.check):
        print_coverage(index)
    return rc


def _first_diff(on_disk: str, fresh: str, relp: str) -> None:
    a, b = on_disk.split("\n"), fresh.split("\n")
    for i in range(max(len(a), len(b))):
        la = a[i] if i < len(a) else "<eof>"
        lb = b[i] if i < len(b) else "<eof>"
        if la != lb:
            print("     first difference at %s line %d:" % (relp, i + 1), file=sys.stderr)
            print("       committed: %s" % la.strip()[:160], file=sys.stderr)
            print("       fresh    : %s" % lb.strip()[:160], file=sys.stderr)
            return


if __name__ == "__main__":
    sys.exit(main())
