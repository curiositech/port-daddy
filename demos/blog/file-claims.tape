# Port Daddy - File Claims: 4 Agents, Zero Conflicts
# Advisory file ownership prevents merge collisions.

Output demos/blog/file-claims.gif

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
Type "pd done 2>/dev/null"
Enter
Sleep 500ms
Ctrl+L
Sleep 300ms
Show
Sleep 500ms

# Begin a session with identity
Type "# Agent begins work on auth module"
Enter
Sleep 800ms
Type `pd begin "Auth refactor" --identity myapp:auth`
Enter
Sleep 2s

# Claim files
Type "# Claim the files you're working on"
Enter
Sleep 800ms
Type "pd session files add src/auth.ts src/middleware.ts"
Enter
Sleep 1.5s

# Show ownership
Type "# Anyone can check who owns what"
Enter
Sleep 800ms
Type "pd who-owns src/auth.ts"
Enter
Sleep 1.5s

# Clean up
Type "# Done - files released automatically"
Enter
Sleep 800ms
Type `pd done "Auth refactor complete"`
Enter
Sleep 2s

Sleep 1s
