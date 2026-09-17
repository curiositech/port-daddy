#!/usr/bin/env bash
# compile_fragment.sh -- compile one Harbor TikZ figure fragment standalone.
#
# Wraps a bare `\input`-only fragment (from website-v2/public/whitepaper/figures,
# whitepaper/figures, or docs/harbor-research/figures) in a minimal document that
# loads the SAME preamble pieces the assembled Book or research paper would load,
# then compiles it with tectonic. This is the only way to render a fragment on
# its own: none of
# the three corpora's fragments carry a `\documentclass` of their own (bar six
# orphaned website-v2/figures/diag-*.tex files -- see below), so they cannot be
# compiled directly.
#
# Preamble fidelity, not reinvention: Book figures always read the assembled
# Book root's preamble. There is deliberately no chapter mode: the eight chapter
# files are source modules, not independently typeset products, and the old A4
# chapter preambles admitted layouts that failed at the Book's 7 x 10 trim.
# Research mode copies and `\input`s the real docs/harbor-research/tex/preamble.tex
# verbatim. Neither this script
# nor its output ever writes into a tracked source file or directory: everything
# happens in a throwaway temp build dir, and only copies of the real style files
# are placed there.
#
# Usage:
#   compile_fragment.sh FRAGMENT.tex [--preamble book|research] [--out DIR]
#
#   FRAGMENT.tex        Path to one figure fragment .tex file.
#   --preamble MODE     Force "research" (docs/harbor-research corpus) or
#                        "book" (the Textbook Edition's own preamble: Palatino under
#                        XeTeX, 7 x 10 in, a 4.5 in text column; the way a
#                        chapter figure is actually printed -- judge Book
#                        figures ONLY in this mode, and run figcheck on the
#                        result with --textwidth-cm 11.43)
#                        selection. Default: auto-detect from the fragment's
#                        location (a sibling pd-figure-language.tex means Book;
#                        a sibling ../tex/preamble.tex means research).
#   --out DIR            Directory to write FRAGMENT.pdf and FRAGMENT.log into.
#                        Default: ./chartwork-build/<fragment-stem>/ under the
#                        current working directory.
#
# Engine: tectonic first, a local TeX Live second.
#
# tectonic remains the reference engine -- it is what CI installs and what the
# committed renders are judged against -- so it is still tried first and the
# TECTONIC / TECTONIC_CACHE_DIR contract below is unchanged. What is new is
# that a machine WITHOUT tectonic no longer stops here: the script falls back
# to a local LaTeX engine, preferring `latexmk -xelatex` and dropping to bare
# `xelatex` only when latexmk is absent.
#
# Why latexmk rather than a fixed pass count: tectonic reruns the engine until
# the output stops changing, and a Harbor fragment genuinely needs that --
# \label/\ref inside a figure, marginpar/sidenote placement, and TikZ
# `remember picture` / overlay bounding boxes all settle on a later pass than
# the first. latexmk implements exactly that fixed-point rule (it watches the
# .aux and the rerun warnings), so it reproduces tectonic's convergence
# behaviour instead of approximating it. Bare xelatex cannot, so the
# last-resort branch runs a fixed three passes, which is enough for every
# fragment in the three corpora but is a guess, not a guarantee.
#
# Honest limits of the local-TeX fallback, compared with tectonic:
#   * NO package auto-fetch. tectonic downloads a missing .sty from its bundle
#     on demand; a local TeX Live cannot. A missing package is a hard error
#     here, fixed by installing the TeX Live package (see the "Local TeX Live"
#     section of this skill's SKILL.md for the exact apt list and the
#     fontconfig file the Book's by-name font binding needs).
#   * NO hermetic bundle. Output depends on the TeX Live version and the fonts
#     fontconfig can see on this machine, so page breaks and glyph metrics can
#     differ from a tectonic render of the same source. Judge a fragment's
#     geometry locally; judge committed page numbers from the CI PDFs.
#   * SHELL ESCAPE stays off in both, so nothing that needs -shell-escape
#     builds under either engine.
#
# Environment:
#   PD_EDITION           Book mode only: maritime | swiss | technical.
#   PD_CHAPTER_HUE       Book mode only: the chapter hue (pdcobalt, pdteal, ...).
#   TECTONIC             Path to the tectonic binary. Default: the first of
#                         (a) a `tectonic` found on PATH, (b) the dev-sandbox
#                         copy at $CHARTWORK_SCRATCH_TEX/tectonic if present.
#                         When none of those exist the script uses the local
#                         LaTeX fallback described above instead of failing.
#   TECTONIC_CACHE_DIR    Tectonic's resource cache. Left untouched if already
#                         exported by the caller; otherwise pointed at the
#                         pre-warmed dev-sandbox cache if present on disk, else
#                         left unset (tectonic falls back to its own default).
#                         Unused by the local fallback.
#   CHARTWORK_SCRATCH_TEX Base dir holding the dev-sandbox tectonic + cache
#                         (default: the scratchpad path documented in this
#                         skill's SKILL.md). CI should not need this: install
#                         tectonic on PATH and let its default cache apply.
#   CHARTWORK_LATEX_ENGINE  Which engine the local fallback drives. Default
#                         `xelatex` -- the Book is a XeTeX document (fontspec).
#                         Set to `pdflatex` or
#                         `lualatex` only to reproduce a non-XeTeX context.
#   CHARTWORK_LATEX_PASSES  Pass count for the bare-engine branch when latexmk
#                         is not installed. Default 3. Ignored when latexmk is
#                         used, because latexmk decides for itself.
#   CHARTWORK_FORCE_LOCAL_TEX  Set to 1 to skip tectonic even when it exists
#                         and take the local branch, for comparing the two.
#
# Exit status:
#   0  a PDF was produced
#   1  a real compile failure (the first "!"-prefixed TeX error is printed)
#   2  usage error: no such fragment, or an unrecognized --preamble value, or
#      neither tectonic nor a local LaTeX engine can be found at all
#   3  NOTHING TO DRAW -- LaTeX reported no error and no pages, which is what a
#      style/apparatus file under figures/ does. Distinct from 1 on purpose: a
#      caller that compiles everything under a figures directory needs to tell
#      "this file has no picture in it" from "this file is broken".
set -u
umask 022

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DEV_SCRATCH_DEFAULT="${HOME}/coding/tmp/chartwork-tex"
CHARTWORK_SCRATCH_TEX="${CHARTWORK_SCRATCH_TEX:-$DEV_SCRATCH_DEFAULT}"

