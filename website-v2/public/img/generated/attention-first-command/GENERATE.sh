#!/usr/bin/env bash
# Regenerate hero + inline illustrations for the post:
#   src/data/blog/attention-is-the-first-command.md
#
# The original art was warm-painterly oak-and-brass photorealism, which is
# OFF the portdaddy.dev blog house style. The house style (see sibling
# pr-reviews-itself/ and tube-multiplex/) is flat Swiss-modern blueprint
# editorial illustration. This script re-renders the same metaphors
# (post office full of unread mail; the SessionStart peephole; tool-call
# vs. hook delivery) in that style.
#
# Per ~/.claude/CLAUDE.md: nano-banana is the default. Sequential only.
#
# Usage:
#   export GEMINI_API_KEY=$(grep "^GEMINI_API_KEY=" \
#     ~/coding/jbuds4life/next-app/.env.local | cut -d= -f2-)
#   bash GENERATE.sh

set -euo pipefail

OUT=/Users/erichowens/coding/port-daddy/website-v2/public/img/generated/attention-first-command
SCRIPT=~/.claude/skills/nano-banana-image-gen/scripts/generate.py
STYLE="Flat Swiss-modern blueprint editorial illustration. Cream paper background #f2eee6 with crisp cobalt blue line work #003fb8, deep teal-sage accents #006b5f, near-black #1f1f1f outlines. Hand-lettered italic serif labels. Architectural blueprint hatching in negative space. No painterly gradients, no photo realism, no wood textures — flat clean lines, like a Tufte diagram crossed with a children's-book scene."

gen () {
  local name="$1"; local scene="$2"; local aspect="${3:-1:1}"
  python3 "$SCRIPT" --scene "$STYLE $scene" --out "$OUT/$name" --aspect "$aspect"
}

# 1. Hero — the full mailbox nobody is checking
gen hero.png \
  "Wide horizontal scene of a small-town post office, drawn flat and clean. On the left, a clerk in a cap stands behind a counter sliding a single letter into a tall wall of hundreds of pigeonholes, each pigeonhole labeled with a tiny agent name in italic hand-lettering. On the right, three tall closed doors with frosted-glass panels, hand-lettered: 'CLAUDE CODE', 'GEMINI CLI', 'CODEX CLI'. No one stands behind the doors. Drifts of unopened envelopes pile up on the floor in front of all three doors. Blueprint hatching fills the upper negative space. Banner across the top in larger architectural lettering: 'NOBODY WAS CHECKING THE MAIL.'" \
  16:9

# 2. peephole — the SessionStart hook as a peephole into the mailroom
gen peephole.png \
  "A clean cutaway diagram of a single wooden door at the end of a short hallway, drawn flat in line work. A small round brass peephole is set at eye level, rendered as a precise circle with cobalt rim. A freshly-installed plaque on the near (operator) side of the door reads, in hand-lettered italic: 'SessionStart'. Through the peephole, drawn as an inset circular view, the post office mailroom is faintly visible: the clerk and the wall of pigeonholes. A single envelope is being slid through a thin mail slot beneath the plaque. Blueprint dimension lines and hatching in the negative space." \
  3:2

# 3. mcp-vs-hook — split pane: model decides vs. delivered upstream
gen mcp-vs-hook.png \
  "A split-pane editorial diagram divided by a single vertical cobalt rule. LEFT panel labeled 'TOOL THE MODEL MUST CHOOSE': a simple seated figure at a desk surrounded by four labeled tool tiles in italic hand-lettering — 'pd_status', 'pd_claim', 'pd_session_start', 'pd_attention' — the figure reaches hesitantly toward the 'pd_attention' tile, a thought bubble above showing a single question mark. RIGHT panel labeled 'DELIVERED BEFORE THE TURN': the same desk, but the tool tiles are gone; instead an open window above the desk lets an unseen hand pass in a paper note labeled 'SessionStart', and the note has already landed on the empty desk before the figure sits down. Flat clean lines, blueprint hatching in the margins." \
  16:9

echo "Done. Verify each PNG is on-brand (flat blueprint, cream+cobalt+teal) before committing." >&2
