#!/usr/bin/env bash
# compile_fragment.sh -- compile one Harbor TikZ figure fragment standalone.
#
# Wraps a bare `\input`-only fragment (from website-v2/public/whitepaper/figures,
# whitepaper/figures, or docs/harbor-research/figures) in a minimal document that
# loads the SAME preamble pieces the real chapter/paper would load, then compiles
# it with tectonic. This is the only way to render a fragment on its own: none of
# the three corpora's fragments carry a `\documentclass` of their own (bar six
# orphaned website-v2/figures/diag-*.tex files -- see below), so they cannot be
# compiled directly.
#
# Preamble fidelity, not reinvention: rather than hand-transcribing the chapter
# palette/package list into this script (which would drift the moment the real
# preamble changes), chapter mode READS the real chapter root's own preamble
# block at run time and reuses it verbatim. Research mode copies and `\input`s
# the real docs/harbor-research/tex/preamble.tex verbatim. Neither this script
# nor its output ever writes into a tracked source file or directory: everything
# happens in a throwaway temp build dir, and only copies of the real style files
# are placed there.
#
# Usage:
#   compile_fragment.sh FRAGMENT.tex [--preamble chapter|research] [--out DIR]
#
#   FRAGMENT.tex        Path to one figure fragment .tex file.
#   --preamble MODE     Force "chapter" (website-v2/whitepaper corpora) or
#                        "research" (docs/harbor-research corpus) preamble
#                        selection. Default: auto-detect from the fragment's
#                        location (a sibling pd-figure-language.tex means
#                        chapter; a sibling ../tex/preamble.tex means research).
#   --out DIR            Directory to write FRAGMENT.pdf and FRAGMENT.log into.
#                        Default: ./chartwork-build/<fragment-stem>/ under the
#                        current working directory.
#
# Environment:
#   TECTONIC             Path to the tectonic binary. Default: the first of
#                         (a) a `tectonic` found on PATH, (b) the dev-sandbox
#                         copy at $CHARTWORK_SCRATCH_TEX/tectonic if present.
#   TECTONIC_CACHE_DIR    Tectonic's resource cache. Left untouched if already
#                         exported by the caller; otherwise pointed at the
#                         pre-warmed dev-sandbox cache if present on disk, else
#                         left unset (tectonic falls back to its own default).
#   CHARTWORK_SCRATCH_TEX Base dir holding the dev-sandbox tectonic + cache
#                         (default: the scratchpad path documented in this
#                         skill's SKILL.md). CI should not need this: install
#                         tectonic on PATH and let its default cache apply.
#
# Exit status: 0 on a clean compile. Non-zero on any TeX error, on a fragment
# or reference file that cannot be found, or on an unrecognized --preamble
# value. On failure the first "!"-prefixed error line from the TeX log is
# printed to stderr before exiting.
set -u
umask 022

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DEV_SCRATCH_DEFAULT="/tmp/claude-0/-home-user-port-daddy/f533555d-4b5c-552b-a885-0b01f8d66dea/scratchpad/tex"
CHARTWORK_SCRATCH_TEX="${CHARTWORK_SCRATCH_TEX:-$DEV_SCRATCH_DEFAULT}"

TEXTWIDTH_CM="${CHARTWORK_TEXTWIDTH_CM:-16.3}"
# Realistic chapter textheight (a4paper, margin=2.5cm: 29.7 - 5 = 24.7cm), with a
# small safety margin. Deliberately NOT an oversized "just in case" canvas: T6
# (figcheck's dead-canvas check) compares drawn content against this page, so an
# arbitrarily tall page would make that comparison meaningless on the height axis.
TEXTHEIGHT_CM="${CHARTWORK_TEXTHEIGHT_CM:-26}"