TEXTWIDTH_CM="${CHARTWORK_TEXTWIDTH_CM:-16.3}"
# Realistic chapter textheight (a4paper, margin=2.5cm: 29.7 - 5 = 24.7cm), with a
# small safety margin. Deliberately NOT an oversized "just in case" canvas: T6
# (figcheck's dead-canvas check) compares drawn content against this page, so an
# arbitrarily tall page would make that comparison meaningless on the height axis.
TEXTHEIGHT_CM="${CHARTWORK_TEXTHEIGHT_CM:-26}"

usage() {
  sed -n '2,37p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

FRAGMENT=""
PREAMBLE_MODE=""
OUT_DIR=""

while [ $# -gt 0 ]; do
  case "$1" in
    --preamble)
      PREAMBLE_MODE="${2:-}"; shift 2 ;;
    --preamble=*)
      PREAMBLE_MODE="${1#--preamble=}"; shift ;;
    --out)
      OUT_DIR="${2:-}"; shift 2 ;;
    --out=*)
      OUT_DIR="${1#--out=}"; shift ;;
    -h|--help)
      usage; exit 0 ;;
    --)
      shift; break ;;
    -*)
      echo "compile_fragment.sh: unrecognized option: $1" >&2; exit 2 ;;
    *)
      if [ -n "$FRAGMENT" ]; then
        echo "compile_fragment.sh: unexpected extra argument: $1" >&2; exit 2
      fi
      FRAGMENT="$1"; shift ;;
  esac
done

if [ -z "$FRAGMENT" ]; then
  usage >&2
  exit 2
fi
if [ ! -f "$FRAGMENT" ]; then
  echo "compile_fragment.sh: no such file: $FRAGMENT" >&2
  exit 2
fi
if [ "$PREAMBLE_MODE" = "chapter" ]; then
  echo "compile_fragment.sh: chapter preambles are retired; Book figures must use --preamble book" >&2
  exit 2
fi
if [ -n "$PREAMBLE_MODE" ] && [ "$PREAMBLE_MODE" != "research" ] && [ "$PREAMBLE_MODE" != "book" ]; then
  echo "compile_fragment.sh: --preamble must be 'book' or 'research', got: $PREAMBLE_MODE" >&2
  exit 2
