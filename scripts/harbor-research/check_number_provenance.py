#!/usr/bin/env python3
"""check_number_provenance.py -- a worked example's numbers still agree with
whatever fixed them.

Born from a pd-qa HIGH on PR #10181. The chapter audit added worked examples
across the Book under a hard rule -- never invent a number; use only numbers
the chapter, its scripts, or its proof artifacts already fix -- and the rule
was followed. But several of those numbers are claims about live code
(\\texttt{HARD\\_MAX\\_DELEGATION\\_DEPTH}\\,=\\,8, default~4, read off
lib/tube-spawner-router.ts) or about a committed proof artifact (1,716
reachable states, read off a TLC log), and nothing kept them true. Change the
constant and the Book goes on printing the old value in the most credible
register the page has: a worked example a reader is invited to redo by hand.
That is the same defect class this repository keeps finding -- a claim that
was true when written, with no mechanism to keep it true -- one level up.

-------------------------------------------------------------------------
THE ANNOTATION

A number states its provenance in a LaTeX comment on the line(s) immediately
above the source line that prints it:

    % pdnum kind=code file=lib/tube-spawner-router.ts
    %       symbol=HARD_MAX_DELEGATION_DEPTH value=8
    %       prints="\\texttt{HARD\\_MAX\\_DELEGATION\\_DEPTH}\\,=\\,8"

The comment is invisible to TeX, so the rendered page is unchanged and the
reader pays nothing. Adjacency is the association: the evidence travels in
the same file, on the line above the claim, the way \\cite and \\bibitem
travel together for check_citations.py -- rather than in a fourth sidecar
registry that can drift away from the text it describes. (The two sidecar
idioms in this repository, PROVENANCE.json for plates and
library-index.json's numbers[] for results, both describe artifacts that are
NOT text files you can write a comment into. A .tex line is.)

A continuation line is a following comment line indented under the opener
(`%` then two or more spaces), so a long annotation wraps at the measure like
the prose around it. An ordinary `% ...` comment ends the annotation rather
than being swallowed into it -- which is how a note ABOUT a number, written
next to one, stays a note.

FIELDS (key=value; a value with spaces is double-quoted, and nothing inside
the quotes is escape-processed, because LaTeX is made of backslashes):

  kind=      required. arithmetic | code | artifact.
  prints=    required. The EXACT TeX substring that renders the number. It
             must occur exactly once inside the annotation's scope, and it
             must itself contain the number. This is the half that catches an
             edit to the chapter; `value` is the half that catches an edit to
             the source. Both must agree or the check fails.
  value=     the number as the chapter states it. Required for kind=code and
             kind=arithmetic; optional for kind=artifact, where omitting it
             turns the check into "this artifact still says this" (a
             verdict-presence check).
  digits=    optional. What to look for inside `prints` when the chapter
             renders the value in a form the decimal literal will not match
             (`10^{-9}` for 1e-9). Defaults to `value`.
  scope=     optional, default `line`. `block` runs the scope from the next
             source line to the end of the worked example it opens (an
             `\\end{pdexample}`, or the blank line that ends a `Numbers by
             hand` paragraph). Use it for a number inside an example: the
             annotation then sits ABOVE `\\begin{pdexample}`, outside the
             prose, and survives a rewrap of the body.
  lines=     optional, default 1, ignored when scope=block. How many
             following non-comment, non-blank source lines form the scope.
             Raise it when a display-math number wraps.
  tol=       kind=arithmetic only. Absolute tolerance. Defaults to half a
             unit in the last decimal place of `value`, i.e. `value` must be
             the correct rounding of `expr`. Set it explicitly when the
             chapter says "about" and means it.
  expr=      kind=arithmetic. The arithmetic, in a small safe language (see
             SAFE_FUNCS): + - * / // % ** and log2 log10 log sqrt exp abs
             min max round floor ceil comb factorial pi e.
  file=      kind=code, kind=artifact. Repo-relative path to the source.
  symbol=    kind=code. The constant's name. Extracted by the default
             assignment pattern below, which must match exactly once.
  pattern=   kind=code, kind=artifact. A regex (MULTILINE) with exactly one
             capturing group, when the default extraction will not do. This
             is an escape hatch, not the normal case.
  note=      optional free text, printed with the annotation in --verbose.
  id=        optional short handle, printed in failure messages.

-------------------------------------------------------------------------
WHAT IS DELIBERATELY NOT COVERED

A count taken off a source listing -- "six error exits in verify()", "zero
alg branches", "three hop processes, hence depth 3" -- is not checkable here
and this script does not pretend otherwise. Re-deriving such a count needs a
parser for the language the listing is written in, and a checker that cries
wolf gets disabled, after which it protects nothing. Those numbers stay
unverified, and the coverage report below names them as debt rather than
implying they are covered. Same for negative claims about code ("the chain
verifier accepts arbitrary depth"): the absence of a bound is not a number,
and grepping for the absence of a thing is how false failures are born.

-------------------------------------------------------------------------
Exit status: 0 when every annotation resolves and agrees, 1 otherwise.

Usage:
    python3 scripts/harbor-research/check_number_provenance.py [--verbose]
    python3 scripts/harbor-research/check_number_provenance.py --inventory
"""
from __future__ import annotations

