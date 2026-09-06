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

  Numbered rules (P10-P14), evaluated against the fragment with LaTeX
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
                     whose text is one bare word -- suggests `pd title`.
  - P15 type-ladder (FAIL) the figure type ladder (three voices, tied to
                     roles, carried by the shared styles) broken at the point
                     of use: a `font=` key outside a `/.style={...}` body; a
                     `\textbf`/`\bfseries`/`\itshape`/`\textit`/`\emph`/
                     `\scshape`/`\textsc`/`\\uppercase`/`\MakeUppercase` in
                     the fragment body; an ALL-CAPS word of four or more
                     letters outside `\texttt`; or more than three distinct
                     point-of-use voices in one picture.
  - P16 retired-hue (WARN) an `hh*` colour other than `hhink`/`hhpaper`: the
                     sand/teal/amber set is being retired in favour of the
                     pd-palette.tex story hues. Any colour outside
                     pd-palette.tex plus those two is a hard `color` finding.

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

# The Book's semantic palette (figures/pd-palette.tex). Hue is meaning; these
# are the only colours a figure may name.
PALETTE_COLORS = {
    "pdcobalt", "pdteal", "pdhealth", "pdindigo", "pdviolet", "pdrust",
    "pdgold", "pderror", "pdamber", "pdlime", "pdink", "pdinkmuted",
    "pdcream", "pdcreamraised", "pdcreamstrong",
    # the chapter hue, resolved from \pdcurrentchaptercolor by pd figure
    "pdfocus",
}
# Ink and paper survive from the hh* set; every other hh* colour is retiring
# (P16 warns on it) but still parses, so an untouched fragment keeps building.
RETIRED_HH_COLORS = {
    "hhsand", "hhsanddeep", "hhebony", "hhcobalt", "hhamber", "hhteal",
    "hhgray", "hhink", "hhpaper",
}
CHAPTER_COLORS = (
    PALETTE_COLORS
    | RETIRED_HH_COLORS
    | {"hhink", "hhpaper", "codebg", "codeframe"}
)
RESEARCH_COLORS = {"harborblue", "shipred", "seagreen"}
# `none` is the absence of a colour, not a colour. Every real colour a figure
# names must be a pd-palette.tex name; stock colours (black/white/gray, and
# tints such as blue!20, red!30, green!40) are the LaTeX default palette and
# are refused outright.
UNIVERSAL_COLORS = {"none"}

# Every style name defined in figures/pd-figure-language.tex (chapter/
# whitepaper corpora). Used to keep the color check from mistaking a bare
# style reference (`\node[pd actor]`) for an unrecognized color.
_PD_CONCEPTS = (
    "pd truth", "pd legible", "pd ready", "pd protocol", "pd identity",
    "pd reputation", "pd value", "pd breach", "pd warn",
)
CHAPTER_STYLE_NAMES = {
    # v2 roles
    "pd figure", "pd title", "pd label", "pd note", "pd tag", "pd kind",
    "pd state", "pd terminal", "pd artifact", "pd panel", "pd hatch",
    "pd hairline", "pd guide", "pd tick", "pd rule", "pd spine",
    "pd thin arrow", "pd arrow", "pd spine arrow",
    "pd focus rule", "pd focus arrow", "pd focus state", "pd focus fill",
    "pd focus datum", "pd neutral fill",
    "pd datum", "pd badge", "pd focus badge", "pd to badge", "pd from badge",
    # v1 names, kept as deprecated aliases by pd-figure-language v2
    "pd row label", "pd panel title", "pd axis label", "pd direct label",
    "pd actor", "pd boundary", "pd caution rule", "pd caution arrow",
    "pd caution fill", "pd caution datum",
}
for _c in _PD_CONCEPTS:
    CHAPTER_STYLE_NAMES |= {
        _c, _c + " rule", _c + " arrow", _c + " state", _c + " fill",
        _c + " datum",
    }
# The subset of the above whose definition already bakes in `align=` or
# `text width=` -- so a multi-word node using one of these does not need its
# own wrapping key. Derived mechanically from pd-figure-language.tex's own
# `.style={...}` bodies, not guessed.
CHAPTER_SAFE_STYLES = {
    "pd title", "pd label", "pd note", "pd tag", "pd kind", "pd panel",
    "pd state", "pd terminal", "pd artifact", "pd focus state", "pd badge",
    "pd focus badge",
    "pd panel title", "pd direct label", "pd axis label", "pd actor",
    "pd boundary", "pd row label",
}
for _c in _PD_CONCEPTS:
    CHAPTER_SAFE_STYLES |= {_c + " state"}

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
RULE_IDS = ["P10", "P11", "P12", "P13", "P14", "P15", "P16"]


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


# --------------------------------------------------------------------------- #
# P15 -- the figure type ladder.
#
# The Book's figures carry exactly three text voices, each tied to a role and
# each owned by a shared style: `pd title` (small caps: panel titles, row and
# actor heads), `pd label` (upright: node text, state names, axis titles, tick
# words, relation words, badge numerals) and `pd note` (italic: the one
# annotation a figure is allowed). A fragment names a role; it never sets a
# font. `\texttt` is reserved for identifiers that are literally code, and is
# therefore not counted as a voice.
# --------------------------------------------------------------------------- #