fi

FRAGMENT_ABS="$(cd "$(dirname "$FRAGMENT")" && pwd)/$(basename "$FRAGMENT")"
STEM="$(basename "$FRAGMENT_ABS" .tex)"
FRAG_DIR="$(dirname "$FRAGMENT_ABS")"
PARENT_DIR="$(dirname "$FRAG_DIR")"

if [ -z "$OUT_DIR" ]; then
  OUT_DIR="./chartwork-build/$STEM"
fi
mkdir -p "$OUT_DIR" || { echo "compile_fragment.sh: cannot create --out dir: $OUT_DIR" >&2; exit 2; }
OUT_DIR_ABS="$(cd "$OUT_DIR" && pwd)"

# --- resolve the engine ------------------------------------------------------
# ENGINE_KIND is one of: tectonic | latexmk | plain. The first is the
# reference engine and keeps its existing environment contract untouched; the
# other two are the local-TeX fallback documented in the header.
ENGINE_KIND=""
LATEX_ENGINE="${CHARTWORK_LATEX_ENGINE:-xelatex}"
LATEX_PASSES="${CHARTWORK_LATEX_PASSES:-3}"

if [ "${CHARTWORK_FORCE_LOCAL_TEX:-0}" != "1" ]; then
  if [ -z "${TECTONIC:-}" ]; then
    if command -v tectonic >/dev/null 2>&1; then
      TECTONIC="$(command -v tectonic)"
    elif [ -x "$CHARTWORK_SCRATCH_TEX/tectonic" ]; then
      TECTONIC="$CHARTWORK_SCRATCH_TEX/tectonic"
    fi
  fi
  if [ -n "${TECTONIC:-}" ]; then
    # An explicitly set TECTONIC that is not runnable is still a hard error:
    # the caller asked for a specific binary and silently using something else
    # would render the fragment under an engine they did not choose.
    if [ ! -x "$TECTONIC" ] && ! command -v "$TECTONIC" >/dev/null 2>&1; then
      echo "compile_fragment.sh: TECTONIC does not point at an executable: $TECTONIC" >&2
      exit 2
    fi
    ENGINE_KIND="tectonic"
    if [ -z "${TECTONIC_CACHE_DIR:-}" ] && [ -d "$CHARTWORK_SCRATCH_TEX/cache" ]; then
      export TECTONIC_CACHE_DIR="$CHARTWORK_SCRATCH_TEX/cache"
    fi
  fi
fi

if [ -z "$ENGINE_KIND" ]; then
  if ! command -v "$LATEX_ENGINE" >/dev/null 2>&1; then
    echo "compile_fragment.sh: no tectonic on PATH, no dev-sandbox copy at $CHARTWORK_SCRATCH_TEX/tectonic, and no local $LATEX_ENGINE either." >&2
    echo "compile_fragment.sh: install a TeX Live with $LATEX_ENGINE (see the 'Local TeX Live' section of skills/harbor-chartwork/SKILL.md) or set TECTONIC=/path/to/tectonic." >&2
    exit 2
  fi
  if command -v latexmk >/dev/null 2>&1; then
    ENGINE_KIND="latexmk"
  else
    ENGINE_KIND="plain"
  fi
fi

CHARTWORK_TMPDIR="${CHARTWORK_TMPDIR:-${HOME}/coding/tmp}"
mkdir -p "$CHARTWORK_TMPDIR" || {
  echo "compile_fragment.sh: cannot create scratch root: $CHARTWORK_TMPDIR" >&2
  exit 2
}
BUILD="$(mktemp -d "$CHARTWORK_TMPDIR/chartwork-compile.XXXXXX")"
cleanup() { rm -rf "$BUILD"; }
trap cleanup EXIT

WRAPPER="$BUILD/wrapper.tex"
MAIN_JOBNAME="wrapper"