import argparse
import ast
import json
import math
import os
import re
import sys
from dataclasses import dataclass, field

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TEXTBOOK_REL = "whitepaper/textbook.json"

VALID_KINDS = ("arithmetic", "code", "artifact")

# One annotation opens with `% pdnum` at the start of a comment; any following
# comment line that does NOT open a new one continues it.
PDNUM_OPEN_RE = re.compile(r"^\s*%\s*pdnum\b(?P<rest>.*)$")
# A continuation indents under the opener: `%` then TWO OR MORE spaces. An
# ordinary `% ...` comment (one space) is prose and ends the annotation, so a
# note written next to an annotation is never swallowed into its fields.
PDNUM_CONT_RE = re.compile(r"^\s*%[ \t]{2,}(?P<rest>\S.*)$")
COMMENT_RE = re.compile(r"^\s*%(?P<rest>.*)$")

# Default kind=code extraction: SYMBOL, optionally a type annotation, then an
# assignment (`=` in TS/Rust/Python, `:` in an object literal or YAML), then a
# numeric literal. Deliberately narrow: a mention of the symbol in a comment or
# a use of it on the right-hand side of something else does not match, which is
# what makes "exactly one match" a usable requirement.
def _code_symbol_re(symbol: str) -> re.Pattern[str]:
    return re.compile(
        r"\b" + re.escape(symbol) + r"\b"
        r"(?:\s*:\s*[A-Za-z_][\w.<>\[\]]*)?"
        r"\s*[=:]\s*"
        r"(?P<v>[-+]?(?:\d[\d_]*(?:\.\d+)?|\.\d+)(?:[eE][-+]?\d+)?)",
        re.MULTILINE,
    )


# ---------------------------------------------------------------- safe arithmetic

SAFE_FUNCS = {
    "log2": math.log2,
    "log10": math.log10,
    "log": math.log,
    "ln": math.log,
    "sqrt": math.sqrt,
    "exp": math.exp,
    "abs": abs,
    "min": min,
    "max": max,
    "round": round,
    "floor": math.floor,
    "ceil": math.ceil,
    "comb": math.comb,
    "factorial": math.factorial,
}
SAFE_CONSTS = {"pi": math.pi, "e": math.e}

_SAFE_NODES = (
    ast.Expression,
    ast.BinOp,
    ast.UnaryOp,
    ast.Call,
    ast.Name,
    ast.Load,
    ast.Constant,
    ast.Add,
    ast.Sub,
    ast.Mult,
    ast.Div,
    ast.FloorDiv,
    ast.Mod,
    ast.Pow,
    ast.USub,
    ast.UAdd,
)


def safe_eval(expr: str) -> float:
    """Evaluate a closed arithmetic expression. No attributes, no subscripts,
    no comprehensions, no names but SAFE_FUNCS/SAFE_CONSTS -- a Book number is
    arithmetic, and anything that needs more than arithmetic is not this kind."""
    tree = ast.parse(expr, mode="eval")
    for node in ast.walk(tree):
        if not isinstance(node, _SAFE_NODES):
            raise ValueError(f"disallowed syntax {type(node).__name__} in expr")
        if isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name) or node.func.id not in SAFE_FUNCS:
                raise ValueError("only the whitelisted arithmetic functions may be called")
        if isinstance(node, ast.Name) and node.id not in SAFE_FUNCS and node.id not in SAFE_CONSTS:
            raise ValueError(f"unknown name {node.id!r} in expr")
    return float(eval(compile(tree, "<pdnum>", "eval"), {"__builtins__": {}}, {**SAFE_FUNCS, **SAFE_CONSTS}))


