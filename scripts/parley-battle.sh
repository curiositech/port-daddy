#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  PARLEY BATTLE — a Port Daddy commercial, staged in tmux.
#
#  Two agents start work in separate panes, neither aware of the other. They
#  claim the same file. Port Daddy notices, alerts both, and pulls them into a
#  parley — rendered as a creature-battle encounter, because that is genuinely
#  what the coordination layer does: two entities discover each other, a wild
#  encounter fires, and they resolve it in turns instead of by force.
#
#  WHAT IS REAL HERE. The command text, the flow, and the ordering are the real
#  coordination path: claim → overlap detected → arrival briefing names the
#  neighbour → parley call → parley respond → parley resolve. In the default
#  mode the OUTPUT is staged, so the commercial runs anywhere with no daemon.
#  Pass --live to run the real `pd` commands against a running daemon instead;
#  the script then shows whatever actually happens, including nothing.
#
#  Usage:
#    scripts/parley-battle.sh              # staged demo (no daemon needed)
#    scripts/parley-battle.sh --live       # drive the real daemon
#    scripts/parley-battle.sh --speed 0.5  # half-speed for recording
#    scripts/parley-battle.sh --attach     # stay attached when it ends
#    scripts/parley-battle.sh --wait       # block until it finishes (recording/CI)
#    scripts/parley-battle.sh --capture DIR # + write each pane's final frame
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

# Box borders are drawn by counting string length, and `${#s}` counts BYTES
# under a C locale — so every multibyte glyph in a banner (·, —, ⚠, █) would
# pull the right-hand border one column left. Containers routinely ship with no
# LANG set at all, which is exactly where this bites. Pin a UTF-8 locale if one
# is available and fall back quietly if not.
if [ -z "${LC_ALL:-}" ] && [ -z "${LANG:-}" ]; then
  for _loc in C.UTF-8 C.utf8 en_US.UTF-8; do
    if locale -a 2>/dev/null | grep -qix "${_loc}"; then export LC_ALL="$_loc"; break; fi
  done
  unset _loc
fi

SESSION="parley-battle"
SPEED="${SPEED:-1}"
LIVE=0
ATTACH=0
WAIT=0
CAPTURE_DIR=""

while [ $# -gt 0 ]; do
  case "$1" in
    --live)   LIVE=1 ;;
    --attach) ATTACH=1 ;;
    --wait)   WAIT=1 ;;
    --capture) shift; CAPTURE_DIR="${1:-}"; WAIT=1 ;;
    --speed)  shift; SPEED="${1:-1}" ;;
    --help|-h)
      sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
  shift
done

command -v tmux >/dev/null || { echo "parley-battle: tmux is required" >&2; exit 1; }

SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"

