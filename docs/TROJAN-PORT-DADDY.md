# Trojan Port Daddy: Multiple Entry Points, One Daemon

## The Strategy

Every entry point looks like a simple, focused tool. Each one silently installs and starts the full Port Daddy daemon. By the time users discover the depth, they're already coordinating agents.

```
USER THINKS                WHAT ACTUALLY HAPPENS
─────────────              ──────────────────────
"I need a port manager"    → Full daemon + agent coordination
"I want MCP tools"         → Full daemon + sessions + salvage
"I want a status bar"      → Full daemon + dashboard + fleet
"I want a coding agent"    → Full daemon + spawn + pub/sub
"I want npx one-liner"     → Daemon starts, claims port, exits
```

## Entry Points

### 1. `brew install port-daddy` — The Port Manager

**Surface:** "Never fight port conflicts again."
**Depth:** Full daemon installs as launchd service.

```bash
brew install port-daddy
pd claim myapp:api
# Port Daddy daemon auto-starts, registers as launchd service
# User thinks they installed a port manager
# They installed an agent coordination platform
```

**What to build:** Homebrew formula (Ruby). Needs:
- Tap at `curiositech/homebrew-tap`
- Formula downloads npm package + runs `pd install`
- Post-install message: "Port Daddy is running. Try: pd claim myapp:api"

### 2. `npx port-daddy` — The Zero-Install One-Liner

**Surface:** "Claim a port without installing anything."
**Depth:** If daemon isn't running, starts it. Leaves daemon running after exit.

```bash
# User just wants a port
PORT=$(npx port-daddy claim myapp:api -q)
echo "Using port $PORT"

# Daemon is now running in the background
# Next time they run npx port-daddy, it's instant (daemon alive)
```

**What to build:** Already works via npm package. Need:
- `postinstall` script that runs `pd install` silently
- Or: `pd claim` auto-starts daemon if not running (ALREADY EXISTS — line 2184 in CLI)

### 3. `pd mcp install` — The Claude Code Plugin

**Surface:** "Add Port Daddy tools to Claude Code."
**Depth:** 44 MCP tools including session management, salvage, pub/sub, tuple space.

```bash
pd mcp install
# Adds to ~/.claude.json
# User gets: begin_session, end_session, claim_port, add_note, whoami, ...
# They start using pd begin/pd done because Claude suggests it
# They're coordinating agents without knowing it
```

**What to build:** Already exists. Need:
- Better onboarding in MCP tool descriptions
- `session_nudge` (already shipped) guides users toward sessions
- Tutorial blog post: "Setting Up Port Daddy MCP"

### 4. `pd menubar` — The Status Bar App (NEW)

**Surface:** "See your agents at a glance."
**Depth:** Menubar shows live fleet status, agent heartbeats, session activity.

```
┌─────────────────────────────────┐
│ ⚓ Port Daddy                   │
├─────────────────────────────────┤
│ 3 agents active                 │
│ 7 ports claimed                 │
│ ░░░░░░░░░░░░░░ 0 violations    │
├─────────────────────────────────┤
│ qa          ● running (2m)      │
│ gardener    ○ idle (next: 8m)   │
│ spark       ○ idle (next: 22m)  │
├─────────────────────────────────┤
│ Open Dashboard...               │
│ Fleet Up / Down                 │
│ Preferences...                  │
└─────────────────────────────────┘
```

**What to build:**
- **Option A:** Swift/SwiftUI native menubar app (best UX, macOS only)
  - Uses `NSStatusItem` + SwiftUI view
  - Polls `localhost:9876/status` every 10s
  - SSE subscription for real-time updates
  - ~500 lines of Swift

- **Option B:** Electron menubar (cross-platform, heavier)
  - Uses `menubar` npm package
  - Web view of a simplified dashboard
  - ~200 lines of JS but 100MB+ binary

- **Option C:** Rust + Tauri menubar (cross-platform, light)
  - System tray with webview panel
  - ~300 lines of Rust + HTML
  - 5-10MB binary

**Recommendation:** Option A (Swift) for macOS. Port Daddy is macOS-first (launchd). A native menubar app reinforces the "always-on daemon" mental model. Ship as `pd menubar install` which copies the .app to `/Applications` and adds a login item.

### 5. `pd agent` — The Coding Agent (NEW)

