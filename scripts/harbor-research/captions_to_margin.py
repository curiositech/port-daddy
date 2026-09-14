#!/usr/bin/env python3
r"""captions_to_margin.py -- move every float caption and every footnote in the
Book's chapters into the margin column.

The Book's margin was carrying portraits and glosses while its captions sat in
the text column at full measure and its notes sat at the foot of the page.
Tufte's own books put captions and notes in the margin FIRST and portraits last
(skills/tufte-evidence-design/references/margin-apparatus.md section 3). This
script performs the mechanical half of that inversion:

  \caption{...}   ->  \pdmargincaption{...}, MOVED to the top of its float
  \footnote{...}  ->  \pdsidenote{...}

WHY THE CAPTION MOVES
---------------------
\pdmargincaption has one placement: the margin block hangs downward from the
line that issues it. A caption written below its content would want the
opposite -- a block raised by its own height, running up the margin beside the
image -- and that raise cannot be made safe from inside a float. The only
position information a macro has there is \pagetotal, and inside an [H] float
declared after a paragraph \pagetotal under-reads by the whole of that
paragraph; the raise is then applied at the float's real position. Measured on
the Book: six lines and 67.1 pt below the foot of p. 370, printed over the
running foot. So the caption is moved to where the one safe placement is
correct, rather than the placement being bent to where the caption happens to
sit. 38 of the Book's 54 convertible captions are already at their float's top
and do not move; 16 do.

Moving a caption carries its immediately-following \label with it, so
\ref/\pageref keep resolving to the float.

Both macros are defined in figures/pd-pedagogy.tex (and its byte-identical twin
under website-v2/public/whitepaper/figures/). Both render into the margin
unconditionally: there is one margin system and one artifact -- the Book --
that renders it, so neither carries a second in-column form. Each does still
measure itself against the room left in its own page's column and set itself in
the text column when it does not fit, which is a per-page fit decision, not a
per-artifact one. All three editions (maritime, swiss, technical) share one
chapter source and one geometry; neither macro branches on \pdedition, so one
conversion serves all three.

THE MEASURED END STATE -- DO NOT "FINISH THE JOB"
-------------------------------------------------
After this conversion the eight chapters named in whitepaper/textbook.json hold
7 \caption calls and 54 \pdmargincaption calls. All 7 residuals are the
longtable/xltabular case below -- anchor-protocol 1, legible-swarm 1,
spawn-to-person 2, harbor-economy 1, agent-transactions 1, federated-harbor 1 --
and the full-bleed case has zero instances in the chapters as of this pass.

None of the 7 was skipped for an incidental reason: not a pattern miss, not a
parse failure, not an unbalanced argument. They are structural. Converting one
would put a single margin block beside page one of a table that spans three
pages, pointing the reader at the wrong rows -- which is the defect the
carve-out exists to prevent. A later pass that "finishes the job" by forcing
these into the margin is a regression, not a completion.

Do not confuse that 7 with the 16 in WHY THE CAPTION MOVES above: 16 counts
captions that move POSITION within their float, not captions left in the
column.

WHAT IS DELIBERATELY LEFT ALONE
-------------------------------
longtable / xltabular captions
    That \caption is longtable's own: it must sit in its own row followed by
    \\, and it heads a table that spans pages. One margin block beside page one
    of a three-page table points at the wrong content. Seven of the Book's 61
    captions are these.

a caption inside a full-bleed plate
    A plate that runs to the paper edge has no margin column beside it to put a
    caption in. Detected as a float whose body reaches past the text column:
    \pdfullwidth, an adjustwidth that cancels the margin, \paperwidth, or
    \AddToShipoutPicture.

a footnote with no line of running prose to sit beside
    Inside a float, a longtable, a tabular, a listing/verbatim environment,
    inside a section-family heading's title argument, or inside another margin
    device's own argument. A margin note anchors to the line that issues it;
    issued from inside a float box it anchors to the float, not to the
    sentence, and the reader is pointed at the wrong thing. This is the one
    real exception to "every footnote becomes a sidenote", and it is the same
    exclusion promote_cites.py already applies for the same reason.

    The heading case is not hypothetical and not merely stylistic: the Book's
    one heading footnote is \subsubsection{Competitive-Insurance Pricing
    Mechanism\protect\footnote{...}} in the bonded-commons chapter. A heading
    title is a moving argument -- it is written to the .toc and the .aux -- and
    a margin device expanded there produced 100 "Missing \endcsname inserted"
    errors and a 360-page torso of the 549-page Book when this script first
    converted it. The heading's margin line already belongs to \pd@marginhead;
    an attribution note attached to a heading rather than to a sentence stays a
    footnote.

IDEMPOTENCE
-----------
The scan only ever matches \caption and \footnote, never \pdmargincaption or
\pdsidenote, so a second run over converted sources changes nothing and reports
zero conversions. Verified by the --check exit status: 0 once converted.

COMMENTS
--------
Every regex pass runs over a MASKED copy of the source in which each commented
run is replaced by spaces of the same length. Same length, not deleted, because
this script rewrites by byte offset: deleting comment text (what margin_lint.py
does, which only reports line numbers) would shift every offset after it.

Usage:
    python3 scripts/harbor-research/captions_to_margin.py [FILE.tex ...]
                                                          [--check|--fix] [--json]

With no FILE arguments, reads the Book's eight chapter sources from the
`source` field of each entry in whitepaper/textbook.json.

--check (the default) reports what would change and writes nothing, exiting 1
if any eligible caption or footnote is still unconverted.
--fix rewrites the files in place and exits 0 unless a file could not be written.
--json emits the findings as JSON instead of text.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TEXTBOOK_REL = "whitepaper/textbook.json"

COMMENT_RE = re.compile(r"(?<!\\)%[^\n]*")

# Float environments whose caption owns a margin column beside it. `listing` and
# `lstlisting`-in-a-float are included by name so a future listing float is
# converted the same way; the Book has none today (its lstlisting blocks are not
# floats and carry no \caption).
FLOAT_ENVS = ("figure", "table", "listing", "lstfloat")
# Caption-bearing environments that are NOT floats with a margin beside them.
LONGTABLE_ENVS = ("longtable", "xltabular", "longtabu", "ltablex")

# Content that may sit between \begin{float} and its \caption without meaning
# the caption is "below its content": alignment and type-size declarations, and
# the array stretch every table in the Book sets. Anything else -- an
# \includegraphics, a tabular, a tikzpicture -- means the caption follows the
# thing it captions, and the caption is moved above it.
PREAMBLE_ONLY_RE = re.compile(
    r"^(?:\s|\\centering\b|\\raggedright\b|\\small\b|\\footnotesize\b|\\scriptsize\b"
    r"|\\normalsize\b|\\renewcommand\s*\{?\\arraystretch\}?\s*\{[^}]*\}"
    r"|\\setlength\s*\{[^}]*\}\s*\{[^}]*\}"
    r"|\\captionsetup\s*\{[^}]*\})*$"
)

# A float body that reaches past the text column has no margin beside it.
FULL_BLEED_RE = re.compile(
    r"\\pdfullwidth|\\begin\{adjustwidth\}|\\AddToShipoutPicture|\\paperwidth"
)

# Environments in which a \footnote has no line of running prose to sit beside.
NO_MARGIN_ENVS = FLOAT_ENVS + LONGTABLE_ENVS + (
    "tabular", "tabularx", "tabu", "array",
    "lstlisting", "verbatim", "Verbatim", "pdsession", "minipage",
)
# Margin devices whose own arguments must not spawn a second, independent
# margin box at the same source line -- the reasoning pd-pedagogy.tex records
# for why \pdgloss builds one combined \marginnote rather than two.
MARGIN_DEVICE_MACROS = ("pdmarginfigure", "pdgloss", "pdmargincaption", "pdsidenote",
                        "marginnote", "marginpar", "pdrecitation")
# A heading title is a moving argument, written to the .toc and .aux; a margin
# device expanded there breaks the build (see the module docstring).
HEADING_COMMANDS = ("part", "chapter", "section", "subsection", "subsubsection",
                    "paragraph", "subparagraph")


def mask_comments(text: str) -> str:
    """Same-length copy with every commented run blanked to spaces.

    Same length so byte offsets found on the mask address the same characters
    in the original; newlines survive so line numbers do too.
    """
    return COMMENT_RE.sub(lambda m: " " * len(m.group(0)), text)


def line_of(text: str, index: int) -> int:
    return text.count("\n", 0, index) + 1


def balanced_group(text: str, open_brace: int):
    """(inner_text, index_just_past_close) for the '{' at open_brace, or None.

    Brace-balanced and backslash-aware, so a caption containing \\emph{...} or a
    literal \\{ is captured whole."""
    if open_brace >= len(text) or text[open_brace] != "{":
        return None
    depth = 0
    i = open_brace
    n = len(text)
    while i < n:
        c = text[i]
        if c == "\\":
            i += 2
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return text[open_brace + 1:i], i + 1
        i += 1
    return None


def env_stack_at(mask: str, index: int):
    """The open environment names at `index`, outermost first."""
    stack = []
    for m in re.finditer(r"\\(begin|end)\s*\{([^}]*)\}", mask[:index]):
        kind, name = m.group(1), m.group(2)
        if kind == "begin":
            stack.append(name)
        else:
            if name in stack:
                while stack and stack.pop() != name:
                    pass
    return stack


def enclosing_float(mask: str, index: int):
    """(env_name, index_just_past_its_\\begin) for the innermost caption-bearing
    environment open at `index`, or (None, None)."""
    depth_stack = []
    for m in re.finditer(r"\\(begin|end)\s*\{([^}]*)\}", mask[:index]):
        kind, name = m.group(1), m.group(2)
        if kind == "begin":
            depth_stack.append((name, m.end()))
        else:
            if any(n == name for n, _ in depth_stack):
                while depth_stack and depth_stack.pop()[0] != name:
                    pass
    for name, end in reversed(depth_stack):
        base = name.rstrip("*")
        if base in FLOAT_ENVS or base in LONGTABLE_ENVS:
            # Step past the float's own [H]/[htbp] placement specifier and,
            # for xltabular, its {width}{colspec} arguments. Without this the
            # "is the caption at the float's top" test sees "[H]" as content
            # and foot-anchors every caption in the Book.
            pos = end
            while pos < len(mask) and mask[pos] in " \t":
                pos += 1
            if pos < len(mask) and mask[pos] == "[":
                close = mask.find("]", pos)
                if close != -1:
                    pos = close + 1
            # Only the longtable family takes mandatory arguments on its
            # \begin; consuming brace groups for a float would swallow real
            # body content that happens to start with a group.
            if base in LONGTABLE_ENVS:
                while True:
                    probe = pos
                    while probe < len(mask) and mask[probe] in " \t":
                        probe += 1
                    if probe < len(mask) and mask[probe] == "{":
                        grp = balanced_group(mask, probe)
                        if grp is None:
                            break
                        pos = grp[1]
                        continue
                    break
            return base, pos
    return None, None


def float_body_end(mask: str, env: str, start: int) -> int:
    m = re.compile(r"\\end\s*\{" + re.escape(env) + r"\*?\}").search(mask, start)
    return m.start() if m else len(mask)


def in_heading_title(mask: str, index: int) -> bool:
    """True if `index` falls inside a section-family heading's title argument."""
    for name in HEADING_COMMANDS:
        for m in re.finditer(r"\\" + re.escape(name) + r"\*?\s*(?:\[[^\]]*\])?\s*\{", mask):
            if not m.group(0).startswith("\\" + name):
                continue
            brace = m.end() - 1
            grp = balanced_group(mask, brace)
            if grp is not None and brace < index < grp[1]:
                return True
    return False


def in_margin_device_argument(mask: str, index: int) -> bool:
    """True if `index` falls inside the braced arguments of a margin device."""
    for name in MARGIN_DEVICE_MACROS:
        for m in re.finditer(r"\\" + re.escape(name) + r"(?![A-Za-z@])", mask):
            if m.end() > index:
                continue
            pos = m.end()
            # Walk this macro's braced arguments; if index lands in one, stop.
            for _ in range(3):
                while pos < len(mask) and mask[pos] in " \t\n":
                    pos += 1
                if pos >= len(mask) or mask[pos] != "{":
                    break
                grp = balanced_group(mask, pos)
                if grp is None:
                    break
                if pos < index < grp[1]:
                    return True
                pos = grp[1]
    return False


def scan_captions(text: str, mask: str):
    """Every convertible \\caption, with the anchor it needs and why."""
    out = []
    for m in re.finditer(r"\\caption(?![A-Za-z@])", mask):
        pos = m.end()
        while pos < len(mask) and mask[pos] in " \t\n":
            pos += 1
        # \caption[short]{...}: the Book has none, and \pdmargincaption's
        # optional slot is the anchor, not a list-of-floats short title.
        if pos < len(mask) and mask[pos] == "[":
            out.append({"line": line_of(text, m.start()), "action": "skip",
                        "reason": "caption carries a list-of-floats short title; "
                                  "\\pdmargincaption's optional argument is the anchor, "
                                  "not a short title"})
            continue
        grp = balanced_group(mask, pos)
        if grp is None:
            out.append({"line": line_of(text, m.start()), "action": "skip",
                        "reason": "unbalanced \\caption argument"})
            continue
        env, body_start = enclosing_float(mask, m.start())
        if env is None:
            out.append({"line": line_of(text, m.start()), "action": "skip",
                        "reason": "\\caption outside any caption-bearing environment"})
            continue
        # These two skips are the ONLY reason a caption stays in the text
        # column, and between them they account for every one of the 7
        # residuals in the Book (all 7 longtable; 0 full-bleed). They are
        # structural, not leftovers -- see THE MEASURED END STATE above before
        # removing either branch to "finish the conversion".
        if env in LONGTABLE_ENVS:
            out.append({"line": line_of(text, m.start()), "action": "skip", "env": env,
                        "reason": f"{env} caption is longtable's own -- it must sit in its "
                                  "own row and heads a table that spans pages, so one "
                                  "margin block beside page one points at the wrong content"})
            continue
        body = mask[body_start:float_body_end(mask, env, body_start)]
        if FULL_BLEED_RE.search(body):
            out.append({"line": line_of(text, m.start()), "action": "skip", "env": env,
                        "reason": "full-bleed plate: the float reaches past the text "
                                  "column, so there is no margin beside it"})
            continue
        before = mask[body_start:m.start()]
        at_top = bool(PREAMBLE_ONLY_RE.match(before))
        # A \label written immediately after the caption belongs to the float
        # and must travel with it, or \ref resolves to whatever precedes it at
        # the caption's new home.
        tail = grp[1]
        lab = re.compile(r"\A\s*\\label\s*\{[^}]*\}").match(mask[tail:])
        if lab:
            tail += lab.end()
        out.append({
            "line": line_of(text, m.start()),
            "action": "convert",
            "env": env,
            "at_top": at_top,
            "start": m.start(),
            "arg_start": pos,
            "end": grp[1],
            "tail": tail,
            "insert_at": body_start,
            "text": re.sub(r"\s+", " ", grp[0]).strip(),
            "reason": ("caption already sits at the float's top" if at_top else
                       "caption sits below its content and is moved to the float's top, "
                       "where the margin block's one safe placement is correct"),
        })
    return out


def scan_footnotes(text: str, mask: str):
    out = []
    for m in re.finditer(r"\\footnote(?![A-Za-z@])", mask):
        pos = m.end()
        while pos < len(mask) and mask[pos] in " \t\n":
            pos += 1
        if pos < len(mask) and mask[pos] == "[":
            out.append({"line": line_of(text, m.start()), "action": "skip",
                        "reason": "\\footnote with an explicit mark; \\pdsidenote numbers "
                                  "its own note"})
            continue
        grp = balanced_group(mask, pos)
        if grp is None:
            out.append({"line": line_of(text, m.start()), "action": "skip",
                        "reason": "unbalanced \\footnote argument"})
            continue
        stack = [e.rstrip("*") for e in env_stack_at(mask, m.start())]
        blocking = [e for e in stack if e in NO_MARGIN_ENVS]
        if blocking:
            out.append({"line": line_of(text, m.start()), "action": "skip",
                        "reason": f"inside {blocking[-1]}: a margin note issued here "
                                  "anchors to that box, not to the sentence, so it would "
                                  "point the reader at the wrong content"})
            continue
        if in_heading_title(mask, m.start()):
            out.append({"line": line_of(text, m.start()), "action": "skip",
                        "reason": "inside a section-family heading's title: a moving "
                                  "argument written to the .toc and .aux, where a margin "
                                  "device breaks the build, and a heading's margin line "
                                  "already belongs to \\pd@marginhead"})
            continue
        if in_margin_device_argument(mask, m.start()):
            out.append({"line": line_of(text, m.start()), "action": "skip",
                        "reason": "inside another margin device's argument: a second, "
                                  "independent margin box at the same source line"})
            continue
        out.append({
            "line": line_of(text, m.start()),
            "action": "convert",
            "start": m.start(),
            "arg_start": pos,
            "end": grp[1],
            "text": re.sub(r"\s+", " ", grp[0]).strip()[:80],
            "reason": "footnote in running prose becomes a sidenote",
        })
    return out


def rewrite(text: str, captions, footnotes) -> str:
    """Apply every conversion, right to left so earlier offsets stay valid.

    A caption already at its float's top is renamed in place. One that is not
    is CUT from where it sits and re-inserted just after the float's \\begin
    (and its \\centering/\\small/\\arraystretch run), carrying any \\label that
    immediately followed it. Both edits for one caption are applied as a single
    right-to-left splice pair, so the insert point -- which is always to the
    left of the cut -- is still valid when its turn comes."""
    edits = []  # (sort_key, apply_fn)
    for c in captions:
        if c["action"] != "convert":
            continue
        if c["at_top"]:
            edits.append((c["start"], ("rename", c["start"], c["arg_start"])))
            continue
        block = "\\pdmargincaption" + text[c["arg_start"]:c["tail"]]
        edits.append((c["start"], ("cut", c["start"], c["tail"])))
        edits.append((c["insert_at"], ("insert", c["insert_at"], block)))
    for f in footnotes:
        if f["action"] != "convert":
            continue
        edits.append((f["start"], ("rename-fn", f["start"], f["arg_start"])))

    for _, edit in sorted(edits, key=lambda e: -e[0]):
        kind = edit[0]
        if kind == "rename":
            text = text[:edit[1]] + "\\pdmargincaption" + text[edit[2]:]
        elif kind == "rename-fn":
            text = text[:edit[1]] + "\\pdsidenote" + text[edit[2]:]
        elif kind == "cut":
            # Take the newline the caption sat on with it, so removing it does
            # not leave a blank line that would end the float's paragraph.
            end = edit[2]
            while end < len(text) and text[end] in " \t":
                end += 1
            if end < len(text) and text[end] == "\n":
                end += 1
            start = edit[1]
            text = text[:start] + text[end:]
        elif kind == "insert":
            text = text[:edit[1]] + "\n" + edit[2] + text[edit[1]:]
    return text


def process(path: str):
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    mask = mask_comments(text)
    captions = scan_captions(text, mask)
    footnotes = scan_footnotes(text, mask)
    return text, captions, footnotes


def default_chapter_sources() -> list:
    with open(os.path.join(REPO_ROOT, TEXTBOOK_REL), encoding="utf-8") as fh:
        data = json.load(fh)
    return [os.path.join(REPO_ROOT, ch["source"]) for ch in data["chapters"]]


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("files", nargs="*",
                        help="chapter .tex files; default: the eight Book chapters "
                             "from whitepaper/textbook.json")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true",
                      help="report only, write nothing; exit 1 if anything would change "
                           "(the default)")
    mode.add_argument("--fix", action="store_true", help="rewrite the files in place")
    parser.add_argument("--json", action="store_true", help="emit findings as JSON")
    args = parser.parse_args(argv)

    files = args.files or default_chapter_sources()
    for f in files:
        if not os.path.isfile(f):
            print(f"captions_to_margin.py: no such file: {f}", file=sys.stderr)
            return 2

    report = []
    total_convert = 0
    for path in files:
        try:
            text, captions, footnotes = process(path)
        except OSError as exc:
            print(f"captions_to_margin.py: cannot read {path}: {exc}", file=sys.stderr)
            return 2
        rel = os.path.relpath(path, REPO_ROOT)
        conv = [c for c in captions + footnotes if c["action"] == "convert"]
        total_convert += len(conv)
        report.append({
            "file": rel,
            "captions_converted": sum(1 for c in captions if c["action"] == "convert"),
            "captions_in_place": sum(1 for c in captions
                                     if c["action"] == "convert" and c["at_top"]),
            "captions_moved": sum(1 for c in captions
                                  if c["action"] == "convert" and not c["at_top"]),
            "captions_skipped": [c for c in captions if c["action"] == "skip"],
            "footnotes_converted": sum(1 for f in footnotes if f["action"] == "convert"),
            "footnotes_skipped": [f for f in footnotes if f["action"] == "skip"],
        })
        if args.fix and conv:
            new = rewrite(text, captions, footnotes)
            try:
                with open(path, "w", encoding="utf-8") as fh:
                    fh.write(new)
            except OSError as exc:
                print(f"captions_to_margin.py: cannot write {path}: {exc}", file=sys.stderr)
                return 2

    if args.json:
        print(json.dumps({"files": report, "total_conversions": total_convert}, indent=2))
        return 0 if (args.fix or total_convert == 0) else 1

    verb = "converted" if args.fix else "would convert"
    for entry in report:
        print(f"{entry['file']}")
        print(f"  captions {verb}: {entry['captions_converted']} "
              f"({entry['captions_in_place']} already at the float's top, "
              f"{entry['captions_moved']} moved there)")
        print(f"  footnotes {verb}: {entry['footnotes_converted']}")
        for skip in entry["captions_skipped"] + entry["footnotes_skipped"]:
            print(f"  left alone at line {skip['line']}: {skip['reason']}")
    print(f"\ntotal {verb}: {total_convert} across {len(files)} file(s)")
    return 0 if (args.fix or total_convert == 0) else 1


if __name__ == "__main__":
    sys.exit(main())