usage() {
  sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
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
if [ -n "$PREAMBLE_MODE" ] && [ "$PREAMBLE_MODE" != "chapter" ] && [ "$PREAMBLE_MODE" != "research" ]; then
  echo "compile_fragment.sh: --preamble must be 'chapter' or 'research', got: $PREAMBLE_MODE" >&2
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

# --- resolve tectonic + its cache -------------------------------------------
if [ -z "${TECTONIC:-}" ]; then
  if command -v tectonic >/dev/null 2>&1; then
    TECTONIC="$(command -v tectonic)"
  elif [ -x "$CHARTWORK_SCRATCH_TEX/tectonic" ]; then
    TECTONIC="$CHARTWORK_SCRATCH_TEX/tectonic"
  else
    echo "compile_fragment.sh: no tectonic found on PATH and no dev-sandbox copy at $CHARTWORK_SCRATCH_TEX/tectonic; set TECTONIC=/path/to/tectonic" >&2
    exit 2
  fi
fi
if [ ! -x "$TECTONIC" ] && ! command -v "$TECTONIC" >/dev/null 2>&1; then
  echo "compile_fragment.sh: TECTONIC does not point at an executable: $TECTONIC" >&2
  exit 2
fi
if [ -z "${TECTONIC_CACHE_DIR:-}" ] && [ -d "$CHARTWORK_SCRATCH_TEX/cache" ]; then
  export TECTONIC_CACHE_DIR="$CHARTWORK_SCRATCH_TEX/cache"
fi

# --- auto-detect preamble mode ----------------------------------------------
if [ -z "$PREAMBLE_MODE" ]; then
  if [ -f "$PARENT_DIR/tex/preamble.tex" ]; then
    PREAMBLE_MODE="research"
  elif [ -f "$FRAG_DIR/pd-figure-language.tex" ]; then
    PREAMBLE_MODE="chapter"
  else
    echo "compile_fragment.sh: cannot auto-detect preamble mode for $FRAGMENT_ABS (no sibling ../tex/preamble.tex or pd-figure-language.tex); pass --preamble chapter|research" >&2
    exit 2
  fi
fi

BUILD="$(mktemp -d "${TMPDIR:-/tmp}/chartwork-compile.XXXXXX")"
cleanup() { rm -rf "$BUILD"; }
trap cleanup EXIT

WRAPPER="$BUILD/wrapper.tex"
MAIN_JOBNAME="wrapper"

# --- fragment already carries its own \documentclass: compile as-is --------
# (Six website-v2/figures/diag-*.tex fragments predate the pd-figure-language
# system and are already complete standalone documents. Any future fragment
# that similarly declares its own class is handled the same way: it needs no
# wrapping, and wrapping it would double up \documentclass and fail to build.)
if grep -q '\\documentclass' "$FRAGMENT_ABS"; then
  MAIN_JOBNAME="$STEM"
  cp "$FRAGMENT_ABS" "$BUILD/$STEM.tex"
  WRAPPER="$BUILD/$STEM.tex"
else
  HAS_FIGURE_ENV=0
  grep -q '\\begin{figure' "$FRAGMENT_ABS" && HAS_FIGURE_ENV=1

  if [ "$PREAMBLE_MODE" = "chapter" ]; then
    # Find a real chapter/whitepaper root in the fragment's parent dir that
    # loads the shared style file, and reuse its preamble block verbatim
    # (documentclass through the `\input{figures/pd-figure-language}` line).
    REF_ROOT=""
    for cand in "$PARENT_DIR"/*.tex; do
      [ -f "$cand" ] || continue
      if grep -q '\\input{figures/pd-figure-language}' "$cand"; then
        REF_ROOT="$cand"
        break
      fi
    done
    if [ -z "$REF_ROOT" ]; then
      echo "compile_fragment.sh: no chapter root in $PARENT_DIR inputs figures/pd-figure-language; cannot build a chapter preamble" >&2
      exit 2
    fi
    mkdir -p "$BUILD/figures"
    cp "$FRAG_DIR/pd-figure-language.tex" "$BUILD/figures/pd-figure-language.tex"
    [ -f "$FRAG_DIR/pd-palette.tex" ] && cp "$FRAG_DIR/pd-palette.tex" "$BUILD/figures/pd-palette.tex"
    cp "$FRAGMENT_ABS" "$BUILD/figures/$STEM.tex"

    sed -n '1,/\\input{figures\/pd-figure-language}/p' "$REF_ROOT" > "$WRAPPER"
    if [ "$HAS_FIGURE_ENV" -eq 0 ]; then
      # Bare tikzpicture: swap the article documentclass line for a
      # tight-cropping standalone one; keep every other preamble line.
      sed -i '1s#.*#\\documentclass[tikz,border=2mm]{standalone}#' "$WRAPPER"
    fi
    {
      echo '\begin{document}'
      if [ "$HAS_FIGURE_ENV" -eq 1 ]; then
        echo '\pagestyle{empty}'
        echo "\\newgeometry{textwidth=${TEXTWIDTH_CM}cm,textheight=${TEXTHEIGHT_CM}cm,top=1cm,bottom=1cm}"
      fi
      echo "\\input{figures/$STEM}"
      echo '\end{document}'
    } >> "$WRAPPER"

  else  # research
    REF_PREAMBLE="$PARENT_DIR/tex/preamble.tex"
    cp "$REF_PREAMBLE" "$BUILD/preamble.tex"
    cp "$FRAGMENT_ABS" "$BUILD/$STEM.tex"

    if [ "$HAS_FIGURE_ENV" -eq 1 ]; then
      cat > "$WRAPPER" <<EOF
\documentclass[11pt,a4paper]{article}
\input{preamble}
\usepackage{graphicx}
\begin{document}
\pagestyle{empty}
\newgeometry{textwidth=${TEXTWIDTH_CM}cm,textheight=${TEXTHEIGHT_CM}cm,top=1cm,bottom=1cm}
\input{$STEM.tex}
\end{document}
EOF
    else
      cat > "$WRAPPER" <<EOF
\documentclass[tikz,border=2mm]{standalone}
\input{preamble}
\begin{document}
\input{$STEM.tex}
\end{document}
EOF
    fi
  fi
fi

# --- compile -----------------------------------------------------------------
LOG_CAPTURE="$BUILD/_tectonic_stdout.log"
( cd "$BUILD" && "$TECTONIC" --keep-logs -o "$BUILD" "$(basename "$WRAPPER")" ) >"$LOG_CAPTURE" 2>&1
STATUS=$?

PDF_SRC="$BUILD/$MAIN_JOBNAME.pdf"
LOG_SRC="$BUILD/$MAIN_JOBNAME.log"
[ -f "$LOG_SRC" ] || LOG_SRC="$LOG_CAPTURE"

cp "$LOG_SRC" "$OUT_DIR_ABS/$STEM.log" 2>/dev/null

if [ "$STATUS" -ne 0 ] || [ ! -f "$PDF_SRC" ]; then
  FIRST_ERROR="$(grep -m1 -E '^! ' "$LOG_SRC" 2>/dev/null)"
  [ -z "$FIRST_ERROR" ] && FIRST_ERROR="$(tail -n 20 "$LOG_CAPTURE" 2>/dev/null)"
  echo "compile_fragment.sh: FAILED to compile $FRAGMENT_ABS ($PREAMBLE_MODE mode)" >&2
  echo "$FIRST_ERROR" >&2
  exit 1
fi

cp "$PDF_SRC" "$OUT_DIR_ABS/$STEM.pdf"
echo "compile_fragment.sh: OK -> $OUT_DIR_ABS/$STEM.pdf"
exit 0
