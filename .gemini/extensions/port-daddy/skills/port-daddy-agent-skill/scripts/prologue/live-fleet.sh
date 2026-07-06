#!/usr/bin/env bash
# Prologue: one-shot snapshot of the live fleet.
#
# Combines pd briefing + sessions + notes + activity + claims into a single
# JSON the agent can scan in one read. Cheaper than 4 separate pd calls and
# returns even if one of them is slow.
#
# Usage:
#   skills/port-daddy-agent-skill/scripts/prologue/live-fleet.sh
#   skills/port-daddy-agent-skill/scripts/prologue/live-fleet.sh --pretty
#   skills/port-daddy-agent-skill/scripts/prologue/live-fleet.sh --project port-daddy
#
# Output schema:
#   - briefing:       summary blob (whatever pd briefing emits)
#   - sessions:       active sessions across worktrees (id, purpose, age, files, notes)
#   - recent_notes:   last 20 notes
#   - recent_activity: last 20 activity entries
#   - file_claims:    map of file → owners
#   - actor_inboxes:  per-actor unread counts (navigator/cartographer/lookout/coxswain/quartermaster)
#   - dead_agents:    salvage queue summary

set -uo pipefail   # NOT -e: we want partial success rather than abort

PRETTY=""
PROJECT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --pretty)  PRETTY="1"; shift ;;
    --project) PROJECT="$2"; shift 2 ;;
    *) shift ;;
  esac
done

scope=""
if [ -n "$PROJECT" ]; then scope="--project $PROJECT"; fi

# Each call can fail independently
briefing=$(pd briefing $scope --json 2>/dev/null || echo '{}')
sessions=$(pd sessions --all-worktrees --json 2>/dev/null || echo '[]')
notes=$(pd notes --limit 20 --json 2>/dev/null || echo '[]')
activity=$(pd activity --limit 20 --json 2>/dev/null || echo '[]')
salvage=$(pd salvage $scope --limit 20 --json 2>/dev/null || echo '[]')

# Actor inboxes — best-effort per actor
inbox_navigator=$(pd actor navigator --inbox-stats --json 2>/dev/null || echo '{}')
inbox_cartographer=$(pd actor cartographer --inbox-stats --json 2>/dev/null || echo '{}')
inbox_lookout=$(pd actor lookout --inbox-stats --json 2>/dev/null || echo '{}')
inbox_coxswain=$(pd actor coxswain --inbox-stats --json 2>/dev/null || echo '{}')
inbox_quartermaster=$(pd actor quartermaster --inbox-stats --json 2>/dev/null || echo '{}')

python3 - \
  "$briefing" "$sessions" "$notes" "$activity" "$salvage" \
  "$inbox_navigator" "$inbox_cartographer" "$inbox_lookout" "$inbox_coxswain" "$inbox_quartermaster" \
  "${PRETTY:-}" <<'PY'
import json, sys

(briefing, sessions, notes, activity, salvage,
 navigator, cartographer, lookout, coxswain, quartermaster, pretty) = sys.argv[1:]

def safe(s, default):
    try:
        return json.loads(s) if s and s.strip().startswith(('{', '[')) else default
    except Exception:
        return default

sessions_list = safe(sessions, [])
salvage_list = safe(salvage, [])

# Surface useful summaries
warnings = []
if isinstance(sessions_list, list) and len(sessions_list) >= 5:
    warnings.append(f"{len(sessions_list)} active sessions — high contention; re-read claims before editing")
if isinstance(salvage_list, list) and len(salvage_list) > 50:
    warnings.append(f"{len(salvage_list)} entries in salvage queue — consider draining")

out = {
    "briefing": safe(briefing, {}),
    "sessions": sessions_list,
    "session_count": len(sessions_list) if isinstance(sessions_list, list) else 0,
    "recent_notes": safe(notes, []),
    "recent_activity": safe(activity, []),
    "salvage_queue_size": len(salvage_list) if isinstance(salvage_list, list) else 0,
    "salvage_top10": salvage_list[:10] if isinstance(salvage_list, list) else [],
    "actor_inboxes": {
        "navigator": safe(navigator, {}),
        "cartographer": safe(cartographer, {}),
        "lookout": safe(lookout, {}),
        "coxswain": safe(coxswain, {}),
        "quartermaster": safe(quartermaster, {}),
    },
    "warnings": warnings,
}

if pretty:
    print(json.dumps(out, indent=2, default=str))
else:
    print(json.dumps(out, default=str))
PY
