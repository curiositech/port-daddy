# Port Daddy ⚓

<p align="center">
  <img src="https://raw.githubusercontent.com/erichowens/port-daddy/main/assets/port_daddy_cover_art.webp" alt="Port Daddy" width="600">
</p>

<p align="center">
  <strong>Your ports. My rules. Zero conflicts.</strong>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> •
  <a href="#why-port-daddy">Why Port Daddy?</a> •
  <a href="#framework-integrations">Frameworks</a> •
  <a href="#api-reference">API</a> •
  <a href="#credits">Credits</a>
</p>

---

Port Daddy is the authoritative port assignment service that eliminates port conflicts across dev servers, AI coding agents, and terminal sessions. One command, one port, zero drama.

```bash
# The only port command you'll ever need
PORT=$(get-port my-project) && npm run dev -- --port $PORT
```

## Why Port Daddy?

**The Problem:**
- Multiple projects running → constant port 3000 conflicts
- Multiple AI agents (Claude, Cursor, Aider) → race conditions
- Manual port tracking → forgotten cleanup, stale assignments
- 5+ rounds of agent negotiation → wasted tokens & time

**The Solution:**
- **Atomic assignment** - SQLite ACID transactions prevent race conditions
- **Auto-cleanup** - Tracks PIDs, removes stale assignments automatically
- **Project persistence** - Same project always gets same port (if available)
- **Universal** - Works with any framework, any language, any AI agent
- **Zero config** - One daemon, three CLI commands, infinite projects

## Quick Start

### Installation

**Option 1: Homebrew** (coming soon)
```bash
brew install port-daddy
brew services start port-daddy
```

**Option 2: Manual**
```bash
cd ~/coding/port-daddy
npm install
node install-daemon.js install
```

### Usage

```bash
# Request a port
PORT=$(get-port windags-ai)
echo $PORT  # 3100

# Use it with your dev server
npm run dev -- --port $PORT

# List active ports
list-ports

# Release when done
release-port windags-ai
```

That's it. Port Daddy handles the rest.

## Framework Integrations

### JavaScript/TypeScript Frameworks

#### Next.js
```json
{
  "scripts": {
    "dev": "PORT=$(get-port ${npm_package_name}) && next dev --port $PORT",
    "start": "PORT=$(get-port ${npm_package_name}) && next start --port $PORT"
  }
}
```

#### Vite (React, Vue, Svelte)
```json
{
  "scripts": {
    "dev": "PORT=$(get-port ${npm_package_name}) && vite --port $PORT"
  }
}
```

#### Create React App
```json
{
  "scripts": {
    "start": "PORT=$(get-port ${npm_package_name}) && react-scripts start"
  }
}
```

#### Remix
```json
{
  "scripts": {
    "dev": "PORT=$(get-port ${npm_package_name}) && remix dev --port $PORT"
  }
}
```

#### Astro
```json
{
  "scripts": {
    "dev": "PORT=$(get-port ${npm_package_name}) && astro dev --port $PORT"
  }
}
```

#### Nuxt.js
```json
{
  "scripts": {
    "dev": "PORT=$(get-port ${npm_package_name}) && nuxt dev --port $PORT"
  }
}
```

#### SvelteKit
```json
{
  "scripts": {
    "dev": "PORT=$(get-port ${npm_package_name}) && vite dev --port $PORT"
  }
}
```

#### Angular
```json
{
  "scripts": {
    "start": "PORT=$(get-port ${npm_package_name}) && ng serve --port $PORT"
  }
}
```

#### Express.js
```javascript
import express from 'express';
import { spawnSync } from 'child_process';

const result = spawnSync('get-port', ['my-api'], { encoding: 'utf8' });
const port = parseInt(result.stdout.trim());

const app = express();
app.listen(port, () => {
  console.log(`API running on port ${port}`);
});
```

### Python Frameworks

#### Flask
```python
import subprocess
import os

port = subprocess.check_output(['get-port', 'my-flask-app']).decode().strip()
os.environ['FLASK_RUN_PORT'] = port

# Then run: flask run
```

