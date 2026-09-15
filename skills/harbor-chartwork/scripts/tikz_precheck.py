#!/usr/bin/env python3
"""tikz_precheck.py -- source-level lint for Harbor TikZ figure fragments.

Needs no TeX engine: every check reads the fragment's own text. This is the
complement of figcheck.py, which needs a compiled PDF and inspects rendered
geometry instead.

Checks (hard, fail the build unless noted):
  - missing provenance comment: line 1 is not a substantive `%` comment.
  - a color name outside the corpus's house palette (see PALETTES below).
  - multi-word `\node{...}` text with no wrapping (`text width=`/`align=`, on
    the node itself OR via a named style -- local to the fragment, or one of
    the shared house styles -- that already bakes one of those in).
  - `R\d+`, `CR-\d+`, or `B6` inside a caption's leading `\textbf{...}` (the
    caption's bolded lead sentence) or inside a title-styled node/pgfplots
    axis title (heuristic, not a full parse -- see find_title_texts()).

  Numbered rules (P10-P25), evaluated against the fragment with LaTeX
  comments stripped (an unescaped `%` to end of line) so a `\tiny` or
  `\resizebox` mentioned only in a comment never fires:
  - P10 tiny        (FAIL) any `\tiny` in the fragment.
  - P11 scriptsize  (FAIL) any `\scriptsize` in the fragment -- the shared
                     styles own the small sizes; a fragment may not set them.
  - P12 resizebox   (WARN) `\resizebox{F\textwidth}`/`{F\linewidth}` with
                     F < 0.85, or any `\resizebox` whose first argument is
                     not a simple `F\textwidth`/`F\linewidth` fraction.
  - P13 bare-fill   (FAIL) a `\fill[...]`/`\path[fill...]` that names a
                     colour at alpha < 20 (`!NN` with NN < 20) with no
                     `draw=` of its own -- the `pd ... fill` house styles are
                     exempt (they draw their own edge).
  - P14 row-labels  (WARN) a `\node[...anchor=east...,font=\scriptsize|\tiny]`
                     whose text is one bare word -- suggests `pd row label`.

  The typographic law (figures/pd-figure-language.tex). One size for every
  named text role; roles separate by weight, slope, family and ink. These
  six rules are what makes the style file binding rather than advisory --
  before them, half the fragments in the Book opted out of the house styles
  by restating typography locally, and the corpus had no single voice. They
  do not apply to the style-definition files themselves (see
  STYLE_DEFINITION_STEMS): that file IS the one place.
  - P18 style-font  (FAIL) a `\node` carrying a `pd ...` house style AND its
                     own `font=`. The style already fixes the font; a local
                     one silently overrides the whole role.
  - P19 node-size   (FAIL) any `font=` whose value names a LaTeX size command
                     (`\footnotesize`, `\small`, `\fontsize{..}`, ...). A
                     fragment never sets a size; it takes the role that
                     already has the right one.
  - P20 hard-ink    (FAIL) a `\fill`/`\draw`/`\path`/`\addplot` that paints a
                     house ink (`hhink`, `hhteal`, `hhamber`, `hhsand`,
                     `hhgray`, ...) through a bare `fill=`/`draw=`/colour
                     token with NO `pd ...` style anywhere in the same option
                     list -- a `pd ... fill` or `pd ... rule` style says the
                     same thing and keeps the edition overrides working.
                     `hhpaper` is exempt: it is the ground, not an ink (a
                     knockout backing or a halo ring around a mark).
  - P21 node-family (FAIL) a `font=` naming a type FAMILY (`\sffamily`,
                     `\rmfamily`, `\ttfamily`, `\fontfamily{..}`). Figure
                     type inherits the document's own face -- Palatino in the
                     Book, Computer Modern in a standalone chapter -- so a
                     fragment asking for sans gets Latin Modern Sans against a
                     Computer Modern page and reads as a foreign object on it.
                     An EDITION may substitute a face, in one command in one
                     file; a fragment may not. The identifier face is asked
                     for by role (`pd mono label`), not by `\ttfamily`.
  - P25 font-handle (FAIL) a `font=` in a fragment whose value is built from
                     anything but the house handles (`\pdfiglabel`,
                     `\pdfiglabelbold`, `\pdfiglabelitalic`,
                     `\pdfiglabelmono`, `\pdfigsub`, `\pdfigmath`, ...).
                     This is the GENERAL form of P19 and P21, and it is a
                     whitelist because the mechanism is general: `pd figure`
                     sets the figure's family through the PICTURE-level `font=`
                     key, and a node's own `font=` REPLACES that key's value
                     wholesale, so `\pdfiglabelfamily` is never applied and the
                     node falls back to the document's face. Measured: in the
                     Book, `font=\bfseries` renders TeXGyrePagellaX-Bold and
                     `font=\itshape` renders TeXGyrePagellaX-Italic inside
                     drawings whose every other label is TeXGyreHeros. A
                     `font=` naming neither a family nor a size still loses the
                     family, which is why enumerating banned commands could
                     never have closed this. The handles re-apply the family
                     themselves, so they are the only safe values.
  - P24 body-font   (FAIL) a family-selection command in a node's TEXT rather
                     than in its `font=`: `\normalfont`, `\rmfamily`,
                     `\sffamily`, `\ttfamily`. P21 watches `font=`; this
                     watches the other door, and `\normalfont` is the one that
                     matters because it resets to the DOCUMENT's family, not the
                     figure's. Three fragments were using it to get an
                     unemphasised second line inside a bold `pd row label`, and
                     in the Book that set the line in Palatino inside a grotesk
                     drawing. The role for a gloss line is `\pdfigsub`, which
                     steps down by slope and weight and leaves the family alone.
                     `\mathrm` and `\text` are NOT flagged: they are math, and
                     math takes the text roman whatever the node's face is.
  - P23 dotted      (FAIL) a `dotted` / `densely dotted` / `loosely dotted`
                     key, in a fragment or in a style file. Those three derive
                     their on-length from `\pgflinewidth`, read when the KEY is
                     processed rather than when the path is stroked -- so a
                     `line width=` set afterwards, or appended by an edition
                     override, changes the stroke and silently leaves the dash
                     at the old width. That is how `pd guide` shipped a 0.448pt
                     dot on a 0.498pt stroke. Write `dash pattern=on Xpt off
                     Ypt`, and let figcheck's T9 say whether it resolves. This
                     is the ONE law rule that also applies to the
                     style-definition files, because that is where the defect
                     was. `dashed` and its relatives are absolute and are fine.
  - P22 figmath     (FAIL) `\pdfigmath` applied to a math group with no sub-
                     or superscript. That macro forces a size one notch ABOVE
                     the law's, and the only thing that buys is a subscript
                     over figcheck's 7pt floor. On plain math it is just a
                     label set larger than its neighbours.

Usage:
  tikz_precheck.py FRAGMENT.tex [FRAGMENT.tex ...]
      [--corpus chapter|research|auto] [--json OUT] [--md OUT]
      [--style-defs FILE ...] [--allow-color NAME ...]

Exit status:
  0  no hard findings in any given fragment (warn-only checks, including
     P12/P14, do not count)
  1  at least one hard finding in at least one fragment
  2  usage error (a given path does not exist, etc.)
"""
import argparse
import json
import re
import sys
from pathlib import Path

