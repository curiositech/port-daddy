# Port Daddy Tuples — Linda-Style Coordination
#
# Tuples are the blackboard. Agents write structured data into a shared
# space. Other agents read or take it. Nobody needs to know who's listening.
#
# This is the coordination pattern that predates pub/sub, predates REST,
# and still works better than both for certain problems.
#
# Linda (1985) → JavaSpaces → Port Daddy Tuples (2026)

Output demos/blog/tuples-tutorial.gif

Set Shell "zsh"
Set Theme "Catppuccin Mocha"
Set FontSize 15
Set Width 1100
Set Height 650
Set Padding 20
Set TypingSpeed 35ms
Set PlaybackSpeed 0.6

Hide
Type "setopt INTERACTIVE_COMMENTS"
Enter
Sleep 200ms
Ctrl+L
Show
Sleep 1s

# Act 1: What's a tuple?
Type "# Tuples: structured data in a shared space"
Enter
Type "# Write with 'out'. Read with 'rd'. Take with 'in'."
Enter
Sleep 2s

# Write some tuples
Type "# Agent A posts a task into the space"
Enter
Sleep 800ms
Type `pd tuple out '{"type":"task","action":"write-tests","file":"auth.ts","priority":1}'`
Enter
Sleep 2s

Type "# Agent B posts a different task"
Enter
Sleep 800ms
Type `pd tuple out '{"type":"task","action":"fix-bug","file":"session.ts","priority":2}'`
Enter
Sleep 2s

# Act 2: Reading
Type ""
Enter
Type "# Any agent can read all tasks (non-destructive — tuples stay)"
Enter
Sleep 800ms
Type `pd tuple rd '{"type":"task"}'`
Enter
Sleep 3s

Type "# Or read only high-priority tasks"
Enter
Sleep 800ms
Type `pd tuple rd '{"type":"task","priority":1}'`
Enter
Sleep 3s

# Act 3: Taking (destructive read — claim the work)
Type ""
Enter
Type "# Agent C TAKES a task — removes it from the space"
Enter
Type "# Now nobody else can claim it. This is atomic coordination."
Enter
Sleep 1.5s
Type `pd tuple in '{"type":"task","priority":1}'`
Enter
Sleep 3s

Type "# The taken task is gone from the space"
Enter
Sleep 800ms
Type "pd tuple scan"
Enter
Sleep 3s

# Act 4: Harbor scoping
Type ""
Enter
Type "# Tuples can be scoped to harbors — team boundaries"
Enter
Sleep 1s
Type `pd tuple out '{"type":"result","status":"tests-pass"}' --harbor backend`
Enter
Sleep 2s

Type `pd tuple rd '{"type":"result"}' --harbor backend`
Enter
Sleep 3s

# Act 5: The Pattern
Type ""
Enter
Type "# The pattern: agents don't talk TO each other."
Enter
Type "# They talk THROUGH the tuple space."
Enter
Type "# Producer doesn't know the consumer. Consumer doesn't know the producer."
Enter
Type "# The space mediates. Coordination without coupling."
Enter
Sleep 4s
