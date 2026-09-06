#!/usr/bin/env python3
"""tikz_precheck.py -- source-level lint for Harbor TikZ figure fragments.

Needs no TeX engine: every check reads the fragment's own text. This is the
complement of figcheck.py, which needs a compiled PDF and inspects rendered
geometry instead.

Checks (hard, fail the build unless noted):
  - missing provenance comment: line 1 is not a substantive `%` comment.
  - `\tiny` anywhere in the fragment.
  - a color name outside the corpus's house palette (see PALETTES below).
  - multi-word `\node{...}` text with no wrapping (`text width=`/`align=`, on
    the node itself OR via a named style -- local to the fragment, or one of
    the shared house styles -- that already bakes one of those in).
  - `R\d+`, `CR-\d+`, or `B6` inside a caption's leading `\textbf{...}` (the
    caption's bolded lead sentence) or inside a title-styled node/pgfplots
    axis title (heuristic, not a full parse -- see find_title_texts()).
  - `\resizebox` anywhere (WARN only -- does not fail the build).

Usage:
  tikz_precheck.py FRAGMENT.tex [FRAGMENT.tex ...]
      [--corpus chapter|research|auto] [--json OUT] [--md OUT]
      [--style-defs FILE ...] [--allow-color NAME ...]

Exit status:
  0  no hard findings in any given fragment (resizebox warnings do not count)
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
    "pd guide", "pd arrow", "pd focus arrow", "pd caution arrow",
    "pd panel title", "pd axis label", "pd direct label", "pd note",
    "pd tick", "pd datum", "pd focus datum", "pd caution datum",
    "pd state", "pd terminal", "pd actor", "pd artifact", "pd boundary",
    "pd focus fill", "pd caution fill", "pd neutral fill", "pd hatch",
}
# The subset of the above whose definition already bakes in `align=` or
# `text width=` -- so a multi-word node using one of these does not need its
# own wrapping key. Derived mechanically from pd-figure-language.tex's own
# `.style={...}` bodies, not guessed.
CHAPTER_SAFE_STYLES = {
    "pd panel title", "pd direct label", "pd note",
    "pd state", "pd terminal", "pd actor", "pd artifact",
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
                content, end = find_braced(text, i)
                out.append((",".join(style_parts), content, m.start()))
                i = end
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
    findings = []
    for m in re.finditer(r"\\tiny\b", text):
        line = text.count("\n", 0, m.start()) + 1
        findings.append(
            {"check": "tiny", "severity": "fail", "line": line, "message": "\\tiny used"}
        )
    return findings


def check_resizebox(text):
    findings = []
    for m in re.finditer(r"\\resizebox\b", text):
        line = text.count("\n", 0, m.start()) + 1
        findings.append(
            {"check": "resizebox", "severity": "warn", "line": line, "message": "\\resizebox used"}
        )
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
    findings += check_resizebox(text)
    findings += check_colors(text, base_colors, known_names)
    findings += check_node_wrapping(text, safe_styles)
    findings += check_title_numbers(text)

    hard = [f for f in findings if f["severity"] == "fail"]
    warn = [f for f in findings if f["severity"] == "warn"]
    by_check = {}
    for f in findings:
        by_check.setdefault(f["check"], []).append(f)

    return {
        "file": str(path),
        "corpus": resolved_corpus,
        "findings": findings,
        "by_check": by_check,
        "summary": {
            "result": "fail" if hard else ("warn" if warn else "pass"),
            "hard_count": len(hard),
            "warn_count": len(warn),
        },
    }


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
            lines.append(f"- [{f['severity']}] {f['check']}{loc}: {f['message']}")
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

    return 1 if any(r["summary"]["result"] == "fail" for r in reports) else 0


if __name__ == "__main__":
    sys.exit(main())