# --------------------------------------------------------------------------- #
# House palettes and style registries, verified against this branch's actual
# state on 2026-09-06 (see the skill's references/corpus-audit.md). There is
# no figures/pd-palette.tex on this branch -- every chapter root instead
# `\definecolor`s this same set directly, immediately before
# `\input{figures/pd-figure-language}`. The research corpus never loads that
# file at all; its own docs/harbor-research/tex/preamble.tex defines a
# separate, smaller palette. --style-defs can extend either set at run time
# by pointing at a real style-definition file (parsed the same way).
# --------------------------------------------------------------------------- #

CHAPTER_COLORS = {
    "hhsand", "hhsanddeep", "hhebony", "hhink", "hhcobalt", "hhamber",
    "hhteal", "hhpaper", "hhgray",
    "codebg", "codeframe", "darkgreen", "darkblue", "accent",
}
RESEARCH_COLORS = {"harborblue", "shipred", "seagreen"}
UNIVERSAL_COLORS = {"black", "white", "none", "gray", "grey"}

# Every style name defined in figures/pd-figure-language.tex (chapter/
# whitepaper corpora). Used to keep the color check from mistaking a bare
# style reference (`\node[pd actor]`) for an unrecognized color.
CHAPTER_STYLE_NAMES = {
    "pd figure", "pd hairline", "pd rule", "pd focus rule", "pd caution rule",
    "pd guide", "pd lattice", "pd arrow", "pd focus arrow", "pd caution arrow",
    "pd row label", "pd panel title", "pd axis label", "pd direct label",
    "pd note", "pd tick", "pd datum", "pd focus datum", "pd caution datum",
    "pd state", "pd terminal", "pd actor", "pd artifact", "pd boundary",
    "pd focus fill", "pd caution fill", "pd neutral fill", "pd ink fill",
    "pd hatch",
    # The roles added with the typographic law. Each is a composition of one
    # of the above, so an edition override on the parent reaches it.
    "pd decision", "pd mono label", "pd verdict", "pd reverse label",
    "pd reverse row label", "pd legend", "pd axis",
    "pd kind tag", "pd badge",
}
# The subset of the above whose definition already bakes in `align=` or
# `text width=` -- so a multi-word node using one of these does not need its
# own wrapping key. Derived mechanically from pd-figure-language.tex's own
# `.style={...}` bodies, not guessed.
CHAPTER_SAFE_STYLES = {
    "pd panel title", "pd direct label", "pd note",
    "pd state", "pd terminal", "pd actor", "pd artifact",
    "pd decision", "pd mono label", "pd verdict", "pd reverse label",
    "pd kind tag", "pd badge",
}

RESEARCH_STYLE_NAMES = {"relnode", "relarrow", "regimebox"}
RESEARCH_SAFE_STYLES = {"relnode", "regimebox"}

BAD_TITLE_RE = re.compile(r"\b(R\d+|CR-\d+|B6)\b")

# Single-word bare TikZ/pgf appearance keywords that are NOT color names.
# Multi-word keywords ("rounded corners", "ultra thick", "densely dotted", ...)
# never need listing here: the color-shape regex below only matches a single
# identifier (optionally chained with `!mixing`), so a token containing a
# space already fails to match it.
NON_COLOR_BARE_KEYWORDS = {
    "thick", "thin", "semithick", "ultrathick", "verythick", "ultrathin", "verythin",
    "dashed", "dotted", "solid", "double",
    "circle", "rectangle", "ellipse", "diamond", "cross", "star", "coordinate",
    "smooth", "decorate", "sloped", "midway",
    "above", "below", "left", "right", "center", "fill", "draw", "text",
    "north", "south", "east", "west", "opacity", "scale", "rotate", "anchor",
}

COLOR_SHAPE_RE = re.compile(
    r"^[A-Za-z][A-Za-z0-9]*(?:!\s*\d+(?:\s*!\s*(?:[A-Za-z][A-Za-z0-9]*|\d+))?)*$"
)
COLOR_KEY_RE = re.compile(
    r"\b(draw|fill|text|color|line\s+color|pattern\s+color|top\s+color|"
    r"bottom\s+color|left\s+color|right\s+color|middle\s+color|fill\s+color|"
    r"draw\s+color)\b\s*=\s*([A-Za-z][A-Za-z0-9]*(?:\s*!\s*\d+(?:\s*!\s*(?:[A-Za-z][A-Za-z0-9]*|\d+))?)*)"
)
TEXTCOLOR_RE = re.compile(r"\\(?:textcolor|colorbox)\{([^{}]*)\}")
COLOR_CMD_RE = re.compile(r"\\color\{([^{}]*)\}")

STYLE_DEF_RE = re.compile(r"([A-Za-z][A-Za-z0-9 _-]*?)/\.style\s*=\s*\{")

# Numbered rule ids introduced alongside the original, unnumbered checks
# above. Kept in one place so the summary/"counts per id" machinery and the
# markdown report can iterate them without hardcoding the list twice.
RULE_IDS = ["P10", "P11", "P12", "P13", "P14",
            "P18", "P19", "P20", "P21", "P22", "P23", "P24", "P25"]

