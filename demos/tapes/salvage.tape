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
Type "pd done 2>/dev/null"
Enter
Sleep 300ms
Type "curl -sX DELETE http://localhost:9876/agents/agent-alice 2>/dev/null"
Enter
Sleep 300ms
Type `curl -sX POST http://localhost:9876/agents -H 'Content-Type: application/json' -d '{"id":"agent-alice","name":"Alice","type":"claude-code","purpose":"Refactoring auth system","identity":"myapp:auth:refactor"}' 2>/dev/null`
Enter
Sleep 300ms
Type `curl -sX POST http://localhost:9876/sessions -H 'Content-Type: application/json' -d '{"purpose":"Splitting monolithic auth.ts into modules","agentId":"agent-alice","files":["src/auth/login.ts","src/auth/session.ts","src/auth/types.ts"]}' 2>/dev/null`
Enter
Sleep 300ms
Type `curl -sX POST http://localhost:9876/notes -H 'Content-Type: application/json' -d '{"content":"Split auth.ts into 3 modules, login.ts done, session.ts in progress","type":"progress"}' 2>/dev/null`
Enter
Sleep 300ms
Type `sqlite3 /Users/erichowens/coding/port-daddy/port-registry.db "UPDATE agents SET lastHeartbeat = datetime('now', '-30 minutes') WHERE id = 'agent-alice'"`
Enter
Sleep 300ms
Type "curl -sX POST http://localhost:9876/resurrection/reap 2>/dev/null"
Enter
Sleep 500ms
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
Type "pd salvage --claim agent-alice"
Enter
Sleep 2s

# Continue their work
Type "# Now continue the work with full context"
Enter
Sleep 800ms
Type `pd note "Picked up from Alice - finishing session.ts module"`
Enter
Sleep 1.5s

Type `pd done "Auth refactor complete - login.ts, session.ts, types.ts all passing"`
Enter
Sleep 2s

Sleep 1s
