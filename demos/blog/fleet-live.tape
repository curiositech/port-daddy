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
Type "eval \"$(pd use stable)\""
Enter
Sleep 800ms
Ctrl+L
Show
Sleep 800ms

# Show what's running
Type "# The fleet is running. Let's see who's alive."
Enter
Sleep 1s

Type "pd agents"
Enter
Sleep 3s

# Show active sessions
Type "# Their sessions — each one tracking work in progress"
Enter
Sleep 1s

Type "pd sessions"
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

Type "curl -s \"${PORT_DADDY_URL}/pheromone/files?depth=1\" | python3 -mjson.tool 2>/dev/null || echo '  (pheromone data accumulates over time)'"
Enter
Sleep 3s

# The dashboard
Type ""
Enter
Type "# FleetBar opens this selected daemon's published Control Center"
Enter
Type "open \"$PORT_DADDY_URL\""
Enter
Type "# The dashboard updates in real-time via Server-Sent Events"
Enter
Sleep 2s

Type "# The fleet runs. The codebase improves. You sleep."
Enter
Sleep 3s