Or in code:
```python
import subprocess

port = int(subprocess.check_output(['get-port', 'my-flask-app']).decode().strip())
app.run(port=port)
```

#### Django
```bash
PORT=$(get-port my-django-app) && python manage.py runserver $PORT
```

Or with `manage.py`:
```python
import subprocess
import sys

if 'runserver' in sys.argv:
    port = subprocess.check_output(['get-port', 'my-django-app']).decode().strip()
    sys.argv.append(port)
```

#### FastAPI
```python
import subprocess
import uvicorn

port = int(subprocess.check_output(['get-port', 'my-fastapi-app']).decode().strip())
uvicorn.run(app, host="0.0.0.0", port=port)
```

### Ruby Frameworks

#### Rails
```bash
PORT=$(get-port my-rails-app) && rails server -p $PORT
```

Or in `config/puma.rb`:
```ruby
port ENV.fetch("PORT") { `get-port my-rails-app`.strip }
```

#### Sinatra
```ruby
require 'sinatra'

port = `get-port my-sinatra-app`.strip
set :port, port.to_i
```

### PHP Frameworks

#### Laravel
```bash
PORT=$(get-port my-laravel-app) && php artisan serve --port=$PORT
```

#### Symfony
```bash
PORT=$(get-port my-symfony-app) && symfony server:start --port=$PORT
```

### Go

#### Standard Library
```go
package main

import (
    "fmt"
    "net/http"
    "os/exec"
    "strings"
)

func main() {
    out, _ := exec.Command("get-port", "my-go-app").Output()
    port := strings.TrimSpace(string(out))

    http.HandleFunc("/", handler)
    fmt.Printf("Server running on port %s\n", port)
    http.ListenAndServe(":"+port, nil)
}
```

#### Gin
```go
import (
    "os/exec"
    "strings"
    "github.com/gin-gonic/gin"
)

func main() {
    out, _ := exec.Command("get-port", "my-gin-app").Output()
    port := strings.TrimSpace(string(out))

    r := gin.Default()
    r.Run(":" + port)
}
```

### Elixir

#### Phoenix
```elixir
# config/dev.exs
import System

port = System.cmd("get-port", ["my-phoenix-app"])
  |> elem(0)
  |> String.trim()
  |> String.to_integer()

config :my_app, MyAppWeb.Endpoint,
  http: [port: port]
```

### Java/Kotlin

#### Spring Boot
```kotlin
import java.io.BufferedReader
import java.io.InputStreamReader

fun main(args: Array<String>) {
    val process = Runtime.getRuntime().exec("get-port my-spring-app")
    val reader = BufferedReader(InputStreamReader(process.inputStream))
    val port = reader.readLine().trim()

    System.setProperty("server.port", port)
    runApplication<MyApplication>(*args)
}
```

Or via `application.properties`:
```bash
PORT=$(get-port my-spring-app) && java -jar app.jar --server.port=$PORT
```

### .NET

#### ASP.NET Core
```csharp
using System.Diagnostics;

var process = new Process
{
    StartInfo = new ProcessStartInfo
    {
        FileName = "get-port",
        Arguments = "my-dotnet-app",
        RedirectStandardOutput = true,
        UseShellExecute = false
    }
};
process.Start();
var port = process.StandardOutput.ReadLine()?.Trim();

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls($"http://localhost:{port}");
```

### Rust

#### Actix Web
```rust
use std::process::Command;

fn get_port(project: &str) -> u16 {
    let output = Command::new("get-port")
        .arg(project)
        .output()
        .expect("Failed to get port");

    String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse()
        .expect("Invalid port")
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let port = get_port("my-actix-app");
    HttpServer::new(|| App::new())
        .bind(("127.0.0.1", port))?
        .run()
        .await
}
```

### Docker Compose

```yaml
services:
  frontend:
    build: ./frontend
    ports:
      - "${FRONTEND_PORT:-3100}:3000"
    command: sh -c "npm run dev -- --port 3000"

  backend:
    build: ./backend
    ports:
      - "${BACKEND_PORT:-3101}:8000"
    command: sh -c "python manage.py runserver 8000"
```