# ── The child process: everything below runs INSIDE a tmux pane ──────────────
# Re-entering ourselves with a role argument keeps the whole commercial in one
# file, so there is nothing to keep in sync across three scripts.
if [ "${PB_ROLE:-}" != "" ]; then
  # ── palette ────────────────────────────────────────────────────────────────
  R=$'\033[0m'; B=$'\033[1m'; D=$'\033[2m'
  RED=$'\033[38;5;203m'; GRN=$'\033[38;5;114m'; YEL=$'\033[38;5;221m'
  BLU=$'\033[38;5;75m';  MAG=$'\033[38;5;177m'; CYN=$'\033[38;5;80m'
  WHT=$'\033[38;5;255m'; ORG=$'\033[38;5;215m'; GRY=$'\033[38;5;244m'
  BG_D=$'\033[48;5;236m'

  # Every sleep in the commercial goes through here so --speed scales all of it.
  nap() { awk -v s="$1" -v m="$SPEED" 'BEGIN{ t=s*m; if (t>0) system("sleep " t) }'; }

  # Typewriter, because a command that appears instantly reads as a screenshot.
  type_out() {
    local text="$1" delay="${2:-0.018}"
    local i ch
    for (( i=0; i<${#text}; i++ )); do
      ch="${text:$i:1}"
      printf '%s' "$ch"
      awk -v s="$delay" -v m="$SPEED" 'BEGIN{ t=s*m; if (t>0) system("sleep " t) }'
    done
    printf '\n'
  }

  prompt() { printf '%s%s%s %s$%s ' "$D" "$1" "$R" "$B$GRN" "$R"; }

  # An HP-style meter. Used for context budget, which is the resource an agent
  # actually spends — the joke lands because the metaphor is nearly literal.
  meter() {
    local label="$1" cur="$2" max="$3" color="$4"
    local width=20 filled empty i bar=""
    filled=$(( cur * width / max )); empty=$(( width - filled ))
    for (( i=0; i<filled; i++ )); do bar="${bar}█"; done
    for (( i=0; i<empty;  i++ )); do bar="${bar}░"; done
    printf '%s%-7s%s %s%s%s %s%d/%d%s\n' "$B$WHT" "$label" "$R" "$color" "$bar" "$R" "$D" "$cur" "$max" "$R"
  }

  # Box-drawn banner.
  #
  # Pads manually rather than with `printf %-Ns`: these lines contain multibyte
  # glyphs (·, —, ⚠) and printf pads to a BYTE count, so every interpunct in a
  # line pulls the right-hand border one column left. `${#s}` counts characters
  # under a UTF-8 locale, which is the number the border actually cares about.
  # Width is also derived from the content instead of hardcoded, so a line
  # longer than the box widens it rather than punching through it.
  banner() {
    local color="$1"; shift
    local lines=("$@") w=0 s pad i rule=""
    for s in "${lines[@]}"; do (( ${#s} > w )) && w=${#s}; done
    (( w < 36 )) && w=36
    for (( i=0; i<w+2; i++ )); do rule="${rule}═"; done

    printf '%s%s╔%s╗%s\n' "$B" "$color" "$rule" "$R"
    for s in "${lines[@]}"; do
      pad=""
      for (( i=${#s}; i<w; i++ )); do pad="${pad} "; done
      printf '%s%s║%s %s%s %s%s║%s\n' "$B" "$color" "$R" "$s" "$pad" "$B" "$color" "$R"
    done
    printf '%s%s╚%s╝%s\n' "$B" "$color" "$rule" "$R"
  }

  # Run a pd command for real (--live) or print a staged result.
  # Keeping both behind one helper is what stops the staged path from silently
  # drifting away from the command it claims to be showing.
  do_cmd() {
    local cmd="$1"; shift
    prompt "~/port-daddy"; type_out "$cmd"
    if [ "$LIVE" = "1" ]; then
      eval "$cmd" 2>&1 | sed 's/^/  /'
    else
      printf '%s\n' "$@"
    fi
    nap 0.5
  }

  clear

  case "$PB_ROLE" in
  # ── ALPHA ────────────────────────────────────────────────────────────────
  alpha)
    printf '%s%s AGENT ALPHA %s %sbackend · reconcile loop%s\n\n' "$BG_D$B$CYN" "" "$R" "$D" "$R"
    meter "CONTEXT" 180 200 "$GRN"
    printf '\n'
    nap 0.6

    do_cmd "pd begin 'wire the reconcile loop producers'" \
      "  ${GRN}✓${R} session ${B}sess-a41${R} started" \
      "  ${D}actor: alpha · project: port-daddy${R}"

    do_cmd "pd claim lib/squid/reconcile.ts" \
      "  ${GRN}✓${R} claimed ${B}lib/squid/reconcile.ts${R}"

    nap 1.6
    printf '\n%s%s ⚡ INCOMING %s\n' "$B$YEL" "" "$R"
    nap 0.4
    banner "$YEL" "A wild AGENT BETA appeared!" "" "It is editing YOUR file."
    nap 0.9
    printf '\n%s→ Port Daddy is summoning a parley…%s\n' "$D" "$R"
    nap 1.4

    do_cmd "pd parley respond p-7 --performative propose \\
        --text 'I take the producers, you take the GC'" \
      "  ${GRN}✓${R} response recorded ${D}(round 1/3)${R}"

    nap 1.2
    printf '\n'
    meter "CONTEXT" 152 200 "$GRN"
    banner "$GRN" "PARLEY COLLAPSED — agreement" "" "Boundary drawn. No merge conflict."
    ;;

  # ── BETA ─────────────────────────────────────────────────────────────────
  beta)
    nap 1.2
    printf '%s%s AGENT BETA %s %srefactor · squid matrix%s\n\n' "$BG_D$B$MAG" "" "$R" "$D" "$R"
    meter "CONTEXT" 140 200 "$GRN"
    printf '\n'
    nap 0.5

    do_cmd "pd begin 'garbage-collect stale matrix keys'" \
      "  ${GRN}✓${R} session ${B}sess-b09${R} started"

    do_cmd "pd claim lib/squid/reconcile.ts" \
      "  ${YEL}!${R} ${B}lib/squid/reconcile.ts${R} is also held by ${B}${CYN}alpha${R}" \
      "  ${D}claim granted — overlap recorded${R}"

    nap 0.8
    printf '\n%s%s ⚡ INCOMING %s\n' "$B$YEL" "" "$R"
    nap 0.4
    banner "$YEL" "A wild AGENT ALPHA appeared!" "" "Same file. Different goal."
    nap 1.0

    do_cmd "pd arrive" \
      "  ${B}⚓ Port Daddy — arrival briefing${R}" \
      "" \
      "  ${B}Agents on adjacent work:${R}" \
      "    • ${B}${CYN}alpha${R} — wire the reconcile loop producers" \
      "      ${D}(editing reconcile.ts)${R}" \
      "    ${D}→ pd parley call alpha --reason \"...\"${R}"

    nap 1.0
    do_cmd "pd parley call alpha --reason 'both editing reconcile.ts'" \
      "  ${GRN}✓${R} parley ${B}p-7${R} summoned ${D}· round limit 3${R}"

    nap 2.2
    do_cmd "pd parley respond p-7 --performative agree \\
        --text 'deal — GC is mine'" \
      "  ${GRN}✓${R} response recorded ${D}(round 2/3)${R}"

    nap 0.8
    printf '\n'
    meter "CONTEXT" 118 200 "$YEL"
    banner "$GRN" "PARLEY COLLAPSED — agreement" "" "Both agents continue. Nothing lost."
    ;;

  # ── PORT DADDY (narrator / referee) ──────────────────────────────────────
  daddy)
    printf '%s%s ⚓ PORT DADDY %s %sthe coordination daemon%s\n' "$BG_D$B$ORG" "" "$R" "$D" "$R"
    printf '%s%s%s\n' "$D" "────────────────────────────────────────────────────────────────────────" "$R"
    nap 2.2

    printf '%s[reconcile]%s tick · 2 active sessions · 0 overlaps\n' "$BLU" "$R"; nap 2.6
    printf '%s[claims]%s   %slib/squid/reconcile.ts%s ← alpha\n' "$BLU" "$R" "$D" "$R"; nap 1.4
    printf '%s[claims]%s   %slib/squid/reconcile.ts%s ← beta  %s⚠ OVERLAP%s\n' "$BLU" "$R" "$D" "$R" "$B$RED" "$R"
    nap 0.7

    printf '\n'
    printf '%s        ██╗   ██╗███████╗%s\n' "$B$RED" "$R"
    printf '%s        ██║   ██║██╔════╝%s\n' "$B$RED" "$R"
    printf '%s        ██║   ██║███████╗%s\n' "$B$RED" "$R"
    printf '%s        ╚██╗ ██╔╝╚════██║%s\n' "$B$RED" "$R"
    printf '%s         ╚████╔╝ ███████║%s\n' "$B$RED" "$R"
    printf '%s          ╚═══╝  ╚══════╝%s\n' "$B$RED" "$R"
    printf '\n'
    printf '   %sALPHA%s   %svs%s   %sBETA%s\n' "$B$CYN" "$R" "$D" "$R" "$B$MAG" "$R"
    printf '   %sreconcile.ts%s\n\n' "$D" "$R"
    nap 1.2

    printf '%s[squid]%s    projecting %sPD_CLAIM_*%s to both agents\n' "$BLU" "$R" "$B" "$R"; nap 1.0
    printf '%s[briefing]%s alpha ← neighbour: beta %s(editing reconcile.ts)%s\n' "$BLU" "$R" "$D" "$R"; nap 0.6
    printf '%s[briefing]%s beta  ← neighbour: alpha %s(editing reconcile.ts)%s\n' "$BLU" "$R" "$D" "$R"; nap 1.6
    printf '%s[parley]%s   %sp-7%s SUMMONED %s· parties: alpha, beta%s\n' "$MAG" "$R" "$B" "$R" "$D" "$R"; nap 2.4
    printf '%s[parley]%s   %sp-7%s round 1 — alpha: %spropose%s\n' "$MAG" "$R" "$B" "$R" "$CYN" "$R"; nap 2.2
    printf '%s[parley]%s   %sp-7%s round 2 — beta:  %sagree%s\n' "$MAG" "$R" "$B" "$R" "$GRN" "$R"; nap 1.0
    printf '%s[parley]%s   %sp-7%s %sCOLLAPSED%s — agreement reached\n' "$MAG" "$R" "$B" "$R" "$B$GRN" "$R"; nap 0.8

    printf '\n'
    banner "$GRN" "COORDINATION COMPLETE" "" "2 agents · 1 file · 0 conflicts" "resolved in 2 rounds, before the write"
    printf '\n%s   Port Daddy — they find each other before%s\n' "$B$ORG" "$R"
    printf '%s   they overwrite each other.%s\n' "$B$ORG" "$R"
    ;;
  esac

  # Hold the finished pane so the last frame is legible.
  nap 4
  exit 0
fi

# ── The parent process: build the tmux session ───────────────────────────────
tmux kill-session -t "$SESSION" 2>/dev/null

# `remain-on-exit` is set BEFORE any pane can finish. Without it the first pane
# to reach the end takes its slot down, and when the last one exits tmux tears
# the whole session down — so a fast run (or a recording harness sampling a
# moment later) finds nothing at all. Panes now hold their final frame, which
# is also what makes the ending readable.
tmux new-session -d -s "$SESSION" -x 200 -y 50 \
  -e "PB_ROLE=daddy" -e "SPEED=$SPEED" -e "LIVE=$LIVE" "$SELF"
# `-w` explicitly: remain-on-exit is a WINDOW option, and letting tmux infer the
# table from a session target is the kind of thing that resolves differently
# across versions. `destroy-unattached off` is belt-and-braces for the detached
# path a recording harness uses — without it the server can reap a session that
# no client ever attached to.
tmux set-option -w -t "$SESSION" remain-on-exit on
tmux set-option -t "$SESSION" destroy-unattached off

# Two agent panes on top, the daemon narrating underneath: the layout IS the
# architecture — peers on one plane, the coordinator observing both.
#
# Pane IDs (%0, %1…) are captured rather than indices: indices renumber as panes
# come and go, so titling by index is a race against the panes' own lifetimes.
PANE_DADDY="$(tmux list-panes -t "$SESSION" -F '#{pane_id}' | head -1)"
PANE_ALPHA="$(tmux split-window -t "$PANE_DADDY" -v -l 62% -P -F '#{pane_id}' \
  -e "PB_ROLE=alpha" -e "SPEED=$SPEED" -e "LIVE=$LIVE" "$SELF")"
PANE_BETA="$(tmux split-window -t "$PANE_ALPHA" -h -l 50% -P -F '#{pane_id}' \
  -e "PB_ROLE=beta"  -e "SPEED=$SPEED" -e "LIVE=$LIVE" "$SELF")"

tmux set-option -t "$SESSION" status on
tmux set-option -t "$SESSION" status-style "bg=colour236,fg=colour215,bold"
tmux set-option -t "$SESSION" status-left  " ⚓ PORT DADDY "
tmux set-option -t "$SESSION" status-right " parley battle · alpha vs beta "
tmux set-option -t "$SESSION" status-left-length 40
tmux set-option -t "$SESSION" pane-border-style "fg=colour238"
tmux set-option -t "$SESSION" pane-active-border-style "fg=colour215"
tmux set-option -t "$SESSION" pane-border-status top
tmux set-option -t "$SESSION" pane-border-format " #{pane_title} "

tmux select-pane -t "$PANE_DADDY" -T "⚓ port-daddy · daemon"
tmux select-pane -t "$PANE_ALPHA" -T "🔵 agent alpha"
tmux select-pane -t "$PANE_BETA"  -T "🟣 agent beta"

if [ "$ATTACH" = "1" ] || [ -t 0 ]; then
  tmux attach -t "$SESSION"
elif [ "$WAIT" = "1" ]; then
  # Block until every pane has finished.
  #
  # Not just a convenience: detached, this script's own process is the only
  # thing tying the tmux server to the caller, and process supervisors — CI
  # runners, sandboxes, container init — routinely reap an orphaned server
  # seconds after its spawning command returns. A recording harness that starts
  # the battle and then goes off to capture frames finds an empty socket.
  # Staying alive keeps the session owned.
  # Snapshot on every poll rather than once at the end.
  #
  # `capture-pane` against a pane whose process has exited comes back EMPTY even
  # with remain-on-exit holding the pane on screen — the pane is visible but its
  # content is no longer capturable. Sampling as we go means the last snapshot
  # of each pane is its final frame, taken while it was still alive.
  snapshot() {
    [ -n "$CAPTURE_DIR" ] || return 0
    mkdir -p "$CAPTURE_DIR"
    local pane pid name body
    for pane in "$PANE_DADDY:daemon" "$PANE_ALPHA:alpha" "$PANE_BETA:beta"; do
      pid="${pane%%:*}"; name="${pane##*:}"
      body="$(tmux capture-pane -t "$pid" -p -e 2>/dev/null)"
      # Only overwrite with something: an empty read means the pane has already
      # gone, and clobbering a good frame with it would lose the ending.
      [ -n "$body" ] && printf '%s\n' "$body" > "$CAPTURE_DIR/${name}.ansi"
      body="$(tmux capture-pane -t "$pid" -p 2>/dev/null)"
      [ -n "$body" ] && printf '%s\n' "$body" > "$CAPTURE_DIR/${name}.txt"
    done
  }

  # Require the all-dead reading TWICE before believing it.
  #
  # A single poll is not trustworthy: between `split-window` returning a pane id
  # and that pane's process being execed, tmux briefly reports the pane as dead,
  # so a one-shot check can conclude the whole commercial finished about a
  # second after it started — with only the opening frames captured. Two
  # consecutive readings, plus a floor on elapsed time, make the exit condition
  # mean what it says.
  settle=0
  waited=0
  while tmux has-session -t "$SESSION" 2>/dev/null; do
    snapshot
    alive="$(tmux list-panes -t "$SESSION" -F '#{pane_dead}' 2>/dev/null | grep -c '^0$' || true)"
    if [ "${alive:-0}" = "0" ] && [ "$waited" -gt 4 ]; then
      settle=$(( settle + 1 ))
      [ "$settle" -ge 2 ] && break
    else
      settle=0
    fi
    waited=$(( waited + 1 ))
    sleep 0.4
  done
  # Capture BEFORE returning. The session only outlives this process when a
  # client is attached, so a harness that captures after we exit races the
  # supervisor that reaps the orphaned server — and usually loses.
  [ -n "$CAPTURE_DIR" ] && echo "parley-battle: final frames written to $CAPTURE_DIR"
  echo "parley-battle: finished; session '$SESSION' holds the final frame"
else
  echo "parley-battle: running detached in tmux session '$SESSION'"
  echo "  attach with:  tmux attach -t $SESSION"
  echo "  (add --wait to keep this process alive — a detached server can be"
  echo "   reaped by CI/sandbox supervisors once this command returns)"
fi
