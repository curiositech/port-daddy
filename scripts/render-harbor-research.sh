#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
sources=(
  docs/harbor-research/tex
  docs/harbor-research/figures
  docs/harbor-research/Makefile
)

# Keep pdflatex's CreationDate stable across rebuilds of unchanged source. Use
# author time because it survives GitHub rebase merges; an unrelated commit or
# the workflow's own regenerated-PDF commit must not mint different bytes.
epoch="$(
  git -C "$repo_root" log --format=%at HEAD -- "${sources[@]}" 2>/dev/null \
    | awk 'BEGIN { max = 0 } $1 > max { max = $1 } END { if (max > 0) print max }' \
    || true
)"
[ -z "$epoch" ] && epoch="$(git -C "$repo_root" log -1 --format=%at HEAD 2>/dev/null || true)"
[ -z "$epoch" ] && epoch="1700000000"

export SOURCE_DATE_EPOCH="$epoch" FORCE_SOURCE_DATE=1
echo "Rendering Harbor research PDFs with SOURCE_DATE_EPOCH=$SOURCE_DATE_EPOCH"
exec make -C "$repo_root/docs/harbor-research" docs