# Rule numbers claimed by work that is not in this file.
#
# P15-P17 were implemented here first, on 2026-09-14 at 12:49, as the three
# typographic-law rules now numbered P18-P20. Thirty-three minutes later
# `claude/figures-that-were-missing` independently landed a DIFFERENT P15, P16
# and P17 -- caption-promise, identifier-consistency and caption-vocabulary --
# each with a passing and a failing fixture and a clean run over all ~100
# fragments in the three corpora. Two branches, six good rules, three numbers.
#
# This branch yielded the numbers rather than the other. Not because its rules
# are worse: because renumbering HERE is something this branch can do, and
# asking the other branch to renumber is something it can only hope for. A
# reconciliation that depends on someone else acting is not a reconciliation.
# The other three keep the numbers they published, and are written down here so
# the collision cannot silently happen a third time.
#
# The point of this table is that it is CHECKED. TestRuleIdRegistry in
# tests/test_tikz_precheck_typography.py asserts that RULE_IDS and
# RESERVED_RULE_IDS are disjoint, that together they run with no gaps, and that
# every implemented id is documented above -- so the next person claiming a
# number has to add a line here, and finds out at once if it is taken. Delete an
# entry only when that branch has merged and its rule lives in this file.
RESERVED_RULE_IDS = {
    "P15": "caption-promise (claude/figures-that-were-missing, PR #10190)",
    "P16": "identifier-consistency (claude/figures-that-were-missing, PR #10190)",
    "P17": "caption-vocabulary (claude/figures-that-were-missing, PR #10190)",
}

# The files that ARE the one place the typographic law lives. P18-P20 police
# fragments for opting out of those files; running them against the files
# themselves would flag the definitions. Matched on the stem, so both twins
# and every edition override are covered.
STYLE_DEFINITION_STEMS = (
    "pd-figure-language",
    "pd-palette",
)

# Every ink in the chapter house palette EXCEPT hhpaper, which is the page
# ground rather than an ink: a `fill=hhpaper` is a knockout backing behind a
# label and a `draw=hhpaper` is a halo ring around a mark, and neither has a
# `pd ...` style that says it better.
HOUSE_INKS = {
    "hhsand", "hhsanddeep", "hhebony", "hhink", "hhcobalt", "hhamber",
    "hhteal", "hhgray",
}

# What to reach for instead, per ink. Named in the finding so the error tells
# the author the fix rather than only the fault.
FILL_EQUIVALENT = {
    "hhteal": "pd focus fill",
    "hhcobalt": "pd focus fill",
    "hhamber": "pd caution fill",
    "hhsand": "pd neutral fill",
    "hhsanddeep": "pd neutral fill",
    "hhgray": "pd neutral fill",
    "hhink": "pd ink fill",
    "hhebony": "pd ink fill",
}
RULE_EQUIVALENT = {
    "hhink": "pd rule",
    "hhebony": "pd rule",
    "hhteal": "pd focus rule",
    "hhcobalt": "pd focus rule",
    "hhamber": "pd caution rule",
    "hhgray": "pd hairline (or pd lattice / pd tick)",
    "hhsand": "pd neutral fill",
    "hhsanddeep": "pd neutral fill",
}

# A LaTeX size command, in any of the forms a fragment has actually used.
SIZE_COMMAND_RE = re.compile(
    r"\\(tiny|scriptsize|footnotesize|small|normalsize|large|Large|LARGE|huge|Huge|fontsize)\b"
)
# A LaTeX family selection. \ttfamily is on the list: a fragment that wants the
# identifier face takes `pd mono label`, which is the one place the mono face
# and its side bearing are decided.
FAMILY_COMMAND_RE = re.compile(
    r"\\(sffamily|rmfamily|ttfamily|fontfamily|sfdefault|rmdefault|ttdefault|usefont)\b"
)
FONT_KEY_RE = re.compile(r"\bfont\s*=\s*")


def is_apparatus(path):
    """True for a file under figures/ that is NOT a drawing.

    Not everything in a figures directory is a figure. The Book keeps its
    apparatus there too -- the figure language and its per-edition overrides,
    the palette, the pedagogy environments, the citation shortforms, the
    chapter map -- and all of them are named `pd-*`, because that is this
    repository's convention for "loaded by the preamble, not \input as a
    picture". Matching the PREFIX rather than listing today's five stems is the
    same lesson compile_fragment.sh's exit 3 encodes: a list of names is
    defeated by the next name, and `pd-pedagogy.tex` is how this one was --
    it uses `\normalfont` inside an environment definition, which is correct
    there and which P24 flagged because this function had never heard of it.
    """
    stem = Path(path).stem
    if stem.startswith("pd-"):
        return True
    return any(stem == s or stem.startswith(s + "-") for s in STYLE_DEFINITION_STEMS)


# The old name, kept because the law rules read better with it: P18-P20 do not
# police the one place the law lives.
is_style_definition = is_apparatus


def _font_value_at(text, start):
    """Return the `font=` value beginning at START (just past the `=`), stopping
    at the first top-level comma, `]` or `}` -- the same boundary pgfkeys uses."""
    depth = 0
    i = start
    n = len(text)
    while i < n:
        c = text[i]
        if c in "{[":
            depth += 1
        elif c in "}]":
            if depth == 0:
                break
            depth -= 1
        elif c == "," and depth == 0:
            break
        i += 1
    return text[start:i].strip()


def strip_comments(text):
    """Return TEXT with every unescaped LaTeX comment (`%` to end of line)
    blanked out to spaces, preserving every other character's offset (and
    therefore line numbers) exactly. `\\%` is a literal percent, not a
    comment start; walking char-by-char and always consuming a backslash
    together with whatever follows it (its escaped character, even another
    backslash) keeps that distinction correct without a lookbehind regex."""
    out = []
    i = 0
    n = len(text)
    while i < n:
        c = text[i]
        if c == "\\" and i + 1 < n:
            out.append(text[i : i + 2])
            i += 2
            continue
        if c == "%":
            j = i
            while j < n and text[j] != "\n":
                j += 1
            out.append(" " * (j - i))
            i = j
            continue
        out.append(c)
        i += 1
    return "".join(out)


def find_braced(text, open_brace_index):
    """Given the index of a '{' return the text inside it (matching braces)."""
    depth = 1
    i = open_brace_index + 1
    n = len(text)
    while i < n and depth > 0:
        c = text[i]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
        i += 1
    return text[open_brace_index + 1 : i - 1], i


def parse_local_styles(text):
    """Return {style_name: body_text} for every `name/.style={...}` in TEXT,
    wherever it appears (a `\\tikzset{...}` block, or inline in a
    `\\begin{tikzpicture}[...]`/`\\begin{axis}[...]` option list)."""
    styles = {}
    for m in STYLE_DEF_RE.finditer(text):
        name = m.group(1).strip()
        brace_idx = text.index("{", m.end() - 1)
        body, _ = find_braced(text, brace_idx)
        styles[name] = body
    return styles


def resolve_safe_styles(local_styles, base_safe, base_all_names):
    """A style is 'safe' (already wraps its text) if its own body sets
    `align=` / `text width=`, or if it names another style (local or house)
    that is itself safe. Fixed-point over local styles handles one style
    referencing another local style, in either definition order."""
    safe = set(base_safe)
    all_names = set(base_all_names) | set(local_styles)
    changed = True
    while changed:
        changed = False
        for name, body in local_styles.items():
            if name in safe:
                continue
            if re.search(r"\balign\s*=", body) or re.search(r"\btext width\s*=", body):
                safe.add(name)
                changed = True
                continue
            for tok in split_top_level(body):
                tok = tok.split("=", 1)[0].strip()
                if tok in safe:
                    safe.add(name)
                    changed = True
                    break
    return safe, all_names


def split_top_level(s):
    out = []
    depth = 0
    cur = []
    for ch in s:
        if ch in "{[(":
            depth += 1
            cur.append(ch)
        elif ch in "}])":
            depth -= 1
            cur.append(ch)
        elif ch == "," and depth == 0:
            out.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    out.append("".join(cur))
    return [t.strip() for t in out if t.strip()]


NODE_CALL_RE = re.compile(r"\\node\b")


def find_node_calls(text):
    """Yield (style_text, content_text, start_offset) for each `\\node`.

    `\\node`'s options and its `(name)`/`at (x,y)` coordinate can appear in
    either order, so this walks forward from each `\\node` token collecting
    every `[...]` group (concatenated) until the first unbracketed `{`,
    rather than relying on one fixed option ordering."""
    out = []
    for m in NODE_CALL_RE.finditer(text):
        i = m.end()
        n = len(text)
        style_parts = []
        while i < n:
            c = text[i]
            if c.isspace():
                i += 1
            elif c == "[":
                body, i = find_braced_bracket(text, i)
                style_parts.append(body)
            elif c == "(":
                depth = 1
                i += 1
                while i < n and depth > 0:
                    if text[i] == "(":
                        depth += 1
                    elif text[i] == ")":
                        depth -= 1
                    i += 1
            elif text[i : i + 2].isalpha() or c.isalpha():
                # bare word like `at` -- skip it
                j = i
                while j < n and text[j].isalpha():
                    j += 1
                i = j
            elif c == "{":
                content, _end = find_braced(text, i)
                out.append((",".join(style_parts), content, m.start()))
                break
            else:
                break
    return out


def find_braced_bracket(text, open_index):
    depth = 1
    i = open_index + 1
    n = len(text)
    while i < n and depth > 0:
        if text[i] == "[":
            depth += 1
        elif text[i] == "]":
            depth -= 1
        i += 1
    return text[open_index + 1 : i - 1], i


WORD_RE = re.compile(r"[A-Za-z0-9]+")
MATH_RE = re.compile(r"\$[^$]*\$|\\\([^)]*\\\)|\\\[[^\]]*\\\]")
CMD_RE = re.compile(r"\\[A-Za-z]+\*?")


def count_prose_words(node_text):
    stripped = MATH_RE.sub(" ", node_text)
    stripped = CMD_RE.sub(" ", stripped)
    stripped = re.sub(r"[{}~^_&\\]", " ", stripped)
    return WORD_RE.findall(stripped)


def style_list_has_wrap(style_text, safe_styles):
    if re.search(r"\balign\s*=", style_text):
        return True
    if re.search(r"\btext width\s*=", style_text):
        return True
    for tok in split_top_level(style_text):
        name = tok.split("=", 1)[0].strip()
        if name in safe_styles:
            return True
    return False


CAPTION_RE = re.compile(r"\\caption\{")
TITLE_BOLD_RE = re.compile(r"^\s*\\textbf\{")
TITLE_KEY_RE = re.compile(r"\btitle\s*=\s*\{")


def find_title_texts(text):
    """Yield (kind, content) for every place this fragment names something as
    a *title*: a caption's leading bolded sentence, or a pgfplots `title={}`
    axis option, or a `\\node[...]` styled with a name containing the word
    "title" (covers `pd panel title` without hardcoding that exact string)."""
    out = []
    for m in CAPTION_RE.finditer(text):
        body, _ = find_braced(text, m.end() - 1)
        bm = TITLE_BOLD_RE.match(body)
        if bm:
            inner, _ = find_braced(body, bm.end() - 1)
            out.append(("caption title-bold", inner))
    for m in TITLE_KEY_RE.finditer(text):
        body, _ = find_braced(text, m.end() - 1)
        out.append(("axis title=", body))
    for style_text, content, _ in find_node_calls(text):
        if "title" in style_text.lower():
            out.append((f"node[{style_text.strip()}]", content))
    return out


PROVENANCE_RE = re.compile(r"^\s*%\s*(\S.*)?$")


def check_provenance(text):
    first_line = text.splitlines()[0] if text else ""
    m = PROVENANCE_RE.match(first_line)
    if not m or not (m.group(1) or "").strip():
        return [
            {
                "check": "provenance",
                "severity": "fail",
                "message": "line 1 is not a substantive '%' comment naming the figure/source",
                "line": 1,
            }
        ]
    return []


def check_tiny(text):
    """P10: `\\tiny` is banned in a fragment outright (comments stripped
    first, so a `\\tiny` mentioned only in a comment does not trip this)."""
    findings = []
    stripped = strip_comments(text)
    for m in re.finditer(r"\\tiny\b", stripped):
        line = stripped.count("\n", 0, m.start()) + 1
        findings.append(
            {
                "check": "tiny",
                "id": "P10",
                "severity": "fail",
                "line": line,
                "message": "\\tiny used -- the shared styles own font sizing, not the fragment",
            }
        )
    return findings


def check_scriptsize(text):
    """P11: `\\scriptsize` is likewise banned -- the shared house styles own
    the small sizes, a fragment may not set them directly."""
    findings = []
    stripped = strip_comments(text)
    for m in re.finditer(r"\\scriptsize\b", stripped):
        line = stripped.count("\n", 0, m.start()) + 1
        findings.append(
            {
                "check": "scriptsize",
                "id": "P11",
                "severity": "fail",
                "line": line,
                "message": "\\scriptsize used -- the shared styles own font sizing, not the fragment",
            }
        )
    return findings


RESIZEBOX_FRACTION_RE = re.compile(
    r"^\s*([0-9]*\.[0-9]+|[0-9]+)\s*\\(textwidth|linewidth)\s*$"
)
RESIZEBOX_MIN_FRACTION = 0.85


