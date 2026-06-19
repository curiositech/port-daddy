# Port Daddy - Distributed Locks
# Prevent two agents from running migrations at the same time.

Output demos/blog/distributed-lock.gif

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
Type "pd unlock db-migration 2>/dev/null; pd unlock build-lock 2>/dev/null"
Enter
Sleep 500ms
Ctrl+L
Sleep 300ms
Show
Sleep 500ms

# with-lock: acquire, run, release in one command
Type "# with-lock: acquire, run command, auto-release"
Enter
Sleep 800ms
Type `pd with-lock db-migration echo "Running migration... done."`
Enter
Sleep 2s

# Manual lock lifecycle
Type "# Manual locks for longer-held resources"
Enter
Sleep 800ms
Type "pd lock build-lock --ttl 30000"
Enter
Sleep 1.5s

# Show active locks
Type "# See what's locked"
Enter
Sleep 800ms
Type "pd locks"
Enter
Sleep 2s

# Release
Type "# Release when finished"
Enter
Sleep 800ms
Type "pd unlock build-lock"
Enter
Sleep 1.5s

Sleep 1s
