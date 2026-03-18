#!/usr/bin/env zsh
# =============================================================================
# Documentarian — The Authority on What This Project IS
# =============================================================================
# The Documentarian is the ultimate source of truth. After each commit, it
# reads the actual code and ensures all documentation surfaces match reality:
#
#   - CLAUDE.md (developer context for AI agents)
#   - README.md (public-facing docs)
#   - API reference (website/docs/api.html)
#   - features.manifest.json (parity source of truth)
#   - CHANGELOG.md (release notes)
#
# The Documentarian does NOT invent features. It reads code and documents
# what EXISTS. If the code does X but the docs say Y, the docs are wrong.
#
# Usage:
#   ./fleet/documentarian.sh                              # Run once
#   pd watch git:committed --exec './fleet/documentarian.sh'  # Auto-trigger
#
# Channels:
#   Subscribes to: git:committed
#   Publishes to: docs:updated, docs:drift-found
# =============================================================================

source "$(dirname "$0")/common.sh"

AGENT_NAME="documentarian"

# Surfaces to check
SURFACES=(
  "CLAUDE.md"
  "README.md"
  "features.manifest.json"
)

documentarian_run() {
  cd "$PROJECT_DIR" || exit 1

  local sha=$(git rev-parse --short HEAD)
  local msg=$(git log -1 --pretty=%s)
  local changed=$(git diff-tree --no-commit-id --name-only -r HEAD 2>/dev/null)

  fleet_log "$AGENT_NAME" "Reviewing docs after $sha: $msg"

  # Determine which surfaces might need updating based on changed files
  local needs_claude_md=false
  local needs_readme=false
  local needs_manifest=false
  local needs_api_ref=false

  echo "$changed" | while read file; do
    case "$file" in
      lib/*.ts|routes/*.ts|server.ts)
        needs_claude_md=true
        needs_readme=true
        needs_manifest=true
        needs_api_ref=true
        ;;
      mcp/*.ts)
        needs_claude_md=true
        needs_readme=true
        ;;
      cli/commands/*.ts|bin/*.ts)
        needs_claude_md=true
        needs_readme=true
        needs_manifest=true
        ;;
      completions/*)
        needs_manifest=true
        ;;
      fleet/*)
        needs_claude_md=true
        needs_readme=true
        ;;
    esac
  done

  # Build the prompt — give the Documentarian full context
  local routes_list=$(ls routes/*.ts 2>/dev/null | tr '\n' ', ')
  local lib_list=$(ls lib/*.ts 2>/dev/null | tr '\n' ', ')
  local cli_commands=$(grep -h "command\|\.command(" bin/port-daddy-cli.ts cli/commands/*.ts 2>/dev/null | head -40)

  local prompt="You are the Documentarian for Port Daddy — the ULTIMATE AUTHORITY on what this project is and does.

Your job: read the actual code, then check if the documentation matches reality.
If it doesn't, FIX THE DOCS to match the code. Never invent features. Never document aspirations.

Latest commit: $sha — $msg
Changed files: $(echo "$changed" | tr '\n' ', ')

Current source of truth:
- Route files: $routes_list
- Lib modules: $lib_list
- CLI commands (sample): $cli_commands

Check these documentation surfaces:
1. CLAUDE.md — Does the Architecture section list all current modules? Does the API Endpoints table match actual routes? Are the Key Patterns still accurate?
2. README.md — Does it describe what PD actually does today (not what it used to do)?
3. features.manifest.json — Does every feature with routes have the correct route list? Do CLI commands match?

For each surface:
- Read the doc file
- Read the relevant source files
- If they match: report SYNCED
- If they diverge: fix the doc file to match the code

Rules:
- Code is truth. Docs follow code.
- Don't add commentary about what SHOULD be built. Document what IS built.
- Keep the same style/tone as the existing docs.
- If a feature was removed from code but still in docs, remove it from docs.
- If a feature was added to code but missing from docs, add it to docs.
- Update version numbers, endpoint lists, module lists to be current."

  local result=$(claude_run "$prompt")

  if [[ $? -eq 0 ]]; then
    # Check if any docs were actually changed
    local doc_changes=$(git diff --name-only -- CLAUDE.md README.md features.manifest.json 2>/dev/null)
    if [[ -n "$doc_changes" ]]; then
      fleet_success "$AGENT_NAME" "Documentation updated: $doc_changes"
      pd_note "Documentarian synced docs after $sha: $doc_changes" "progress"
      pd_pub "docs:updated" "{\"sha\":\"$sha\",\"files\":\"$doc_changes\",\"agent\":\"$AGENT_NAME\",\"timestamp\":$(date +%s)}"
    else
      fleet_log "$AGENT_NAME" "Documentation already in sync"
      pd_pub "docs:synced" "{\"sha\":\"$sha\",\"agent\":\"$AGENT_NAME\",\"timestamp\":$(date +%s)}"
    fi
  else
    fleet_error "$AGENT_NAME" "Documentation review failed"
  fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
fleet_register "$AGENT_NAME" "Documentation authority — sync docs to code"
trap 'fleet_shutdown "$AGENT_NAME"; exit 0' INT TERM

documentarian_run
fleet_shutdown "$AGENT_NAME"