def check_resizebox(text):
    """P12: warn if `\\resizebox`'s first argument is a `F\\textwidth`/
    `F\\linewidth` fraction shrunk below RESIZEBOX_MIN_FRACTION, or is not a
    simple fraction of the page width at all (a fixed length, `\\linewidth`
    with no coefficient, two-dimension resize, etc.) -- both are the shapes
    that tend to fight the chapter's own layout rather than sit inside it."""
    findings = []
    stripped = strip_comments(text)
    for m in re.finditer(r"\\resizebox\b", stripped):
        line = stripped.count("\n", 0, m.start()) + 1
        brace_idx = stripped.find("{", m.end())
        if brace_idx == -1:
            continue
        arg1, _ = find_braced(stripped, brace_idx)
        fm = RESIZEBOX_FRACTION_RE.match(arg1)
        if fm:
            frac = float(fm.group(1))
            if frac < RESIZEBOX_MIN_FRACTION:
                findings.append(
                    {
                        "check": "resizebox",
                        "id": "P12",
                        "severity": "warn",
                        "line": line,
                        "message": f"\\resizebox first argument {arg1.strip()!r} is only "
                        f"{frac:g}x the page width, below the {RESIZEBOX_MIN_FRACTION:g}x floor",
                    }
                )
        else:
            findings.append(
                {
                    "check": "resizebox",
                    "id": "P12",
                    "severity": "warn",
                    "line": line,
                    "message": f"\\resizebox first argument {arg1.strip()!r} is not a plain "
                    f"F\\textwidth/F\\linewidth fraction",
                }
            )
    return findings


PD_FILL_STYLE_RE = re.compile(r"^pd(\s+[A-Za-z]+)*\s+fill$")
BARE_FILL_MIN_ALPHA = 20


def check_bare_fill(text):
    """P13: a `\\fill[...]` or `\\path[...fill...]` that names a colour at an
    explicit alpha below BARE_FILL_MIN_ALPHA with no `draw=` of its own reads
    as a near-invisible wash with no crisp edge once printed. The house
    `pd ... fill` styles (`pd focus fill`, `pd caution fill`, `pd neutral
    fill`, ...) are exempt: they already draw their own edge."""
    findings = []
    stripped = strip_comments(text)
    for m in re.finditer(r"\\(fill|path)\b", stripped):
        cmd = m.group(1)
        i = m.end()
        while i < len(stripped) and stripped[i].isspace():
            i += 1
        if i >= len(stripped) or stripped[i] != "[":
            continue
        opts, _ = find_braced_bracket(stripped, i)
        if cmd == "path" and not re.search(r"\bfill\b", opts):
            continue  # a \path[...] with no fill option is not a fill at all
        if re.search(r"\bdraw\s*=", opts):
            continue  # exempt: draws its own edge
        line = stripped.count("\n", 0, m.start()) + 1
        for tok in split_top_level(opts):
            val = tok.split("=", 1)[1].strip() if "=" in tok else tok.strip()
            base = val.split("!", 1)[0].strip()
            if PD_FILL_STYLE_RE.match(base):
                continue  # a house "pd ... fill" style reference, exempt
            am = re.search(r"!(\d+)", val)
            if am and int(am.group(1)) < BARE_FILL_MIN_ALPHA:
                findings.append(
                    {
                        "check": "bare-fill",
                        "id": "P13",
                        "severity": "fail",
                        "line": line,
                        "message": f"\\{cmd}[...] fills {val!r} at alpha {am.group(1)} "
                        f"(below {BARE_FILL_MIN_ALPHA}) with no draw= edge",
                    }
                )
                break
    return findings


ANCHOR_EAST_RE = re.compile(r"\banchor\s*=\s*east\b")
ROW_LABEL_FONT_RE = re.compile(r"\bfont\s*=\s*\\(scriptsize|tiny)\b")
BARE_WORD_RE = re.compile(r"^[A-Za-z][A-Za-z0-9]*$")


def check_row_labels(text):
    """P14: an `anchor=east` node set in `font=\\scriptsize`/`\\tiny` whose
    text is a single bare word is almost always a row label in a disguised
    table -- `pd row label` exists for exactly this and keeps the size out
    of the fragment's own hands (see P10/P11)."""
    findings = []
    stripped = strip_comments(text)
    for style_text, content, offset in find_node_calls(stripped):
        if not ANCHOR_EAST_RE.search(style_text):
            continue
        fm = ROW_LABEL_FONT_RE.search(style_text)
        if not fm:
            continue
        word = content.strip()
        if not BARE_WORD_RE.match(word):
            continue
        line = stripped.count("\n", 0, offset) + 1
        findings.append(
            {
                "check": "row-labels",
                "id": "P14",
                "severity": "warn",
                "line": line,
                "message": f"node[anchor=east, font=\\{fm.group(1)}] {{{word}}} looks like a "
                f"row label; consider the 'pd row label' style",
            }
        )
    return findings


def check_style_font_override(text, house_style_names):
    """P18: a `\\node` that carries a `pd ...` house style AND sets its own
    `font=`. The style already fixes size, weight and family for that role;
    a local `font=` silently replaces all three, which is how a corpus ends
    up with no single voice while every fragment looks locally reasonable."""
    findings = []
    stripped = strip_comments(text)
    for style_text, _content, offset in find_node_calls(stripped):
        names = {t.split("=", 1)[0].strip() for t in split_top_level(style_text)}
        used = sorted(names & set(house_style_names))
        if not used:
            continue
        m = FONT_KEY_RE.search(style_text)
        if not m:
            continue
        value = _font_value_at(style_text, m.end())
        line = stripped.count("\n", 0, offset) + 1
        findings.append(
            {
                "check": "style-font",
                "id": "P18",
                "severity": "fail",
                "line": line,
                "message": f"node styled {used} also sets font={value!r} -- the house "
                f"style already fixes the font; take the role that has the "
                f"typography you want instead of overriding this one",
            }
        )
    return findings


def check_node_font_size(text):
    """P19: any `font=` whose value names a LaTeX size command. This reaches
    the places a node-only check cannot: a pgfplots `tick label style=
    {font=\\footnotesize}`, a `\\begin{tikzpicture}[font=\\small]`, a local
    `.style` definition inside the fragment. The size lives in
    figures/pd-figure-language.tex and nowhere else."""
    findings = []
    stripped = strip_comments(text)
    for m in FONT_KEY_RE.finditer(stripped):
        value = _font_value_at(stripped, m.end())
        sm = SIZE_COMMAND_RE.search(value)
        if not sm:
            continue
        line = stripped.count("\n", 0, m.start()) + 1
        findings.append(
            {
                "check": "node-size",
                "id": "P19",
                "severity": "fail",
                "line": line,
                "message": f"font={value!r} names the size command \\{sm.group(1)} -- "
                f"a fragment never sets a figure's type size; the named roles in "
                f"figures/pd-figure-language.tex do",
            }
        )
    return findings


