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

Type "cat .spark/ideas/2026-03-27-pheromone-cli.md"
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

Type "sed -n '9,21p' .spider/connections/2026-03-27-connections.md"
Enter
Sleep 6s

# The implementation proposal
Type ""
Enter
Type "# Step 3: Spark read Spider's S2, and proposed a concrete implementation"
Enter
Sleep 1.5s

Type "head -45 .spark/ideas/2026-03-27-from-spider.md"
Enter
Sleep 6s

# The pub/sub that carried it
Type ""
Enter
Type "# The conversation happened on pub/sub channels. No human orchestrated it."
Enter
Sleep 1.5s

Type "pd msg spark:idea"
Enter
Sleep 2s

Type "pd msg spider:connections"
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
