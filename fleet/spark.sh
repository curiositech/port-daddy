#!/usr/bin/env zsh
# =============================================================================
# Spark — The Idea Engine
# =============================================================================
# Always-on creative agent. Cycles: OBSERVE → RESEARCH → SYNTHESIZE → PITCH.
# Runs on a timer (not event-driven). Commissions the Research Scout.
#
# Usage:
#   ./fleet/spark.sh                  # One ideation cycle
#   ./fleet/spark.sh --loop 1800      # Continuous (every 30 min)
#   pd fleet spark                    # Via fleet CLI
#   pd fleet spark ideas              # Browse ideas
#
# KEY DESIGN: Register ONCE, note MANY times, done ONCE on shutdown.
# Previous version registered per-cycle, creating 100s of orphan sessions.
# =============================================================================

source "$(dirname "$0")/common.sh"

AGENT_NAME="spark"
SPARK_DIR="$PROJECT_DIR/.spark"
IDEAS_DIR="$SPARK_DIR/ideas"

mkdir -p "$IDEAS_DIR"

spark_ideas_index() {
  pd ideas list --dir "$PROJECT_DIR" --limit 12 --json 2>/dev/null
}

spark_idea_matches() {
  local query="$1"
  [[ -n "$query" ]] || return 0
  pd ideas search "$query" --dir "$PROJECT_DIR" --limit 6 --include-raw --json 2>/dev/null
}

# ---------------------------------------------------------------------------
# Phase 1: OBSERVE
# ---------------------------------------------------------------------------
spark_observe() {
  fleet_log "$AGENT_NAME" "OBSERVE"

  local recent_commits=$(git -C "$PROJECT_DIR" log --oneline -10 2>/dev/null)
  local module_list=$(ls "$PROJECT_DIR/lib/"*.ts 2>/dev/null | xargs -I{} basename {} .ts | tr '\n' ', ')
  local test_count=$(grep -rl "it\(\|test\(" "$PROJECT_DIR/tests/" 2>/dev/null | wc -l | tr -d ' ')
  local research_files=$(fleet_glob "$PROJECT_DIR/research/*.md")
  local idea_files=$(fleet_glob "$IDEAS_DIR/*.md")

  cat > "$SPARK_DIR/latest-observation.md" << OBSERVATION
# Spark Observation — $(date +%Y-%m-%d\ %H:%M)

## Codebase
- Modules: $module_list
- Test files: ~$test_count

## Recent commits
$recent_commits

## Research available
${research_files:-(none)}

## Previous ideas
$(if [[ -n "$idea_files" ]]; then for f in ${(f)idea_files}; do echo "- $(basename $f)"; done; else echo "(none)"; fi)
OBSERVATION

  pd_note "Spark observed: ${test_count} test files, $(echo "$recent_commits" | wc -l | tr -d ' ') recent commits" "progress"
}