def check_node_font_family(text):
    """P21: any `font=` naming a type family. The figure's face is the
    document's face; an edition substitutes it in one command in one file, and
    a fragment never does. `\\sffamily` against a Computer Modern page
    resolves to Latin Modern Sans and reads as a foreign object on it -- the
    exact complaint that sent this rule in."""
    findings = []
    stripped = strip_comments(text)
    for m in FONT_KEY_RE.finditer(stripped):
        value = _font_value_at(stripped, m.end())
        fm = FAMILY_COMMAND_RE.search(value)
        if not fm:
            continue
        line = stripped.count("\n", 0, m.start()) + 1
        findings.append(
            {
                "check": "node-family",
                "id": "P21",
                "severity": "fail",
                "line": line,
                "message": f"font={value!r} names the type family \\{fm.group(1)} -- figure "
                f"type inherits the document's own face; for an identifier take "
                f"'pd mono label', and leave any other substitution to an edition",
            }
        )
    return findings


FIGMATH_RE = re.compile(r"\\pdfigmath\b")


def check_figmath(text):
    """P22: `\\pdfigmath` is the one licensed exception to the one-size law,
    and it is licensed for one reason -- a sub- or superscript inside a
    `\\pdfiglabelsize` label renders under figcheck's 7pt floor (measured:
    5.98pt in a chapter, 6.36pt in the Book). Used on math that carries
    neither, it is not an exception; it is a label set a notch larger than the
    ones beside it. Looks at the rest of the enclosing braced group, which is
    how the macro is always written: `{\\pdfigmath $x_i$}`."""
    findings = []
    stripped = strip_comments(text)
    for m in FIGMATH_RE.finditer(stripped):
        depth, i, n = 0, m.end(), len(stripped)
        while i < n:
            c = stripped[i]
            if c == "{":
                depth += 1
            elif c == "}":
                if depth == 0:
                    break
                depth -= 1
            i += 1
        scope = stripped[m.end() : i]
        if "_" in scope or "^" in scope:
            continue
        line = stripped.count("\n", 0, m.start()) + 1
        findings.append(
            {
                "check": "figmath",
                "id": "P22",
                "severity": "fail",
                "line": line,
                "message": f"\\pdfigmath governs {scope.strip()[:40]!r}, which carries no sub- or "
                f"superscript -- it exists only to lift a subscript over the 7pt floor, "
                f"so here it just sets one label larger than its neighbours",
            }
        )
    return findings


# The three keys whose on-length is `\pgflinewidth` rather than a length.
# `dashed`, `densely dashed` and `loosely dashed` are NOT here: those are
# absolute (on 3pt off 3pt and relatives) and cannot drift when a width moves.
# A family-selection command as it appears in a node's TEXT. `\mathrm` and
# `\text` are deliberately absent: those are math, and TeX sets math roman in
# the text family whatever face the node carries -- flagging them would be
# flagging the typesetter, not the author.
# The house handles, and nothing else, may appear in a fragment's `font=`.
# Each one re-applies \pdfiglabelfamily, so a node built from them keeps the
# edition's face; anything else replaces the picture-level `font=` and loses it.
FONT_HANDLE_RE = re.compile(
    r"\\(pdfiglabelfamily|pdfiglabelsize|pdfiglabelbold|pdfiglabelitalic|"
    r"pdfiglabelmono|pdfiglabel|pdfigbasesize|pdfigsub|pdfigmath|relax)\b"
)


def check_font_handle(text):
    """P25: a `font=` built from anything but the house handles.

    The mechanism, measured rather than assumed. `pd figure` sets the figure's
    family through the PICTURE-level `font=` key:

        pd figure/.style={font=\\pdfiglabelfamily\\pdfigbasesize,text=hhink}

    A node's own `font=` is the SAME KEY, so its value replaces that one
    entirely. \\pdfiglabelfamily is then never applied to the node and it falls
    back to the document's face -- Palatino in the Book, against a drawing whose
    every other label is in the edition's grotesk.

    This is why a blacklist could never close it. `font=\\bfseries` names no
    family and no size, and in the Book it renders TeXGyrePagellaX-Bold;
    `font=\\itshape` renders TeXGyrePagellaX-Italic. Both were found by
    figcheck's T10 on compiled pages of appendix-figures.tex and
    fig-anchor-phases.tex, after P19 and P21 had passed them clean.

    So: a fragment's `font=` may be built only from the handles, which re-apply
    the family themselves. P19 (a size) and P21 (a family) stay, because they
    name the specific fault in their message and fire first on the common cases.
    """
    findings = []
    stripped = strip_comments(text)
    for m in FONT_KEY_RE.finditer(stripped):
        value = _font_value_at(stripped, m.end())
        residue = FONT_HANDLE_RE.sub("", value).strip()
        if not residue.strip("{} \t"):
            continue
        line = stripped.count("\n", 0, m.start()) + 1
        findings.append(
            {
                "check": "font-handle",
                "id": "P25",
                "severity": "fail",
                "line": line,
                "message": f"font={value!r} is not built from the house handles, so it replaces "
                f"the picture-level `font=` that carries \\pdfiglabelfamily and the node "
                f"falls back to the DOCUMENT's face -- in the Book, Palatino inside a "
                f"grotesk drawing. Take a `pd *` role, or build the font from "
                f"\\pdfiglabel / \\pdfiglabelbold / \\pdfiglabelitalic / \\pdfiglabelmono.",
            }
        )
    return findings


BODY_FONT_RE = re.compile(r"\\(normalfont|rmfamily|sffamily|ttfamily)\b")


def check_body_font(text):
    """P24: a family-selection command inside node text.

    P21 watches `font=`. This watches the other door, and it is the one that was
    actually open: three fragments wrote
    `{the 6-cycle\\\\\\normalfont the disagreement closes a cycle}` inside a
    `pd row label` to get an unemphasised second line. `\\normalfont` resets to
    the DOCUMENT's family -- Palatino in the Book -- so the second line printed
    in the body serif inside a grotesk drawing, and the figure disagreed with
    itself. No `font=` rule could see it, and figcheck T10 can see it on the page
    but cannot always separate it from math's own use of the text roman. Here it
    is unambiguous.

    The role for a gloss line is `\\pdfigsub`: it steps down by slope and weight
    and touches neither family nor ink, which is what lets it sit on a reversed
    node without vanishing.
    """
    findings = []
    stripped = strip_comments(text)
    for m in BODY_FONT_RE.finditer(stripped):
        line = stripped.count("\n", 0, m.start()) + 1
        cmd = m.group(1)
        findings.append(
            {
                "check": "body-font",
                "id": "P24",
                "severity": "fail",
                "line": line,
                "message": f"`\\{cmd}` in node text selects a family directly. "
                + ("`\\normalfont` resets to the DOCUMENT's family, so in the Book this "
                   "line prints in the body serif inside a grotesk drawing. "
                   if cmd == "normalfont" else
                   "The figure's face is the edition's, set in one command in one file. ")
                + "For an unemphasised gloss line inside a node take `\\pdfigsub`; for an "
                  "identifier take `pd mono label`.",
            }
        )
    return findings


