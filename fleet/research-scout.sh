#!/usr/bin/env zsh
# =============================================================================
# Research Scout — Know what's out there
# =============================================================================
# Watches for research requests on the research:request channel and spawns
# Claude agents to do deep research, dropping findings as session notes.
#
# Usage:
#   pd pub research:request '{"topic":"IPv6 SSRF prevention best practices"}'
#   pd watch research:request --exec './fleet/research-scout.sh'
#
# Or run directly:
#   ./fleet/research-scout.sh "How do other port managers handle agent coordination?"
#
# Channels:
#   Subscribes to: research:request
#   Publishes to: research:results
# =============================================================================

source "$(dirname "$0")/common.sh"

AGENT_NAME="research-scout"

scout_run() {
  local topic="$1"
  local context="${2:-}"

  if [[ -z "$topic" ]]; then
    # Try to parse from PD_MESSAGE env var (set by pd watch --exec)
    if [[ -n "$PD_MESSAGE" ]]; then
      topic=$(echo "$PD_MESSAGE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('topic',''))" 2>/dev/null)
      context=$(echo "$PD_MESSAGE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('context',''))" 2>/dev/null)
    fi
  fi

  if [[ -z "$topic" ]]; then
    fleet_error "$AGENT_NAME" "No topic provided. Usage: $0 'topic' ['context']"
    return 1
  fi

  fleet_log "$AGENT_NAME" "Researching: $topic"

  local prompt="You are a research scout for Port Daddy, a port management daemon for multi-agent development.

Research topic: $topic
${context:+Context: $context}

Instructions:
1. Search the web for current best practices, implementations, and prior art
2. Look at how similar tools solve this problem (pm2, turbowatch, nx, turborepo, docker-compose)
3. Read relevant documentation, blog posts, GitHub issues
4. Synthesize your findings into a concise report

Output format:
## Research: [topic]

### Key Findings
- [finding 1 with source]
- [finding 2 with source]
- [finding 3 with source]

### Relevant Projects/Tools
- [project]: [what it does, how it relates]

### Recommendations for Port Daddy
- [actionable recommendation 1]
- [actionable recommendation 2]

### Sources
- [url 1]
- [url 2]

Be thorough but concise. Focus on actionable insights, not summaries."

  local result=$(claude -p "$prompt" --allowedTools 'WebSearch,WebFetch,Read,Grep' 2>/dev/null)

  if [[ -n "$result" ]]; then
    # Save findings as a note
    local escaped=$(echo "$result" | head -50 | sed 's/"/\\"/g' | tr '\n' ' ')
    pd_note "Research Scout — $topic: $escaped" "research"

    # Save full findings to a file
    local slug=$(echo "$topic" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd 'a-z0-9-' | head -c 50)
    local report_file="$PROJECT_DIR/research/${slug}-$(date +%Y%m%d).md"
    mkdir -p "$PROJECT_DIR/research"
    echo "$result" > "$report_file"

    fleet_success "$AGENT_NAME" "Research complete — saved to $report_file"
    pd_pub "research:results" "{\"topic\":\"$topic\",\"file\":\"$report_file\",\"agent\":\"$AGENT_NAME\",\"timestamp\":$(date +%s)}"
  else
    fleet_warn "$AGENT_NAME" "Research returned no results for: $topic"
  fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
fleet_register "$AGENT_NAME" "Deep research on: ${1:-$PD_MESSAGE}"
trap 'fleet_shutdown "$AGENT_NAME"; exit 0' INT TERM

scout_run "$1" "$2"
fleet_shutdown "$AGENT_NAME"
