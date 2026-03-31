# Spider's Syllogisms — The Connection Engine
#
# This tape is about Spider specifically — showing how it finds
# combinatorial connections between features via formal syllogisms.
# PREMISE A + PREMISE B = THEREFORE (new capability)
#
# This is the "mind-blown" demo — the one for the research crowd

Output demos/blog/spider-syllogisms.gif

Set Shell "zsh"
Set Theme "Catppuccin Mocha"
Set FontSize 15
Set Width 1100
Set Height 700
Set Padding 20
Set TypingSpeed 30ms
Set PlaybackSpeed 0.6

Hide
Type "setopt INTERACTIVE_COMMENTS"
Enter
Sleep 200ms
Ctrl+L
Show
Sleep 800ms

# Intro
Type "# Spider — the connection engine"
Enter
Type "# Finds what no one notices: two features that compose into a third"
Enter
Sleep 2s

# Show Spider's config
Type "# Spider's job: read the feature manifest + codebase, output syllogisms"
Enter
Sleep 1s

Type "grep -A 5 'spider:' pd-fleet.yml | head -8"
Enter
Sleep 3s

# The connections file
Type "# Spider's output: formal syllogisms"
Enter
Sleep 1s

Type "cat .spider/connections/2026-03-27-connections.md | head -5"
Enter
Sleep 2s

# Syllogism S1: Pheromone + Arbiter = Adaptive Thresholds
Type ""
Enter
Type "# S1: Two features. One new capability. No new code required."
Enter
Sleep 1s

Type "sed -n '9,21p' .spider/connections/2026-03-27-connections.md"
Enter
Sleep 6s

# Syllogism S9: Worktree + Trie = Auto-Namespaced Identities
Type "# S9: This one solved a problem we'd been fighting for weeks"
Enter
Sleep 1s

Type "sed -n '137,149p' .spider/connections/2026-03-27-connections.md"
Enter
Sleep 6s

# Syllogism S10: Spawner + Pheromone = Reputation-Based Backend Selection
Type "# S10: The reputation system bootstrapped from existing primitives"
Enter
Sleep 1s

Type "sed -n '153,165p' .spider/connections/2026-03-27-connections.md"
Enter
Sleep 6s

# How Spark picks up Spider's connections
Type ""
Enter
Type "# Spark reads Spider's syllogisms and proposes implementations"
Enter
Sleep 1s

Type "head -10 .spark/ideas/2026-03-27-from-spider.md"
Enter
Sleep 4s

# The creative loop
Type ""
Enter
Type "# The loop: Spider finds → Spark proposes → QA validates → Documentarian records"
Enter
Type "# Nobody plans this. It emerges from the pub/sub topology."
Enter
Sleep 3s

# Show the channel wiring
Type "grep -E 'trigger:|on_success:' pd-fleet.yml"
Enter
Sleep 4s

Type ""
Enter
Type "# Agents that create ideas. Agents that connect ideas."
Enter
Type "# A fleet that thinks while you sleep."
Enter
Sleep 3s
