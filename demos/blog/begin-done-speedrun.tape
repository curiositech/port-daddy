# Port Daddy - Zero to Multi-Agent in 30 Seconds
# The speedrun: begin a session, leave notes, check context, done.

Output demos/blog/begin-done-speedrun.gif

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
Type "pd release myapp:api 2>/dev/null"
Enter
Sleep 300ms
Ctrl+L
Sleep 300ms
Show
Sleep 500ms

# Step 1: Begin — registers agent + starts session in one call
Type "# Start a session with an identity"
Enter
Sleep 800ms
Type `pd begin "Building the payment API" --identity myapp:api --lifecycle durable`
Enter
Sleep 2s

# Step 2: Check who you are
Type "# Check your context at any time"
Enter
Sleep 800ms
Type "pd whoami"
Enter
Sleep 2s

# Step 3: Leave a breadcrumb
Type "# Leave immutable notes as you work"
Enter
Sleep 800ms
Type `pd note "Stripe integration complete"`
Enter
Sleep 1.5s

# Step 4: Wrap up cleanly
Type "# Done - ends session and unregisters agent"
Enter
Sleep 800ms
Type `pd done "Payment API shipped"`
Enter
Sleep 2s

Sleep 1s
