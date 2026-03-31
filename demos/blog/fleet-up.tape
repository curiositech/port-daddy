# Port Daddy - Fleet: Background Agent Management
# Declare agents in YAML, run them as a fleet.

Output demos/blog/fleet-up.gif

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
Ctrl+L
Sleep 300ms
Show
Sleep 500ms

# Show fleet status
Type "# Fleet: manage a swarm of background agents"
Enter
Sleep 800ms
Type "pd fleet status"
Enter
Sleep 3s

# Show what's in the fleet config
Type "# Agents declared in pd-fleet.yml - gardener, qa, research..."
Enter
Sleep 1s
Type "# pd fleet up starts them all, pd fleet down stops them"
Enter
Sleep 1.5s

Sleep 1s
