# Port Daddy - Quick Start
# The core "begin -> note -> whoami -> done" workflow

Output demos/gifs/quickstart.gif

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
Type "pd done 2>/dev/null; pd agent register --agent demo-agent --purpose 'cleanup' 2>/dev/null; curl -sX DELETE http://localhost:9876/agents/demo-agent 2>/dev/null"
Enter
Sleep 500ms
Ctrl+L
Sleep 300ms
Show
Sleep 500ms

# Step 1: Begin a session
Type "# Start a session - registers you and tracks your work"
Enter
Sleep 800ms
Type `pd begin "Building the payment API"`
Enter
Sleep 2s

# Step 2: Leave notes as you work
Type "# Leave notes - immutable breadcrumbs for future agents"
Enter
Sleep 800ms
Type `pd note "Finished Stripe integration, starting PayPal"`
Enter
Sleep 1.5s

Type `pd note "PayPal sandbox working, writing tests" --type progress`
Enter
Sleep 1.5s

# Step 3: Check context
Type "# Check your context - see what you're working on"
Enter
Sleep 800ms
Type "pd whoami"
Enter
Sleep 2s

# Step 4: Done
Type "# Wrap up - ends session cleanly"
Enter
Sleep 800ms
Type `pd done "Payment API complete, all tests passing"`
Enter
Sleep 2s

Sleep 1s
