#!/usr/bin/env bash
# Regenerate the imagery for the post:
#   src/data/blog/attention-is-the-first-command.md
#
# Per ~/.claude/CLAUDE.md: nano-banana (Gemini) is the default. Sequential only.
# Style: flat Swiss-modern blueprint. Cream paper #f2eee6, cobalt #003fb8,
# teal-sage #006b5f, near-black #1f1f1f, sparing lime-green accent tick.
#
# Usage:
#   export GEMINI_API_KEY=$(grep "^GEMINI_API_KEY=" \
#     ~/coding/jbuds4life/next-app/.env.local | cut -d= -f2-)
#   bash GENERATE.sh
set -euo pipefail

OUT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT=~/.claude/skills/nano-banana-image-gen/scripts/generate.py
STYLE="Flat Swiss-modern blueprint editorial illustration. Cream paper background #f2eee6 with a faint grid, crisp cobalt blue line work #003fb8, deep teal-sage accents #006b5f, near-black #1f1f1f outlines, a small lime-green accent tick used sparingly. Architectural blueprint hatching in negative space. No painterly gradients, no photorealism, flat technical line art like a Tufte diagram. No stray text or gibberish lettering."

gen () { local name="$1"; local scene="$2"; local aspect="${3:-16:9}"
  python3 "$SCRIPT" --scene "$STYLE $scene" --out "$OUT/$name" --aspect "$aspect"; }

# Hero — a post office sorting wall full of letters, three closed service
# doors, nobody collecting: delivery works, attention doesn't.
gen hero.png \
  "Wide horizontal cutaway of a post office drawn as an architectural elevation. LEFT: a tall wall grid of pigeonhole mailboxes, many slots stuffed with letters drawn as small cobalt rectangles, a small clerk figure (simple flat line figure) sliding one more letter in. RIGHT: three identical closed doors drawn in elevation with hatched panels, each door silent and unattended, a growing drift of undelivered letters piling on the floor in front of them. Letters keep arriving but no door ever opens. Reads instantly as: the mail system works perfectly, yet nobody is checking their mail." \
  16:9

# Inline 1 — the peephole: a SessionStart hook drilled into the door so the
# inbox is seen before the session begins.
gen peephole.png \
  "Architectural cutaway detail of a single closed door at the end of a short hallway, drawn in section view. Set into the door at eye level is a small round peephole lens with sight-lines drawn as thin cobalt rays passing THROUGH the door, landing on a wall of pigeonhole mailboxes on the far side. Beneath the peephole, a thin horizontal mail slot with a single envelope mid-slide passing through it into the room. The door never opens; the looking and the delivery both happen through fixtures built into the door itself." \
  16:9

# Inline 2 — MCP tool vs hook: the model choosing to check mail vs the mail
# being delivered upstream of any choice.
gen mcp-vs-hook.png \
  "Two-panel diptych split by a thin vertical rule. LEFT panel (opt-in, unreliable): a simple flat figure seated at a drafting desk, an array of four identical small tool cards laid out in front, one hand hovering hesitantly above the LAST tool card, a dotted question-mark thought path curling above its head — checking the mailbox is a choice it may never make. RIGHT panel (delivered, guaranteed): the same desk and figure, the tool cards gone; above the desk an open transom window through which an envelope is dropping directly onto the center of the desk before the figure has even picked up a pen. A small lime-green tick beside the landing envelope. Reads instantly as: on the left attention is optional, on the right attention arrives first." \
  16:9

echo "Done. Audit each PNG looks on-brand before committing." >&2
