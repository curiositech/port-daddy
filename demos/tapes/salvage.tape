# Port Daddy - Agent Resurrection (Salvage)
# When an agent dies mid-task, its work isn't lost

Output demos/gifs/salvage.gif

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
Type "bash demos/tapes/setup-salvage.sh >/dev/null 2>&1"
Enter
Sleep 3s
Ctrl+L
Sleep 300ms
Show
Sleep 500ms

# Scene: New agent starts work, checks for dead agents first
Type "# A new agent starts - first, check if anyone died mid-task"
Enter
Sleep 1s
Type "pd salvage"
Enter
Sleep 3s

# Claim the dead agent's work
Type "# Claim their work and continue where they left off"
Enter
Sleep 800ms
Type "pd salvage claim agent-alice"
Enter
Sleep 2s

# Continue their work
Type "# Now continue the work with full context"
Enter
Sleep 800ms
Type `pd note "Picked up from Alice - finishing session.ts module"`
Enter
Sleep 1.5s

Type `pd done "Auth refactor complete - all modules passing"`
Enter
Sleep 2s

Sleep 1s
