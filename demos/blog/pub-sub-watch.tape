# Port Daddy - Pub/Sub Messaging
# Event-driven coordination between agents.

Output demos/blog/pub-sub-watch.gif

Set Shell "zsh"
Set Theme "Catppuccin Mocha"
Set FontSize 16
Set Width 900
Set Height 500
Set Padding 20
Set TypingSpeed 40ms
Set PlaybackSpeed 0.8

# Clean slate (hidden)
Hide
Type "setopt INTERACTIVE_COMMENTS"
Enter
Sleep 200ms
Type "pd channels clear test-events 2>/dev/null; pd channels clear build-results 2>/dev/null"
Enter
Sleep 500ms
Ctrl+L
Sleep 300ms
Show
Sleep 500ms

# Publish a message
Type "# Publish events to named channels"
Enter
Sleep 800ms
Type `pd pub test-events '{"status":"passed","suite":"auth","duration":4.2}'`
Enter
Sleep 1.5s

Type `pd pub test-events '{"status":"passed","suite":"payments","duration":1.8}'`
Enter
Sleep 1.5s

# Read messages
Type "# Any agent can read the channel history"
Enter
Sleep 800ms
Type "pd channels"
Enter
Sleep 2s

# Show watch concept
Type "# pd watch: trigger scripts on channel events"
Enter
Sleep 800ms
Type "# pd watch build-results --exec './deploy.sh'"
Enter
Sleep 1.5s

Sleep 1s
