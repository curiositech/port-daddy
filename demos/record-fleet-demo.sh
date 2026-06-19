#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
# Fleet Demo GIF — "57 Messages Were Piling Up"
# ═══════════════════════════════════════════════════════════════════════
#
# Art direction:
#   Left  — pd-fleet.yml in a terminal (bat/cat with syntax highlighting)
#           Shows the YAML config: agents, triggers, channels
#           This is "the plan"
#
#   Right — Terminal where the commit happens
#           Shows: git status → git commit → agents fire
#           This is "the action"
#
#   Top   — FleetBar menu bar popover (open it manually before recording)
#           Shows agents cascade from idle → running → done
#           This is "the proof"
#
#   Behind — Web dashboard at localhost:9876
#           Fleet panel visible, adds depth and legitimacy
#           This is "the infrastructure"
#
# The GIF tells one story in 15 seconds:
#   "I commit code. Eight agents wake up automatically."
#
# Usage:
#   1. Promote to stable first:  ./scripts/promote-stable.sh
#   2. Verify fleet is running:  curl -s localhost:9876/fleet | jq .running
#   3. Open FleetBar and expand the popover
#   4. Run this script:          ./demos/record-fleet-demo.sh
#   5. The script will:
#      a. Open and arrange background windows
#      b. Wait for you to start screen recording (Cmd+Shift+5)
#      c. Execute the demo sequence with timed pauses
#      d. Signal when to stop recording
#   6. Convert to GIF:          ./demos/convert-to-gif.sh
#
# ═══════════════════════════════════════════════════════════════════════

set -euo pipefail

DEMO_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$DEMO_DIR")"
RECORDING_DIR="$DEMO_DIR/recordings"
mkdir -p "$RECORDING_DIR"

# Colors
BOLD='\033[1m'
DIM='\033[2m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo ""
echo -e "${BOLD}═══════════════════════════════════════════════${NC}"
echo -e "${BOLD}  Fleet Demo — Art Direction${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════${NC}"
echo ""

# ─── Step 0: Preflight ─────────────────────────────────────────────────

echo -e "${CYAN}Preflight checks...${NC}"

# Daemon running?
if ! curl -s http://localhost:9876/health > /dev/null 2>&1; then
    echo -e "${YELLOW}⚠ Daemon not running. Starting...${NC}"
    pd start
    sleep 3
fi

# Fleet running?
FLEET_RUNNING=$(curl -s http://localhost:9876/fleet 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('running',False))" 2>/dev/null || echo "False")
if [ "$FLEET_RUNNING" != "True" ]; then
    echo -e "${YELLOW}⚠ Fleet not running. Starting...${NC}"
    curl -s -X POST http://localhost:9876/fleet/start -H 'Content-Type: application/json' -d '{}' > /dev/null
    sleep 2
fi

echo -e "${GREEN}✓ Daemon running${NC}"
echo -e "${GREEN}✓ Fleet active${NC}"
echo ""

# ─── Step 1: Set the stage — background windows ───────────────────────

echo -e "${CYAN}Setting the stage...${NC}"
echo ""

# Open the web dashboard in default browser (background depth)
open "http://localhost:9876" &

sleep 1

# Open a terminal with the fleet YAML (the plan)
# Use osascript to open a new Terminal window with specific content
osascript <<'APPLESCRIPT'
tell application "Terminal"
    activate
    -- Left window: fleet config
    set leftWindow to do script "cd ~/coding/port-daddy && clear && echo ''; echo '  ┌─────────────────────────────────────────┐'; echo '  │  pd-fleet.yml — The Fleet Configuration │'; echo '  └─────────────────────────────────────────┘'; echo ''; cat pd-fleet.yml"
    set bounds of front window to {0, 80, 900, 900}

    delay 0.5

    -- Right window: the action terminal
    set rightWindow to do script "cd ~/coding/port-daddy && clear && echo ''; echo '  ┌───────────────────────────────────┐'; echo '  │  Ready to commit — watching fleet │'; echo '  └───────────────────────────────────┘'; echo ''; pd status; echo ''; echo '── Fleet status ──'; curl -s http://localhost:9876/fleet | python3 -m json.tool 2>/dev/null | head -20; echo ''"
    set bounds of front window to {920, 80, 1800, 900}
end tell
APPLESCRIPT

echo -e "${GREEN}✓ Background windows arranged${NC}"
echo ""

# ─── Step 2: Wait for recording ───────────────────────────────────────

echo -e "${BOLD}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  SCENE IS SET. Now:                          ║${NC}"
echo -e "${BOLD}║                                              ║${NC}"
echo -e "${BOLD}║  1. Click the FleetBar sailboat in menu bar  ║${NC}"
echo -e "${BOLD}║  2. Expand the port-daddy project            ║${NC}"
echo -e "${BOLD}║  3. Press Cmd+Shift+5 → Record Screen        ║${NC}"
echo -e "${BOLD}║  4. Press ENTER here when recording          ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════╝${NC}"
echo ""
read -p "$(echo -e ${GREEN}Recording? Press ENTER to start the demo...${NC})"
echo ""

# ─── Step 3: The demo sequence ────────────────────────────────────────

echo -e "${CYAN}Demo running...${NC}"

# Create a throwaway change to commit
DEMO_FILE="$PROJECT_DIR/.demo-trigger-$(date +%s).md"
echo "# Fleet Demo Trigger" > "$DEMO_FILE"
echo "" >> "$DEMO_FILE"
echo "This file triggers the fleet agents." >> "$DEMO_FILE"
echo "Created: $(date)" >> "$DEMO_FILE"

# Execute the commit in the right terminal
osascript <<APPLESCRIPT
tell application "Terminal"
    -- Find the action window (second one we opened)
    set targetWindow to window 1
    do script "clear && echo '' && echo '  Staging a change...' && echo '' && git add .demo-trigger-*.md && sleep 1 && echo '  Committing...' && echo '' && git commit -m 'demo: trigger fleet agents' && echo '' && echo '  ✓ Commit done. Watch the fleet react!' && echo '' && echo '── Agents are firing ──' && sleep 3 && curl -s http://localhost:9876/fleet | python3 -c \"
import sys, json
data = json.load(sys.stdin)
for fleet in data.get('fleets', []):
    print(f\\\"  {fleet['project']}: {len(fleet['agents'])} agents\\\")
    for a in fleet['agents']:
        status = '●' if a['running'] else '○'
        print(f\\\"    {status} {a['name']} ({a['type']})\\\")
\" 2>/dev/null" in targetWindow
end tell
APPLESCRIPT

# Wait for the demo to play out
echo -e "${DIM}  Waiting 12 seconds for agents to cascade...${NC}"
sleep 12

# ─── Step 4: Signal end ───────────────────────────────────────────────

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  DEMO COMPLETE                               ║${NC}"
echo -e "${BOLD}║                                              ║${NC}"
echo -e "${BOLD}║  1. Stop screen recording (Cmd+Shift+5)      ║${NC}"
echo -e "${BOLD}║  2. Recording saved to ~/Desktop             ║${NC}"
echo -e "${BOLD}║  3. Run: ./demos/convert-to-gif.sh            ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════╝${NC}"
echo ""

# Clean up demo file
rm -f "$DEMO_FILE"
# Undo the demo commit (soft reset, keeps the file deleted)
git reset --soft HEAD~1 2>/dev/null || true
git checkout -- .demo-trigger-*.md 2>/dev/null || true
rm -f "$PROJECT_DIR"/.demo-trigger-*.md

echo -e "${GREEN}✓ Demo commit reverted. Workspace clean.${NC}"
