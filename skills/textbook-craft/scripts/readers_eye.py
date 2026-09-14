#!/usr/bin/env python3
"""readers_eye.py -- Layer 1 of the reader's-eye check: mechanical signals for
Book prose a competent reader cannot follow.

WHY THIS EXISTS (the gap, stated plainly)
-----------------------------------------
Every prose check this repository already ships measures STRUCTURE:

  skills/textbook-craft/scripts/chapter_lint.py       does the section have a
                                                      worked example, is the
                                                      claim tagged with its
                                                      epistemic kind, is the
                                                      exercise at the chapter
                                                      end
  skills/tufte-evidence-design/scripts/margin_lint.py is the gloss the term's
                                                      first use, does the
                                                      portrait have a cleared
                                                      sidecar, is a footnote
                                                      in the body
  skills/harbor-exposition/scripts/check_style.py     are the seven house moves
                                                      present anywhere in the
                                                      file
  scripts/lint/check-banned-phrases.mjs               does a banned phrase
                                                      appear

Not one of them asks whether a READER COULD FOLLOW THE SENTENCE. A section can
satisfy every floor in chapter_lint -- worked example present, claims tagged,
exercises at the end, gloss at first use, no banned phrase -- and still open
with a paragraph that borrows four metaphors from four domains, instantiates
none of them, and gives its one concrete, checkable fact away to a table
caption. That paragraph passes every existing gate. It is also the defect an
actual reader hits first, and the only one that makes them stop reading.

This file is the mechanical half of the check that closes that gap. It counts
and matches; it does not judge prose. The judging half is a rubric a model
applies per paragraph, in `references/readers-eye.md` -- run that after this,
against the paragraphs this reports and against the ones it does not.

WHAT IT CHECKS, AND WHY EACH IS DEFENSIBLE
------------------------------------------
Every rule below is something that can be counted or matched without a taste
judgement. Where a rule needs a word list, the list lives in
`references/readers-eye-lexicon.json`, not here (same separation as
skills/make_copy_and_media_human, whose tells live in references/catalog.json
and whose script measures only densities and ratios).

  caption-carries-the-fact   The sharpest signal there is, and the one no
                             other check in the repo can see, because it is a
                             relation BETWEEN two objects rather than a
                             property of either. A float's caption states
                             something concrete and checkable -- a filename, a
                             number, a named mechanism -- and the paragraph
                             that introduces that float states nothing
                             concrete at all. The author knew the fact, wrote
                             it down, and put it where the reader arrives only
                             after the prose has already lost them. Both
                             halves are mechanical: "is there a concrete token
                             here" is a regex, and "which paragraph introduces
                             this float" is the paragraph holding \\ref{label}.

  metaphor-domain-collision  A paragraph drawing figurative vocabulary from
                             two or more different domains, with no definition
                             anywhere in it. Counting domains is mechanical;
                             deciding whether a metaphor is EARNED is not, and
                             is left to the judge. The lexicon is small and
                             curated against this Book's literal vocabulary
                             (the lexicon file records what was deliberately
                             left out and what that cost).

  metaphor-never-instantiated  A figurative term used N or more times in a
                             section's prose before any concrete token follows
                             it. This is the "five organs before one organ
                             does one thing" defect, and it is pure counting.
                             Floats are excluded from the scan on purpose:
                             concreteness inside a table does not rescue the
                             prose.

  undefined-slash-pair       `word/word` where both sides are >= 6 characters,
                             the pair is not an established technical compound
                             (allowlist in the lexicon), and nothing in the
                             paragraph glosses it. A house coinage compressed
                             into a slash is a term the reader has to decode
                             from nothing.

  artifact-register-drift    "this paper", "the paper's" in a source that is a
                             Book chapter. Occurrences inside an \\ifpdbook
                             else-branch are skipped: that branch IS the
                             standalone paper and the word is correct there.

  abstraction-run            N or more consecutive sentences in one paragraph
                             with no concrete token and no example pointer.
                             Deliberately the loosest rule here, and the one
                             tuned hardest for precision: the threshold and
                             the minimum sentence length were both raised
                             until the corpus-wide count was small enough that
                             a person would actually read the output.

CONCRETENESS
------------
A "concrete token" is, mechanically: a \\texttt/\\path/\\verb/\\lstinline, a
\\pdexample or \\pdsession pointer, a digit, a dotted or underscored identifier
(pd.daemon, wal_hook), a SLASHED identifier carrying an internal capital or
digit (SQLite/WAL -- the capital is required, or `resource/exclusion` would
count as concrete and cancel the very rules that exist to flag it), an all-caps
acronym (WAL, SQL, TLS), an internally capitalised name (SQLite, GitHub), or
inline/display mathematics. Cross-references (\\ref, \\cite, \\pageref, \\S) are stripped
BEFORE the scan: a pointer to where the fact lives is not the fact. Spelled
numbers ("seven organs") are not concrete either -- "seven" is a count of
abstractions, not an instance of one.

Usage:
    python3 readers_eye.py [CHAPTER.tex ...] [--json] [--rule NAME] [--strict]
    python3 readers_eye.py --limit 0        # list every finding, not 12 per rule
    python3 readers_eye.py                  # no files: every chapter in
                                            # whitepaper/textbook.json
    python3 readers_eye.py --summary        # one line per rule, no findings
    python3 readers_eye.py --selftest       # clean vs. deliberately-bad prose

Exit code: 0 always, unless --strict is given and at least one finding was
reported (then 1), or a file cannot be read (then 2). Advisory in CI on day
one, for the same reason 7c2c5e16f made the figure-blocker step advisory: a
check nobody has cleaned up after yet must not freeze the merge queue.
stdlib only.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

# skills/textbook-craft/scripts/readers_eye.py -> scripts -> textbook-craft
# -> skills -> repo root. Same depth and same convention as chapter_lint.py.
REPO_ROOT = Path(__file__).resolve().parents[3]
LEXICON_PATH = Path(__file__).resolve().parents[1] / "references" / "readers-eye-lexicon.json"

# ---------------------------------------------------------------------------
# Thresholds. Every one of these was set by running the check over all eight
# Book chapters and raising it until the output was small enough to read. The
# tuning record is in references/readers-eye.md; changing one of these numbers
# without re-running the corpus makes that record a lie.
# ---------------------------------------------------------------------------

MIN_PARAGRAPH_WORDS = 35          # below this a "paragraph" is a stub or a macro line
METAPHOR_DOMAIN_FLOOR = 2         # distinct figurative domains in one paragraph
METAPHOR_INSTANCE_FLOOR = 4       # uses of one figure before any concrete token
SLASH_SIDE_MIN_CHARS = 6          # both sides of word/word must be this long
ABSTRACTION_RUN_FLOOR = 5         # consecutive concrete-free sentences
ABSTRACTION_MIN_SENTENCE_WORDS = 12   # a short connective sentence never joins a run
CAPTION_MIN_PARAGRAPH_WORDS = 40  # the introducing paragraph must be substantial

# Environments whose contents are not running prose. Blanked before paragraphs
# are cut, so a table row or a listing never becomes a "paragraph" and never
# lends its concreteness to one.
NON_PROSE_ENVS = frozenset({
    "figure", "figure*", "table", "table*", "sidewaystable", "sidewaysfigure",
    "wrapfigure", "wraptable", "margintable", "marginfigure", "longtable",
    "tabular", "tabular*", "tabularx", "xltabular", "array", "tikzpicture",
    "lstlisting", "verbatim", "Verbatim", "minted", "alltt",
    "equation", "equation*", "align", "align*", "gather", "gather*",
    "multline", "multline*", "eqnarray", "eqnarray*", "displaymath",
    "itemize", "enumerate", "description", "thebibliography", "tcolorbox",
    # Exercise apparatus is a different genre from expository prose: a prompt
    # is deliberately compressed and leans on terms the chapter has already
    # defined, so the slash-pair and abstraction rules mis-read it wholesale.
    # Excluding it is a recall loss, recorded in references/readers-eye.md,
    # and it is what took undefined-slash-pair from 66 findings (two thirds of
    # them exercise prompts run together into one pseudo-paragraph) to a list
    # a person will read.
    "pdexercise", "pdsolution", "pdexercises", "pdhint", "pdanswer",
})

FLOAT_ENVS = frozenset({
    "figure", "figure*", "table", "table*", "sidewaystable", "sidewaysfigure",
    "wrapfigure", "wraptable", "margintable", "marginfigure", "longtable",
})

SECTIONING_RE = re.compile(r"\\(chapter|section|subsection|subsubsection)\*?\s*\{")

# A pointer to where a fact lives is not the fact. Stripped before every
# concreteness scan.
REFERENCE_MACROS = (
    "ref", "pageref", "eqref", "autoref", "cref", "Cref", "nameref", "label",
    "cite", "citep", "citet", "citeauthor", "citeyear", "pdcite", "pdciteshort",
    "index", "pdchapterref", "pdfigref", "pdexercisepointer", "pdprovedon",
)
_REF_MACRO_RE = re.compile(
    r"\\(?:" + "|".join(REFERENCE_MACROS) + r")\*?\s*(?:\[[^\]]*\])?\s*\{[^{}]*\}"
)

CONCRETE_PATTERNS = (
    ("code-span", re.compile(r"\\(?:texttt|path|verb|lstinline|pdcode|pdfile|url|href)\b")),
    ("example-pointer", re.compile(r"\\(?:pdexample|pdsession|pdtranscript)\b|\\begin\s*\{(?:pdexample|pdsession)\}")),
    ("digit", re.compile(r"(?<![A-Za-z\\])\d")),
    # A dotted or underscored identifier: pd.daemon, wal_hook. Both sides must
    # be at least two characters so "e.g" and "i.e" are not mistaken for one.
    ("identifier", re.compile(r"\b[A-Za-z][A-Za-z0-9]+(?:[._][A-Za-z0-9]{2,})+\b")),
    # A SLASHED identifier must carry an internal capital or digit. Without
    # that guard `resource/exclusion` -- the very coinage undefined-slash-pair
    # exists to flag -- counted as a concrete token and cancelled the
    # metaphor rule on the specimen paragraph. SQLite/WAL still counts.
    ("path-identifier",
     re.compile(r"\b(?=[A-Za-z0-9/]*[A-Z0-9])[A-Za-z][A-Za-z0-9]*(?:/[A-Za-z0-9]+)+\b")),
    ("acronym", re.compile(r"\b[A-Z]{2,}\b")),
    ("named-thing", re.compile(r"\b[A-Z][a-z]+[A-Z][A-Za-z]*\b")),
    # A symbol is something a reader can point at and carry. A paragraph that
    # names $\Sigma$ and $K$ and says what they range over is doing the
    # opposite of what this check hunts, even when it contains no filename.
    # Adding this took abstraction-run from 45 findings to 26 and removed
    # every formal-methods false positive in the sample.
    ("math", re.compile(r"\$[^$]*\$|\\\(|\\\[")),
)


# ---------------------------------------------------------------------------
# LaTeX surface handling. strip_comments and balanced_brace_arg are taken
# verbatim in shape from chapter_lint.py so the two checkers cannot disagree
# about what a comment or a macro argument is.
# ---------------------------------------------------------------------------

_TEX_COMMENT_RE = re.compile(r"(?<!\\)%.*$", re.MULTILINE)


def strip_comments(text: str) -> str:
    """Drop LaTeX line comments, preserving every newline so line numbers
    computed against the result still point at the real source line."""
    return _TEX_COMMENT_RE.sub("", text)


def line_of(text: str, pos: int) -> int:
    return text.count("\n", 0, pos) + 1


def balanced_brace_arg(text: str, start: int):
    """Return (arg_content, index_after_closing_brace) for the braced group at
    or after `start`; (None, start) if there is none."""
    i, n = start, len(text)
    while i < n and text[i] in " \t\n":
        i += 1
    if i >= n or text[i] != "{":
        return None, start
    depth, j = 0, i
    while j < n:
        c = text[j]
        if c == "\\" and j + 1 < n:
            j += 2
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return text[i + 1:j], j + 1
        j += 1
    return None, start


def blank_span(text: str, start: int, end: int) -> str:
    """Replace [start, end) with spaces, keeping newlines, so every offset and
    every line number in the rest of the file stays exactly where it was."""
    chunk = text[start:end]
    return text[:start] + "".join("\n" if c == "\n" else " " for c in chunk) + text[end:]


def environment_spans(text: str, names) -> list:
    """Outermost spans of the named environments, nesting-aware."""
    spans, stack = [], []
    for m in re.finditer(r"\\(begin|end)\s*\{([A-Za-z@*]+)\}", text):
        kind, name = m.group(1), m.group(2)
        if kind == "begin":
            stack.append((name, m.start()))
            continue
        for i in range(len(stack) - 1, -1, -1):
            if stack[i][0] == name:
                nm, st = stack[i]
                nested_in_target = any(s[0] in names for s in stack[:i])
                if nm in names and not nested_in_target:
                    spans.append((st, m.end()))
                del stack[i:]
                break
    return spans


def ifpdbook_else_spans(text: str) -> list:
    """Spans of the \\else branch of every \\ifpdbook ... \\else ... \\fi.

    That branch is what the STANDALONE paper compiles, so "this paper" is
    correct inside it and the register rule must not see it."""
    spans = []
    for m in re.finditer(r"\\ifpdbook\b", text):
        depth, i, n = 0, m.end(), len(text)
        else_at = None
        while i < n:
            nxt = re.search(r"\\(ifpdbook|if[a-zA-Z]*|else|fi)\b", text[i:])
            if not nxt:
                break
            tok, at = nxt.group(1), i + nxt.start()
            if tok.startswith("if"):
                depth += 1
            elif tok == "else" and depth == 0 and else_at is None:
                else_at = i + nxt.end()
            elif tok == "fi":
                if depth == 0:
                    if else_at is not None:
                        spans.append((else_at, at))
                    break
                depth -= 1
            i = i + nxt.end()
    return spans


_KEEP_CONTENT_MACROS = (
    "emph", "textbf", "textit", "textsc", "texttt", "textrm", "underline",
    "enquote", "mbox", "text", "caption", "title", "footnote", "pdgloss",
)


def to_plain_text(tex: str) -> str:
    """Render a chunk of LaTeX down to something close to what a reader sees.

    Reference macros go first (a pointer is not prose), then keep-content
    macros are unwrapped, then remaining control words and braces are dropped.
    Good enough for word counts, sentence splitting, and phrase matching; it
    is not a TeX engine and does not pretend to be."""
    s = tex
    for _ in range(4):
        s = _REF_MACRO_RE.sub(" ", s)
    for _ in range(6):
        changed = False
        for name in _KEEP_CONTENT_MACROS:
            pat = re.compile(r"\\" + name + r"\*?\s*\{")
            m = pat.search(s)
            while m:
                arg, end = balanced_brace_arg(s, m.end() - 1)
                if arg is None:
                    break
                s = s[:m.start()] + arg + s[end:]
                changed = True
                m = pat.search(s)
        if not changed:
            break
    s = re.sub(r"\\begin\s*\{[A-Za-z@*]+\}|\\end\s*\{[A-Za-z@*]+\}", " ", s)
    s = re.sub(r"\\[A-Za-z@]+\*?", " ", s)
    s = re.sub(r"\\[^A-Za-z]", " ", s)
    s = s.replace("{", " ").replace("}", " ").replace("~", " ")
    s = s.replace("``", '"').replace("''", '"').replace("---", " -- ")
    return re.sub(r"[ \t]+", " ", s)


_CODE_SPAN_MACROS = ("texttt", "path", "url", "lstinline", "pdcode", "pdfile")


def strip_code_spans(tex: str) -> str:
    """Drop code spans and their contents.

    Needed by the slash-pair rule and nothing else: `\\texttt{skills/harbor-research}`
    is a path, not a house coinage, and a rule about undefined coinages that
    fires on every file path in the Book is a rule nobody will keep."""
    s = tex
    for _ in range(6):
        changed = False
        for name in _CODE_SPAN_MACROS:
            pat = re.compile(r"\\" + name + r"\*?\s*\{")
            m = pat.search(s)
            while m:
                _, end = balanced_brace_arg(s, m.end() - 1)
                if end == m.end() - 1:
                    break
                s = s[:m.start()] + " " + s[end:]
                changed = True
                m = pat.search(s)
        m = re.search(r"\\href\s*\{", s)
        while m:
            _, end1 = balanced_brace_arg(s, m.end() - 1)
            if end1 == m.end() - 1:
                break
            arg2, end2 = balanced_brace_arg(s, end1)
            s = s[:m.start()] + " " + (arg2 or "") + s[(end2 if arg2 is not None else end1):]
            changed = True
            m = re.search(r"\\href\s*\{", s)
        if not changed:
            break
    return s


_ABBREV = ("e.g.", "i.e.", "cf.", "vs.", "Fig.", "Figs.", "Tab.", "Eq.",
           "Thm.", "Sec.", "Ch.", "No.", "Dr.", "Mr.", "Ms.", "St.", "etc.")


def split_sentences(plain: str) -> list:
    """Deterministic sentence split with the abbreviations this Book actually
    uses protected. Crude on purpose: it feeds a count, not a parse."""
    s = plain
    for a in _ABBREV:
        s = s.replace(a, a.replace(".", "\x00"))
    parts = re.split(r"(?<=[.!?])[\"')\]]?\s+", s)
    return [p.replace("\x00", ".").strip() for p in parts if p.strip()]


def word_count(plain: str) -> int:
    return len(re.findall(r"[A-Za-z][A-Za-z'’-]*", plain))


def concrete_hits(tex: str) -> list:
    """Every concrete token in a chunk of LaTeX, as (kind, matched-text).

    References are stripped first, so `Table~\\ref{tab:swk-seven-organs}`
    contributes nothing: pointing at the table is not stating the fact."""
    stripped = _REF_MACRO_RE.sub(" ", tex)
    stripped = re.sub(r"\\S\b", " ", stripped)
    out = []
    for kind, pat in CONCRETE_PATTERNS:
        for m in pat.finditer(stripped):
            out.append((kind, m.group(0)))
    return out


# ---------------------------------------------------------------------------
# Document model
# ---------------------------------------------------------------------------

@dataclass
class Paragraph:
    start: int
    end: int
    line: int
    tex: str
    plain: str
    section: str
    section_line: int
    code_free_plain: str = ""

    @property
    def words(self) -> int:
        return word_count(self.plain)


@dataclass
class Float:
    start: int
    end: int
    line: int
    env: str
    label: str
    caption_tex: str
    caption_plain: str


@dataclass
class Chapter:
    path: str
    raw: str
    text: str                 # comment-stripped, offsets preserved
    paragraphs: list = field(default_factory=list)
    floats: list = field(default_factory=list)
    else_spans: list = field(default_factory=list)


def parse_chapter(path: str) -> Chapter:
    raw = Path(path).read_text(encoding="utf-8", errors="replace")
    text = strip_comments(raw)

    floats = []
    for start, end in environment_spans(text, FLOAT_ENVS):
        env_m = re.match(r"\\begin\s*\{([A-Za-z@*]+)\}", text[start:])
        env = env_m.group(1) if env_m else "float"
        body = text[start:end]
        caption = ""
        cm = re.search(r"\\caption\*?\s*\{", body)
        if cm:
            arg, _ = balanced_brace_arg(body, cm.end() - 1)
            caption = arg or ""
        lm = re.search(r"\\label\s*\{([^{}]*)\}", body)
        floats.append(Float(
            start=start, end=end, line=line_of(text, start), env=env,
            label=lm.group(1) if lm else "",
            caption_tex=caption, caption_plain=to_plain_text(caption),
        ))

    # Blank everything that is not running prose, then cut paragraphs from
    # what is left. Blanking (rather than deleting) keeps every offset valid.
    masked = text
    for start, end in environment_spans(text, NON_PROSE_ENVS):
        masked = blank_span(masked, start, end)

    sections = []   # (pos, title)
    pos = 0
    while True:
        m = SECTIONING_RE.search(masked, pos)
        if not m:
            break
        arg, end = balanced_brace_arg(masked, m.end() - 1)
        if arg is None:
            pos = m.end()
            continue
        sections.append((m.start(), to_plain_text(arg).strip()))
        masked = blank_span(masked, m.start(), end)
        pos = end

    paragraphs = []
    # Start each paragraph at the first NON-WHITESPACE character: blanking a
    # float or a \section leaves spaces behind, and a paragraph that began at
    # one of them would carry the blanked macro's source text into its `tex`
    # slice and quietly re-admit exactly what was masked out.
    for chunk in re.finditer(r"[^\s](?:[^\n]|\n(?!\s*\n))*", masked):
        seg = chunk.group(0)
        if not seg.strip():
            continue
        start = chunk.start()
        tex = text[start:chunk.end()]
        plain = to_plain_text(tex).strip()
        if not plain:
            continue
        sec_title, sec_line = "(front matter)", 0
        for spos, stitle in sections:
            if spos <= start:
                sec_title, sec_line = stitle, line_of(text, spos)
            else:
                break
        paragraphs.append(Paragraph(
            start=start, end=chunk.end(), line=line_of(text, start),
            tex=tex, plain=plain, section=sec_title, section_line=sec_line,
            code_free_plain=to_plain_text(strip_code_spans(tex)).strip(),
        ))

    return Chapter(path=path, raw=raw, text=text, paragraphs=paragraphs,
                   floats=floats, else_spans=ifpdbook_else_spans(text))


# ---------------------------------------------------------------------------
# Lexicon
# ---------------------------------------------------------------------------

def load_lexicon(path: Path | None = None) -> dict:
    p = path or LEXICON_PATH
    data = json.loads(p.read_text(encoding="utf-8"))
    domains = {k: v for k, v in data["figurative_domains"].items() if not k.startswith("$")}
    compiled = {}
    for domain, terms in domains.items():
        ordered = sorted((t for t in terms), key=len, reverse=True)
        alt = "|".join(re.escape(t) for t in ordered)
        compiled[domain] = re.compile(r"(?<![A-Za-z])(" + alt + r")(?![A-Za-z])", re.IGNORECASE)
    data["_compiled_domains"] = compiled
    anchors = data["definition_anchors"]
    data["_anchor_re"] = re.compile(
        "|".join(
            [r"\\(?:" + "|".join(anchors["macros"]) + r")\b"]
            + [r"\\begin\s*\{(?:" + "|".join(anchors["environments"]) + r")\}"]
            + [re.escape(p) for p in anchors["phrases"]]
        ),
        re.IGNORECASE,
    )
    data["_slash_allow"] = {p.lower() for p in data["slash_pair_allowlist"]["pairs"]}
    data["_register_re"] = re.compile(
        "|".join(re.escape(p) for p in data["artifact_register"]["deictic_self_reference"]),
        re.IGNORECASE,
    )
    return data


# ---------------------------------------------------------------------------
# Findings
# ---------------------------------------------------------------------------

def make_finding(chapter, para_or_line, rule, message, evidence, excerpt="",
                 section="", severity="advisory") -> dict:
    return {
        "file": chapter.path,
        "line": para_or_line,
        "rule": rule,
        "severity": severity,
        "section": section,
        "message": message,
        "evidence": evidence,
        "excerpt": excerpt[:400],
    }


def excerpt_of(plain: str, limit: int = 220) -> str:
    s = re.sub(r"\s+", " ", plain).strip()
    return s if len(s) <= limit else s[:limit - 1] + "\u2026"


# ---------------------------------------------------------------------------
# Rule: caption-carries-the-fact
# ---------------------------------------------------------------------------

def rule_caption_carries_the_fact(ch: Chapter, lex: dict) -> list:
    """The float's caption states a concrete, checkable fact; the paragraph
    that introduces the float states nothing concrete at all.

    Mechanical on both sides. "Introduces the float" is defined as: the prose
    paragraph containing \\ref{<the float's label>}, or, when the float carries
    no label or nothing references it, the nearest preceding prose paragraph."""
    out = []
    for fl in ch.floats:
        # Bare mathematics does not count on the CAPTION side. "$g$" or
        # "$\to$" in a caption is notation, not a checkable statement, and
        # treating it as one produced the only two false positives this rule
        # had on the corpus. It still counts on the PARAGRAPH side: a
        # paragraph that names its symbols is anchoring the reader.
        cap_hits = [h for h in concrete_hits(fl.caption_tex) if h[0] != "math"]
        if not cap_hits:
            continue
        intro = None
        if fl.label:
            ref_pat = re.compile(r"\\(?:ref|autoref|cref|Cref|pageref|nameref)\s*\{" + re.escape(fl.label) + r"\}")
            for p in ch.paragraphs:
                if ref_pat.search(p.tex):
                    intro = p
                    break
        if intro is None:
            before = [p for p in ch.paragraphs if p.end <= fl.start]
            intro = before[-1] if before else None
        if intro is None or intro.words < CAPTION_MIN_PARAGRAPH_WORDS:
            continue
        if concrete_hits(intro.tex):
            continue
        kinds = sorted({k for k, _ in cap_hits})
        sample = sorted({v.strip() for _, v in cap_hits})[:4]
        out.append(make_finding(
            ch, intro.line, "caption-carries-the-fact",
            (f"the caption of {fl.env} '{fl.label or '(unlabelled)'}' (line {fl.line}) states something "
             f"concrete and checkable, and the {intro.words}-word paragraph that introduces it states "
             f"nothing concrete at all -- the prose kept the figure and gave the fact away"),
            {"float_line": fl.line, "float_env": fl.env, "float_label": fl.label,
             "caption_concrete_kinds": kinds, "caption_concrete_sample": sample,
             "paragraph_words": intro.words,
             "caption": excerpt_of(fl.caption_plain)},
            excerpt=excerpt_of(intro.plain), section=intro.section,
        ))
    return out


# ---------------------------------------------------------------------------
# Rule: metaphor-domain-collision
# ---------------------------------------------------------------------------

def _domain_hits(plain: str, lex: dict) -> dict:
    hits = {}
    for domain, pat in lex["_compiled_domains"].items():
        found = [m.group(1) for m in pat.finditer(plain)]
        if found:
            hits[domain] = found
    return hits


def rule_metaphor_domain_collision(ch: Chapter, lex: dict) -> list:
    out = []
    for p in ch.paragraphs:
        if p.words < MIN_PARAGRAPH_WORDS:
            continue
        hits = _domain_hits(p.plain, lex)
        if len(hits) < METAPHOR_DOMAIN_FLOOR:
            continue
        if lex["_anchor_re"].search(p.tex):
            continue
        listed = {d: sorted({h.lower() for h in v}) for d, v in sorted(hits.items())}
        out.append(make_finding(
            ch, p.line, "metaphor-domain-collision",
            (f"one paragraph borrows figurative vocabulary from {len(hits)} unrelated domains "
             f"({', '.join(sorted(hits))}) and defines none of them -- the reader is asked to carry "
             f"{len(hits)} analogies at once and is given no way to cash any of them"),
            {"domains": listed, "paragraph_words": p.words},
            excerpt=excerpt_of(p.plain), section=p.section,
        ))
    return out


# ---------------------------------------------------------------------------
# Rule: metaphor-never-instantiated
# ---------------------------------------------------------------------------

_APPARATUS_SECTION_RE = re.compile(r"(exercises?|solutions?|answers?|bibliography|references)\b", re.I)


def _base(term: str) -> str:
    t = term.lower()
    return t[:-1] if t.endswith("s") and len(t) > 3 else t


def rule_metaphor_never_instantiated(ch: Chapter, lex: dict) -> list:
    """A figure used N+ times in a section's PROSE before any concrete token
    follows it. Floats are excluded from the scan on purpose: a concrete
    table row does not rescue the paragraph above it."""
    out = []
    by_section = {}
    for p in ch.paragraphs:
        by_section.setdefault((p.section, p.section_line), []).append(p)
    for (section, sec_line), paras in by_section.items():
        if _APPARATUS_SECTION_RE.match(section.strip()):
            # An Exercises or Solutions section is apparatus: its bodies are
            # masked out above, so what is left is pointers and titles, and
            # counting a figure across them measures nothing.
            continue
        events = []   # (offset-in-section-prose, kind, value)
        cursor = 0
        prose = section + ". "
        for p in paras:
            prose += p.plain + "\n\n"
        for domain, pat in lex["_compiled_domains"].items():
            for m in pat.finditer(prose):
                events.append((m.start(), "term", _base(m.group(1))))
        # Concrete tokens are located in the section's TeX prose, mapped onto
        # the same ordering by paragraph index; per-paragraph granularity is
        # enough for "did a concrete thing come after this figure".
        offset = len(section) + 2
        for p in paras:
            if concrete_hits(p.tex):
                events.append((offset, "concrete", ""))
            offset += len(p.plain) + 2
        events.sort()
        # A concrete paragraph closes the count for every figure seen so far:
        # the question is how many times the reader met the metaphor BEFORE
        # anything concrete followed it. A figure first used after that point
        # starts its own count, closed in turn by the next concrete paragraph.
        counts = {}
        for _pos, kind, val in events:
            if kind == "concrete":
                for state in counts.values():
                    state["closed"] = True
                continue
            state = counts.setdefault(val, {"n": 0, "closed": False})
            if state["closed"]:
                continue
            state["n"] += 1
        for term, st in sorted(counts.items()):
            if st["n"] < METAPHOR_INSTANCE_FLOOR:
                continue
            out.append(make_finding(
                ch, sec_line or paras[0].line, "metaphor-never-instantiated",
                (f"the figure '{term}' is used {st['n']} times in the prose of section "
                 f"\u201c{section}\u201d before any concrete instance follows it -- the reader meets the "
                 f"metaphor {st['n']} times before seeing one of the things it stands for do one thing"),
                {"term": term, "uses_before_first_concrete": st["n"], "section": section},
                excerpt=excerpt_of(paras[0].plain), section=section,
            ))
    return out


# ---------------------------------------------------------------------------
# Rule: undefined-slash-pair
# ---------------------------------------------------------------------------

_SLASH_RE = re.compile(r"(?<![A-Za-z0-9./\\])([A-Za-z]{4,})/([A-Za-z]{4,})(?![A-Za-z0-9./])")


def rule_undefined_slash_pair(ch: Chapter, lex: dict) -> list:
    out = []
    for p in ch.paragraphs:
        if p.words < MIN_PARAGRAPH_WORDS:
            continue
        seen = set()
        for m in _SLASH_RE.finditer(p.code_free_plain):
            left, right = m.group(1), m.group(2)
            pair = f"{left}/{right}".lower()
            if pair in seen:
                continue
            if len(left) < SLASH_SIDE_MIN_CHARS or len(right) < SLASH_SIDE_MIN_CHARS:
                continue
            if pair in lex["_slash_allow"]:
                continue
            if left[0].isupper() or right[0].isupper():
                continue   # SQLite/WAL, Alice/Bob: a named thing, not a coinage
            if lex["_anchor_re"].search(p.tex):
                continue
            seen.add(pair)
            out.append(make_finding(
                ch, p.line, "undefined-slash-pair",
                (f"the coinage '{left}/{right}' is used with no gloss in its own paragraph -- a slash "
                 f"compresses a relation the reader is left to guess at, and this one is not an "
                 f"established compound"),
                {"pair": f"{left}/{right}", "paragraph_words": p.words},
                excerpt=excerpt_of(p.plain), section=p.section,
            ))
    return out


# ---------------------------------------------------------------------------
# Rule: artifact-register-drift
# ---------------------------------------------------------------------------

def rule_artifact_register_drift(ch: Chapter, lex: dict) -> list:
    out = []
    for p in ch.paragraphs:
        # Matched against the paragraph's SOURCE, not its plain text, so each
        # hit keeps an absolute offset and can be tested against the
        # \ifpdbook else-branches one by one. A paragraph that straddles
        # \else -- and in this Book they do -- must not be exempted whole.
        matches = []
        for m in lex["_register_re"].finditer(p.tex):
            abs_pos = p.start + m.start()
            if any(s <= abs_pos < e for s, e in ch.else_spans):
                continue   # the \else branch IS the standalone paper
            matches.append(m.group(0))
        if not matches:
            continue
        out.append(make_finding(
            ch, p.line, "artifact-register-drift",
            (f"a Book chapter calls itself a paper ({', '.join(sorted(set(matches)))}) -- the reader "
             f"holding a book is told they are holding something else, and the register of every claim "
             f"around it shifts with it"),
            {"phrases": sorted(set(matches))},
            excerpt=excerpt_of(p.plain), section=p.section,
        ))
    return out


# ---------------------------------------------------------------------------
# Rule: abstraction-run
# ---------------------------------------------------------------------------

def rule_abstraction_run(ch: Chapter, lex: dict) -> list:
    out = []
    for p in ch.paragraphs:
        if p.words < MIN_PARAGRAPH_WORDS:
            continue
        sentences = split_sentences(p.plain)
        # A short sentence is TRANSPARENT: it neither joins a run nor breaks
        # one. "It is not a database." is as abstract as the sentence before
        # it, so breaking the run there would reward chopping; counting it
        # would let three connectives in a row trip the rule. Only a sentence
        # long enough to carry a claim, and carrying no concrete token, counts.
        run, best = [], []
        for s in sentences:
            if word_count(s) < ABSTRACTION_MIN_SENTENCE_WORDS:
                continue
            if concrete_hits(s):
                run = []
                continue
            run.append(s)
            if len(run) > len(best):
                best = list(run)
        if len(best) < ABSTRACTION_RUN_FLOOR:
            continue
        span = best
        out.append(make_finding(
            ch, p.line, "abstraction-run",
            (f"{len(best)} consecutive sentences with no concrete token -- no filename, no number, no "
             f"identifier, no example pointer. The reader has nothing to attach the claim to and "
             f"cannot check whether they have understood it"),
            {"run_length": len(best), "sentences": [excerpt_of(s, 160) for s in span]},
            excerpt=excerpt_of(" ".join(span)), section=p.section,
        ))
    return out


RULES = {
    "caption-carries-the-fact": rule_caption_carries_the_fact,
    "metaphor-domain-collision": rule_metaphor_domain_collision,
    "metaphor-never-instantiated": rule_metaphor_never_instantiated,
    "undefined-slash-pair": rule_undefined_slash_pair,
    "artifact-register-drift": rule_artifact_register_drift,
    "abstraction-run": rule_abstraction_run,
}


def lint_file(path: str, lex: dict, only=None) -> list:
    ch = parse_chapter(path)
    findings = []
    for name, fn in RULES.items():
        if only and name not in only:
            continue
        findings.extend(fn(ch, lex))
    findings.sort(key=lambda f: (f["line"], f["rule"]))
    return findings


def default_chapter_sources(repo_root: str) -> list:
    """Same convention and same function shape as margin_lint.py's and
    chapter_lint.py's: the chapter list is whitepaper/textbook.json's `source`
    fields, never a hard-coded list of eight paths."""
    textbook_path = Path(repo_root) / "whitepaper" / "textbook.json"
    data = json.loads(textbook_path.read_text(encoding="utf-8"))
    return [str(Path(repo_root) / ch["source"]) for ch in data["chapters"]]


# ---------------------------------------------------------------------------
# Self-test: a clean paragraph and a deliberately bad one, separated
# ---------------------------------------------------------------------------

CLEAN_FIXTURE = r"""
\section{The write path}
\label{sec:writepath}

A write reaches the daemon as one \texttt{BEGIN IMMEDIATE} transaction against
\texttt{harbor.db}. The daemon holds the write lock for the duration, appends
the row to \texttt{claims}, and returns the new \texttt{rowid} to the caller;
a second writer arriving during that window blocks for up to 5000 ms and then
fails with \texttt{SQLITE\_BUSY} rather than waiting forever. Nothing else in
the system may open the file for writing, which is what makes the rowid a
total order rather than a hint.

\begin{table}[H]
\caption{Busy-timeout settings, in milliseconds, for each caller class.}
\label{tab:busy}
\begin{tabular}{ll}
caller & timeout \\
\end{tabular}
\end{table}
"""

BAD_FIXTURE = r"""
\section{The runtime as five organs}
\label{sec:badorgans}

We organise the runtime into five \emph{organs}, each a contract the process
must hold for the tiers above it to cohere (Table~\ref{tab:bad}). The
temptation is to present such a runtime as a flat noun-list of parts --- ports,
leases, sessions, a bus, markers, receipts, a monitor, a store --- which is the
symptom of treating the runtime as a warehouse. It is not a warehouse. It is a
system of record plus an arbiter, and naming the organs exposes the connective
tissue a noun-list buries. The organs are what the remaining tiers rest upon,
and the ordering of the organs is the ordering of the paper's own corrections.
Naming them in this order is what lets the argument of the tiers above proceed
without re-deriving the arrangement from first principles every time.

\begin{table}[H]
\caption{The five organs. All five are disciplines over one
\texttt{runtime.db} file: one commit history, not five stores.}
\label{tab:bad}
\begin{tabular}{ll}
organ & contract \\
\end{tabular}
\end{table}

The substrate organ is the floor; the other four are, mechanically, tables
with rigour over the same file. We treat the substrate and the two organs
that carry the paper's sharpest corrections (resource/exclusion and
obligation/enforcement) in full, and the rest with the depth their novelty
warrants.
"""


def selftest(lex: dict) -> int:
    import tempfile
    ok = True
    with tempfile.TemporaryDirectory() as tmp:
        clean = Path(tmp) / "clean.tex"
        bad = Path(tmp) / "bad.tex"
        clean.write_text(CLEAN_FIXTURE, encoding="utf-8")
        bad.write_text(BAD_FIXTURE, encoding="utf-8")
        cf = lint_file(str(clean), lex)
        bf = lint_file(str(bad), lex)
    print("clean fixture:", len(cf), "finding(s)")
    for f in cf:
        print("   ", f["rule"], "--", f["message"][:100])
    print("bad fixture:  ", len(bf), "finding(s)")
    for f in bf:
        print("   ", f["rule"], "--", f["message"][:100])
    if cf:
        print("FAIL: the clean fixture should produce no findings")
        ok = False
    bad_rules = {f["rule"] for f in bf}
    expected = {"caption-carries-the-fact", "metaphor-domain-collision",
                "metaphor-never-instantiated", "undefined-slash-pair",
                "artifact-register-drift", "abstraction-run"}
    missing = expected - bad_rules
    if missing:
        print("FAIL: the bad fixture did not trip:", ", ".join(sorted(missing)))
        ok = False
    print("selftest:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("files", nargs="*",
                        help="chapter .tex files; default: every chapter in whitepaper/textbook.json")
    parser.add_argument("--json", action="store_true", help="emit findings as JSON")
    parser.add_argument("--summary", action="store_true", help="counts per rule only")
    parser.add_argument("--rule", action="append", default=None,
                        help=f"only this rule (repeatable); one of: {', '.join(sorted(RULES))}")
    parser.add_argument("--limit", type=int, default=12,
                        help="list at most this many findings per rule (0 = all); the summary "
                             "counts are always the true totals")
    parser.add_argument("--strict", action="store_true", help="exit 1 if any finding is reported")
    parser.add_argument("--selftest", action="store_true",
                        help="run the clean-vs-bad fixture pair and report whether they separate")
    parser.add_argument("--lexicon", default=str(LEXICON_PATH), help="path to the lexicon JSON")
    parser.add_argument("--repo-root", default=str(REPO_ROOT), help="repository root")
    args = parser.parse_args(argv)

    try:
        lex = load_lexicon(Path(args.lexicon))
    except Exception as exc:  # noqa: BLE001
        print(f"readers_eye.py: could not read lexicon {args.lexicon}: {exc}", file=sys.stderr)
        return 2

    if args.selftest:
        return selftest(lex)

    if args.rule:
        unknown = [r for r in args.rule if r not in RULES]
        if unknown:
            print(f"readers_eye.py: unknown rule(s): {', '.join(unknown)}", file=sys.stderr)
            return 2

    if args.files:
        files = args.files
    else:
        try:
            files = default_chapter_sources(str(Path(args.repo_root).resolve()))
        except Exception as exc:  # noqa: BLE001
            print(f"readers_eye.py: could not read chapter sources from whitepaper/textbook.json: {exc}",
                  file=sys.stderr)
            return 2

    for f in files:
        if not Path(f).is_file():
            print(f"readers_eye.py: no such file: {f}", file=sys.stderr)
            return 2

    findings = []
    for f in files:
        findings.extend(lint_file(f, lex, only=set(args.rule) if args.rule else None))

    if args.json:
        print(json.dumps(findings, indent=2))
        return 1 if (args.strict and findings) else 0

    per_rule = {}
    for f in findings:
        per_rule[f["rule"]] = per_rule.get(f["rule"], 0) + 1

    if not args.summary:
        if not findings:
            print("readers_eye: no findings")
        shown = {}
        for f in findings:
            n = shown.get(f["rule"], 0)
            if args.limit and n >= args.limit:
                shown[f["rule"]] = n + 1
                continue
            shown[f["rule"]] = n + 1
            head = f"{f['file']}:{f['line']}: [{f['severity'].upper()}] {f['rule']}"
            print(f"{head}\n    section: {f['section']}\n    {f['message']}")
            if f["excerpt"]:
                print(f"    prose:   {f['excerpt']}")
            print(f"    evidence: {json.dumps(f['evidence'], ensure_ascii=False)}")
            print()
        for rule, n in sorted(shown.items()):
            if args.limit and n > args.limit:
                print(f"... {n - args.limit} more {rule} finding(s) not listed "
                      f"(--rule {rule} --limit 0 to see them all)")

    print(f"readers_eye: {len(findings)} finding(s) across {len(files)} chapter(s)")
    for rule in sorted(RULES):
        if args.rule and rule not in args.rule:
            continue
        print(f"    {per_rule.get(rule, 0):4d}  {rule}")
    print("Layer 2 (the judge pass) is not run here: see "
          "skills/textbook-craft/references/readers-eye.md")

    return 1 if (args.strict and findings) else 0


if __name__ == "__main__":
    sys.exit(main())
