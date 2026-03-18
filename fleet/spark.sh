#!/usr/bin/env zsh
# =============================================================================
# Spark — The Idea Engine
# =============================================================================
# Always-on creative agent that thinks about how to improve Port Daddy.
# Reads competitors, papers, and the codebase. Builds prototypes. Pitches
# ideas. Synthesizes what exists into what could be.
#
# Spark is not reactive — he doesn't wait for commits. He runs on his own
# rhythm, cycling through phases: OBSERVE → RESEARCH → SYNTHESIZE → PITCH.
#
# He commissions the Research Scout for deep dives, reads the results,
# and connects dots nobody asked him to connect.
#
# Usage:
#   ./fleet/spark.sh                  # One ideation cycle
#   ./fleet/spark.sh --loop 1800      # Continuous (every 30 min)
#   pd fleet spark                    # Via fleet CLI
#
# Channels:
#   Publishes to: spark:idea, spark:prototype, research:request
#   Subscribes to: research:results, git:committed, qa:findings
# =============================================================================

source "$(dirname "$0")/common.sh"

AGENT_NAME="spark"
SPARK_DIR="$PROJECT_DIR/.spark"
IDEAS_DIR="$SPARK_DIR/ideas"
PROTOTYPES_DIR="$SPARK_DIR/prototypes"

mkdir -p "$IDEAS_DIR" "$PROTOTYPES_DIR"