# ---------------------------------------------------------------- field parsing


def parse_fields(text: str) -> tuple[dict[str, str], list[str]]:
    """key=value / key="value with spaces". No escape processing inside the
    quotes: the values are LaTeX, which is made of backslashes."""
    fields: dict[str, str] = {}
    problems: list[str] = []
    i, n = 0, len(text)
    while i < n:
        if text[i].isspace():
            i += 1
            continue
        m = re.match(r"([A-Za-z_][A-Za-z0-9_]*)=", text[i:])
        if not m:
            j = i
            while j < n and not text[j].isspace():
                j += 1
            problems.append(f"cannot parse {text[i:j]!r} as key=value")
            i = j
            continue
        key = m.group(1)
        i += m.end()
        if i < n and text[i] == '"':
            close = text.find('"', i + 1)
            if close == -1:
                problems.append(f"unterminated quoted value for {key}=")
                return fields, problems
            val = text[i + 1 : close]
            i = close + 1
        else:
            j = i
            while j < n and not text[j].isspace():
                j += 1
            val = text[i:j]
            i = j
        if key in fields:
            problems.append(f"duplicate field {key}=")
        fields[key] = val
    return fields, problems


# ---------------------------------------------------------------- normalization

# TeX spellings that are typographic, not numeric: a thousands separator, a
# thin space, a math-mode dollar, the braces around an exponent.
_TEX_NOISE_RE = re.compile(r"(\{,\}|\\,|\\!|\\;|\\:|\\ |~|\$|\{|\}|\s|,)")


def tex_normalize(s: str) -> str:
    return _TEX_NOISE_RE.sub("", s)


def looks_numeric(s: str) -> bool:
    return bool(re.fullmatch(r"[-+]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][-+]?\d+)?", s.strip()))


def decimals_of(s: str) -> int:
    s = s.strip()
    if "e" in s or "E" in s:
        return -1
    return len(s.split(".", 1)[1]) if "." in s else 0


# ---------------------------------------------------------------- model


@dataclass
class Annotation:
    chapter_file: str  # repo-relative
    chapter_number: int
    line: int  # 1-based line of the `% pdnum` opener
    fields: dict[str, str]
    scope_lines: list[tuple[int, str]] = field(default_factory=list)

    @property
    def handle(self) -> str:
        ident = self.fields.get("id")
        return f"[{ident}]" if ident else f"[{self.fields.get('kind', '?')}]"

    @property
    def where(self) -> str:
        return f"{self.chapter_file}:{self.line}"


# ---------------------------------------------------------------- collection


def collect_annotations(path: str, rel: str, chapter_number: int) -> tuple[list[Annotation], list[str]]:
    lines = open(path, encoding="utf-8").read().split("\n")
    anns: list[Annotation] = []
    problems: list[str] = []
    i = 0
    while i < len(lines):
        m = PDNUM_OPEN_RE.match(lines[i])
        if not m:
            i += 1
            continue
        open_line = i + 1
        raw = m.group("rest")
        j = i + 1
        while j < len(lines):
            cm = PDNUM_CONT_RE.match(lines[j])
            if not cm or PDNUM_OPEN_RE.match(lines[j]):
                break
            raw += " " + cm.group("rest")
            j += 1
        fields, fprobs = parse_fields(raw)
        for p in fprobs:
            problems.append(f"{rel}:{open_line}: malformed annotation -- {p}")
        ann = Annotation(rel, chapter_number, open_line, fields)
        scope_mode = fields.get("scope", "line")
        if scope_mode not in ("line", "block"):
            problems.append(f"{rel}:{open_line}: scope= must be `line` or `block`, got {scope_mode!r}")
            scope_mode = "line"
        # Consecutive annotations stack onto the same target.
        if scope_mode == "block":
            k = j
            while k < len(lines) and (not lines[k].strip() or COMMENT_RE.match(lines[k])):
                k += 1
            if k < len(lines):
                opener = lines[k]
                ann.scope_lines.append((k + 1, opener))
                if BLOCK_OPEN_RE.search(opener):
                    k += 1
                    while k < len(lines):
                        ann.scope_lines.append((k + 1, lines[k]))
                        if BLOCK_CLOSE_RE.search(lines[k]):
                            break
                        k += 1
                else:
                    # a `Numbers by hand` paragraph: to the next blank line
                    k += 1
                    while k < len(lines) and lines[k].strip():
                        ann.scope_lines.append((k + 1, lines[k]))
                        k += 1
        else:
            try:
                want = int(fields.get("lines", "1"))
            except ValueError:
                problems.append(f"{rel}:{open_line}: lines= must be an integer, got {fields.get('lines')!r}")
                want = 1
            k = j
            while k < len(lines) and len(ann.scope_lines) < max(1, want):
                if lines[k].strip() and not COMMENT_RE.match(lines[k]):
                    ann.scope_lines.append((k + 1, lines[k]))
                elif lines[k].strip() == "":
                    break  # a blank line ends the claim's neighbourhood
                k += 1
        anns.append(ann)
        i = j
    return anns, problems


