# pubsub.tape — Real-time agent coordination via Swarm Radio
# Shows pub/sub messaging between agents

Output demos/pubsub.gif

Set FontSize 16
Set Width 1000
Set Height 550
Set Padding 30
Set TypingSpeed 40ms
Set Theme "Catppuccin Macchiato"

Hide
Type "clear"
Enter
Sleep 500ms
Show

# 1. Register two agents
Type "pd agent register --agent builder-01 --identity myapp:api --purpose 'Building REST endpoints'"
Enter
Sleep 2s

Type "pd agent register --agent tester-01 --identity myapp:test --purpose 'Writing integration tests'"
Enter
Sleep 2s

# 2. Publish a message
Type "pd pub myapp:build '{\"status\":\"endpoints ready\",\"count\":12}'"
Enter
Sleep 1.5s

# 3. Check channels
Type "pd channels"
Enter
Sleep 2s

# 4. Read the message
Type "pd sub myapp:build --last 1"
Enter
Sleep 2.5s

# 5. Lock a shared resource
Type "pd lock deploy --owner builder-01 --ttl 60000"
Enter
Sleep 1.5s

Type "pd locks"
Enter
Sleep 2.5s

# 6. Release lock
Type "pd unlock deploy --owner builder-01"
Enter
Sleep 1.5s

# Cleanup
Hide
Type "pd agent unregister --agent builder-01 2>/dev/null; pd agent unregister --agent tester-01 2>/dev/null"
Enter
Show

Sleep 2s