DOTTED_KEY_RE = re.compile(r"\b(densely\s+dotted|loosely\s+dotted|dotted)\b")


def check_dotted(text):
    """P23: a dash whose on-length is derived from the line width.

    pgf defines `dotted` as `dash pattern=on \\pgflinewidth off 2pt`, and the
    densely/loosely variants the same way with a different gap. \\pgflinewidth is
    read when the KEY is processed, not when the path is stroked -- so the
    on-length is frozen at whatever the width happened to be at that moment, and
    any `line width=` arriving afterwards moves the stroke and leaves the dash.

    Not a theoretical hazard. `pd guide` was defined
    `draw=hhgray!62,line width=.45pt,densely dotted`; the Swiss edition appended
    `draw=hhink!40,line width=.5pt`; the canonical Book therefore shipped a
    0.448pt dot on a 0.498pt stroke -- 0.93 device pixels at 150 dpi, under one
    pixel, with its rendered weight swinging 1.6x on sub-pixel phase alone.
    Nothing in the source showed it and nothing in the caption showed it.

    Unlike the rest of the typographic-law rules, this one DOES apply to the
    style-definition files. Those rules police fragments for opting out of the
    one place the law lives; this one is about a defect that was IN that place.
    """
    findings = []
    stripped = strip_comments(text)
    for m in DOTTED_KEY_RE.finditer(stripped):
        line = stripped.count("\n", 0, m.start()) + 1
        findings.append(
            {
                "check": "dotted",
                "id": "P23",
                "severity": "fail",
                "line": line,
                "message": f"`{m.group(1)}` takes its on-length from \\pgflinewidth, read when the "
                f"key is processed -- a `line width=` set after it, or appended by an "
                f"edition override, moves the stroke and leaves the dash at the old "
                f"width. Write `dash pattern=on Xpt off Ypt`; figcheck T9 measures "
                f"whether it resolves at 150 dpi.",
            }
        )
    return findings


PAINT_CMD_RE = re.compile(r"\\(fill|draw|path|addplot)\b")


def check_hard_ink(text):
    """P20: a path that paints a house ink through a bare colour token or a
    `fill=`/`draw=` key with no `pd ...` style anywhere in the same option
    list. Every such case has a house style that says the same thing, and
    going through the style is what lets the Book's edition overrides
    (swiss, technical) restyle the same drawing."""
    findings = []
    stripped = strip_comments(text)
    for m in PAINT_CMD_RE.finditer(stripped):
        cmd = m.group(1)
        i = m.end()
        while i < len(stripped) and stripped[i].isspace():
            i += 1
        if i >= len(stripped) or stripped[i] != "[":
            continue
        opts, _ = find_braced_bracket(stripped, i)
        tokens = split_top_level(opts)
        if any(t.split("=", 1)[0].strip().startswith("pd ") for t in tokens):
            continue  # already goes through a house style
        line = stripped.count("\n", 0, m.start()) + 1
        for tok in tokens:
            if "=" in tok:
                key, value = tok.split("=", 1)
                key, value = key.strip(), value.strip()
                if key not in ("fill", "draw"):
                    continue
                table = FILL_EQUIVALENT if key == "fill" else RULE_EQUIVALENT
            else:
                # A bare colour token means "fill" on \fill and on a \path
                # whose options say fill, and "draw" everywhere else. Getting
                # this backwards sends the author to `pd focus rule` for what
                # is plainly an area, so the command decides the table.
                fills = cmd == "fill" or (cmd == "path" and re.search(r"\bfill\b", opts))
                key = "fill" if fills else "draw"
                value = tok.strip()
                table = FILL_EQUIVALENT if fills else RULE_EQUIVALENT
            base = value.split("!", 1)[0].strip()
            if base not in HOUSE_INKS:
                continue
            findings.append(
                {
                    "check": "hard-ink",
                    "id": "P20",
                    "severity": "fail",
                    "line": line,
                    "message": f"\\{cmd}[...] paints {key}={value} with no pd style in the "
                    f"option list -- use '{table[base]}'",
                }
            )
            break
    return findings


def check_colors(text, allowed_colors, known_style_names):
    findings = []

    def check_token(raw_token, line):
        segments = [seg.strip() for seg in raw_token.split("!")]
        for seg in segments:
            if not seg or seg.isdigit():
                continue
            if seg in known_style_names:
                continue  # a style reference caught by the color-shaped regex, not a color
            if seg not in allowed_colors:
                findings.append(
                    {
                        "check": "color",
                        "severity": "fail",
                        "line": line,
                        "color": seg,
                        "raw": raw_token,
                        "message": f"color '{seg}' (in '{raw_token}') is outside the house palette",
                    }
                )

    for m in COLOR_KEY_RE.finditer(text):
        line = text.count("\n", 0, m.start()) + 1
        check_token(m.group(2), line)
    for m in TEXTCOLOR_RE.finditer(text):
        line = text.count("\n", 0, m.start()) + 1
        check_token(m.group(1), line)
    for m in COLOR_CMD_RE.finditer(text):
        line = text.count("\n", 0, m.start()) + 1
        check_token(m.group(1), line)
    return findings


def check_node_wrapping(text, safe_styles):
    findings = []
    for style_text, content, offset in find_node_calls(text):
        words = count_prose_words(content)
        if len(words) < 2:
            continue
        if style_list_has_wrap(style_text, safe_styles):
            continue
        line = text.count("\n", 0, offset) + 1
        snippet = content.strip().replace("\n", " ")
        if len(snippet) > 60:
            snippet = snippet[:57] + "..."
        findings.append(
            {
                "check": "node-wrap",
                "severity": "fail",
                "line": line,
                "message": f"multi-word node text {snippet!r} has no text width=/align= "
                f"(directly or via a named style that bakes one in)",
            }
        )
    return findings


