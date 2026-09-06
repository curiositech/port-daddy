#!/usr/bin/env bash
# render_figure.sh -- compile one pd figure fragment IN THE BOOK and render it
# to a cropped PNG you can actually look at.
#
# Why this exists.  Two reasons.
#
#  1. The Book is not the chapter.  The seven chapter roots load `lmodern` on
#     a4 paper; the Book (website-v2/public/whitepaper/coordination-papers-
#     mega-volume-preamble.tex) sets 7 x 10 in paper, a 4.5 in text column and
#     newpxtext (Palatino).  A figure judged in Computer Modern on a4 is not
#     the figure the reader gets, so this script compiles in BOOK mode by
#     default and every exemplar and gallery PNG in this skill was made that
#     way.  Use `--preamble chapter` only to check that a fragment still
#     builds in a standalone chapter.
#  2. harbor-chartwork's compile_fragment.sh needs the fragment to sit beside
#     pd-figure-language.tex with a root in the parent directory.  A template
#     inside a skill bundle sits nowhere near either, so this script stages the
#     fragment into a throwaway copy of the real figures/ directory (the real
#     pd-*.tex files and the real roots, copied, never modified).
#
# Book mode delegates to `compile_fragment.sh --preamble book` when that flag
# exists, and otherwise builds the same wrapper itself; either way the
# preamble is the Book's own file, read at run time, never transcribed.
#
# Usage:
#   render_figure.sh FRAGMENT.tex [--out DIR] [--preamble book|chapter]
#                    [--style v2|v1] [--zoom 1.6] [--repo PATH] [--no-png]
#
# --style v2 (the default) stages the PROPOSED style layer,
# templates/pd-figure-language-v2.tex, over the installed
# pd-figure-language.tex for the duration of the build, so a fragment written
# to the v2 role names compiles before v2 is installed.
#
# Exit status: 0 when precheck, compile and figcheck all pass; non-zero on the
# first failure, with the failing step named on stderr.
#
# Requires: bash, python3 with pymupdf, and a tectonic on PATH (export
# TECTONIC_CACHE_DIR first to reuse a warm cache).
set -u
umask 022

FRAG=""; OUT=""; ZOOM="1.6"; REPO=""; DO_PNG=1; STYLE="v2"; MODE="book"
while [ $# -gt 0 ]; do
  case "$1" in
    --out)      OUT="${2:-}"; shift 2 ;;
    --zoom)     ZOOM="${2:-}"; shift 2 ;;
    --repo)     REPO="${2:-}"; shift 2 ;;
    --style)    STYLE="${2:-}"; shift 2 ;;
    --preamble) MODE="${2:-}"; shift 2 ;;
    --no-png)   DO_PNG=0; shift ;;
    -h|--help)  sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "render_figure.sh: unknown option: $1" >&2; exit 2 ;;
    *)  FRAG="$1"; shift ;;
  esac
done
[ -n "$FRAG" ] || { echo "render_figure.sh: need a FRAGMENT.tex" >&2; exit 2; }
[ -f "$FRAG" ] || { echo "render_figure.sh: no such file: $FRAG" >&2; exit 2; }
case "$MODE" in book|chapter) ;; *) echo "render_figure.sh: --preamble must be book or chapter" >&2; exit 2 ;; esac
case "$STYLE" in v1|v2) ;; *) echo "render_figure.sh: --style must be v1 or v2" >&2; exit 2 ;; esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -n "$REPO" ] || REPO="$(cd "$SCRIPT_DIR/../../.." && pwd)"
CHARTWORK="$REPO/skills/harbor-chartwork/scripts"
BOOKDIR="$REPO/website-v2/public/whitepaper"
CHAPDIR="$REPO/whitepaper"
V2="$SCRIPT_DIR/../templates/pd-figure-language-v2.tex"
for p in "$CHARTWORK/compile_fragment.sh" "$CHARTWORK/figcheck.py" \
         "$CHARTWORK/tikz_precheck.py" "$BOOKDIR/figures/pd-figure-language.tex" \
         "$BOOKDIR/coordination-papers-mega-volume-preamble.tex"; do
  [ -e "$p" ] || { echo "render_figure.sh: expected $p under --repo $REPO" >&2; exit 2; }
done

STEM="$(basename "$FRAG" .tex)"
[ -n "$OUT" ] || OUT="./tdc-build/$STEM"
mkdir -p "$OUT" || exit 2
OUT_ABS="$(cd "$OUT" && pwd)"

echo "--- precheck ---"
python3 "$CHARTWORK/tikz_precheck.py" "$FRAG" || { echo "render_figure.sh: precheck FAILED" >&2; exit 1; }

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/tdc-stage.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT

# A shadow repo: compile_fragment.sh resolves the Book (and the chapter) from
# its OWN location, so copying it into $STAGE/skills/harbor-chartwork/scripts
# makes it read $STAGE/website-v2/... and $STAGE/whitepaper/... instead of the
# tracked tree. That is how --style v2 swaps the proposed style layer in
# without ever writing to a tracked file.
mkdir -p "$STAGE/skills/harbor-chartwork/scripts"
cp "$CHARTWORK/compile_fragment.sh" "$STAGE/skills/harbor-chartwork/scripts/"
if [ "$MODE" = "book" ]; then
  mkdir -p "$STAGE/website-v2/public/whitepaper/figures"
  cp "$BOOKDIR"/figures/pd-*.tex "$STAGE/website-v2/public/whitepaper/figures/"
  cp "$BOOKDIR"/coordination-papers-mega-volume*.tex "$STAGE/website-v2/public/whitepaper/"
  FIGSTAGE="$STAGE/website-v2/public/whitepaper/figures"
else
  mkdir -p "$STAGE/whitepaper/figures"
  cp "$CHAPDIR"/figures/pd-*.tex "$STAGE/whitepaper/figures/"
  cp "$CHAPDIR"/*.tex "$STAGE/whitepaper/" 2>/dev/null || true
  FIGSTAGE="$STAGE/whitepaper/figures"
fi
if [ "$STYLE" = "v2" ]; then
  [ -f "$V2" ] || { echo "render_figure.sh: missing $V2" >&2; exit 2; }
  cp "$V2" "$FIGSTAGE/pd-figure-language.tex"
  echo "style layer: v2 (proposed, staged from templates/pd-figure-language-v2.tex)"
else
  echo "style layer: v1 (as installed)"
fi
cp "$FRAG" "$FIGSTAGE/$STEM.tex"

echo "--- compile (preamble: $MODE) ---"
grep -q 'PREAMBLE_MODE" = "book"' "$CHARTWORK/compile_fragment.sh" || {
  echo "render_figure.sh: this compile_fragment.sh has no --preamble book; update it" >&2
  [ "$MODE" = "book" ] && exit 2; }
bash "$STAGE/skills/harbor-chartwork/scripts/compile_fragment.sh" "$FIGSTAGE/$STEM.tex" \
     --preamble "$MODE" --out "$OUT_ABS" \
  || { echo "render_figure.sh: compile FAILED" >&2; exit 1; }
echo "compiled by: compile_fragment.sh --preamble $MODE"

# The Book preamble catches an over-wide picture and rescales it into the
# margin column rather than letting it run off the page. That is a safety net,
# not a licence: a pd-book line in the log means the fragment does not fit the
# 4.5 in measure and must be redrawn narrower.
if [ "$MODE" = "book" ] && grep -q 'pd-book' "$OUT_ABS/$STEM.log" 2>/dev/null; then
  echo "render_figure.sh: the Book rescaled this picture -- it is wider than the measure:" >&2
  grep -m3 'pd-book' "$OUT_ABS/$STEM.log" >&2
  exit 1
fi
echo "pd-book warnings in the log: none"

echo "--- figcheck ---"
python3 "$CHARTWORK/figcheck.py" "$OUT_ABS/$STEM.pdf" --textwidth-cm 11.43 \
        --json "$OUT_ABS/$STEM.figcheck.json" >/dev/null \
  || { echo "render_figure.sh: figcheck FAILED (see $OUT_ABS/$STEM.figcheck.json)" >&2; exit 1; }
python3 - "$OUT_ABS/$STEM.figcheck.json" <<'PY'
import json, sys
s = json.load(open(sys.argv[1]))["summary"]
print("figcheck: %s  failed=%s warned=%s" % (s["result"], s["failed_checks"] or "-", s["warned_checks"] or "-"))
PY

if [ "$DO_PNG" -eq 1 ]; then
  echo "--- png ---"
  python3 - "$OUT_ABS/$STEM.pdf" "$OUT_ABS/$STEM.png" "$ZOOM" <<'PY'
import re, sys
import pymupdf
src, dst, zoom = sys.argv[1], sys.argv[2], float(sys.argv[3])
page = pymupdf.open(src)[0]
CAPTION = re.compile(r"^\s*(Figure|Table)\s+\d+", re.I)
art = pymupdf.Rect(1e9, 1e9, -1e9, -1e9)   # the picture: drawings + non-caption text
whole = pymupdf.Rect(1e9, 1e9, -1e9, -1e9) # everything, for the crop
for d in page.get_drawings():
    art |= d["rect"]; whole |= d["rect"]
for b in page.get_text("blocks"):
    r = pymupdf.Rect(b[:4]); whole |= r
    if not CAPTION.match(b[4] or ""):
        art |= r
if whole.is_empty or whole.is_infinite:
    whole = page.rect
crop = (whole + (-6, -6, 6, 6)) & page.rect
pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), clip=crop, alpha=False)
pix.save(dst)
w = art.width
print("png: %s  %dx%d px  picture %.1f pt wide (%.2f in)" % (dst, pix.width, pix.height, w, w / 72.0))
if w > 325.0:
    print("WARNING: the picture is %.1f pt wide, over the 325 pt (4.5 in) measure" % w)
PY
fi
echo "OK: $STEM"