# ---------------------------------------------------------------- verification


def read_source(rel_path: str) -> tuple[str | None, str | None]:
    abs_path = os.path.join(REPO_ROOT, rel_path)
    if not os.path.isfile(abs_path):
        return None, f"names file={rel_path}, which does not exist"
    try:
        return open(abs_path, encoding="utf-8", errors="replace").read(), None
    except OSError as exc:  # pragma: no cover - unreadable file
        return None, f"cannot read file={rel_path}: {exc}"


def observe(ann: Annotation) -> tuple[str | None, str | None, str]:
    """Return (observed_value, error, evidence) for one annotation."""
    kind = ann.fields.get("kind", "")
    if kind == "arithmetic":
        expr = ann.fields.get("expr")
        if not expr:
            return None, "kind=arithmetic needs expr=", ""
        try:
            got = safe_eval(expr)
        except Exception as exc:
            return None, f"expr={expr!r} did not evaluate: {exc}", ""
        return repr(got), None, f"{expr} = {got!r}"

    file_rel = ann.fields.get("file")
    if not file_rel:
        return None, f"kind={kind} needs file=", ""
    text, err = read_source(file_rel)
    if err:
        return None, err, ""
    assert text is not None

    pattern = ann.fields.get("pattern")
    if pattern:
        try:
            rx = re.compile(pattern, re.MULTILINE)
        except re.error as exc:
            return None, f"pattern={pattern!r} is not a regex: {exc}", ""
        if rx.groups != 1 and ann.fields.get("value"):
            return None, f"pattern={pattern!r} must have exactly one capturing group", ""
        matches = list(rx.finditer(text))
        if not matches:
            return None, f"pattern={pattern!r} matches nothing in {file_rel}", ""
        if len(matches) > 1 and ann.fields.get("value"):
            lns = ", ".join(str(text[: m.start()].count("\n") + 1) for m in matches[:5])
            return None, f"pattern={pattern!r} matches {len(matches)} times in {file_rel} (lines {lns}); tighten it", ""
        m0 = matches[0]
        ln = text[: m0.start()].count("\n") + 1
        if rx.groups == 0:
            return "", None, f"{file_rel}:{ln}: {m0.group(0).strip()}"
        return m0.group(1), None, f"{file_rel}:{ln}: {m0.group(0).strip()}"

    if kind == "code":
        symbol = ann.fields.get("symbol")
        if not symbol:
            return None, "kind=code needs symbol= (or pattern=)", ""
        rx = _code_symbol_re(symbol)
        matches = list(rx.finditer(text))
        if not matches:
            return None, (
                f"{file_rel} has no assignment of {symbol} to a numeric literal "
                f"-- it was renamed, moved, or is now computed; give pattern= or fix the chapter"
            ), ""
        if len(matches) > 1:
            lns = ", ".join(str(text[: m.start()].count("\n") + 1) for m in matches)
            return None, (
                f"{symbol} is assigned a number {len(matches)} times in {file_rel} "
                f"(lines {lns}); add pattern= to say which one the chapter means"
            ), ""
        m0 = matches[0]
        ln = text[: m0.start()].count("\n") + 1
        return m0.group("v").replace("_", ""), None, f"{file_rel}:{ln}: {m0.group(0).strip()}"

    if kind == "artifact":
        return None, "kind=artifact needs pattern= (what to read out of the artifact)", ""
    return None, f"unknown kind={kind!r} (expected one of {', '.join(VALID_KINDS)})", ""


