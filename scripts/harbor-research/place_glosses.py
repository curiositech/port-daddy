#!/usr/bin/env python3
r"""place_glosses.py -- replace the FIRST body \textbf{Term} of each corpus term
with \pdgloss{Term}{definition}.

Placement rules, all enforced here rather than left to review:

  1. First use only. \pdgloss is a first-use device; margin_lint.py fails a term
     glossed twice in one chapter, and the skill's anti-pattern section says why.
  2. Never inside a float, a verbatim/listing block, a maths environment, or a
     heading's moving argument -- a margin device in a moving argument is written
     to the .toc and .aux and breaks the build.
  3. MIN_GAP source lines between any two margin-issuing devices in one chapter
     (\pdgloss, \pdsidenote, \pdmarginfigure, \pdmargincaption, \pdprovedon).
     The tufte-evidence-design skill puts the collision distance at "about a
     dozen source lines"; MIN_GAP is that, and it is the only thing standing
     between a generous margin and a column of overlapping notes.
  4. A term whose definition would not fit is not shortened here -- it is the
     author's to edit. Nothing is dropped silently: every skipped term is
     reported with the rule that skipped it.
"""
from __future__ import annotations
import json, re, sys

# Eight source lines, not the dozen the skill names for margin FIGURES. The
# dozen is a figure's distance: a portrait is 100 pt or more and two of them
# within a dozen lines overlap. A gloss is two or three lines in the margin and
# \pd@placemargin's occupancy bookkeeping STACKS a second block below the first
# rather than overlapping it, so the binding constraint for glosses is the foot
# of the column, not the neighbour. Eight is the distance at which two stacked
# glosses still clear the foot on a dense page; the gate that checks it is the
# build log's "Marginpar on page" count, measured, not this number.
MIN_GAP = 8

# Floats, verbatim and display maths only. A theorem, a definition or a list
# item is ordinary horizontal-mode text: \pdgloss works there exactly as it
# does in a paragraph, and those environments are where a chapter's terms of
# art are most often introduced, so excluding them threw away the best
# placements this corpus has.
SKIP_ENVS = ("figure", "table", "tabular", "tabularx", "xltabular", "longtable",
             "verbatim", "lstlisting", "align", "equation", "gather",
             "tikzpicture", "pdsession")
HEADING_RE = re.compile(r'\\(chapter|section|subsection|subsubsection|paragraph|caption|pdmargincaption|pdsidenote|pdgloss|pdboundary|title|keyidea|pitfall|xrefbox|pullquote)\*?\s*[\[{]')
MARGIN_DEVICE_RE = re.compile(r'\\(pdgloss|pdsidenote|pdmarginfigure|pdmargincaption|pdprovedon|pd@marginhead|keyidea|pitfall|xrefbox)\b')


def env_stack_per_line(lines):
    depth, stack = [], []
    for l in lines:
        for m in re.finditer(r'\\(begin|end)\{(\w+\*?)\}', l):
            if m.group(1) == "begin":
                stack.append(m.group(2))
            elif stack:
                stack.pop()
        depth.append(tuple(stack))
    return depth


def place(path, terms, report):
    text = open(path).read()
    lines = text.split("\n")
    body_at = text.find("\\begin{document}")
    first_body = text[:body_at].count("\n") if body_at > 0 else 0
    depth = env_stack_per_line(lines)

    # every line that already issues a margin device
    occupied = sorted(i for i, l in enumerate(lines)
                      if MARGIN_DEVICE_RE.search(l) and not l.lstrip().startswith("%"))

    placed, skipped = [], []
    for term, definition in terms:
        pat = re.compile(r'\\textbf\{' + re.escape(term) + r'\}')
        hit = None
        for i, l in enumerate(lines):
            if i < first_body or l.lstrip().startswith("%"):
                continue
            if re.search(r"\\(newcommand|renewcommand|providecommand|def|author|date)\b", l):
                continue
            if any(e.rstrip("*") in SKIP_ENVS for e in depth[i]):
                continue
            m = pat.search(l)
            if not m:
                continue
            if HEADING_RE.search(l[:m.start()]):
                continue
            hit = (i, m)
            break
        if hit is None:
            skipped.append((term, "no eligible first use in running prose"))
            continue
        i, m = hit
        near = [j for j in occupied if abs(j - i) < MIN_GAP]
        if near:
            skipped.append((term, "within %d source lines of the margin device at line %d"
                            % (MIN_GAP, near[0] + 1)))
            continue
        call = "\\pdgloss{%s}{%s}" % (term, definition)
        lines[i] = lines[i][:m.start()] + call + lines[i][m.end():]
        occupied.append(i)
        occupied.sort()
        placed.append((term, i + 1))
    open(path, "w").write("\n".join(lines))
    report[path] = {"placed": placed, "skipped": skipped}
    return len(placed), len(skipped)


def main():
    corpus = json.load(open(sys.argv[1]))
    paths = json.load(open(sys.argv[2]))
    report, tp, ts = {}, 0, 0
    for chapter, terms in corpus.items():
        if chapter.startswith("_"):
            continue
        p = paths[chapter]
        a, b = place(p, terms, report)
        tp += a
        ts += b
        print("%-22s placed %3d  skipped %3d" % (chapter, a, b))
        for term, why in report[p]["skipped"]:
            print("      SKIP %-42s %s" % (term, why))
    print("TOTAL placed %d, skipped %d" % (tp, ts))
    json.dump(report, open(sys.argv[3], "w"), indent=1)


if __name__ == "__main__":
    main()
