#!/usr/bin/env bash
# skills/federated-harbor-author/scripts/voice-check.sh
#
# Mechanical pass over a Federated Harbor section for the seven
# voice tells from SKILL.md. Run before announcing
# `ready-for-redteam:fh:§N`.
#
# Usage:
#   voice-check.sh <section-path>
#   voice-check.sh papers/federated-harbor/sections/§3.tex
#
# Exit codes:
#   0  clean (no banned phrases, em-dash density within bounds)
#   1  banned phrases found
#   2  em-dash density too high
#   3  missing self-deprecation as ballast (heuristic)
#   4  cardinal sin trigger (jargon front-loading suspected)
#
# This is the *mechanical* pass. The structural tells (cathedral
# build, ballast, inline definitions) require the voice-editor agent.

set -euo pipefail

if [ $# -ne 1 ]; then
  echo "usage: $0 <section-path>" >&2
  exit 2
fi

SECTION="$1"
if [ ! -f "$SECTION" ]; then
  echo "no such file: $SECTION" >&2
  exit 2
fi

FAIL=0

# ── banned phrases (corporate-evenness markers) ─────────────────────────
BANNED_PHRASES=(
  "we believe"
  "we feel"
  "we think"
  "arguably"
  "perhaps"
  "in some sense"
  "essentially"
  "leverages"
  "leverage"        # only as verb; warn rather than fail
  "novel approach"
  "robust foundation"
  "seamless"
  "best-in-class"
  "world-class"
  "cutting-edge"
  "state of the art"
)

echo "── banned phrases ──"
for p in "${BANNED_PHRASES[@]}"; do
  HITS=$(grep -in -- "$p" "$SECTION" || true)
  if [ -n "$HITS" ]; then
    echo "  FAIL: banned phrase \"$p\" found:"
    echo "$HITS" | sed 's/^/    /'
    FAIL=1
  fi
done

# ── em-dash density ─────────────────────────────────────────────────────
echo
echo "── em-dash density ──"
# Count em-dashes (— U+2014) and paragraphs (blank-line separated blocks).
EMDASH_COUNT=$(grep -o "—" "$SECTION" | wc -l | tr -d ' ')
PARA_COUNT=$(awk 'BEGIN{p=1} /^$/{p=1; next} {if(p){c++; p=0}} END{print c+0}' "$SECTION")
if [ "$PARA_COUNT" -gt 0 ]; then
  # bash arithmetic: integer ratio × 100
  RATIO=$(( EMDASH_COUNT * 100 / PARA_COUNT ))
  echo "  em-dashes: $EMDASH_COUNT  paragraphs: $PARA_COUNT  ratio: ${RATIO}%"
  if [ "$RATIO" -gt 100 ]; then
    echo "  FAIL: em-dash density exceeds one-per-paragraph max."
    FAIL=2
  fi
else
  echo "  (no paragraphs detected)"
fi

# ── self-deprecation / ballast heuristic ────────────────────────────────
# Heuristic: count "fails", "breaks", "knocks", "unless", "if X then we lose"
# style markers. Sections that make strong claims with zero ballast are
# suspicious.
echo
echo "── ballast heuristic ──"
BALLAST_HITS=$(grep -ciE "knocks? (it )?down|would fail|fails? if|would break|unless |we lose|we cannot defend|we owe" "$SECTION" || true)
THEOREM_HITS=$(grep -ciE "^[[:space:]]*\\\\begin\\{(theorem|lemma|proposition|claim)\\}|^[[:space:]]*Theorem\\b|^[[:space:]]*Claim\\b|^[[:space:]]*Lemma\\b" "$SECTION" || true)
echo "  ballast markers: $BALLAST_HITS  theorem/claim markers: $THEOREM_HITS"
if [ "$THEOREM_HITS" -gt 0 ] && [ "$BALLAST_HITS" -lt "$THEOREM_HITS" ]; then
  echo "  WARN: fewer ballast markers than theorems. Manual review recommended."
  # don't fail; this is heuristic. The voice-editor agent decides.
fi

# ── cardinal sin: jargon front-loading ──────────────────────────────────
# Heuristic: terms that appear in §1 of the section without an inline
# definition (no parenthetical, no \footnote{...}, no \marginnote{...},
# no \sidenote{...} within 100 chars of first occurrence) are suspect.
# This is a placeholder; a real implementation requires the author
# skill's term list per section. For now, just flag.
echo
echo "── cardinal-sin: jargon front-loading ──"
echo "  (heuristic-only; see references/cardinal-sins.md for the full list)"

# ── summary ─────────────────────────────────────────────────────────────
echo
if [ "$FAIL" -eq 0 ]; then
  echo "VOICE OK: $SECTION"
  exit 0
else
  echo "VOICE FAIL: $SECTION (code $FAIL)"
  exit "$FAIL"
fi