# --- fragment already carries its own \documentclass: compile as-is --------
# (Six website-v2/figures/diag-*.tex fragments predate the pd-figure-language
# system and are already complete standalone documents. Any future fragment
# that similarly declares its own class is handled the same way: it needs no
# wrapping, and wrapping it would double up \documentclass and fail to build.)
# Checked BEFORE preamble auto-detection, deliberately: such a fragment needs
# no preamble pieces at all, so it should never be blocked by living
# somewhere auto-detection cannot place in either corpus.
if grep -q '\\documentclass' "$FRAGMENT_ABS"; then
  MAIN_JOBNAME="$STEM"
  cp "$FRAGMENT_ABS" "$BUILD/$STEM.tex"
  WRAPPER="$BUILD/$STEM.tex"
else
  # --- auto-detect preamble mode ---------------------------------------------
  if [ -z "$PREAMBLE_MODE" ]; then
    if [ -f "$PARENT_DIR/tex/preamble.tex" ]; then
      PREAMBLE_MODE="research"
    elif [ -f "$FRAG_DIR/pd-figure-language.tex" ]; then
      PREAMBLE_MODE="book"
    else
      echo "compile_fragment.sh: cannot auto-detect preamble mode for $FRAGMENT_ABS (no sibling ../tex/preamble.tex or pd-figure-language.tex); pass --preamble book|research" >&2
      exit 2
    fi
  fi
  HAS_FIGURE_ENV=0
  grep -q '\\begin{figure' "$FRAGMENT_ABS" && HAS_FIGURE_ENV=1

  # Extract FILE's preamble: everything from line 1 up to (but not including)
  # its `\begin{document}` line. Printed via awk, not sed, so the boundary
  # line itself is cleanly excluded rather than fiddled with afterward.
  extract_preamble() {
    awk '/\\begin\{document\}/{exit} {print}' "$1"
  }

  if [ "$PREAMBLE_MODE" = "book" ]; then
    # The Book: its root's preamble section verbatim (the generated-input
    # guard, the preamble, the seams, the PDF metadata), its figure twins, and
    # the fragment. The Book's geometry stands, so no \newgeometry; there is
    # no standalone variant because the column is the point.
    BOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../website-v2/public/whitepaper" && pwd)"
    BOOK_ROOT="$BOOK_DIR/coordination-papers-mega-volume.tex"
    [ -f "$BOOK_ROOT" ] || { echo "compile_fragment.sh: Book root not found at $BOOK_ROOT" >&2; exit 2; }
    mkdir -p "$BUILD/figures"
    for shared in "$BOOK_DIR"/figures/pd-*.tex; do
      [ -f "$shared" ] && cp "$shared" "$BUILD/figures/$(basename "$shared")"
    done
    # Every sibling of the Book root, rather than a list of the names today's
    # preamble happens to \input. The preamble pulls in the plate set for
    # whichever character \pdedition selects, and that used to be maritime,
    # which inputs none -- so the plate copy was missing and invisible until
    # Swiss became the default and all 36 fragments failed at once with
    # "File `coordination-papers-mega-volume-swiss-plates.tex' not found".
    # Naming the files, or globbing a guess at how the next one will be named,
    # both leave that hole open for the edition after this one. Copying the
    # family closes it: a few unread files in a scratch build dir cost nothing,
    # and a missing one costs the whole run.
    for piece in "$BOOK_DIR"/coordination-papers-mega-volume-*.tex; do
      [ -f "$piece" ] && cp "$piece" "$BUILD/$(basename "$piece")"
    done
    # ...but the two the wrapper cannot compile without are still asserted, so a
    # renamed preamble fails here rather than 200 lines into a TeX log.
    for required in coordination-papers-mega-volume-preamble.tex coordination-papers-mega-volume-seams.tex; do
      [ -f "$BUILD/$required" ] || {
        echo "compile_fragment.sh: $required not found in $BOOK_DIR" >&2
        exit 2
      }
    done
    cp "$FRAGMENT_ABS" "$BUILD/figures/$STEM.tex"
    # PD_EDITION (maritime | swiss | technical) selects the edition exactly as
    # the edition roots do, by defining \pdedition before the Book root is
    # read; unset, the Book's own default applies. PD_CHAPTER_HUE sets the
    # hue the chapter opener would have set (e.g. pdviolet for Part III), so
    # a figure is judged in the colour it prints in.
    : > "$WRAPPER"
    if [ -n "${PD_EDITION:-}" ]; then
      printf '\\def\\pdedition{%s}\n' "$PD_EDITION" >> "$WRAPPER"
    fi
    extract_preamble "$BOOK_ROOT" >> "$WRAPPER"
    {
      echo '\begin{document}'
      echo '\pagestyle{empty}'
      if [ -n "${PD_CHAPTER_HUE:-}" ]; then
        echo "\\renewcommand{\\pdcurrentchaptercolor}{$PD_CHAPTER_HUE}"
      fi
      echo "\\input{figures/$STEM}"
      echo '\end{document}'
    } >> "$WRAPPER"
    TEXTWIDTH_CM="11.43"

  else  # research
    # Prefer the ONE real tex/*.tex document that actually `\input`s this
    # fragment (its full preamble), rather than approximating that context.
    # Not just paper*.tex: exec1.tex/exec2.tex/exec3.tex each
    # `\input` exactly one figure too. This matters in practice: paper3.tex
    # and paper6.tex each add `\usetikzlibrary{patterns}` beyond the shared
    # preamble.tex, purely for one figure apiece (fig-r7-regime.tex,
    # fig-paper6-regime.tex).
    REF_ROOT=""
    for cand in "$PARENT_DIR"/tex/*.tex; do
      [ -f "$cand" ] || continue
      if grep -qE "\\\\input\\{${STEM}(\\.tex)?\\}" "$cand"; then
        REF_ROOT="$cand"
        break
      fi
    done

    cp "$PARENT_DIR/tex/preamble.tex" "$BUILD/preamble.tex"
    cp "$FRAGMENT_ABS" "$BUILD/$STEM.tex"

    if [ -n "$REF_ROOT" ]; then
      extract_preamble "$REF_ROOT" > "$WRAPPER"
    else
      cat > "$WRAPPER" <<EOF
\documentclass[11pt,a4paper]{article}
\input{preamble}
\usepackage{graphicx}
EOF
    fi
    if [ "$HAS_FIGURE_ENV" -eq 0 ]; then
      # Bare tikzpicture: swap just the `\documentclass[11pt,a4paper]{article}`
      # substring for a tight-cropping standalone class -- a substring
      # replacement, not a whole-line one, because paper2.tex crams several
      # preamble commands onto that same physical line and a whole-line
      # replace would silently drop them.
      sed -i '1s#\\documentclass\[11pt,a4paper\]{article}#\\documentclass[tikz,border=2mm]{standalone}#' "$WRAPPER"
    fi
    {
      echo '\begin{document}'
      if [ "$HAS_FIGURE_ENV" -eq 1 ]; then
        echo '\pagestyle{empty}'
        echo "\\newgeometry{textwidth=${TEXTWIDTH_CM}cm,textheight=${TEXTHEIGHT_CM}cm,top=1cm,bottom=1cm}"
      fi
      echo "\\input{$STEM.tex}"
      echo '\end{document}'
    } >> "$WRAPPER"
  fi
fi

# --- compile -----------------------------------------------------------------
# The capture file keeps its historical name so callers (and the failure path
# below) do not have to care which engine ran.
LOG_CAPTURE="$BUILD/_tectonic_stdout.log"
WRAPPER_BASE="$(basename "$WRAPPER")"

case "$ENGINE_KIND" in
  tectonic)
    ( cd "$BUILD" && "$TECTONIC" --keep-logs -o "$BUILD" "$WRAPPER_BASE" ) >"$LOG_CAPTURE" 2>&1
    STATUS=$?
    ;;
  latexmk)
    # latexmk reruns to a fixed point, which is what tectonic does and what a
    # fragment with \label/\ref, marginpar or a remembered TikZ picture needs.
    latexmk_flag="-xelatex"
    case "$LATEX_ENGINE" in
      pdflatex) latexmk_flag="-pdf" ;;
      lualatex) latexmk_flag="-lualatex" ;;
      xelatex)  latexmk_flag="-xelatex" ;;
      *) echo "compile_fragment.sh: CHARTWORK_LATEX_ENGINE must be xelatex, pdflatex or lualatex, got: $LATEX_ENGINE" >&2; exit 2 ;;
    esac
    ( cd "$BUILD" && latexmk "$latexmk_flag" -interaction=nonstopmode -halt-on-error \
        -file-line-error -outdir="$BUILD" "$WRAPPER_BASE" ) >"$LOG_CAPTURE" 2>&1
    STATUS=$?
    ;;
  plain)
    # No latexmk: a fixed pass count is the pragmatic substitute for running to
    # a fixed point. Three passes settle labels, the marginpar/sidenote column
    # and TikZ bounding boxes for every fragment in the three corpora; it is a
    # bound, not a proof of convergence.
    STATUS=0
    : >"$LOG_CAPTURE"
    for _pass in $(seq 1 "$LATEX_PASSES"); do
      ( cd "$BUILD" && "$LATEX_ENGINE" -interaction=nonstopmode -halt-on-error \
          -file-line-error -output-directory="$BUILD" "$WRAPPER_BASE" ) >>"$LOG_CAPTURE" 2>&1
      STATUS=$?
      # A hard TeX error will not improve on the next pass.
      [ "$STATUS" -ne 0 ] && break
      # Converged early: stop burning passes once nothing asks for a rerun.
      if [ "$_pass" -ge 2 ] && [ -f "$BUILD/$MAIN_JOBNAME.log" ] \
         && ! grep -Eq 'Rerun to get|Label\(s\) may have changed|Rerun to get cross-references right' "$BUILD/$MAIN_JOBNAME.log"; then
        break
      fi
    done
    ;;
esac

PDF_SRC="$BUILD/$MAIN_JOBNAME.pdf"
LOG_SRC="$BUILD/$MAIN_JOBNAME.log"
[ -f "$LOG_SRC" ] || LOG_SRC="$LOG_CAPTURE"

cp "$LOG_SRC" "$OUT_DIR_ABS/$STEM.log" 2>/dev/null

if [ "$STATUS" -ne 0 ] || [ ! -f "$PDF_SRC" ]; then
  FIRST_ERROR="$(grep -m1 -E '^! ' "$LOG_SRC" 2>/dev/null)"

  # NOTHING TO DRAW is not the same thing as WOULD NOT COMPILE, and this script
  # used to report them identically.
  #
  # Not every .tex under a figures/ directory is a figure. The Book keeps its
  # apparatus there too -- pd-figure-language.tex and its per-edition overrides,
  # pd-pedagogy.tex, pd-cite-shortforms.tex -- and those carry \tikzset and
  # \newcommand definitions and no tikzpicture at all. Wrapped and run, LaTeX
  # succeeds and emits "No pages of output."; there is then no .xdv for
  # xdvipdfmx to convert, so tectonic exits non-zero with `cannot open
  # "wrapper.xdv"`. Read as a compile failure, that reddened the figure gate for
  # two files that had simply drawn nothing.
  #
  # The test is by SHAPE, not by name: LaTeX emits a `! `-prefixed line for
  # every real error, and emits none when it merely had nothing to typeset. A
  # log with "No pages of output." and no `! ` line is therefore a file with no
  # drawing in it -- which is a fact about the file, not a verdict on it -- and
  # a skip list keyed on today's five filenames would be the same defect one
  # layer down: the next apparatus file added under a new name would redden the
  # gate again.
  #
  # Exit 3, distinct from both 0 (a PDF exists) and 1 (a real error), so a
  # caller can tell the three apart. Note for whoever reads this next: the
  # visual-proof guard on the PR side deliberately treats EVERY .tex under
  # figures/ as a figure surface, and that is correct for the question it asks
  # ("does this PR owe a render?"). This is a different question ("can this be
  # compiled as a picture?") and it has a different answer for the same files.
  # Do not unify them.
  if grep -q 'No pages of output' "$LOG_SRC" 2>/dev/null && [ -z "$FIRST_ERROR" ]; then
    echo "compile_fragment.sh: NO PAGES from $FRAGMENT_ABS (${PREAMBLE_MODE:-self-contained} mode)" >&2
    echo "compile_fragment.sh: LaTeX reported no error -- this file defines style or apparatus and draws nothing, so there is no picture to render" >&2
    exit 3
  fi

  [ -z "$FIRST_ERROR" ] && FIRST_ERROR="$(tail -n 20 "$LOG_CAPTURE" 2>/dev/null)"
  echo "compile_fragment.sh: FAILED to compile $FRAGMENT_ABS (${PREAMBLE_MODE:-self-contained} mode)" >&2
  echo "$FIRST_ERROR" >&2
  exit 1
fi

cp "$PDF_SRC" "$OUT_DIR_ABS/$STEM.pdf"
echo "compile_fragment.sh: OK -> $OUT_DIR_ABS/$STEM.pdf"
exit 0