# ---------------------------------------------------------------------------
# Phase 2: RESEARCH — commission the Research Scout
# ---------------------------------------------------------------------------
spark_research() {
  fleet_log "$AGENT_NAME" "RESEARCH"

  fleet_check_claude "$AGENT_NAME" || { fleet_log "$AGENT_NAME" "skipping research (no pd/claude)"; return 0; }

  local ideas_index=$(spark_ideas_index)

  local prev_ideas=$(fleet_glob "$IDEAS_DIR/*.md")
  local prev_content=""
  if [[ -n "$prev_ideas" ]]; then
    prev_content=$(for f in ${(f)prev_ideas}; do head -5 "$f" 2>/dev/null; done | head -20)
  fi

  local topic=$(pd spawn --backend claude-cli \
    --maxTokens 100 \
    --timeout 120000 \
    -q -- "You are Spark, the idea engine for Port Daddy (a multi-agent coordination daemon). Based on this observation:

$(cat "$SPARK_DIR/latest-observation.md" 2>/dev/null)

Structured ideas index: ${ideas_index:-(none)}
Previous ideas: ${prev_content:-(none)}

Pick ONE research topic that would help Port Daddy leap forward. Avoid topics that are already duplicated in the canonical trove unless you have a materially different actuator or payoff. Output ONLY the topic as a single sentence." 2>/dev/null | head -1)

  if [[ -n "$topic" ]]; then
    local related_matches=$(spark_idea_matches "$topic")
    if [[ -n "$related_matches" ]]; then
      printf '%s\n' "$related_matches" > "$SPARK_DIR/latest-idea-matches.json"
    else
      rm -f "$SPARK_DIR/latest-idea-matches.json" 2>/dev/null
    fi
    fleet_log "$AGENT_NAME" "Research topic: $topic"
    local json=$(python3 -c "import json,sys; print(json.dumps({'topic':sys.argv[1],'context':'Commissioned by Spark','requestor':'spark'}))" "$topic" 2>/dev/null)
    pd_pub "research:request" "$json"
    pd_note "Spark commissioned research: $topic" "research"
    echo "$topic" >> "$SPARK_DIR/research-log.md"
  else
    fleet_log "$AGENT_NAME" "no research topic generated"
  fi
}

# ---------------------------------------------------------------------------
# Phase 3: SYNTHESIZE — generate an idea
# ---------------------------------------------------------------------------
spark_synthesize() {
  fleet_log "$AGENT_NAME" "SYNTHESIZE"

  fleet_check_claude "$AGENT_NAME" || { fleet_log "$AGENT_NAME" "skipping synthesis (no pd/claude)"; return 0; }

  local ideas_index=$(spark_ideas_index)
  local related_matches=""
  if [[ -f "$SPARK_DIR/latest-idea-matches.json" ]]; then
    related_matches=$(cat "$SPARK_DIR/latest-idea-matches.json" 2>/dev/null)
  fi

  local research_content=""
  local research_files=$(fleet_glob "$PROJECT_DIR/research/*.md")
  if [[ -n "$research_files" ]]; then
    research_content=$(for f in ${(f)research_files}; do head -20 "$f" 2>/dev/null; done | head -60)
  fi

  local prev_content=""
  local idea_files=$(fleet_glob "$IDEAS_DIR/*.md")
  if [[ -n "$idea_files" ]]; then
    prev_content=$(for f in ${(f)idea_files}; do head -5 "$f" 2>/dev/null; done | head -20)
  fi

  local idea=$(pd spawn --backend claude-cli \
    --maxTokens 1500 \
    --timeout 600000 \
    -q -- "You are Spark. Generate ONE bold idea for Port Daddy.

Observation: $(cat "$SPARK_DIR/latest-observation.md" 2>/dev/null | head -30)
Research: ${research_content:-(none)}
Structured ideas index: ${ideas_index:-(none)}
Related idea matches: ${related_matches:-(none)}
Previous ideas: ${prev_content:-(none)}

Format:
# [Idea Name]
## The Insight
[One paragraph]
## The Proposal
[Specific: modules, endpoints, CLI commands]
## Why It Matters
[Who benefits]
## Effort
[Small / Medium / Large]

Novelty gate:
- Do not rename an existing trove item and pretend it is new
- If this is only a refinement, start with EXTENDS: <slug>
- Only produce a new standalone idea if it adds a new actuator, data source, API surface, or operator payoff

Be bold. Be specific. Be buildable. If nothing novel survives dedupe, say DUPLICATE and stop." 2>/dev/null)

  if [[ -n "$idea" && "$idea" != DUPLICATE* ]]; then
    local idea_name=$(echo "$idea" | grep "^# " | head -1 | sed 's/^# //')
    local slug=$(echo "$idea_name" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd 'a-z0-9-' | head -c 40)
    local idea_file="$IDEAS_DIR/$(date +%Y%m%d-%H%M)-${slug}.md"

    echo "$idea" > "$idea_file"
    fleet_success "$AGENT_NAME" "New idea: $idea_name"
    pd_note "Spark idea: $idea_name" "idea"
    local json=$(python3 -c "import json,sys; print(json.dumps({'name':sys.argv[1],'file':sys.argv[2],'timestamp':int(__import__('time').time())}))" "$idea_name" "$idea_file" 2>/dev/null)
    pd_pub "spark:idea" "$json"
  else
    fleet_log "$AGENT_NAME" "no idea generated this cycle"
  fi
}

# ---------------------------------------------------------------------------
# Phase 4: PITCH — surface the latest unreviewed idea
# ---------------------------------------------------------------------------
spark_pitch() {
  fleet_log "$AGENT_NAME" "PITCH"

  local idea_files=$(fleet_glob "$IDEAS_DIR/*.md")
  if [[ -z "$idea_files" ]]; then
    fleet_log "$AGENT_NAME" "no ideas to pitch yet"
    return 0
  fi

  # Find most recent idea
  local latest=$(echo "$idea_files" | tr ' ' '\n' | sort -r | head -1)
  local idea_name=$(grep "^# " "$latest" 2>/dev/null | head -1 | sed 's/^# //')
  local insight=$(grep -A3 "## The Insight" "$latest" 2>/dev/null | tail -3 | head -c 300)

  pd_note "Spark pitches: $idea_name — $insight (full: $latest)" "idea"
  fleet_success "$AGENT_NAME" "Pitched: $idea_name"
}

# ---------------------------------------------------------------------------
# Full ideation cycle — uses notes, not new sessions
# ---------------------------------------------------------------------------
spark_cycle() {
  local cycle_num="${1:-1}"
  fleet_log "$AGENT_NAME" "=== Cycle $cycle_num ==="
  pd_note "Spark starting cycle $cycle_num" "progress"

  spark_observe
  spark_research
  spark_synthesize
  spark_pitch

  pd_note "Spark cycle $cycle_num complete" "progress"
  fleet_success "$AGENT_NAME" "Cycle $cycle_num complete"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
if [[ "$1" == "--loop" ]]; then
  fleet_register "$AGENT_NAME" "Always-on idea engine" || exit 0
  trap 'fleet_shutdown "$AGENT_NAME"; exit 0' INT TERM

  local cycle=0
  while true; do
    cycle=$((cycle + 1))
    spark_cycle "$cycle"
    local interval="${2:-1800}"
    fleet_log "$AGENT_NAME" "sleeping ${interval}s until next cycle"
    sleep "$interval"
  done

elif [[ "$1" == "ideas" ]]; then
  echo ""
  echo "${CYAN}=== Spark's Ideas ===${NC}"
  echo ""
  local idea_files=$(fleet_glob "$IDEAS_DIR/*.md")
  if [[ -z "$idea_files" ]]; then
    echo "  (no ideas yet — run: pd fleet spark)"
  else
    for f in ${(f)idea_files}; do
      local name=$(grep "^# " "$f" 2>/dev/null | head -1 | sed 's/^# //')
      local effort=$(grep -A1 "## Effort" "$f" 2>/dev/null | tail -1 | head -c 20)
      echo "  ${GREEN}$name${NC} ${DIM}($effort)${NC}"
      echo "    $f"
    done
  fi
  echo ""

elif [[ "$1" == "pitch" ]]; then
  spark_pitch

else
  # Single cycle
  fleet_register "$AGENT_NAME" "Ideation cycle" || exit 0
  trap 'fleet_shutdown "$AGENT_NAME"; exit 0' INT TERM
  spark_cycle 1
  fleet_shutdown "$AGENT_NAME"
fi
