# Port Daddy - Semantic Port Management
# Stable ports from semantic identities - no more port conflicts

Output demos/gifs/ports.gif

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
Type "pd release myapp:api:main >/dev/null 2>&1; pd release myapp:frontend:main >/dev/null 2>&1; pd release myapp:db:test >/dev/null 2>&1"
Enter
Sleep 500ms
Ctrl+L
Sleep 300ms
Show
Sleep 500ms

# Claim ports with semantic identities
Type "# Claim ports - same identity always gets the same port"
Enter
Sleep 800ms
Type "pd claim myapp:api:main"
Enter
Sleep 1.5s

Type "pd claim myapp:frontend:main"
Enter
Sleep 1.5s

Type "pd claim myapp:db:test"
Enter
Sleep 1.5s

# Find services
Type "# Find all services for a project"
Enter
Sleep 800ms
Type `pd find "myapp:*"`
Enter
Sleep 2s

# Quiet mode for scripts
Type "# Quiet mode - just the port number, perfect for scripts"
Enter
Sleep 800ms
Type `PORT=$(pd claim myapp:api:main -q) && echo "API on port $PORT"`
Enter
Sleep 1.5s

# Release
Type "# Release when done"
Enter
Sleep 800ms
Type "pd release myapp:api:main"
Enter
Sleep 1.5s

Sleep 1s
