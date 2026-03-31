# Port Daddy Fleet Showcase — The Always-On Daemon
#
# This tape shows the fleet as a living system:
# 1. Fleet status overview
# 2. Spark generates an idea
# 3. Spider finds connections (syllogisms)
# 4. Subscribe to all fleet channels
# 5. Browse Spark's ideas and Spider's connections
#
# This is the "hero" demo — the one that makes people say "I want that"

Output demos/blog/fleet-showcase.gif

Set Shell "zsh"
Set Theme "Catppuccin Mocha"
Set FontSize 15
Set Width 1100
Set Height 650
Set Padding 20
Set TypingSpeed 35ms
Set PlaybackSpeed 0.7

# Clean setup
Hide
Type "setopt INTERACTIVE_COMMENTS"
Enter
Sleep 200ms
Ctrl+L
Show
Sleep 800ms

# Act 1: The Fleet Exists
Type "# Port Daddy Fleet — 8 agents declared, always ready"
Enter
Sleep 1s

Type "cat pd-fleet.yml | head -6"
Enter
Sleep 2s

Type "# Each agent has a purpose, a trigger, and a schedule"
Enter
Sleep 1s

Type "grep -E '^\s{4}\w+:$' pd-fleet.yml"
Enter
Sleep 2.5s

# Act 2: What Spark Found
Type "# Spark proposes ideas every 30 minutes"
Enter
Sleep 1s

Type "ls .spark/ideas/"
Enter
Sleep 2s

Type "# Let's read Spark's latest idea..."
Enter
Sleep 800ms

Type "head -25 .spark/ideas/2026-03-27-from-spider.md"
Enter
Sleep 4s

# Act 3: What Spider Found — The Syllogisms
Type "# Spider finds connections between features nobody noticed"
Enter
Sleep 1s

Type "head -22 .spider/connections/2026-03-27-connections.md"
Enter
Sleep 5s

# Act 4: The Pub/Sub Channels
Type "# The fleet talks through pub/sub channels"
Enter
Sleep 1s

Type "pd channels"
Enter
Sleep 3s

# Act 5: Fleet comes alive
Type "# Start the fleet — all 8 agents, coordinated"
Enter
Sleep 1s

Type "pd fleet up"
Enter
Sleep 3s

Type "# Watch the activity stream in real-time"
Enter
Sleep 800ms

Type "pd activity --range 5m --json | head -20"
Enter
Sleep 3s

# Outro
Type ""
Enter
Sleep 500ms
Type "# The fleet runs while you sleep."
Enter
Type "# Spark dreams. Spider connects. QA hunts."
Enter
Type "# The codebase gets better on its own."
Enter
Sleep 3s