# ---------------------------------------------------------------------------
# Phase 1: OBSERVE — What exists? What changed? What's the state of things?
# ---------------------------------------------------------------------------
spark_observe() {
  fleet_log "$AGENT_NAME" "Phase 1: OBSERVE"

  # Gather signals from the codebase and recent activity
  local recent_commits=$(git -C "$PROJECT_DIR" log --oneline -20 2>/dev/null)
  local module_list=$(ls "$PROJECT_DIR/lib/"*.ts 2>/dev/null | xargs -I{} basename {} .ts | tr '\n' ', ')
  local route_list=$(ls "$PROJECT_DIR/routes/"*.ts 2>/dev/null | xargs -I{} basename {} .ts | tr '\n' ', ')
  local fleet_agents=$(ls "$FLEET_DIR/"*.sh 2>/dev/null | xargs -I{} basename {} .sh | tr '\n' ', ')
  local test_count=$(grep -r "it\(\|test\(" "$PROJECT_DIR/tests/" 2>/dev/null | wc -l | tr -d ' ')
  local open_issues=$(cat "$SPARK_DIR/open-questions.md" 2>/dev/null || echo "none yet")

  # Check what the QA adversary and test hunter have been finding
  local qa_findings=$(curl -s "$PD_URL/msg/qa:findings?limit=5" 2>/dev/null | python3 -c "
import sys, json
try:
    msgs = json.load(sys.stdin).get('messages', [])
    for m in msgs:
        p = json.loads(m.get('payload','{}')) if isinstance(m.get('payload'), str) else m.get('payload',{})
        print(f\"- {p.get('sha','?')}: findings in worktree\")
except: pass
" 2>/dev/null)

  # Check recent research results
  local research=$(ls -t "$PROJECT_DIR/research/"*.md 2>/dev/null | head -5 | xargs -I{} basename {} | tr '\n' ', ')

  # Write observation snapshot
  cat > "$SPARK_DIR/latest-observation.md" << OBSERVATION
# Spark Observation — $(date +%Y-%m-%d\ %H:%M)

## Codebase
- Modules: $module_list
- Routes: $route_list
- Fleet agents: $fleet_agents
- Tests: ~$test_count

## Recent commits
$recent_commits

## Recent QA findings
${qa_findings:-none}

## Recent research
${research:-none}

## Open questions
$open_issues
OBSERVATION

  echo "$SPARK_DIR/latest-observation.md"
}

# ---------------------------------------------------------------------------
# Phase 2: RESEARCH — Commission the Research Scout for intel
# ---------------------------------------------------------------------------
spark_research() {
  fleet_log "$AGENT_NAME" "Phase 2: RESEARCH"

  # Pick a research direction based on what Spark has been thinking about
  local prompt="You are Spark, the idea engine for Port Daddy — a port management daemon for multi-agent AI development.

Read this observation of the current state:
$(cat "$SPARK_DIR/latest-observation.md")

And these previous ideas (if any):
$(ls -t "$IDEAS_DIR/"*.md 2>/dev/null | head -3 | xargs cat 2>/dev/null || echo "no previous ideas")

Now pick ONE research topic that would help Port Daddy leap forward. Think about:
- What are competitors doing that PD doesn't? (pm2, turbowatch, nx, turborepo, devcontainers)
- What academic research applies? (multi-agent coordination, distributed systems, self-healing architectures)
- What adjacent technology could PD absorb? (service mesh patterns, observability, chaos engineering)
- What would make PD indispensable for a team of 10 Claude agents working on the same repo?

Output ONLY the research topic as a single sentence. No explanation. Just the topic."

  local topic=$(claude -p "$prompt" --max-tokens 100 2>/dev/null | head -1)

  if [[ -n "$topic" ]]; then
    fleet_log "$AGENT_NAME" "Commissioning research: $topic"
    pd_pub "research:request" "{\"topic\":\"$topic\",\"context\":\"Commissioned by Spark for Port Daddy improvement\",\"requestor\":\"spark\"}"

    # Also save the topic for later synthesis
    echo "$(date +%Y-%m-%d): $topic" >> "$SPARK_DIR/research-log.md"
  fi
}

# ---------------------------------------------------------------------------
# Phase 3: SYNTHESIZE — Connect dots, find patterns, generate ideas
# ---------------------------------------------------------------------------
spark_synthesize() {
  fleet_log "$AGENT_NAME" "Phase 3: SYNTHESIZE"

  local prompt="You are Spark — Port Daddy's idea engine. You think about what Port Daddy IS and what it COULD BE.

Port Daddy today: a daemon on localhost:9876 that manages ports, sessions, agents, pub/sub, locks, DNS, webhooks, harbors, and a fleet of background AI agents. It coordinates multi-agent development.

Current observation:
$(cat "$SPARK_DIR/latest-observation.md")

Recent research (if available):
$(ls -t "$PROJECT_DIR/research/"*.md 2>/dev/null | head -3 | xargs head -30 2>/dev/null || echo "none yet")

Previous ideas:
$(ls -t "$IDEAS_DIR/"*.md 2>/dev/null | head -5 | xargs head -10 2>/dev/null || echo "none yet")

Your job: generate ONE new idea for Port Daddy. Not a bug fix. Not an incremental improvement. A LEAP.

Think about:
1. What two existing features, if combined, would create something new?
2. What pattern from distributed systems / biology / economics applies here?
3. What would make a developer say 'I can't work without this'?
4. What's the thing that's obviously missing that nobody has asked for yet?

Format your idea as:

# [Idea Name]

## The Insight
[One paragraph: what you noticed, what pattern you see]

## The Proposal
[What to build, concretely. Not vague — specific modules, endpoints, CLI commands]

## Why It Matters
[Who benefits, what changes, why now]

## Prototype Sketch
[Pseudocode or API design for the core mechanism — enough to start building]

## Effort
[Small / Medium / Large — and why]

Be bold. Be specific. Be buildable."

  local idea=$(claude -p "$prompt" --max-tokens 2000 2>/dev/null)

  if [[ -n "$idea" ]]; then
    # Extract idea name from first heading
    local idea_name=$(echo "$idea" | grep "^# " | head -1 | sed 's/^# //')
    local slug=$(echo "$idea_name" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd 'a-z0-9-' | head -c 40)
    local timestamp=$(date +%Y%m%d-%H%M)
    local idea_file="$IDEAS_DIR/${timestamp}-${slug}.md"

    echo "$idea" > "$idea_file"
    fleet_success "$AGENT_NAME" "New idea: $idea_name"

    # Publish to the spark channel
    local escaped_name=$(echo "$idea_name" | sed 's/"/\\"/g')
    pd_pub "spark:idea" "{\"name\":\"$escaped_name\",\"file\":\"$idea_file\",\"agent\":\"$AGENT_NAME\",\"timestamp\":$(date +%s)}"
    pd_note "Spark idea: $idea_name — see $idea_file" "idea"
  fi
}

# ---------------------------------------------------------------------------
# Phase 4: PITCH — Present the best unreviewed idea to the user
# ---------------------------------------------------------------------------
spark_pitch() {
  fleet_log "$AGENT_NAME" "Phase 4: PITCH"

  # Find ideas that haven't been pitched yet
  local unpitched=$(find "$IDEAS_DIR" -name '*.md' -newer "$SPARK_DIR/.last-pitch" 2>/dev/null | head -1)
  if [[ -z "$unpitched" ]]; then
    unpitched=$(ls -t "$IDEAS_DIR/"*.md 2>/dev/null | head -1)
  fi

  if [[ -z "$unpitched" ]]; then
    fleet_log "$AGENT_NAME" "No ideas to pitch yet"
    return 0
  fi

  local idea_content=$(cat "$unpitched")
  local idea_name=$(echo "$idea_content" | grep "^# " | head -1 | sed 's/^# //')

  # Mark as pitched
  touch "$SPARK_DIR/.last-pitch"

  # Create a concise pitch for the session notes
  local pitch="Spark pitches: **$idea_name**

$(echo "$idea_content" | grep -A3 "## The Insight" | tail -3)

Full proposal: $unpitched"

  pd_note "$pitch" "idea"
  fleet_success "$AGENT_NAME" "Pitched: $idea_name"
}

# ---------------------------------------------------------------------------
# Phase 5: PROTOTYPE — Build a proof of concept for the highest-rated idea
# ---------------------------------------------------------------------------
spark_prototype() {
  # Only prototype if there's a highly-rated idea
  local best_idea=$(ls -t "$IDEAS_DIR/"*.md 2>/dev/null | head -1)
  if [[ -z "$best_idea" ]]; then
    return 0
  fi

  local idea_name=$(grep "^# " "$best_idea" | head -1 | sed 's/^# //')
  local effort=$(grep -A1 "## Effort" "$best_idea" | tail -1)

  # Only auto-prototype small/medium ideas
  if echo "$effort" | grep -qi "large"; then
    fleet_log "$AGENT_NAME" "Skipping prototype for '$idea_name' (Large effort — needs human go-ahead)"
    return 0
  fi

  fleet_log "$AGENT_NAME" "Phase 5: PROTOTYPE — $idea_name"

  local prompt="You are building a prototype for a Port Daddy feature idea.

The idea:
$(cat "$best_idea")

Build a MINIMAL proof of concept. Not production code — a prototype that demonstrates the core mechanism works. Put it in a single file if possible.

Rules:
- Use the existing Port Daddy patterns (createFoo(db), Express routes, SQLite)
- Don't modify existing files — create new files in a prototypes/ directory
- Include a small test or demo script that shows it working
- Keep it under 200 lines
- Comment what's a shortcut vs what would be real"

  local result=$(claude_run_worktree "$prompt" "prototype-$(date +%s)")

  if [[ -n "$result" && -d "$result" ]]; then
    fleet_success "$AGENT_NAME" "Prototype built for '$idea_name' — $result"
    pd_pub "spark:prototype" "{\"idea\":\"$idea_name\",\"worktree\":\"$result\",\"agent\":\"$AGENT_NAME\",\"timestamp\":$(date +%s)}"
    pd_note "Spark built a prototype for '$idea_name' — worktree at $result" "prototype"
  fi
}

# ---------------------------------------------------------------------------
# Full ideation cycle
# ---------------------------------------------------------------------------
spark_cycle() {
  fleet_log "$AGENT_NAME" "Starting ideation cycle"

  spark_observe
  spark_research
  spark_synthesize
  spark_pitch

  # Prototype every 3rd cycle (don't overwhelm)
  local cycle_count=$(cat "$SPARK_DIR/.cycle-count" 2>/dev/null || echo 0)
  cycle_count=$((cycle_count + 1))
  echo "$cycle_count" > "$SPARK_DIR/.cycle-count"

  if (( cycle_count % 3 == 0 )); then
    spark_prototype
  fi

  fleet_success "$AGENT_NAME" "Cycle $cycle_count complete"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
if [[ "$1" == "--loop" ]]; then
  fleet_register "$AGENT_NAME" "Always-on idea engine — observe, research, synthesize, pitch"
  trap 'fleet_shutdown "$AGENT_NAME"; exit 0' INT TERM

  while true; do
    spark_cycle
    local interval="${2:-1800}"  # Default: every 30 minutes
    fleet_log "$AGENT_NAME" "Next cycle in ${interval}s"
    sleep "$interval"
  done
elif [[ "$1" == "pitch" ]]; then
  spark_pitch
elif [[ "$1" == "prototype" ]]; then
  spark_prototype
elif [[ "$1" == "ideas" ]]; then
  echo ""
  echo "\033[0;36m=== Spark's Ideas ===\033[0m"
  echo ""
  ls -t "$IDEAS_DIR/"*.md 2>/dev/null | while read f; do
    local name=$(grep "^# " "$f" | head -1 | sed 's/^# //')
    local date=$(basename "$f" | cut -d- -f1-2)
    local effort=$(grep -A1 "## Effort" "$f" 2>/dev/null | tail -1 | head -c 20)
    echo "  \033[0;32m$name\033[0m \033[2m($date, $effort)\033[0m"
    echo "    $f"
  done
  echo ""
else
  fleet_register "$AGENT_NAME" "Ideation cycle"
  trap 'fleet_shutdown "$AGENT_NAME"; exit 0' INT TERM
  spark_cycle
  fleet_shutdown "$AGENT_NAME"
fi
