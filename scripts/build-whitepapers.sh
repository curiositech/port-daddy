#!/usr/bin/env bash
#
# build-whitepapers.sh — rebuild every published whitepaper PDF from its
# LaTeX source, reproducibly.
#
# Why this exists: the published PDFs under website-v2/public/whitepaper/ are
# the artifacts the website serves and people download. They are NOT rebuilt
# automatically when the .tex or figures change, so they drift (e.g. the
# trilogy PDFs shipped a June-3 render with retired cinnabar after the source
# moved to cobalt on June 11). This script is the single source of truth for
# turning source -> PDF; CI runs it and commits the result.
#
# Reproducibility: each paper's embedded /CreationDate (and the PDF /ID) is
# pinned to the last source commit's author time via SOURCE_DATE_EPOCH +
# FORCE_SOURCE_DATE. Author time survives GitHub's rebase merge; committer time
# does not. So a given source tree renders byte-identically before and after it
# enters main, which makes the CI drift guard meaningful.
#
# Usage:
#   scripts/build-whitepapers.sh            # build all papers
#   scripts/build-whitepapers.sh federated-harbor-whitepaper   # build one (by root basename)
#   scripts/build-whitepapers.sh --changed-since <git-ref>      # build papers whose imported TeX changed
#
# Requires: latexmk + pdflatex (TeX Live). No bibtex/biber — all papers embed
# \begin{thebibliography}.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PUB="website-v2/public/whitepaper"
BUILD_DIR="$(mktemp -d)"
trap 'rm -rf "$BUILD_DIR"' EXIT

# paper table: "<srcdir>|<root.tex>|<dest published pdf path>"
PAPERS=(
  "$PUB|agent-transactions-whitepaper.tex|$PUB/agent-transactions-whitepaper.pdf"
  "$PUB|anchor-protocol-whitepaper.tex|$PUB/anchor-protocol-whitepaper.pdf"
  "$PUB|federated-harbor-whitepaper.tex|$PUB/federated-harbor-whitepaper.pdf"
  "$PUB|harbor-economy.tex|$PUB/harbor-economy-whitepaper.pdf"
  "$PUB|spawn-to-person.tex|$PUB/spawn-to-person-whitepaper.pdf"
  "whitepaper|legible-swarm.tex|$PUB/legible-swarm-whitepaper.pdf"
  "whitepaper|single-writer-kernel.tex|$PUB/single-writer-kernel-whitepaper.pdf"
)

CHANGED_SINCE=""
if [ "${1:-}" = "--changed-since" ]; then
  [ -n "${2:-}" ] || { echo "--changed-since requires a git ref" >&2; exit 2; }
  CHANGED_SINCE="$2"
  shift 2
fi
FILTER="${1:-}"
FAILED=()
BUILT=()

# Print the transitive TeX source set for one paper. Figure files share a
# directory across several papers, so the directory itself is deliberately not
# a dependency: changing fig-stp-* must not retimestamp every other PDF.
paper_sources() {
  local srcdir="$1" roottex="$2"
  local pending=("$roottex")
  local seen="|" rel full ref index=0

  while [ "$index" -lt "${#pending[@]}" ]; do
    rel="${pending[$index]}"
    index=$((index + 1))
    case "$seen" in
      *"|$rel|"*) continue ;;
    esac
    seen="${seen}${rel}|"
    full="$srcdir/$rel"
    [ -f "$full" ] || continue
    printf '%s\n' "$full"

    while IFS= read -r ref; do
      case "$ref" in
        *.tex) ;;
        *) ref="$ref.tex" ;;
      esac
      [ -f "$srcdir/$ref" ] && pending+=("$ref")
    done < <(perl -ne 'while (/\\(?:input|include)\{([^}]+)\}/g) { print "$1\n" }' "$full")
  done
}

# Deterministic per-paper epoch: author time of the latest commit touching the
# paper's root tex or one of its transitive \input / \include dependencies.
# Author time is stable across rebase merges. Falls back to the repo HEAD author
# time, then to a fixed constant, so builds remain reproducible outside git.
paper_epoch() {
  local srcdir="$1" roottex="$2" epoch=""
  local sources=()
  while IFS= read -r source; do
    sources+=("$source")
  done < <(paper_sources "$srcdir" "$roottex")
  epoch="$(git log -1 --format=%at HEAD -- "${sources[@]}" 2>/dev/null || true)"
  [ -z "$epoch" ] && epoch="$(git log -1 --format=%at HEAD 2>/dev/null || true)"
  [ -z "$epoch" ] && epoch="1700000000"
  printf '%s' "$epoch"
}

paper_changed_since() {
  local base_ref="$1" srcdir="$2" roottex="$3"
  local sources=()
  while IFS= read -r source; do
    sources+=("$source")
  done < <(paper_sources "$srcdir" "$roottex")
  ! git diff --quiet "$base_ref"...HEAD -- "${sources[@]}"
}

build_one() {
  local srcdir="$1" roottex="$2" dest="$3"
  local base="${roottex%.tex}"
  local outdir="$BUILD_DIR/$base"
  mkdir -p "$outdir"

  local epoch; epoch="$(paper_epoch "$srcdir" "$roottex")"
  echo "::group::build $roottex  (SOURCE_DATE_EPOCH=$epoch)"
  (
    cd "$srcdir"
    export SOURCE_DATE_EPOCH="$epoch" FORCE_SOURCE_DATE=1
    latexmk -pdf -interaction=nonstopmode -halt-on-error -file-line-error \
            -outdir="$outdir" "$roottex"
  )
  local rc=$?
  if [ $rc -ne 0 ] || [ ! -f "$outdir/$base.pdf" ]; then
    echo "::error::latexmk failed for $roottex (rc=$rc)"
    # surface the tail of the log to the CI console
    [ -f "$outdir/$base.log" ] && tail -40 "$outdir/$base.log" || true
    echo "::endgroup::"
    return 1
  fi
  cp "$outdir/$base.pdf" "$dest"
  echo "wrote $dest ($(wc -c < "$dest") bytes)"
  echo "::endgroup::"
  return 0
}

main() {
  local row srcdir roottex dest base
  for row in "${PAPERS[@]}"; do
    IFS='|' read -r srcdir roottex dest <<< "$row"
    base="${roottex%.tex}"
    if [ -n "$FILTER" ] && [ "$FILTER" != "$base" ] && [ "$FILTER" != "${dest##*/}" ]; then
      continue
    fi
    if [ -n "$CHANGED_SINCE" ] && ! paper_changed_since "$CHANGED_SINCE" "$srcdir" "$roottex"; then
      echo "skip $roottex (no imported TeX changed since $CHANGED_SINCE)"
      continue
    fi
    if build_one "$srcdir" "$roottex" "$dest"; then
      BUILT+=("$dest")
    else
      FAILED+=("$roottex")
    fi
  done

  echo ""
  echo "built ${#BUILT[@]} PDF(s); ${#FAILED[@]} failure(s)"
  if [ "${#FAILED[@]}" -ne 0 ]; then
    printf '  FAILED: %s\n' "${FAILED[@]}"
    exit 1
  fi
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi
