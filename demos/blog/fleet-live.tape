# Fleet Live — Real-Time Agent Activity
#
# This tape subscribes to all fleet pub/sub channels simultaneously
# and shows the activity stream. It's like watching the heartbeat
# of a living system.
#
# Best run WHILE the fleet is active (pd fleet up first)
# This is the "ambient" demo — mesmerizing to watch

Output demos/blog/fleet-live.gif

Set Shell "zsh"
Set Theme "Catppuccin Mocha"
Set FontSize 14
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

# Show what's running
Type "# The fleet is running. Let's see who's alive."
Enter
Sleep 1s

Type "pd agents --json 2>/dev/null | python3 -c \"import sys,json; agents=json.load(sys.stdin).get('agents',[]); [print(f'  {a[\\\"id\\\"][:12]:12s}  {a.get(\\\"identity\\\",\\\"?\\\"):30s}  {a.get(\\\"purpose\\\",\\\"\\\")[:40]}') for a in agents[:8]]\" 2>/dev/null || echo '  (fleet not running — start with pd fleet up)'"
Enter
Sleep 3s

# Show active sessions
Type "# Their sessions — each one tracking work in progress"
Enter
Sleep 1s

Type "pd sessions --json 2>/dev/null | python3 -c \"import sys,json; ss=json.load(sys.stdin).get('sessions',[]); [print(f'  {s[\\\"id\\\"][:10]:10s}  {s.get(\\\"purpose\\\",\\\"\\\")[:50]:50s}  {s.get(\\\"phase\\\",\\\"?\\\")}') for s in ss[:6] if s.get('status')=='active']\" 2>/dev/null || echo '  (no active sessions)'"
Enter
Sleep 3s

# Show the channels they communicate on
Type "# The channels they talk through"
Enter
Sleep 1s

Type "pd channels"
Enter
Sleep 3s

# Show recent notes
Type "# Notes they've left — immutable breadcrumbs"
Enter
Sleep 1s

Type "pd notes --limit 5"
Enter
Sleep 4s

# Show activity timeline
Type "# The activity stream — everything that happened"
Enter
Sleep 1s

Type "pd activity --limit 10"
Enter
Sleep 4s

# Show file heat map
Type "# Where in the codebase are they working?"
Enter
Sleep 1s

Type "pd pheromone files --depth 1 2>/dev/null || echo '  (pheromone data accumulates over time)'"
Enter
Sleep 3s

# The dashboard
Type ""
Enter
Type "# All of this is also visible at http://localhost:9876"
Enter
Type "# The dashboard updates in real-time via Server-Sent Events"
Enter
Sleep 2s

Type "# The fleet runs. The codebase improves. You sleep."
Enter
Sleep 3s
