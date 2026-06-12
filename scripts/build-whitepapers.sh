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
# pinned to the last git commit time of that paper's sources via
# SOURCE_DATE_EPOCH + FORCE_SOURCE_DATE. So a given source tree always renders
# byte-identical bits, which is what makes the CI drift-guard meaningful: if a
# rebuilt PDF differs from the committed one, the source genuinely changed and
# the committed PDF is stale.
#
# Usage:
#   scripts/build-whitepapers.sh            # build all papers
#   scripts/build-whitepapers.sh federated-harbor-whitepaper   # build one (by root basename)
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

FILTER="${1:-}"
FAILED=()
BUILT=()

# Deterministic per-paper epoch: latest commit touching the paper's root tex or
# the figures directory in its source tree. Falls back to repo HEAD time, then
# to a fixed constant, so the build is reproducible even outside a git checkout.
paper_epoch() {
  local srcdir="$1" roottex="$2" epoch=""
  epoch="$(git log -1 --format=%ct HEAD -- "$srcdir/$roottex" "$srcdir/figures" 2>/dev/null || true)"
  [ -z "$epoch" ] && epoch="$(git log -1 --format=%ct HEAD 2>/dev/null || true)"
  [ -z "$epoch" ] && epoch="1700000000"
  printf '%s' "$epoch"
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

for row in "${PAPERS[@]}"; do
  IFS='|' read -r srcdir roottex dest <<< "$row"
  base="${roottex%.tex}"
  if [ -n "$FILTER" ] && [ "$FILTER" != "$base" ] && [ "$FILTER" != "${dest##*/}" ]; then
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