Then:
```bash
export FRONTEND_PORT=$(get-port frontend)
export BACKEND_PORT=$(get-port backend)
docker-compose up
```

## CLI Reference

### get-port

Request a port assignment for a project.

```bash
# Auto-assign port
get-port my-project

# Request specific port
get-port my-project 3221

# Capture in variable
PORT=$(get-port my-project)

# Use inline
npm run dev -- --port $(get-port my-project)
```

**Behavior:**
- First call: Assigns next available port (3100-9999)
- Subsequent calls: Returns same port (if process alive)
- Records your PID for auto-cleanup

### release-port

Release a port assignment.

```bash
# Release by project name
release-port my-project

# Release by port number
release-port 3221
```

**When to use:**
- When shutting down project permanently
- When switching to different port
- To force cleanup of stale assignment

### list-ports

Show all active port assignments.

```bash
list-ports
```

**Output:**
```
PORT DADDY - Active Port Assignments
============================================================

3100 | windags-ai      | PID:12345 | alive | 15m ago
3101 | erichowens-com  | PID:12346 | alive | 2m ago
3221 | my-api          | PID:12347 | dead  | 45m ago

Total: 3 port(s)
```

**Status indicators:**
- `alive` - Process is running
- `dead` - Process exited (will be cleaned up)

## API Reference

### POST /ports/request

Request a port assignment.

**Request:**
```bash
curl -X POST http://localhost:9876/ports/request \
  -H 'Content-Type: application/json' \
  -H 'X-PID: $$' \
  -d '{"project": "my-app", "preferred": 3221}'
```

**Response:**
```json
{
  "port": 3221,
  "message": "assigned preferred port",
  "existing": false
}
```

### DELETE /ports/release

Release a port assignment.

**Request:**
```bash
curl -X DELETE http://localhost:9876/ports/release \
  -H 'Content-Type: application/json' \
  -d '{"project": "my-app"}'
```

**Response:**
```json
{
  "success": true,
  "message": "released 1 port(s) for project my-app"
}
```

### GET /ports/active

List all active port assignments.

**Request:**
```bash
curl http://localhost:9876/ports/active
```

**Response:**
```json
{
  "ports": [
    {
      "port": 3221,
      "project": "my-app",
      "pid": 12345,
      "started": 1770463572228,
      "last_seen": 1770463577664,
      "alive": true,
      "age_minutes": 15,
      "started_at": "2026-02-07T11:26:12.228Z",
      "last_seen_at": "2026-02-07T11:26:17.664Z"
    }
  ],
  "count": 1
}
```

### POST /ports/cleanup

Manually trigger cleanup of stale assignments.

**Request:**
```bash
curl -X POST http://localhost:9876/ports/cleanup
```

**Response:**
```json
{
  "freed": [
    {"port": 3333, "project": "old-app"}
  ],
  "count": 1
}
```

### GET /health

Health check endpoint.

**Request:**
```bash
curl http://localhost:9876/health
```

**Response:**
```json
{
  "status": "ok",
  "uptime_seconds": 3600,
  "active_ports": 5,
  "pid": 12945
}
```

## How It Works

### Architecture

```
┌──────────────┐
│ Your Project │
└──────┬───────┘
       │ get-port my-app
       ▼
┌──────────────────────────────┐
│   Port Daddy Service         │
│   (localhost:9876)           │
│                              │
│  ┌────────────────────────┐  │
│  │  SQLite Database       │  │
│  │  (port-registry.db)    │  │
│  │                        │  │
│  │  port | project | pid  │  │
│  │  3100 | app-1  | 123  │  │
│  │  3101 | app-2  | 456  │  │
│  └────────────────────────┘  │
└──────────────────────────────┘
       │
       │ Returns: 3100
       ▼
┌──────────────┐
│ Your Project │
│ (port 3100)  │
└──────────────┘
```

### Process Tracking

Port Daddy monitors the PID of each process that requests a port. Every 5 minutes, it checks if processes are still alive:

```bash
ps -p <pid>  # Returns exit code 0 if alive
```