def verify(ann: Annotation) -> list[str]:
    errs: list[str] = []
    kind = ann.fields.get("kind", "")
    if kind not in VALID_KINDS:
        return [f"{ann.where}: {ann.handle} unknown kind={kind!r} (expected one of {', '.join(VALID_KINDS)})"]

    prints = ann.fields.get("prints")
    declared = ann.fields.get("value")

    # 1. The source still says what the annotation says it says.
    observed, err, evidence = observe(ann)
    if err:
        errs.append(f"{ann.where}: {ann.handle} {err}")
    elif declared is not None and observed is not None:
        if looks_numeric(declared) and looks_numeric(observed):
            try:
                tol = float(ann.fields["tol"]) if "tol" in ann.fields else None
            except ValueError:
                errs.append(f"{ann.where}: {ann.handle} tol={ann.fields['tol']!r} is not a number")
                tol = None
            if tol is None:
                d = decimals_of(declared)
                tol = 0.5 * (10 ** -d) if d >= 0 else abs(float(declared)) * 1e-9
            if abs(float(observed) - float(declared)) > tol + 1e-12:
                errs.append(
                    f"{ann.where}: {ann.handle} the Book says {declared} and the source says "
                    f"{float(observed):.10g} (tolerance {tol:g}) -- {evidence}"
                )
        elif declared.strip() != observed.strip():
            errs.append(
                f"{ann.where}: {ann.handle} the Book says {declared!r} and the source says "
                f"{observed.strip()!r} -- {evidence}"
            )

    # 2. The chapter still prints it, in the place the annotation points at.
    if not prints:
        errs.append(f"{ann.where}: {ann.handle} has no prints= (nothing ties the annotation to the page)")
        return errs
    if not ann.scope_lines:
        errs.append(f"{ann.where}: {ann.handle} has no source line under it to annotate")
        return errs
    scope_text = "\n".join(t for _, t in ann.scope_lines)
    hits = scope_text.count(prints)
    span = (
        f"line {ann.scope_lines[0][0]}"
        if len(ann.scope_lines) == 1
        else f"lines {ann.scope_lines[0][0]}-{ann.scope_lines[-1][0]}"
    )
    if hits == 0:
        errs.append(
            f"{ann.chapter_file}:{ann.scope_lines[0][0]}: {ann.handle} the chapter no longer prints "
            f"{prints!r} (annotated at {ann.where}, scope {span}); the example was edited away from "
            f"its provenance -- update prints=, or put the number back"
        )
    elif hits > 1:
        errs.append(
            f"{ann.chapter_file}:{ann.scope_lines[0][0]}: {ann.handle} prints=`{prints}` occurs "
            f"{hits} times in {span}; lengthen it so it names one site"
        )

    # 3. What the chapter prints contains the number it claims to.
    digits = ann.fields.get("digits", declared)
    if digits is not None and hits == 1:
        if tex_normalize(digits) not in tex_normalize(prints):
            errs.append(
                f"{ann.where}: {ann.handle} prints=`{prints}` does not contain `{digits}`; "
                f"the annotation is pointing at text that does not show the number "
                f"(use digits= when the chapter renders it in another form)"
            )
    return errs


# ---------------------------------------------------------------- inventory

BLOCK_OPEN_RE = re.compile(r"\\begin\{pdexample\}")
BLOCK_CLOSE_RE = re.compile(r"\\end\{pdexample\}")
NUMBERS_BY_HAND_RE = re.compile(r"(\\paragraph|\\noindent\\textbf)\{Numbers by hand")
# Reference-shaped macro arguments carry digits that are not quantities.
REF_ARG_RE = re.compile(
    r"\\(?:ref|eqref|label|cite|pdcite|pdprov|input|includegraphics|pageref|autoref)"
    r"(?:\{[^{}]*\})+"
)
NUMERIC_RE = re.compile(r"\d+(?:\{,\}\d{3})*(?:\.\d+)?")


def worked_example_blocks(text: str) -> list[tuple[int, int, str]]:
    """(start_line, end_line, body) for every pdexample and every
    `Numbers by hand` paragraph. Same rule the survey used."""
    lines = text.split("\n")
    out: list[tuple[int, int, str]] = []
    i = 0
    while i < len(lines):
        if BLOCK_OPEN_RE.search(lines[i]):
            j = i
            while j < len(lines) and not BLOCK_CLOSE_RE.search(lines[j]):
                j += 1
            out.append((i + 1, j + 1, "\n".join(lines[i : j + 1])))
            i = j + 1
            continue
        if NUMBERS_BY_HAND_RE.search(lines[i]):
            j = i
            while j < len(lines) and lines[j].strip():
                j += 1
            out.append((i + 1, j, "\n".join(lines[i:j])))
            i = j
            continue
        i += 1
    return out