def check_title_numbers(text):
    findings = []
    for kind, content in find_title_texts(text):
        hits = sorted(set(BAD_TITLE_RE.findall(content)))
        if hits:
            findings.append(
                {
                    "check": "title-number",
                    "severity": "fail",
                    "message": f"{kind} names internal result label(s) {hits}: {content[:70]!r}",
                }
            )
    return findings


def detect_corpus(path):
    p = Path(path).resolve()
    parts = [seg.lower() for seg in p.parts]
    if "harbor-research" in parts:
        return "research"
    parent = p.parent.parent
    if (parent / "tex" / "preamble.tex").is_file():
        return "research"
    if (p.parent / "pd-figure-language.tex").is_file():
        return "chapter"
    return "chapter"


def load_extra_style_defs(paths):
    styles = {}
    for p in paths:
        text = Path(p).read_text(encoding="utf-8", errors="replace")
        styles.update(parse_local_styles(text))
    return styles


def run_precheck(path, corpus="auto", extra_style_defs=None, extra_colors=None):
    text = Path(path).read_text(encoding="utf-8", errors="replace")
    resolved_corpus = detect_corpus(path) if corpus == "auto" else corpus

    if resolved_corpus == "research":
        base_colors = RESEARCH_COLORS | UNIVERSAL_COLORS
        base_safe = set(RESEARCH_SAFE_STYLES)
        base_names = set(RESEARCH_STYLE_NAMES)
    else:
        base_colors = CHAPTER_COLORS | UNIVERSAL_COLORS
        base_safe = set(CHAPTER_SAFE_STYLES)
        base_names = set(CHAPTER_STYLE_NAMES)

    if extra_colors:
        base_colors = base_colors | set(extra_colors)

    local_styles = dict(extra_style_defs or {})
    local_styles.update(parse_local_styles(text))
    safe_styles, known_names = resolve_safe_styles(local_styles, base_safe, base_names)

    findings = []
    findings += check_provenance(text)
    findings += check_tiny(text)
    findings += check_scriptsize(text)
    findings += check_resizebox(text)
    findings += check_bare_fill(text)
    findings += check_row_labels(text)
    # The typographic law polices fragments, never the file that defines it,
    # and only the corpus that has one: the research papers under
    # docs/harbor-research/ have their own preamble, their own palette, and no
    # figures/pd-figure-language.tex, so there is no single place their sizes
    # and inks could be moved to yet. Extending P18-P20 there means giving
    # that corpus a style file first.
    if resolved_corpus != "research":
        # P23 is the one law rule that also applies to the style-definition
        # files: the others police fragments for opting OUT of the one place the
        # law lives, and this one is about a defect that was IN it.
        findings += check_dotted(text)
    if resolved_corpus != "research" and not is_style_definition(path):
        findings += check_style_font_override(text, base_names)
        findings += check_node_font_size(text)
        findings += check_node_font_family(text)
        findings += check_body_font(text)
        findings += check_font_handle(text)
        findings += check_figmath(text)
        findings += check_hard_ink(text)
    findings += check_colors(text, base_colors, known_names)
    findings += check_node_wrapping(text, safe_styles)
    findings += check_title_numbers(text)

    hard = [f for f in findings if f["severity"] == "fail"]
    warn = [f for f in findings if f["severity"] == "warn"]
    by_check = {}
    for f in findings:
        by_check.setdefault(f["check"], []).append(f)
    by_id = {rid: 0 for rid in RULE_IDS}
    for f in findings:
        if f.get("id") in by_id:
            by_id[f["id"]] += 1

    return {
        "file": str(path),
        "corpus": resolved_corpus,
        "findings": findings,
        "by_check": by_check,
        "summary": {
            "result": "fail" if hard else ("warn" if warn else "pass"),
            "hard_count": len(hard),
            "warn_count": len(warn),
            "by_id": by_id,
        },
    }


def aggregate_by_id(reports):
    totals = {rid: 0 for rid in RULE_IDS}
    for r in reports:
        for rid, n in r["summary"].get("by_id", {}).items():
            totals[rid] = totals.get(rid, 0) + n
    return totals


def render_markdown(reports):
    lines = ["# tikz_precheck report", ""]
    lines.append("| File | Corpus | Result | Hard | Warn |")
    lines.append("|---|---|---|---|---|")
    for r in reports:
        lines.append(
            f"| `{Path(r['file']).name}` | {r['corpus']} | {r['summary']['result']} "
            f"| {r['summary']['hard_count']} | {r['summary']['warn_count']} |"
        )
    lines.append("")
    for r in reports:
        if not r["findings"]:
            continue
        lines.append(f"## `{Path(r['file']).name}`")
        for f in r["findings"]:
            loc = f" (line {f['line']})" if "line" in f else ""
            rid = f" [{f['id']}]" if "id" in f else ""
            lines.append(f"- [{f['severity']}]{rid} {f['check']}{loc}: {f['message']}")
        lines.append("")
    totals = aggregate_by_id(reports)
    lines.append("## Rule ID counts")
    lines.append("")
    lines.append(", ".join(f"{rid}={totals[rid]}" for rid in RULE_IDS))
    lines.append("")
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Source-level lint for Harbor TikZ figure fragments.")
    ap.add_argument("fragments", nargs="+")
    ap.add_argument("--corpus", choices=["chapter", "research", "auto"], default="auto")
    ap.add_argument("--json")
    ap.add_argument("--md")
    ap.add_argument("--style-defs", action="append", default=[])
    ap.add_argument("--allow-color", action="append", default=[])
    args = ap.parse_args(argv)

    for f in args.fragments:
        if not Path(f).is_file():
            print(f"tikz_precheck.py: no such file: {f}", file=sys.stderr)
            return 2

    extra_styles = load_extra_style_defs(args.style_defs) if args.style_defs else {}

    reports = [
        run_precheck(f, corpus=args.corpus, extra_style_defs=extra_styles, extra_colors=args.allow_color)
        for f in args.fragments
    ]

    if args.json:
        Path(args.json).write_text(json.dumps(reports, indent=2, default=str))
    if args.md:
        Path(args.md).write_text(render_markdown(reports))
    if not args.json and not args.md:
        print(json.dumps(reports, indent=2, default=str))

    # Summary line, always on stderr so it never corrupts a stdout JSON dump.
    totals = aggregate_by_id(reports)
    print(
        "tikz_precheck summary: "
        + ", ".join(f"{rid}={totals[rid]}" for rid in RULE_IDS),
        file=sys.stderr,
    )

    return 1 if any(r["summary"]["result"] == "fail" for r in reports) else 0


if __name__ == "__main__":
    sys.exit(main())