**Surface:** "An AI coding agent that coordinates with others."
**Depth:** Uses pd begin/done/notes/claims/salvage automatically. The agent IS the coordination.

```bash
pd agent "Fix the auth bug in session.ts"
# Equivalent to:
#   pd begin --identity myapp:agent --purpose "Fix auth bug"
#   pd spawn --backend claude-cli -- "Fix the auth bug in session.ts"
#   (agent runs, uses pd notes/claims/pub/sub internally)
#   pd done

# The user doesn't call pd begin or pd done
# The agent does it. Coordination is invisible.
```

**What to build:**
- A thin wrapper around `pd spawn` that auto-wraps with `pd begin`/`pd done`
- The spawned agent's prompt includes Port Daddy coordination instructions
- On death, the salvage system preserves context automatically
- ~50 lines in `cli/commands/agent.ts`

### 6. `pd init` — The Project Onboarding (ENHANCE EXISTING)

**Surface:** "Set up Port Daddy for this project."
**Depth:** Scans project, generates pd-fleet.yml, installs MCP, creates .portdaddy/ context.

```bash
cd myproject
pd init
# Scans: Next.js + Express + PostgreSQL detected
# Generates: pd-fleet.yml with gardener, qa, test-hunter
# Creates: .portdaddy/current.json
# Installs: MCP tools (if Claude Code detected)
# Suggests: "Run pd fleet up to start your agents"
```

**What to build:** Enhance existing `pd learn` + `pd scan` into a unified `pd init`:
- Framework detection (already exists)
- Fleet template generation (new — pick agents based on detected stack)
- MCP auto-install if `.claude/` directory exists
- `.portdaddy/` directory creation

## The Funnel

```
                    AWARENESS
                    ┌─────────────────────────────┐
                    │ Blog post / HN / Twitter     │
                    │ "The Port Collision That      │
                    │  Ate My Saturday"             │
                    └─────────────┬───────────────┘
                                  │
                    INSTALLATION
                    ┌─────────────┴───────────────┐
                    │ brew install port-daddy       │
                    │ npx port-daddy claim myapp    │
                    │ pd mcp install                │
                    └─────────────┬───────────────┘
                                  │
                    FIRST VALUE (< 5 minutes)
                    ┌─────────────┴───────────────┐
                    │ pd claim myapp:api           │
                    │ (port conflict solved)        │
                    └─────────────┬───────────────┘
                                  │
                    DISCOVERY (< 30 minutes)
                    ┌─────────────┴───────────────┐
                    │ pd begin / pd done            │
                    │ pd files / pd notes           │
                    │ (coordination discovered)     │
                    └─────────────┬───────────────┘
                                  │
                    DEPTH (< 1 week)
                    ┌─────────────┴───────────────┐
                    │ pd fleet up                   │
                    │ pd watch / pd spawn           │
                    │ pd salvage                    │
                    │ pd tuple                      │
                    │ (full platform adopted)        │
                    └─────────────┬───────────────┘
                                  │
                    ADVOCACY
                    ┌─────────────┴───────────────┐
                    │ "Have you tried Port Daddy?"  │
                    └─────────────────────────────┘
```

## Implementation Priority

| Entry Point | Effort | Impact | Priority |
|-------------|--------|--------|----------|
| `npx port-daddy` (auto-start) | Already done | High | SHIPPED |
| `pd mcp install` | Already done | High | SHIPPED |
| Blog content (9 articles) | Done this session | High | READY TO DEPLOY |
| `brew install` (Homebrew tap) | 2-3 hours | Very High | NEXT |
| `pd agent` (thin wrapper) | 1-2 hours | High | NEXT |
| `pd init` (project onboarding) | 4-6 hours | High | NEXT |
| `pd menubar` (Swift app) | 2-3 days | Medium | SOON |
| Trojan npx postinstall | 1 hour | Medium | SOON |

## The Key Insight

Port Daddy doesn't need to be sold as "agent coordination infrastructure." It needs to be sold as:
- **To solodevs:** "Never fight port conflicts again"
- **To teams:** "Know what your AI agents are doing"
- **To enterprises:** "Audit trail for all agent activity"

The coordination happens automatically once the daemon is running. The daemon runs once installed. Installation happens through any entry point.

Every entry point is a Trojan horse. The horse is beautiful. What's inside is an agent coordination platform.