VOICE_CMD_RE = re.compile(
    r"\\(textbf|bfseries|itshape|textit|emph|scshape|textsc|"
    r"uppercase|MakeUppercase|MakeTextUppercase|sffamily|ttfamily|rmfamily|"
    r"normalfont|fontfamily|fontsize|selectfont|usefont)\b"
)
FONT_KEY_RE = re.compile(r"\bfont\s*=\s*")
ALLCAPS_RE = re.compile(r"(?<![A-Za-z0-9\\])[A-Z]{4,}(?![A-Za-z0-9])")
VOICE_LIMIT = 3


def _style_body_spans(text):
    """Character ranges of every `name/.style={...}` body. A style definition
    is where a voice is SUPPOSED to be declared, so P15 does not look inside
    one -- it polices the point of use."""
    spans = []
    for m in STYLE_DEF_RE.finditer(text):
        try:
            brace = text.index("{", m.end() - 1)
        except ValueError:
            continue
        _, end = find_braced(text, brace)
        spans.append((m.start(), end))
    return spans


def _texttt_spans(text):
    spans = []
    for m in re.finditer(r"\\(?:texttt|lstinline|verb)\b", text):
        i = m.end()
        while i < len(text) and text[i].isspace():
            i += 1
        if i < len(text) and text[i] == "{":
            _, end = find_braced(text, i)
            spans.append((m.start(), end))
    return spans


def _in_spans(pos, spans):
    return any(a <= pos < b for a, b in spans)


def check_type_ladder(text):
    """P15: the type ladder, enforced at the point of use."""
    findings = []
    stripped = strip_comments(text)
    style_spans = _style_body_spans(stripped)
    tt_spans = _texttt_spans(stripped)
    # The caption is prose in the body voice, not figure text; the ladder
    # governs the picture. Exclude everything from \caption{ to its close.
    caption_spans = []
    for m in re.finditer(r"\\caption\b", stripped):
        i = m.end()
        while i < len(stripped) and stripped[i] in " \n[":
            if stripped[i] == "[":
                _, i = find_braced_bracket(stripped, i)
                continue
            i += 1
        if i < len(stripped) and stripped[i] == "{":
            _, end = find_braced(stripped, i)
            caption_spans.append((m.start(), end))
    skip = style_spans + caption_spans

    voices = set()
    for m in FONT_KEY_RE.finditer(stripped):
        if _in_spans(m.start(), skip):
            continue
        line = stripped.count("\n", 0, m.start()) + 1
        tail = stripped[m.end():m.end() + 40].split(",")[0].split("]")[0].strip()
        voices.add("font=" + tail)
        findings.append({
            "check": "type-ladder", "id": "P15", "severity": "fail", "line": line,
            "message": f"`font={tail}` set at the point of use; name a role style "
                       f"(pd title / pd label / pd note) instead",
        })
    for m in VOICE_CMD_RE.finditer(stripped):
        if _in_spans(m.start(), skip):
            continue
        line = stripped.count("\n", 0, m.start()) + 1
        voices.add(m.group(1))
        findings.append({
            "check": "type-ladder", "id": "P15", "severity": "fail", "line": line,
            "message": f"\\{m.group(1)} in the picture; the three voices are carried "
                       f"by pd title / pd label / pd note, never by a switch",
        })
    for m in ALLCAPS_RE.finditer(stripped):
        if _in_spans(m.start(), skip) or _in_spans(m.start(), tt_spans):
            continue
        word = m.group(0)
        line = stripped.count("\n", 0, m.start()) + 1
        findings.append({
            "check": "type-ladder", "id": "P15", "severity": "fail", "line": line,
            "message": f"ALL-CAPS word {word!r}: set a state name in sentence case in "
                       f"the label voice, or in \\texttt if it is literally code",
        })
    if len(voices) > VOICE_LIMIT:
        findings.append({
            "check": "type-ladder", "id": "P15", "severity": "fail", "line": 1,
            "message": f"{len(voices)} distinct point-of-use text voices "
                       f"({', '.join(sorted(voices))}); at most {VOICE_LIMIT} voices "
                       f"exist in the ladder and a fragment should declare none",
        })
    return findings


def check_retired_hues(text, retired):
    """P16: an hh* colour other than hhink/hhpaper. The sand/teal/amber set is
    being retired in favour of the pd-palette.tex story hues; a fragment that
    still names one keeps building but is flagged for migration."""
    findings = []
    seen = {}
    def note(raw, line):
        for seg in (s.strip() for s in raw.split("!")):
            if seg in retired and seg not in seen:
                seen[seg] = line
    for m in COLOR_KEY_RE.finditer(text):
        note(m.group(2), text.count("\n", 0, m.start()) + 1)
    for m in TEXTCOLOR_RE.finditer(text):
        note(m.group(1), text.count("\n", 0, m.start()) + 1)
    for m in COLOR_CMD_RE.finditer(text):
        note(m.group(1), text.count("\n", 0, m.start()) + 1)
    for name, line in sorted(seen.items()):
        findings.append({
            "check": "retired-hue", "id": "P16", "severity": "warn", "line": line,
            "message": f"colour '{name}' is being retired; use the pd-palette.tex "
                       f"story hue for the concept it stands for",
        })
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
    findings += check_colors(text, base_colors, known_names)
    findings += check_node_wrapping(text, safe_styles)
    findings += check_type_ladder(text)
    if resolved_corpus == "chapter":
        findings += check_retired_hues(text, RETIRED_HH_COLORS)
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
