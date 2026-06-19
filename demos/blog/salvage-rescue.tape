# Port Daddy - Dead Agent Rescue
# When an agent dies mid-task, another agent picks up where it left off.

Output demos/blog/salvage-rescue.gif

Set Shell "zsh"
Set Theme "Catppuccin Mocha"
Set FontSize 16
Set Width 900
Set Height 550
Set Padding 20
Set TypingSpeed 40ms
Set PlaybackSpeed 0.8

# Set up a "dead" agent scenario (hidden)
Hide
Type "setopt INTERACTIVE_COMMENTS"
Enter
Sleep 200ms
Type "bash demos/blog/setup-salvage.sh >/dev/null 2>&1"
Enter
Sleep 3s
Ctrl+L
Sleep 300ms
Show
Sleep 500ms

# Scene: New agent checks for dead agents
Type "# A new agent starts - check for dead agents first"
Enter
Sleep 1s
Type "pd salvage --project myapp"
Enter
Sleep 3s

# Claim the dead agent's work
Type "# Claim their work - get full context"
Enter
Sleep 800ms
Type "pd salvage claim agent-alice"
Enter
Sleep 2s

# Start your own session to continue
Type "# Continue where they left off"
Enter
Sleep 800ms
Type `pd begin "Continuing auth refactor from Alice" --identity myapp:auth --lifecycle durable`
Enter
Sleep 2s

Type `pd note "Finished session.ts module, running tests"`
Enter
Sleep 1.5s

Type `pd done "Auth refactor complete"`
Enter
Sleep 2s

Sleep 1s
