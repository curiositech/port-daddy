# Port Daddy - No More Port Conflicts
# Semantic identities give every service a stable, unique port.

Output demos/blog/port-conflict.gif

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
Type "pd release myapp:api >/dev/null 2>&1; pd release myapp:frontend >/dev/null 2>&1; pd release myapp:db >/dev/null 2>&1"
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
Type "pd claim myapp:api"
Enter
Sleep 1.5s

Type "pd claim myapp:frontend"
Enter
Sleep 1.5s

Type "pd claim myapp:db"
Enter
Sleep 1.5s

# Show all services
Type "# Find all services for a project"
Enter
Sleep 800ms
Type `pd find "myapp:*"`
Enter
Sleep 2s

# Quiet mode for scripting
Type "# Quiet mode - just the port number, for scripts"
Enter
Sleep 800ms
Type `PORT=$(pd claim myapp:api -q) && echo "API running on port $PORT"`
Enter
Sleep 1.5s

# Clean up (hidden)
Hide
Type "pd release myapp:api >/dev/null 2>&1; pd release myapp:frontend >/dev/null 2>&1; pd release myapp:db >/dev/null 2>&1"
Enter
Sleep 300ms
Show

Sleep 1s