If a process dies, its port is automatically freed.

### Atomic Assignment

All port assignments use SQLite transactions with WAL mode:

```sql
BEGIN TRANSACTION;
SELECT port FROM port_assignments WHERE project = ?;
-- If exists and alive: return existing
-- If not: find next available and INSERT
COMMIT;
```

This ensures two processes requesting ports simultaneously never get the same port.

### Security

- **No shell injection:** Uses `spawnSync` with direct arguments
- **Localhost only:** Binds to 127.0.0.1 (not accessible remotely)
- **No authentication:** Assumes trusted local environment
- **PID validation:** Integer parsing prevents injection
- **SQLite prepared statements:** Prevents SQL injection

## Management

### Check Service Status

```bash
cd ~/coding/port-daddy && node install-daemon.js status
```

Output:
```
🔍 Checking Port Daddy status...

✅ Daemon installed at: ~/Library/LaunchAgents/com.erichowens.port-daddy.plist
✅ Daemon is loaded (should be running)
✅ Service is responding on port 9876
```

### Restart Service

```bash
cd ~/coding/port-daddy && node install-daemon.js uninstall
cd ~/coding/port-daddy && node install-daemon.js install
```

### View Logs

```bash
# stdout
tail -f ~/coding/port-daddy/port-daddy.log

# stderr
tail -f ~/coding/port-daddy/port-daddy-error.log

# combined
tail -f ~/coding/port-daddy/*.log
```

### Database Maintenance

**View database:**
```bash
sqlite3 ~/coding/port-daddy/port-registry.db "SELECT * FROM port_assignments;"
```

**Reset database:**
```bash
cd ~/coding/port-daddy
launchctl unload ~/Library/LaunchAgents/com.erichowens.port-daddy.plist
rm port-registry.db*
launchctl load ~/Library/LaunchAgents/com.erichowens.port-daddy.plist
```

## Troubleshooting

### Port Daddy Not Running

**Symptom:** `ERROR: Port Daddy is not running`

**Solution:**
```bash
cd ~/coding/port-daddy && node install-daemon.js install
```

### Port Already In Use

**Symptom:** Dev server says "port 3221 already in use"

**Solution:**
```bash
# Check what's using the port
lsof -i :3221

# If it's a zombie process, kill it
kill -9 <pid>

# Release from Port Daddy
release-port 3221

# Or cleanup all stale assignments
curl -X POST http://localhost:9876/ports/cleanup
```

### Stale Assignments Piling Up

**Symptom:** `list-ports` shows many dead processes

**Solution:**
```bash
# Manual cleanup
curl -X POST http://localhost:9876/ports/cleanup

# Check results
list-ports
```

Auto-cleanup runs every 5 minutes, but you can force it anytime.

### Service Won't Start

**Symptom:** Installation succeeds but health check fails

**Solution:**
```bash
# Check if port 9876 is available
lsof -i :9876

# Check launchd logs
log show --predicate 'subsystem == "com.erichowens.port-daddy"' --last 1h

# Try manual start to see errors
cd ~/coding/port-daddy && node server.js
```

## Performance

| Operation | Latency | Notes |
|-----------|---------|-------|
| Port assignment | <10ms | SQLite transaction + process check |
| Cleanup scan | ~1ms/100 entries | ps command overhead |
| Health check | <1ms | Simple uptime query |
| Database size | ~50KB/1000 assignments | Very lightweight |
| Memory usage | ~40MB | Express + SQLite resident |

## Cost Savings

### Token Efficiency

**Without Port Daddy:**
- Average 5 agent rounds negotiating ports
- ~$0.02 per conflict (GPT-4/Claude Sonnet)
- 20 conflicts/day = $0.40/day
- **Annual cost: $146**

**With Port Daddy:**
- 1 query → immediate assignment
- ~$0.0001 per request (or free if using CLI)
- 20 requests/day = $0.002/day
- **Annual cost: $0.73**

**Savings: ~$145/year + developer sanity**

### Time Savings

