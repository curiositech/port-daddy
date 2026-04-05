# The Spark → Spider Creative Loop
#
# This tape shows the emergent creative cycle:
# 1. Spark proposes an idea (pheromone CLI)
# 2. Spider reads it and finds connections
# 3. Spark reads Spider's connections and proposes implementations
# 4. The pub/sub channels carry the conversation
#
# This is the "poetry" demo — slow, deliberate, shows the beauty

Output demos/blog/spark-spider-loop.gif

Set Shell "zsh"
Set Theme "Catppuccin Mocha"
Set FontSize 15
Set Width 1100
Set Height 650
Set Padding 20
Set TypingSpeed 30ms
Set PlaybackSpeed 0.5

Hide
Type "setopt INTERACTIVE_COMMENTS"
Enter
Sleep 200ms
Ctrl+L
Show
Sleep 1s

# The idea
Type "# Step 1: Spark had an idea at 5:09 PM"
Enter
Sleep 1.5s

Type "cat .spark/ideas/2026-03-27-pheromone-cli.md 2>/dev/null || echo '(spark ideas appear after pd fleet up runs)'"
Enter
Sleep 6s

# The connection
Type ""
Enter
Type "# Step 2: Spider woke up, read Spark's idea, and found 10 connections"
Enter
Sleep 1.5s

Type "# Including this one — Spark's pheromone CLI + the Arbiter = adaptive thresholds"
Enter
Sleep 1.5s

Type "head -30 .spider/connections/2026-03-27-connections.md 2>/dev/null || echo '(spider connections appear after pd fleet up runs)'"
Enter
Sleep 6s

# The implementation proposal
Type ""
Enter
Type "# Step 3: Spark read Spider's connections, and proposed a concrete implementation"
Enter
Sleep 1.5s

Type "head -45 .spark/ideas/2026-03-27-from-spider.md 2>/dev/null || echo '(implementation proposals accumulate over time)'"
Enter
Sleep 6s

# The pub/sub that carried it
Type ""
Enter
Type "# The conversation happened on pub/sub channels. No human orchestrated it."
Enter
Sleep 1.5s

Type "pd channels"
Enter
Sleep 2s

Type "pd notes --limit 8"
Enter
Sleep 2s

# The philosophy
Type ""
Enter
Type "# This is stigmergic coordination."
Enter
Sleep 1s
Type "# No central planner. No shared memory. No meetings."
Enter
Sleep 1s
Type "# Just agents leaving traces for other agents to find."
Enter
Sleep 1s
Type "# Ideas compound. Connections multiply. The codebase evolves."
Enter
Sleep 3s