def count_numbers(body: str) -> int:
    return len(NUMERIC_RE.findall(REF_ARG_RE.sub(" ", body)))


# ---------------------------------------------------------------- main


def load_chapters() -> list[dict]:
    with open(os.path.join(REPO_ROOT, TEXTBOOK_REL), encoding="utf-8") as fh:
        return json.load(fh)["chapters"]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--verbose", action="store_true", help="print every annotation and its evidence")
    ap.add_argument("--inventory", action="store_true", help="print the coverage inventory and exit 0")
    args = ap.parse_args()

    chapters = load_chapters()
    all_anns: list[Annotation] = []
    problems: list[str] = []
    inventory: list[tuple[dict, int, int, int, int]] = []

    for ch in chapters:
        rel = ch["source"]
        path = os.path.join(REPO_ROOT, rel)
        if not os.path.isfile(path):
            problems.append(f"{TEXTBOOK_REL}: chapter {ch['number']} names {rel}, which does not exist")
            continue
        anns, probs = collect_annotations(path, rel, ch["number"])
        all_anns.extend(anns)
        problems.extend(probs)

        text = open(path, encoding="utf-8").read()
        blocks = worked_example_blocks(text)
        block_numbers = sum(count_numbers(b) for _, _, b in blocks)
        in_block = 0
        for ann in anns:
            if not ann.scope_lines:
                continue
            ln = ann.scope_lines[0][0]
            if any(a <= ln <= b for a, b, _ in blocks):
                in_block += 1
        inventory.append((ch, len(blocks), block_numbers, len(anns), in_block))

    failures = list(problems)
    for ann in sorted(all_anns, key=lambda a: (a.chapter_file, a.line)):
        failures.extend(verify(ann))

    by_kind: dict[str, int] = {}
    for ann in all_anns:
        by_kind[ann.fields.get("kind", "?")] = by_kind.get(ann.fields.get("kind", "?"), 0) + 1

    print(f"Scanned {len(chapters)} Book chapter(s) named by {TEXTBOOK_REL}.")
    print()
    print("=" * 78)
    print("INVENTORY -- worked-example numbers, and how many carry provenance")
    print("=" * 78)
    print(f"  {'ch':>2}  {'chapter':<22} {'blocks':>6} {'numbers':>8} {'pdnum':>6} {'in-block':>9}")
    tb, tn, ta, ti = 0, 0, 0, 0
    for ch, nblocks, nnums, nanns, ninblock in inventory:
        print(
            f"  {ch['number']:>2}  {ch['id']:<22} {nblocks:>6} {nnums:>8} {nanns:>6} {ninblock:>9}"
        )
        tb += nblocks
        tn += nnums
        ta += nanns
        ti += ninblock
    print(f"  {'':>2}  {'TOTAL':<22} {tb:>6} {tn:>8} {ta:>6} {ti:>9}")
    print()
    print(
        f"  Coverage: {ta} annotated number(s), {ti} of them inside a worked-example block, "
        f"against {tn} numeric literal(s) in {tb} block(s) -- {100.0 * ti / tn if tn else 0:.1f}%."
    )
    print("  The rest is known debt, not silent debt. A count taken off a source")
    print("  listing is out of scope by design (see this file's header).")
    print()
    if by_kind:
        print("  By kind: " + ", ".join(f"{k}={v}" for k, v in sorted(by_kind.items())))
        print()

    if args.verbose or args.inventory:
        print("=" * 78)
        print("ANNOTATIONS")
        print("=" * 78)
        for ann in sorted(all_anns, key=lambda a: (a.chapter_file, a.line)):
            observed, err, evidence = observe(ann)
            state = f"ERROR: {err}" if err else evidence
            print(f"  {ann.where}  kind={ann.fields.get('kind')}  value={ann.fields.get('value')}")
            print(f"      {state}")
            if ann.fields.get("note"):
                print(f"      note: {ann.fields['note']}")
        print()

    if args.inventory:
        return 0

    print("=" * 78)
    print(f"RESULT: {len(failures)} problem(s) across {len(all_anns)} annotation(s)")
    print("=" * 78)
    for line in failures:
        print(f"  {line}")
    if not failures:
        print("  (none -- every annotated number still agrees with what fixed it)")
    print("=" * 78)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