| Task | Before | After | Savings |
|------|--------|-------|---------|
| Port assignment | 30-60s (manual) | <1s (automatic) | 29-59s |
| Conflict resolution | 2-5 min | 0s | 2-5 min |
| Cleanup | Never (forgotten) | Automatic | ∞ |
| Agent coordination | 5+ messages | 0 messages | 5+ messages |

**Per day:** ~30-60 minutes saved across all projects

## Why Not Alternatives?

| Tool | Limitation | Port Daddy Advantage |
|------|-----------|---------------------|
| **kill-my-port** | Only kills, doesn't assign | Proactive reservation system |
| **lsof + kill** | Manual intervention | Fully automated |
| **Hardcoded ports** | Conflicts across projects | Dynamic per-project assignment |
| **Environment variables** | Manual coordination needed | Atomic automatic assignment |
| **File-based registry** | Race conditions, no cleanup | SQLite ACID + PID tracking |
| **Port Killer** | Centralized but manual | Automatic process monitoring |

Port Daddy is the only tool that combines:
- Proactive port reservation
- Automatic process tracking
- Atomic assignment (no race conditions)
- Auto-cleanup of dead processes
- Universal framework support
- AI agent coordination

## Multi-Agent Workflows

Port Daddy shines in multi-agent development:

### Claude + Cursor + Aider

```bash
# Terminal 1: Claude session
PORT=$(get-port windags-ai) && npm run dev -- --port $PORT

# Terminal 2: Cursor session
PORT=$(get-port erichowens-com) && npm run dev -- --port $PORT

# Terminal 3: Aider session
PORT=$(get-port my-api) && npm run dev -- --port $PORT

# No conflicts, ever
list-ports
```

### Git Worktrees + Multiple Agents

```bash
# Main branch
cd ~/projects/my-app
PORT=$(get-port my-app-main) && npm run dev -- --port $PORT

# Feature branch worktree
cd ~/projects/my-app-feature
PORT=$(get-port my-app-feature) && npm run dev -- --port $PORT

# Each worktree gets its own port automatically
```

## Database Schema

```sql
CREATE TABLE port_assignments (
  port INTEGER PRIMARY KEY,
  project TEXT NOT NULL,
  pid INTEGER NOT NULL,
  started INTEGER NOT NULL,  -- Unix timestamp (ms)
  last_seen INTEGER NOT NULL -- Unix timestamp (ms)
);

CREATE INDEX idx_project ON port_assignments(project);
CREATE INDEX idx_pid ON port_assignments(pid);
```

**Simple and efficient:** 4 columns, 2 indexes, sub-10ms queries.

## Contributing

Port Daddy is open source and PRs are welcome! If you have ideas or find bugs:

1. Check [existing issues](https://github.com/erichowens/port-daddy/issues)
2. Open a new issue with details
3. PRs welcome for framework integrations and improvements

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Credits

<p align="center">
  <strong>Built with 🔥 by <a href="https://github.com/erichowens">Erich Owens</a> / <a href="https://curiositech.com">Curiositech LLC</a></strong>
</p>

Port Daddy was born from the chaos of running 20+ Claude sessions simultaneously, each fighting over localhost ports like toddlers over a single toy. No more.

**Tech Stack:**
- [Express.js](https://expressjs.com/) - HTTP server
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) - Atomic database operations
- [Winston](https://github.com/winstonjs/winston) - Structured logging
- [Node.js](https://nodejs.org/) - Runtime
- macOS launchd - Daemon management

**Special Thanks:**
- Claude (Anthropic) - For being the reason this exists
- The localhost:3000 conflict - For the final straw

---

<p align="center">
  <strong>Your ports. My rules. Zero conflicts.</strong>
</p>

<p align="center">
  <sub>If Port Daddy saved you from port conflict hell, star this repo ⭐</sub>
</p>

```bash
# Install
cd ~/coding/port-daddy && npm install && node install-daemon.js install

# Use
PORT=$(get-port my-app) && npm run dev -- --port $PORT

# Profit
```

<p align="center">
  <sub>© 2026 Erich Owens / Curiositech LLC</sub>
</p>
