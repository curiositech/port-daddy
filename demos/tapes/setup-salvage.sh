#!/bin/bash
# Setup script for salvage demo — called from salvage.tape's hidden block
# Creates a "dead agent" scenario with agent-alice in the resurrection queue

DB="port-registry.db"

# Clean up any previous demo state
sqlite3 "$DB" "DELETE FROM resurrection_queue" 2>/dev/null
curl -sX DELETE http://localhost:9876/agents/agent-alice >/dev/null 2>&1
sqlite3 "$DB" "DELETE FROM session_notes WHERE session_id IN (SELECT id FROM sessions WHERE agent_id = 'agent-alice')" 2>/dev/null
sqlite3 "$DB" "DELETE FROM session_files WHERE session_id IN (SELECT id FROM sessions WHERE agent_id = 'agent-alice')" 2>/dev/null
sqlite3 "$DB" "DELETE FROM sessions WHERE agent_id = 'agent-alice'" 2>/dev/null

# Register agent-alice
curl -sX POST http://localhost:9876/agents \
  -H 'Content-Type: application/json' \
  -d '{"id":"agent-alice","name":"Alice","type":"claude-code","purpose":"Refactoring auth system"}' \
  >/dev/null 2>&1

sleep 0.3

# Create a session for agent-alice
curl -sX POST http://localhost:9876/sessions \
  -H 'Content-Type: application/json' \
  -d '{"purpose":"Splitting monolithic auth.ts into modules","agentId":"agent-alice","files":["src/auth/login.ts","src/auth/session.ts","src/auth/types.ts"]}' \
  >/dev/null 2>&1

sleep 0.3

# Add a progress note
curl -sX POST http://localhost:9876/notes \
  -H 'Content-Type: application/json' \
  -d '{"content":"Split auth.ts into 3 modules, login.ts done, session.ts in progress","type":"progress"}' \
  >/dev/null 2>&1

sleep 0.3

# Insert directly into resurrection queue (no reap endpoint exists)
SESSION_ID=$(sqlite3 "$DB" "SELECT id FROM sessions WHERE agent_id = 'agent-alice' LIMIT 1")
NOW_MS=$(python3 -c "import time; print(int(time.time() * 1000))")

sqlite3 "$DB" "INSERT OR REPLACE INTO resurrection_queue (agent_id, agent_name, session_id, purpose, detected_at, status) VALUES ('agent-alice', 'Alice', '$SESSION_ID', 'Refactoring auth system', $NOW_MS, 'pending')"

# Delete agent so it appears properly dead
sqlite3 "$DB" "DELETE FROM agents WHERE id = 'agent-alice'"

echo "Salvage demo setup complete"
