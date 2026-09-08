#!/usr/bin/env python3
"""Tests for submission_lint. Run: python3 test_submission_lint.py

Stdlib only, no pytest needed. Exits nonzero on failure.

The brace cases below are the whole reason this file exists: the obvious
implementation of brace counting mis-handles '\\\\{' and produces confident
false positives on files that compile fine.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from submission_lint import count_braces, strip_noise, load, collect_labels, \
    check_structure, check_citations, check_refs, check_figures  # noqa: E402

FAILS = []


def eq(got, want, label):
    if got != want:
        FAILS.append(f"{label}: expected {want!r}, got {got!r}")


# --- count_braces ---------------------------------------------------------
eq(count_braces("a{b}c"), 0, "plain balanced")
eq(count_braces("{"), 1, "single open")
eq(count_braces("}"), -1, "single close")
eq(count_braces(r"\{"), 0, "escaped open brace is not a brace")
eq(count_braces(r"\}"), 0, "escaped close brace is not a brace")
eq(count_braces(r"\{\}"), 0, "both escaped")
# The regression that motivated the rewrite: '\\' is an escaped backslash
# (a LaTeX line break); the '{' after it is a REAL brace and must count.
eq(count_braces("\\\\{a}"), 0, "line-break then balanced group")
eq(count_braces("\\\\{"), 1, "line-break then unbalanced open")
eq(count_braces(r"\%{x}"), 0, "escaped percent then group")
eq(count_braces(r"\\\{"), 0, "line break then escaped brace")

# --- strip_noise ----------------------------------------------------------
eq(strip_noise("a % comment {").strip(), "a", "comment removed")
eq(strip_noise(r"100\% real {x}").strip(), r"100\% real {x}", "escaped percent kept")
eq(count_braces(strip_noise("{ok} % dangling {")), 0, "brace inside comment ignored")
eq(strip_noise("\\begin{verbatim}\n{{{\n\\end{verbatim}").strip(), "", "verbatim blanked")

# --- integration on a synthetic paper ------------------------------------
SAMPLE = r"""
\documentclass{article}
\begin{document}
\begin{abstract}
We show a thing. \end{abstract}
\section{Intro}\label{sec:intro}
As shown in \S\ref{sec:intro} and \S\ref{sec:ghost}, see \cite{real} and \cite{ghost}.
\begin{figure}
\includegraphics{x}
\caption{Too short.}
\end{figure}
\begin{figure}
\includegraphics{y}\label{fig:ok}
\end{figure}
\begin{thebibliography}{9}
\bibitem{real} A real entry.
\bibitem{orphan} Never cited.
\end{thebibliography}
\end{document}
"""

tmp = Path("/tmp/_lint_sample.tex")
tmp.write_text(SAMPLE)
doc = load(tmp)
collect_labels(doc)

kinds = lambda fs: sorted(f.check for f in fs)  # noqa: E731

eq(check_structure(doc), [], "sample is structurally sound")
eq("dangling-cite" in kinds(check_citations(doc, set())), True, "catches \\cite with no \\bibitem")
eq("unused-bibitem" in kinds(check_citations(doc, set())), True, "catches uncited \\bibitem")
eq("dangling-ref" in kinds(check_refs(doc, doc.labels)), True, "catches \\ref with no \\label")
figs = kinds(check_figures(doc))
eq("uncaptioned" in figs, True, "catches figure with no caption")
eq("thin-caption" in figs, True, "catches a too-short caption")
eq("unlabelled-float" in figs, True, "catches figure with no label")

# a .bib supplying the key should silence the dangling-cite
eq("dangling-cite" in kinds(check_citations(doc, {"ghost"})), False, "--bib keys count as defined")
tmp.unlink()

# --- report ---------------------------------------------------------------
if FAILS:
    print(f"FAILED ({len(FAILS)}):")
    for f in FAILS:
        print("  -", f)
    sys.exit(1)
print("all tests pass")
