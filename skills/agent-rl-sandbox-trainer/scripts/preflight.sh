#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-.}"

echo "# Preflight"
echo "target: $TARGET"
echo "pwd: $(pwd)"
echo

if command -v git >/dev/null 2>&1 && git -C "$TARGET" rev-parse --git-dir >/dev/null 2>&1; then
  echo "## Git Status"
  git -C "$TARGET" status --short
  echo
else
  echo "## Git Status"
  echo "not a git repository"
  echo
fi

echo "## Top-Level Entries"
find "$TARGET" -maxdepth 2 -mindepth 1 | sed 's#^\./##' | sort | head -200
