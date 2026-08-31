# Port Daddy V4: Harbor-First Architecture Plan

## Reading Guide

This document has 28 parts. They were written iteratively — later parts amend earlier
ones, and the dependency graph isn't linear. **Don't read front-to-back.** Use this
guide instead.

### If you're implementing V4: Critical Path (read these first)

1. **Part I** — Harbor-first architecture. The thesis, enforcement middleware, capability
   attenuation, filesystem isolation. Everything else depends on this.
2. **Part VIII** — Binary transport (msgpack). Ships in V4.0 alongside enforcement.
3. **Part XVIII** — Key management. Where keys live, rotation, HMAC → Ed25519 migration.
4. **Part XIX** — Schema migrations. How the database evolves across versions.
5. **Part XVII** — Distributed state & conflict resolution. The hardest problem. Required
   for remote harbors but the HLC and sync protocol design informs local choices too.
6. **Part XXV** — Retrospective amendments. Patches gaps in Parts I-XVI. Read AFTER
   the parts it amends.
7. **Part XXVIII** — Gap analysis. Twelve unsolved problems with proposed solutions.

### If you're planning the product: Strategy & Positioning

- **Part V** — Monetization (open core + hosted lighthouse)
- **Part XXII** — Market positioning & competitive landscape
- **Part XXI** — UX complexity management & error design
- **Part IV** — Website copy and content strategy

### If you're building the surfaces: CLI, Dashboard, MCP, Website

- **Part IX** — Dashboard wireframes (layout and data) — revised by Part XXIV
- **Part XXIV** — Dashboard architecture (Web Components, ADR-0016)
- **Part X** — MCP server V4 tool plan (108 tools, harbor card flow)
- **Part XI** — Website V2 full wireframes
- **Part XVI** — Agent skills, `pd teach`, application templates

### If you're designing the distributed system: Remote Harbors

- **Part I § Phase 2** → **Part III** (lighthouse discovery) → **Part XII** (trust tiers)
  → **Part XIII** (harbor data structures) → **Part XVII** (sync protocol)
  → **Part XXVIII** Gaps 1-12

### If you're working on a specific feature

| Feature | Read |
|---------|------|
| Windows support | Part II |
| Semantic trie | Part VII |
| Regions (code boundaries) | Part XIV |
| Pheromones / stigmergy | Part XV (deferred to V4.2-V4.3) |
| Observability & logging | Part XX |
| Storage lifecycle & CI/CD | Part XXIII |
| Anchor Protocol (task economy) | Part XXVII |

### Cross-references and supersessions

- Part XVII supersedes Part I's wire protocol (SSE → WebSocket)
- Part XXIV supersedes Part IX's implicit single-file approach
- Part XXV amends Parts I-XVI with operational detail
- Part XXVI cross-pollinates ideas from a parallel planning effort
- ADR-0017 (proposed in Part IX revision) supersedes ADR-0005 (single-file dashboard)
- `harbor.json` replaces all references to `lighthouse.json` as the config manifest
  (decided in Part XXVIII Gap 12)

---
---

# Part I: Harbor-First Architecture

## The Thesis

You said three things, and they're actually one thing:

1. **Default harbors** — agents shouldn't have access to everything
2. **Networked harbors** — your desktop and MacBook should coordinate
3. **`pd team` is just `pd harbor remote`** — harbors ARE the coordination unit

The insight is: **harbors are not a feature. Harbors are the security model.** Everything
flows through a harbor. Local harbors are just remote harbors where the remote is localhost.

The ProVerif proofs (the registered models in `whitepaper/formal/proverif/harbor-card/`) already verify this. The formal property
`Accepted(B, harbor, cap) ==> IssuedRoot(A, harbor, cap) && Delegated(A, B, cap)` holds
for delegation chains. The crypto (`lib/harbor-tokens.ts`, `core/harbor-card-rs/`) is
real. What's missing is the **wiring** — the middleware that actually enforces harbor
cards on every request, and the networking layer that connects daemons.

---

## Phase 1: Default Harbors (Enforce Locally)

### What changes

**Today:** `pd begin` calls `sugar.begin()` → registers agent + starts session. No harbor
involvement. Every agent operates in a global namespace with full access to everything.

**After:** `pd begin` auto-creates a harbor named after the project identity prefix,
enters the agent into it, and returns a harbor card. All subsequent requests from that
agent must present the harbor card. Requests without a valid card are rejected (not
logged and ignored — *rejected*).

### Implementation

#### 1. Auto-harbor on `pd begin`

Modify `lib/sugar.ts` `begin()`:

```
begin(options) →
  1. Register agent (existing)
  2. Extract project from identity (e.g., "myapp" from "myapp:api:feature")
  3. Create harbor if not exists: harbors.create(project, { capabilities: ['*'] })
  4. Enter harbor: harbors.enter(project, agentId, { capabilities: requested_caps })
  5. Store harbor card in response
  6. Start session (existing)
```

The harbor is named after the **project segment** of the identity. All agents working on
`myapp:*` share the `myapp` harbor. This is the "invisible by default" security boundary.

#### 2. Enforcement middleware

New file: `lib/harbor-middleware.ts`

Express middleware that runs on every mutating route (POST/PUT/DELETE):

```
function requireHarborCard(harborTokens) {
  return async (req, res, next) => {
    const token = req.headers['x-harbor-card'] || req.query.harborCard;

    // Allow unauthenticated: health, version, config, GET /harbors
    if (isPublicRoute(req)) return next();

    // No token = reject
    if (!token) return res.status(401).json({ error: 'harbor card required' });

    // Verify token (algorithm pinned to HS256, checks revocation, checks lhb)
    const payload = await harborTokens.verifyHarborCard(token);
    if (!payload) return res.status(403).json({ error: 'invalid harbor card' });

    // Attach to request for downstream capability checks
    req.harborCard = payload;
    next();
  };
}
```

Capability checks per route:
- `POST /claim/*` → requires `ports:claim` or `*`
- `POST /sessions/*/notes` → requires `notes:write` or `*`
- `POST /msg/*` → requires `msg:publish` or `*`
- `POST /locks/*` → requires `locks:acquire` or `*`
- `DELETE /*` → requires the specific `*:delete` cap or `*`

#### 3. Capability attenuation on `pd spawn`

When an agent spawns a child via `pd spawn`, the child gets a **delegated** harbor card
with reduced capabilities. The parent's card has `cap: ['*']`. The child's card has
`cap: ['code:read', 'notes:write']` — whatever the parent specifies.

This is exactly what the ProVerif v3 delegation model proves safe:
- Parent cannot escalate (give child more caps than it has)
- Child cannot forge (HMAC signature binds caps to the token)
- Daemon is sole arbiter (all verification goes through `harbor-tokens.ts`)

#### 4. Backward compatibility

**Grace period mode:** For V4.0, add a `--enforce-harbors` flag (default: `warn`).
In `warn` mode, missing harbor cards log a warning but don't reject. In `enforce` mode,
they reject. This lets existing scripts and integrations migrate.

V4.1 flips the default to `enforce`.

#### 5. Filesystem isolation — run the daemon as a dedicated OS user

Harbor cards are **application-layer access control**. They gate what an agent can do
*through the Port Daddy API*. They do NOT restrict what the agent's underlying process
can do on the filesystem. An agent running as your dev user can `rm -rf` the daemon's
source, delete `port-registry.db`, overwrite key files, or kill the daemon process.

This is the same trust boundary as postgres, redis, and nginx: the daemon protects its
own data by running as a separate OS user. The API is the only interface.

**Implementation (V4.0):**

Run the daemon as a dedicated `portdaddy` system user. The launchd/systemd service
config already manages the daemon — just specify the user.

```bash
# Linux (systemd)
sudo useradd -r -s /bin/false -d /var/lib/port-daddy portdaddy
sudo chown portdaddy:portdaddy /var/lib/port-daddy/port-registry.db
sudo chown -R portdaddy:portdaddy /var/lib/port-daddy/keys/

# In the systemd unit file:
[Service]
User=portdaddy
Group=portdaddy

# macOS (launchd)
# Create a _portdaddy system account (underscore prefix is macOS convention)
# In the launchd plist:
<key>UserName</key>
<string>_portdaddy</string>
```

**What this protects:**
- `port-registry.db` — owned by `portdaddy`, dev user can't corrupt or delete it
- `~portdaddy/.config/port-daddy/keys/` — key material inaccessible to agent processes
- The daemon process itself — agents running as your dev user can't `kill` it

**What this does NOT protect:**
- Your source code — agents need filesystem access to do their job. File claims are
  advisory coordination, not OS-level enforcement.
- The daemon binary — if installed globally via npm, it's world-readable. An agent
  could modify it. Mitigation: `pd keys verify` checks code hash on startup.

**The security boundary statement:** Harbors are the security model for the Port Daddy
API. The OS user model is the security model for the daemon's own state. These are
complementary layers, not alternatives. Neither alone is sufficient.

**Migration for existing installs:**

```bash
pd install --system-user          # V4.0: creates user + reinstalls service
pd install --system-user=custom   # use a custom username
pd install                        # V3 behavior: runs as current user (warns in V4)
```

`pd install` without `--system-user` in V4 logs a warning:
`"⚠ Daemon running as your user. For production use: pd install --system-user"`

#### 6. `pd begin` without `--identity`

If no identity is given, use the current directory name as project:
```
cd ~/code/myapp && pd begin "working on auth"
→ identity: myapp:default:session-abc123
→ harbor: myapp (auto-created)
```

#### 7. Branches, harbors, and git worktrees

**Branches are not harbors.** All agents working on `myapp:*` share the `myapp`
harbor regardless of which branch they're on. This is correct — agents on different
branches of the same repo still need to see each other's file claims, sessions, and
pub/sub messages. An agent on `main` and an agent on `feature-auth` can conflict
on the same file.

**The practical problem:** A git repo can only have one branch checked out at a time.
Two agents in the same directory can't work on different branches — one does
`git checkout feature-a` and blows away the other's working state.

**The solution:** Git worktrees. Port Daddy already tracks `worktree_id` on agent
registration.

```bash
# Main checkout stays on main
cd ~/code/myapp

# Create a worktree for the second agent's branch
git worktree add ../myapp-feature-auth feature-auth

# Agent A works in the main checkout
pd begin "API refactor" --identity myapp:api:main --worktree default

# Agent B works in the worktree
cd ../myapp-feature-auth
pd begin "auth feature" --identity myapp:api:feature-auth --worktree feature-auth
```

Both agents are in the **same harbor** (`myapp`). They see each other's file claims,
coordinate via pub/sub, and avoid conflicts. But they have independent working trees,
so `git checkout` in one doesn't affect the other.

**`pd begin` with worktree auto-detection:** If the current directory is a git
worktree (detected via `git rev-parse --git-common-dir`), the worktree name is
set automatically. No `--worktree` flag needed.

```bash
cd ~/code/myapp-feature-auth
pd begin "auth feature" --identity myapp:api:feature-auth
# → worktree: feature-auth (auto-detected)
# → harbor: myapp (same as main checkout)
```

**When to use different harbors instead:** Long-lived forks or release branches
that never merge back. Use a different project name:

```bash
pd begin "v2 hotfix" --identity myapp-v2:api:hotfix    # harbor: myapp-v2
pd begin "v3 feature" --identity myapp-v3:api:feature  # harbor: myapp-v3
```

These are separate harbors — agents can't see each other. Use this when the branches
are effectively separate codebases.

---

## Phase 2: Remote Harbors (Network Daemons)

### The model

A "remote harbor" is not a new concept. It's a harbor whose members span multiple
daemon instances. The daemons sync harbor state over an authenticated channel.

```
┌──────────────────┐          ┌──────────────────┐
│  MacBook Pro      │   TLS    │  PC Desktop      │
│  daemon :9876     │◄────────►│  daemon :9876    │
│                   │  mutual  │                  │
│  harbor: myapp    │  auth    │  harbor: myapp   │
│    agent-A        │          │    agent-B       │
│    agent-C        │          │    agent-D       │
└──────────────────┘          └──────────────────┘
         ▲                              ▲
         │  harbor card                 │  harbor card
         │  (HS256 → Ed25519)           │  (same harbor key)
    ┌────┴──────┐                 ┌─────┴─────┐
    │  Claude   │                 │  Cursor   │
    │  agent    │                 │  agent    │
    └───────────┘                 └───────────┘
```

### `pd harbor connect` (replaces `pd team`)

```bash
# On MacBook (the "lighthouse" — first daemon):
pd harbor create myapp --remote --listen 0.0.0.0:9877
# → Harbor 'myapp' is now accepting remote peers on :9877
# → Peer token: eyJ... (give this to the other machine)

# On PC Desktop (the "peer"):
pd harbor connect myapp --peer 192.168.1.50:9877 --token eyJ...
# → Connected to myapp harbor on MacBook
# → Local agents can now see remote agents, file claims, sessions, pub/sub
```

No relay server. No cloud dependency. Direct daemon-to-daemon over your local network
(or Tailscale/WireGuard for remote). The barnacle Rust crate (`core/pd-barnacle/`) already
has axum + tokio + reqwest — it can serve as the networking foundation.

### What syncs

Not everything. Harbors sync **coordination state**, not all daemon state:

| Syncs | Doesn't sync |
|-------|-------------|
| Harbor membership | Port assignments (local resource) |
| File claims within harbor | Activity logs |
| Session status + notes | Webhooks |
| Pub/sub messages on harbor channels | DNS records |
| Lock state for harbor resources | Daemon config |
| Agent liveness (heartbeats) | Other harbors |

### Authentication between daemons

**Phase 1 (V4.0):** Shared HMAC key per harbor. Both daemons have the same signing key.
Harbor cards issued on either machine are valid on both. Simple, proven by ProVerif v1.

**Phase 2 (V4.x):** Ed25519 per daemon. Each daemon has its own keypair. Harbor cards
are signed by the issuing daemon but verifiable by any daemon that knows the public key.
This is ProVerif v2 (asymmetric model) — already verified.

### Wire protocol

~~SSE for real-time sync, HTTP for RPCs~~ **Superseded by Part XVII:** WebSocket for
bidirectional sync channel, HTTP for one-off RPCs. See Part XVII for the full
sync protocol, Merkle hashing, and conflict resolution model.

```
WS  /harbor/:name/sync    — persistent bidirectional sync channel
POST /harbor/:name/verify  — verify a harbor card from the other daemon
GET  /harbor/:name/state   — one-off state snapshot
```

All traffic is TLS with mutual authentication (each daemon presents its harbor card
to the other). The Noise protocol work in `lib/tunnel.ts` could also serve here.

---

## Phase 3: The CLI Surface

### New commands

```bash
# Default harbor (invisible, automatic)
pd begin "auth refactor" --identity myapp:api:auth
# → auto-creates harbor 'myapp', enters agent, returns card

# Explicit harbor management
pd harbor create myapp:security-review --cap code:read,notes:write
pd harbor enter myapp:security-review
pd harbor show myapp
pd harbors

# Remote harbors (replaces pd team)
pd harbor listen myapp --port 9877          # advertise harbor
pd harbor connect myapp --peer <host:port>  # join remote harbor
pd harbor peers myapp                       # list connected daemons
pd harbor disconnect myapp --peer <host>    # leave

# Spawn with attenuated capabilities
pd spawn --backend claude --cap code:read,notes:write -- "Review the auth module"
# → child agent gets delegated harbor card with only those caps
```

### What `pd team` becomes

There is no `pd team`. It was always `pd harbor connect`. The harbor IS the team
boundary. When you connect your MacBook to your desktop's harbor, you ARE a team.
When a third machine connects, it's a bigger team. No new abstraction needed.

---

## What This Means for the Formal Verification

The ProVerif models already prove exactly what we need:

| Model | What it proves | Where it applies |
|-------|---------------|-----------------|
| `harbor_card_v1.pv` | HMAC tokens can't be forged | Local enforcement (Phase 1) |
| `harbor_card_v1_refined.pv` | Algorithm confusion immune | CVE-2026-22817 defense |
| `harbor_card_v2_asymmetric.pv` | Ed25519 tokens work cross-daemon | Remote harbors (Phase 2) |
| `harbor_card_v3_delegation.pv` | Capability attenuation is safe | Spawn delegation (Phase 1) |

This is not theoretical. The proofs exist. The Rust implementation (`core/harbor-card-rs/`)
with Kani verification exists. The TypeScript implementation (`lib/harbor-tokens.ts`) exists.
What's missing is the middleware that says "no card, no entry."

---

## Files to Create/Modify

### New files
- `lib/harbor-middleware.ts` — Express middleware for harbor card enforcement
- `lib/sync-protocol.ts` — WebSocket sync protocol, Merkle hashing, diff exchange (see Part XVII)
- `lib/hlc.ts` — Hybrid Logical Clock implementation (see Part XVII)
- `lib/conflict-resolver.ts` — LWW resolution, conflict detection (see Part XVII)

### Modified files
- `lib/sugar.ts` — auto-create harbor on `pd begin`
- `lib/spawner.ts` — delegate attenuated harbor cards to children
- `server.ts` — wire middleware, wire harbor-sync routes
- `cli/commands/harbors.ts` — add `listen`, `connect`, `peers`, `disconnect`
- `lib/client.ts` — add harbor connect/listen/peers SDK methods
- `routes/harbors.ts` — add sync/stream endpoints
- `completions/*.{bash,zsh,fish}` — new subcommands

### Test files
- `tests/unit/harbor-middleware.test.js` — enforcement unit tests
- `tests/unit/sync-protocol.test.js` — WebSocket sync protocol unit tests (see Part XVII)
- `tests/unit/hlc.test.js` — HLC property tests (see Part XVII)
- `tests/unit/conflict-resolver.test.js` — conflict resolution unit tests (see Part XVII)
- `tests/integration/harbor-remote.test.js` — two-daemon integration test

---

## Execution Order

1. **Harbor middleware + auto-harbor on begin** (Phase 1 core — biggest bang)
2. **Capability attenuation on spawn** (Phase 1 delegation)
3. **Grace period → enforce migration** (Phase 1 rollout)
4. **Harbor sync protocol design** (Phase 2 foundation)
5. **`pd harbor connect` + daemon-to-daemon auth** (Phase 2 networking)
6. **Shell completions + SDK + docs** (parity)

Phase 1 is the V4.0 release. Phase 2 is V4.1-4.2. Phase 3 (CLI polish) ships
incrementally with each.

---
---

# Part II: Windows Support

## The Problem

Port Daddy is macOS/Linux only. ADR-0004 explicitly says "Unix sockets are not available
on Windows (irrelevant — Port Daddy targets macOS/Linux dev environments)." That was true
when this was a port management tool. It's not true when this is an agent coordination
runtime — Cursor, Windsurf, and VS Code on Windows represent a massive agent-heavy audience.

## Blockers (Ranked by Severity)

### Critical — Daemon Won't Start

| Blocker | File(s) | Windows Equivalent |
|---------|---------|-------------------|
| Unix socket binding | `server.ts:668-730`, `/tmp/port-daddy.sock` in ~20 files | Named pipes (`\\.\pipe\port-daddy`) |
| `/tmp/` hardcoded paths | `server.ts:151-154`, `lib/client.ts:23`, `bin/port-daddy-cli.ts:95` | `os.tmpdir()` (returns `%TEMP%`) |
| Rust native library `.dylib`/`.so` only | `lib/arbiter.ts:20` | Add `.dll` case |

### High — Core Commands Fail

| Blocker | File(s) | Windows Equivalent |
|---------|---------|-------------------|
| `lsof` for port scanning | `shared/port-utils.js:98,138,212,229` | `netstat -ano` or `Get-NetTCPConnection` |
| `ps` for PID liveness | `shared/port-utils.js:34,51,267` | `tasklist /FI "PID eq N"` or `process.kill(pid, 0)` |
| `launchctl` (macOS service) | `install-daemon.ts:107-136` | Windows Service (`sc.exe`) or NSSM |
| `systemctl` (Linux service) | `install-daemon.ts:190-224` | Same as above |

### Medium — Features Degrade

| Blocker | File(s) | Notes |
|---------|---------|-------|
| `open`/`xdg-open` missing Windows | `cli/commands/services.ts:235` | Already handled in `diagnostics.ts:182` — just copy the pattern |
| mDNS/Bonjour assumptions | `lib/dns.ts` | Windows has mDNS but different API |

### Already Handled

- `lib/orchestrator.ts:360` — correctly uses `cmd /c` on Windows
- `cli/commands/diagnostics.ts:182` — correctly uses `start` on Windows

## Architecture: Platform Adapter

Don't scatter `process.platform` checks everywhere. Create one adapter:

```
lib/platform.ts

interface PlatformAdapter {
  // Transport
  getSocketPath(): string;          // Unix socket path or named pipe
  getTempDir(): string;             // /tmp or %TEMP%
  getPortFile(): string;            // port discovery file

  // Process introspection
  isProcessAlive(pid: number): boolean;
  findProcessOnPort(port: number): ProcessInfo | null;
  listListeningPorts(): PortInfo[];

  // Service management
  installService(config: ServiceConfig): void;
  uninstallService(): void;
  getServiceStatus(): ServiceStatus;

  // Shell
  getShell(): [string, string];     // ['sh', '-c'] or ['cmd', '/c']
  getOpenCommand(): string;         // 'open', 'xdg-open', 'start'

  // Native libraries
  getNativeLibExtension(): string;  // '.dylib', '.so', '.dll'
}

function createPlatform(): PlatformAdapter {
  switch (process.platform) {
    case 'darwin': return new DarwinAdapter();
    case 'linux':  return new LinuxAdapter();
    case 'win32':  return new WindowsAdapter();
    default: throw new Error(`Unsupported platform: ${process.platform}`);
  }
}
```

Every file that currently calls `lsof`, `ps`, checks `/tmp`, or references sockets
gets refactored to use `platform.xyz()` instead. One import, one adapter, zero
platform conditionals in business logic.

## Windows Transport: Named Pipes

Named pipes are Windows' equivalent of Unix sockets. Node.js supports them natively:

```typescript
// server.ts
const PIPE_PATH = '\\\\.\\pipe\\port-daddy';
app.listen(PIPE_PATH);  // works with Express

// client.ts
http.request({ socketPath: '\\\\.\\pipe\\port-daddy', ... });  // works with http module
```

The SDK (`lib/client.ts`) already has `SocketTarget` vs `TcpTarget` — named pipes
fit cleanly into `SocketTarget` since Node.js treats them the same way.

## Windows Service Management

Three options, in order of preference:

1. **`node-windows`** npm package — creates a proper Windows Service. Restarts on crash.
   Equivalent to launchd/systemd. Most reliable.
2. **NSSM (Non-Sucking Service Manager)** — wraps any executable as a Windows Service.
   External dependency but well-known.
3. **Startup folder shortcut** — lowest-friction, least reliable. No crash recovery.

Recommendation: ship with `node-windows` for `pd install`, fall back to startup
folder for `pd start` (manual mode, same as current unsupported-platform behavior).

## Windows Port Scanning

Replace `lsof -i -P -n` with:

```typescript
// WindowsAdapter.listListeningPorts()
const { stdout } = spawnSync('netstat', ['-ano', '-p', 'TCP']);
// Parse: TCP 0.0.0.0:3000 0.0.0.0:0 LISTENING 12345
```

Or use PowerShell for richer data:
```typescript
spawnSync('powershell', ['-Command', 'Get-NetTCPConnection -State Listen | ConvertTo-Json']);
```

The `netstat` approach is faster and doesn't require PowerShell execution policy changes.

## Execution Plan

1. Create `lib/platform.ts` with `DarwinAdapter`, `LinuxAdapter`, `WindowsAdapter`
2. Refactor `shared/port-utils.js` to use platform adapter
3. Refactor `server.ts` socket binding to use platform adapter
4. Refactor `install-daemon.ts` to use platform adapter
5. Update `lib/client.ts`, `lib/request.ts`, `cli/utils/fetch.ts` socket paths
6. Add `.dll` case to `lib/arbiter.ts`
7. Add Windows CI target in `.github/workflows/ci.yml`
8. Cross-compile `core/harbor-card-rs` and `core/pd-barnacle` for Windows
9. Test on Windows (real machine or GitHub Actions `windows-latest`)

## What Doesn't Change

- SQLite (`better-sqlite3`) — works on Windows, has prebuilt binaries
- Express — platform-independent
- All business logic — harbors, sessions, locks, pub/sub, salvage
- The SDK interface — callers don't see the transport layer
- MCP server — stdio transport is platform-independent

---
---

# Part III: Lighthouse Discovery

## The Concept

When you run `pd harbor connect myapp --peer 192.168.1.50:9877`, you need to know the
IP address. That's fine for two machines on your desk. It breaks down when:

- Your IP changes (DHCP, coffee shop, VPN)
- You have 3+ machines
- You want zero-config "just works" discovery

Lighthouses solve this. Three discovery mechanisms, layered:

## Layer 1: Local Network Discovery (mDNS/Bonjour)

**What it is:** Your MacBook and PC desktop find each other automatically on the same
LAN, like AirDrop finds nearby Macs.

**Protocol:** mDNS (Multicast DNS) / DNS-SD (Service Discovery). macOS has Bonjour
built-in. Linux has Avahi. Windows has mDNS support since Windows 10.

**How it works:**

```
MacBook daemon starts →
  Advertises: _portdaddy._tcp.local. port 9877
  TXT record: harbor=myapp, version=4.0, pubkey=ed25519:abc123...

PC desktop daemon starts →
  Browses: _portdaddy._tcp.local.
  Discovers: MacBook at 192.168.1.50:9877, harbor=myapp
  Auto-connects (if harbor name matches and token is pre-shared)
```

**CLI:**
```bash
pd harbor listen myapp --advertise        # advertise on local network
pd harbor discover                        # scan for nearby daemons
pd harbor connect myapp --auto            # auto-connect to discovered peer
```

**Implementation:** Use the `bonjour-service` npm package (pure JS, works on all platforms).
Or use `dns-sd` / `mdns` native bindings for better performance.

**Security:** Discovery only reveals existence and harbor name. Connection still requires
a valid harbor card (HMAC or Ed25519 signed). Advertising is opt-in (`--advertise` flag).
You can discover a daemon but can't join its harbor without a token.

**This is the zero-config layer.** Two machines on the same WiFi, both running Port Daddy
with a `myapp` harbor — they find each other. No IP addresses, no configuration.

## Layer 2: WAN Discovery via portdaddy.dev Registry

**What it is:** A lightweight public registry where daemons can register their harbor
endpoints for discovery across the internet (not just LAN).

**Architecture:**

```
┌─────────────────────┐
│  registry.portdaddy.dev  │
│  (Cloudflare Worker)     │
│                          │
│  harbor_endpoints:       │
│    myapp@erichowens →    │
│      host: tailscale-ip  │
│      port: 9877          │
│      pubkey: ed25519:... │
│      last_seen: 2m ago   │
└─────────────────────┘
      ▲              ▲
      │ register     │ lookup
      │              │
  MacBook         PC Desktop
  (home)          (office)
```

**How it works:**

```bash
# On MacBook (registers with the lighthouse):
pd harbor listen myapp --lighthouse
# → Registered myapp@erichowens at registry.portdaddy.dev
# → Peers can connect with: pd harbor connect myapp --from erichowens

# On PC Desktop (discovers via lighthouse):
pd harbor connect myapp --from erichowens
# → Looked up myapp@erichowens at registry.portdaddy.dev
# → Found: 100.64.0.5:9877 (Tailscale IP)
# → Connected.
```

**What the registry stores:**
- Harbor name + owner identity (e.g., `myapp@erichowens`)
- Public key (Ed25519) — for verification, NOT the HMAC secret
- Connection endpoint (IP:port) — can be Tailscale, WireGuard, public IP, etc.
- Heartbeat timestamp — stale entries are cleaned up
- **NO harbor cards, NO secrets, NO session data**

The registry is a phone book, not a relay. Data still flows daemon-to-daemon.

**Implementation:** Cloudflare Worker + KV store. ~200-300 lines of code (signed challenge
auth, KV storage, heartbeat cleanup, lookup API). Free tier handles
millions of lookups/month. Alternatively, a simple Express endpoint on portdaddy.dev.

**Security:**
- Registration requires a signed challenge (daemon proves it controls the Ed25519 key)
- Lookup is public (knowing an endpoint exists is not a vulnerability)
- Connection still requires harbor card exchange (ProVerif-verified)
- No traffic passes through the registry — it's pure discovery

**This is the convenience layer.** Your machines find each other across networks
without exchanging IP addresses manually.

## Layer 3: Self-Hosted Lighthouse

For teams and enterprises that don't want to use portdaddy.dev:

```bash
# Run your own lighthouse:
pd lighthouse serve --port 9878
# → Lighthouse running at http://lighthouse.internal:9878

# Configure daemons to use it:
pd harbor listen myapp --lighthouse http://lighthouse.internal:9878
pd harbor connect myapp --lighthouse http://lighthouse.internal:9878
```

Same protocol as Layer 2, just pointed at your own server. The lighthouse is a
~300-400 line Express app that stores harbor endpoints in SQLite (auth, cleanup, lookup).

**This is the enterprise layer.** Self-hosted, air-gapped, controlled.

## Discovery Priority

When `pd harbor connect myapp` is run without explicit flags:

1. Check local mDNS — is there a `myapp` harbor on the LAN?
2. Check portdaddy.dev — is there a registered `myapp` endpoint?
3. Check configured lighthouses — any custom registries?
4. Fail with helpful message listing options

```bash
pd harbor connect myapp
# → Scanning local network... found MacBook.local:9877 (myapp)
# → Connect? [Y/n]
```

## Files to Create

- `lib/discovery.ts` — mDNS advertisement and browsing
- `lib/lighthouse-client.ts` — portdaddy.dev registry client
- `lib/lighthouse-server.ts` — self-hosted lighthouse (for `pd lighthouse serve`)
- `routes/lighthouse.ts` — lighthouse HTTP endpoints
- `cli/commands/lighthouse.ts` — `pd lighthouse serve`, `pd harbor discover`

## What This Enables

The full flow becomes:

```bash
# Machine 1 (MacBook, home):
pd begin "building auth" --identity myapp:api:auth
# → harbor 'myapp' created, harbor card issued, advertised on mDNS

# Machine 2 (PC Desktop, same network):
pd begin "building frontend" --identity myapp:web:auth
# → discovers 'myapp' harbor on LAN via mDNS
# → auto-connects, gets harbor card
# → file claims visible across both machines
# → pub/sub messages flow between agents on both machines

# Machine 3 (laptop at coffee shop, different network):
pd harbor connect myapp --from erichowens
# → looks up portdaddy.dev, finds Tailscale endpoint
# → connects, joins the harbor
```

Three machines, zero IP addresses typed, cryptographically authenticated.

---
---

# Part IV: Website V2 — Copy and Content Strategy

## Current State

The website is **better than the feedback suggested**. It's already positioned around
agent coordination, not port management:

- **Hero:** "Port Authority for AI Swarms" — good
- **Features:** "The Definitive Control Plane" with 12 features — good
- **Tutorials:** 16 real tutorials with content, not stubs — good
- **Docs:** SDK manual with command cards — good
- **Blog:** 1 deep technical post on formal verification — good start

The messaging is already V4-aligned. The problems are:

1. **GitHub links wrong** — `erichowens/port-daddy` → should be `curiositech/port-daddy`
2. **Brew tap wrong** — `erichowens/port-daddy` → should be `curiositech/port-daddy`
3. **No OpenGraph / social meta tags** — sharing shows nothing
4. **Blog has 1 post** — needs more content
5. **Copy doesn't mention harbors as security boundary** — it mentions them but as a
   feature, not as the fundamental architecture
6. **No "Why not just..." comparison page** — docker-compose, detect-port, etc.

## Content Strategy: What to Write

### Immediate Fixes (Before V4 Ships)

1. **Fix all GitHub/brew links** — 5 files in website-v2:
   - `Nav.tsx:79`
   - `CTABanner.tsx:58,79`
   - `Footer.tsx:96`
   - `GettingStarted.tsx:48`
   - `blogData.ts:89`

2. **Add OpenGraph meta tags** to `index.html`:
   ```html
   <meta property="og:title" content="Port Daddy — Port Authority for AI Swarms" />
   <meta property="og:description" content="Atomic port assignment, cryptographic harbors, and agent coordination for multi-agent development." />
   <meta property="og:image" content="/og-image.png" />
   <meta property="og:url" content="https://portdaddy.dev" />
   <meta name="twitter:card" content="summary_large_image" />
   ```

3. **Create OG image** — 1200x630px, dark navy background, Port Daddy logo, tagline

### Hero Revision for V4

Current hero is good but doesn't convey the **security story**. V4 hero should lead
with the enforcement angle:

```
Before: "Port Authority for AI Swarms."
After:  "Your agents run in zero-trust harbors. Or they don't run at all."

Subhead: "Cryptographic capability tokens. Formally verified with ProVerif.
          The coordination runtime that treats agent security as non-negotiable."
```

Keep "Port Authority for AI Swarms" as a secondary tagline. The V4 story is about
harbors being enforced, not advisory.

### Blog Content Pipeline

Priority order (each is a standalone post that drives SEO traffic):

1. **"We Formally Proved Our Agent Security Protocol. Here's What We Found."**
   Expand the existing ProVerif blog post. Include the actual verification output,
   the attack scenarios, the delegation chain proof. This is link-bait for the
   security/formal-methods community.

2. **"Why Your AI Agents Need Zero-Trust Security (And How to Add It)"**
   The V4 harbor enforcement story. Before/after. "Today, your Claude agent has
   root access to everything. Here's why that's terrifying."

3. **"4 Claude Agents, 1 Codebase, 0 Conflicts: A Walkthrough"**
   The practical demo post. Step-by-step with terminal recordings. Show `pd begin`,
   file claims preventing conflicts, pub/sub coordination, salvage on crash.

4. **"Port Daddy vs. Docker Compose vs. Random Ports: An Honest Comparison"**
   The comparison page disguised as a blog post. Be honest about when docker-compose
   is the right answer. Show where Port Daddy wins (agent coordination, no containers,
   sub-2ms latency).

5. **"How We Coordinate Development Across a MacBook and a PC Desktop"**
   The remote harbors story. Your actual use case. Real screenshots, real workflow.

### Tutorial Updates for V4

The existing 16 tutorials are good. Add:

- **Tutorial 17: "Default Harbors"** — What changed in V4, why every `pd begin` now
  creates a harbor, what capability attenuation means for spawned agents
- **Tutorial 18: "Remote Harbors"** — Connect two machines, see file claims sync,
  pub/sub across the network
- **Tutorial 19: "Lighthouse Discovery"** — mDNS auto-discovery, portdaddy.dev
  registration, self-hosted lighthouse

### Comparison Page

New route: `/compare`

Three columns: Port Daddy | Docker Compose | detect-port / --port 0

| Feature | Port Daddy | Docker Compose | detect-port |
|---------|-----------|---------------|------------|
| Port conflicts | Solved (atomic) | Solved (container networking) | Solved (random) |
| Deterministic ports | Yes (same identity = same port) | Yes (in docker-compose.yml) | No (random each time) |
| Agent coordination | Yes (sessions, file claims, pub/sub) | No | No |
| Multi-machine sync | Yes (remote harbors) | Yes (Swarm/K8s) | No |
| Security boundaries | Yes (harbor cards, formally verified) | Yes (container isolation) | No |
| Setup complexity | `npm install -g port-daddy` | Dockerfile + compose.yml | `npm install detect-port` |
| Resource overhead | ~20MB daemon | Docker Desktop (~2GB) | Zero |

Be honest. Docker Compose is better if you already have containers. detect-port is
better if you just need one port. Port Daddy is better if you have agents.

### MCP Page Expansion

The MCP page currently lists tools by category. Add:

- **Install instructions** (one-liner for Claude Code, Cursor, etc.)
- **"Essential 8" walkthrough** — what each tool does, when to use it
- **Example agent session** — show a Claude Code transcript using MCP tools

---
---

# Part V: Monetization

## Pricing Model: Open Core + Hosted Lighthouse

### What's Free (Forever)

Everything that runs on your machine:
- Daemon, CLI, SDK, MCP server
- All local primitives: ports, sessions, locks, pub/sub, salvage, inbox
- Local harbors with enforcement
- Capability delegation (spawn with attenuated cards)
- Dashboard
- mDNS discovery (LAN)
- Shell completions, tutorials, docs

**Why free:** Local-first tools win on adoption. The daemon running on every developer's
machine is the distribution moat. Charging for local features kills adoption before
network effects kick in.

### Pro ($14/seat/month) *(revised from $19 in Part XXII — see pricing validation)*

For individual developers who work across machines:

- **portdaddy.dev lighthouse registration** — register harbors for WAN discovery
- **Remote harbor connections** (up to 5 peers) — sync across machines *(revised from 3 in Part XXII)*
- **Session replays** — timeline view of all actions in a session
- **Priority mDNS** — faster discovery, persistent peer memory
- **Email support**

**Why $14:** Low enough for an individual to expense without a second thought. The
value prop is "my MacBook and my desktop work together without me typing IP addresses."

### Team ($39/team/month, up to 10 seats) *(revised from $49 in Part XXII)*

For teams running multi-developer agent swarms:

- Everything in Pro
- **Unlimited remote peers** — whole team's machines coordinate
- **Self-hosted lighthouse** — `pd lighthouse serve` for internal networks
- **Team dashboard** — aggregate view of all agents across all machines
- **Harbor audit logs** — who did what, when, where (exportable)
- **SAML/SSO** (roadmap) — enterprise auth

**Why $39/team:** A team of 5 devs each running 2-3 agents is 10-15 agents that need
coordination. That's real infrastructure value. $39 is well below the "needs procurement
approval" threshold at most companies.

### Enterprise (Custom)

For companies with compliance requirements:

- Everything in Team
- **On-prem lighthouse** — air-gapped, self-hosted registry
- **SAML/SSO + SCIM** — provision users from corporate directory
- **Compliance audit logs** — SOC 2, ISO 27001 compatible exports
- **SLA** — guaranteed response times
- **Custom capability policies** — centrally-managed harbor permissions
- **$500-2000/month** depending on seat count

### What NOT to Charge For

- **The daemon itself** — never. It's the adoption engine.
- **MCP tools** — never. Agents need these to function. Paywalling them kills the ecosystem.
- **Local harbors** — never. Security should be default, not premium.
- **Shell completions** — never. Developer ergonomics are table stakes.

### Revenue Projections (Revised — see Part XXII for validation)

| Quarter | Users | Pro ($14) | Team ($39) | Enterprise | MRR |
|---------|-------|-----------|------------|------------|-----|
| Q3 2026 | 500 | 10 | 2 | 0 | $218 |
| Q4 2026 | 2,000 | 40 | 8 | 1 | $1,372 |
| Q1 2027 | 5,000 | 100 | 25 | 3 | $3,875 |
| Q2 2027 | 10,000 | 200 | 60 | 8 | $7,540 |

This assumes **2% Pro conversion** (revised from 4% — see Part XXII pricing
validation), 0.5% Team conversion, and <0.1% Enterprise. Conservative.

### Implementation: License Key System

Keep it simple. No DRM, no phone-home-or-die:

```bash
pd license activate <key>
# → Stored in ~/.portdaddy/license.json
# → Enables remote harbor features
# → Checked locally (not on every request)
# → Grace period if license server unreachable
```

License validation happens at `pd harbor connect` and `pd lighthouse` time, not on
every daemon request. The daemon never stops working because a license check failed.

### The Real Revenue Play (V5+)

**Managed lighthouse + cloud spawn:**

```bash
pd spawn --cloud --backend claude --model claude-sonnet -- "Audit the codebase"
# → Port Daddy provisions a cloud container
# → Wires it into your harbor
# → Agent runs, coordinated via your local daemon
# → Billed per agent-minute
```

This is the "Heroku for agent fleets" play. Thin margins on LLM API costs, thick
margins on orchestration/coordination value. But this is V5 — don't build it until
V4 revenue proves the market.

---
---

# Part VI: ADRs and White Paper

## New ADRs for V4

### ADR-0011: Harbor-First Security Model

**Status:** Proposed
**Context:** V1-V3 harbors were advisory — agents could ignore boundaries. V4 makes
harbors the mandatory security boundary for all daemon operations.

**Decision:**
- Every `pd begin` auto-creates a project-scoped harbor
- All mutating API requests require a valid harbor card (JWT)
- Harbor cards are algorithm-pinned to HS256 (local) or Ed25519 (remote)
- Capability attenuation on delegation (spawned agents get subset of parent's caps)
- Grace period mode for backward compatibility migration

**Consequences:**
- Breaking change for scripts that don't present harbor cards (mitigated by grace period)
- All existing ProVerif proofs apply directly (no new verification needed)
- Opens the door to remote harbors (same security model, different transport)

### ADR-0012: Platform Adapter for Cross-Platform Support

**Status:** Proposed
**Context:** ADR-0004 declared Unix sockets as primary transport and explicitly stated
"Windows is out of scope." V4 reverses this decision to reach the Cursor/Windsurf/
VS Code on Windows audience.

**Decision:**
- Introduce `lib/platform.ts` with `PlatformAdapter` interface
- Three implementations: `DarwinAdapter`, `LinuxAdapter`, `WindowsAdapter`
- Windows uses named pipes for transport, `netstat` for port scanning, `node-windows`
  for service management
- All platform conditionals concentrated in one module

**Consequences:**
- Supersedes parts of ADR-0004 (socket path decisions)
- Adds Windows CI target to GitHub Actions
- Requires cross-compiling Rust crates for Windows

### ADR-0013: Remote Harbor Synchronization Protocol

**Status:** Proposed
**Context:** Harbors are the coordination boundary. V4 extends them across machines
with daemon-to-daemon synchronization.

**Decision:**
- Harbors sync coordination state (membership, file claims, sessions, pub/sub, locks)
  but NOT local state (port assignments, activity logs, DNS, webhooks)
- Wire protocol: WebSocket for bidirectional sync, HTTP for one-off RPCs (revised in Part XVII)
- Authentication: shared HMAC key per harbor (Phase 1), Ed25519 per daemon (Phase 2)
- Discovery: mDNS (LAN), portdaddy.dev registry (WAN), self-hosted lighthouse (enterprise)

**Consequences:**
- Requires ProVerif v2 model for cross-daemon authentication (already verified)
- Adds network dependency for remote harbors (local harbors unaffected)
- Opens path to paid tiers (lighthouse registration, unlimited peers)

### ADR-0014: Lighthouse Discovery Protocol

**Status:** Proposed
**Context:** Remote harbors need a way to find each other without exchanging IP addresses.

**Decision:**
- Three-layer discovery: mDNS (automatic, LAN), portdaddy.dev (convenience, WAN),
  self-hosted lighthouse (enterprise, air-gapped)
- mDNS advertises `_portdaddy._tcp.local.` with harbor name and public key in TXT record
- portdaddy.dev is a phone book (stores endpoints + public keys, not secrets or data)
- Registration requires signed challenge (daemon proves key ownership)
- Discovery is public; connection requires harbor card exchange

**Consequences:**
- Adds `bonjour-service` or equivalent dependency
- portdaddy.dev infrastructure cost (~$0 on Cloudflare Workers free tier)
- Opt-in only (`--advertise` flag) — no automatic network exposure

## White Paper Updates

### Current State

The whitepaper (`docs/reports/PORT_DADDY_ANCHOR_WHITEPAPER.md`) covers:
- The three threat vectors (port squatting, resource contention, privilege escalation)
- Three-phase protocol evolution (HS256 → Ed25519 → delegation chains)
- ProVerif formal verification strategy
- Kani Rust model checking
- The Arbiter runtime enforcement agent

The formal verification report (`docs/reports/FORMAL_VERIFICATION_ANCHOR_V3.md`) covers:
- ProVerif 2.05 results for all three phases
- All four security properties verified (secrecy, authentication, algorithm pinning, delegation integrity)
- Recommendations (PID binding, transport security)

### What's Missing

1. **Implementation status table** — what's deployed vs. designed:

| Component | Status | Location |
|-----------|--------|----------|
| HS256 harbor cards | Implemented | `lib/harbor-tokens.ts` |
| Algorithm pinning | Implemented | `lib/harbor-tokens.ts:207-209` |
| JTI revocation | Implemented | `lib/harbor-tokens.ts:233-240` |
| Zombie detection (lhb claim) | Implemented | `lib/harbor-tokens.ts:39` |
| Ed25519 asymmetric | Designed | ProVerif model only |
| Delegation chains | Designed | ProVerif model only |
| Rust crypto core | Partially built | `core/harbor-card-rs/` |
| Kani verification | Partially built | `core/harbor-card-rs/target/` |
| Arbiter FFI bridge | Implemented (basic) | `lib/arbiter.ts` |
| Route-level enforcement | **Not implemented** | Planned for V4 |

2. **The enforcement gap** — the whitepaper describes the protocol but doesn't mention
   that routes don't actually check harbor cards yet. V4 closes this gap.

3. **Remote harbor protocol** — the whitepaper covers single-daemon security. It needs
   a section on cross-daemon authentication and state synchronization.

4. **Economic layer** (Float Plans, credits, escrow) — explicitly defer this to a
   separate document. The whitepaper should stay focused on cryptographic properties.

### White Paper V2 Plan

Expand the existing whitepaper with:

1. **Section 6: Implementation Status** — honest table of what's built vs. designed
2. **Section 7: V4 Enforcement Architecture** — middleware, capability checks, grace period
3. **Section 8: Cross-Daemon Authentication** — how the ProVerif v2 model applies to
   remote harbors, the sync protocol, the lighthouse discovery layer
4. **Section 9: Threat Model Revisions** — new threats from networking (MITM on harbor
   sync, rogue lighthouse, DNS spoofing of mDNS advertisements)
5. **Appendix A: ProVerif Model Listings** — include the actual `.pv` source inline
6. **Appendix B: Kani Proof Harnesses** — include the Rust verification harnesses

### Publication Strategy

- **arXiv preprint** — submit to cs.CR (Cryptography and Security). Citable, free,
  permanent. Good for credibility with security researchers.
- **Blog post derivative** — distill into a 2,000-word blog post for the website.
  Lead with the attack scenarios, show the ProVerif output, end with "this is why
  your agents need cryptographic identity."
- **Conference submission** — target USENIX Security 2027 or NDSS. The "formal
  verification of an agent coordination protocol" angle is novel enough for a
  workshop paper, possibly a full paper if combined with the enforcement data from
  V4 production usage.

---
---

---
---

# Part VII: Semantic Trie for Universal Token Namespace

## The Problem

The universal token namespace (`myapp:api:auth:files:src/*`) is currently resolved
via SQL `LIKE` queries: `WHERE name LIKE 'myapp:%'`. This has three problems:

1. **Leading wildcards are full table scans** — `*:api:*` can't use a B-tree index
2. **Multi-segment matching is awkward** — 5-segment hierarchies need nested LIKE clauses
3. **Hot-path latency** — harbor middleware checks caps on every request; SQL per check is too slow

## The Solution: In-Memory Radix Trie

Build a colon-delimited radix trie as a **read-optimized index** over SQLite:

```
root
├── myapp
│   ├── api
│   │   ├── auth
│   │   │   ├── files
│   │   │   │   └── src/* → [file-claim-1, file-claim-2]
│   │   │   └── locks
│   │   │       └── auth-module → [lock-1]
│   │   └── main → [agent-2, session-3]
│   └── web
│       └── * → [agent-3]
└── otherproject
    └── ...
```

### Operations

| Operation | Complexity | Example |
|-----------|-----------|---------|
| Exact lookup | O(k) where k = segments | `myapp:api:auth` → direct walk |
| Prefix query | O(k + m) where m = matches | `myapp:*` → walk to `myapp`, return all descendants |
| Wildcard query | O(n × k) worst case | `*:api:*` → walk all roots, check for `api` child |
| Insert/delete | O(k) + SQLite write | Trie updated in-memory, SQLite is source of truth |
| Capability check | O(k) | `does cap ['myapp:api:*'] cover 'myapp:api:auth:files:src/foo'?` → yes |

### Implementation

New file: `lib/token-trie.ts`

```typescript
interface TrieNode {
  segment: string;
  children: Map<string, TrieNode>;
  values: Set<{ type: string; id: string }>;  // what's registered at this path
}

interface TokenTrie {
  insert(token: string, value: { type: string; id: string }): void;
  remove(token: string, valueId: string): void;
  lookup(token: string): Set<Value>;            // exact match
  query(pattern: string): Set<Value>;           // wildcard match
  covers(capability: string, target: string): boolean;  // cap check
  rebuild(db: Database): void;                  // full rebuild from SQLite
}
```

### Where It's Used

1. **Harbor middleware** — `trie.covers(harborCard.cap, requestedResource)` on every request
2. **`pd query`** — new command: `pd query myapp:*:*:files:*` → all file claims in myapp
3. **Wildcard pub/sub** — `pd msg "events:*" subscribe` → match all event channels
4. **Agent identity matching** — `pd agents --identity "myapp:*"` → instant, not SQL LIKE

### Lifecycle

- Built on daemon startup from SQLite tables (agents, sessions, file_claims, locks, harbors)
- Updated in-memory on every mutation (insert/remove are O(k))
- SQLite remains source of truth — if the daemon restarts, trie is rebuilt
- No persistence of the trie itself — it's a cache, not a store

### Why Not Just Fix the SQL?

You could add a `segments` column and a GIN-style index. But:
- SQLite doesn't have GIN indexes
- Even with indexes, SQL can't do `*:api:*` without full scan
- The trie is ~200-300 lines of code (with wildcard matching and capability checks)
  and eliminates SQL from the hot path entirely
- Harbor middleware runs on every request — microseconds matter

---
---

# Part VIII: Transport Layer — Socket-First, HTTP-Second

## The Problem

The daemon currently listens on both a Unix socket and TCP port, serving HTTP+JSON
on both. For local communication (CLI → daemon, SDK → daemon, MCP → daemon), the
HTTP overhead is pure waste:

| Layer | Overhead | Purpose |
|-------|----------|---------|
| TCP handshake | ~0.3ms | Unnecessary (same machine) |
| HTTP parsing | ~0.1ms | Unnecessary (structured protocol exists) |
| Express middleware | ~0.1ms | Rate limiting, CORS — irrelevant locally |
| JSON serialization | ~0.05ms | Could use msgpack (2-3x faster) |
| **Total overhead** | **~0.55ms** | **Per request, on top of <0.1ms actual work** |

That's 85% overhead. For a coordination primitive that agents call hundreds of times
per session, this adds up.

## The Architecture: Two Channels

```
                    ┌────────────────────────────┐
                    │         DAEMON              │
                    │                              │
  LOCAL CLIENTS ──► │  Unix Socket / Named Pipe   │ ◄── Fast path
  (CLI, SDK, MCP)   │    Binary protocol (msgpack) │     No HTTP, no Express
                    │    Direct function dispatch  │     ~0.05ms per call
                    │                              │
  REMOTE CLIENTS ─► │  TCP :9877 (harbor sync)    │ ◄── Remote path
  (other daemons)   │    WebSocket + msgpack + TLS │     Bidirectional sync
                    │    HTTP for one-off RPCs      │     See Part XVII
                    └────────────────────────────┘
```

### Fast Local Channel (Unix Socket / Named Pipe)

For same-machine communication:

```typescript
// Protocol: length-prefixed msgpack frames
// [4 bytes: payload length][N bytes: msgpack payload]

interface LocalRequest {
  method: string;      // 'claim', 'release', 'begin', 'note', etc.
  params: unknown;     // method-specific parameters
  harborCard?: string; // JWT for enforcement
}

interface LocalResponse {
  success: boolean;
  data?: unknown;
  error?: string;
}
```

The daemon maps `method` directly to the module function — no Express routing, no
middleware chain, no HTTP parsing. Just:

```
socket receives bytes →
  decode msgpack →
    verify harbor card (if enforcement enabled) →
      dispatch to module function →
        encode response →
          write to socket
```

### HTTP Channel (TCP, for Remote Harbors Only)

Keep the existing Express app for:
- Remote harbor sync (`POST /harbor/:name/sync`, `GET /harbor/:name/stream`)
- Lighthouse endpoints
- Dashboard (serves `public/index.html`)
- Any external integrations that expect HTTP

The HTTP channel binds to a **separate port** (9877) and is only enabled when
remote harbors are configured. Local-only users never open a TCP port.

### Migration Path

~~Originally phased across V4.0-V4.3.~~ **Revised: ship msgpack in V4.0.**

The binary protocol is simple (length-prefixed msgpack frames, ~200 lines), the
performance gain is immediate (85% overhead eliminated), and deferring it means
building harbor middleware on top of the slow path and then migrating later. Ship
the fast path first, then wire harbor enforcement directly into it.

1. **V4.0:** Add binary protocol on the Unix socket/named pipe. HTTP stays as fallback
   on the same socket for backward compatibility. SDK auto-detects protocol support
   via a handshake byte (`0x01` = msgpack, `0x00` or HTTP verb = HTTP). Harbor
   middleware runs on both paths.
2. **V4.1:** CLI and MCP server default to binary protocol. HTTP fallback still works.
3. **V4.2:** Remove HTTP listener from Unix socket entirely. HTTP only on TCP for remote.

### Why Not gRPC?

gRPC would solve the serialization problem (protobuf is fast) but adds:
- `@grpc/grpc-js` dependency (~2MB)
- Protobuf schema management
- Code generation step
- Complexity for what's fundamentally a simple RPC protocol

Msgpack + length-prefixed frames is simpler, faster, and zero-dependency (msgpack
is ~50 lines to implement for the subset we need).

### What About the MCP Server?

The MCP server uses stdio transport (stdin/stdout) to communicate with Claude Code.
It then makes HTTP calls to the daemon. With the fast local channel, the MCP server
would use the binary protocol instead — cutting per-tool-call latency roughly in half.

The MCP protocol itself (JSON-RPC over stdio) doesn't change. Only the MCP→daemon
hop gets faster.

### Benchmark Targets (V4.0)

| Path | Current | V4.0 Target |
|------|---------|-------------|
| CLI → daemon (claim) | ~2ms | <0.5ms |
| SDK → daemon (claim) | ~1.5ms | <0.3ms |
| MCP → daemon (claim) | ~3ms | <1ms |
| Remote daemon → daemon (sync) | ~5ms | ~5ms (HTTP/WS stays) |

---
---

---
---

# Part IX: Dashboard UI — Wireframes and Plan

> **Relationship to Part XXIV:** Part IX defines the 12-panel layout and data
> requirements. Part XXIV defines the implementation architecture (Web Components,
> ADR-0016) that supersedes Part IX's implicit single-file approach. Part IX is
> "what the dashboard shows," Part XXIV is "how it's built." The 12 panels defined
> here are phased as 6+6 across V4.1 and V4.2 in the Consolidated Execution Timeline.

## Current State

The dashboard (`public/index.html`) is a **115-line skeleton**. It has:
- 12 empty `<div>` panels (`#panel-overview` through `#panel-webhooks`)
- CSS variables for a dark glassmorphism theme
- A `COMMANDS` array listing 48 CLI commands
- Zero data fetching, zero rendered content, zero interactivity

The dashboard is at **~0% functional** despite being listed at 38% in parity docs.
The CSS exists. The HTML structure doesn't.

## Design Philosophy

The dashboard is the **local control plane** — served by the daemon at `localhost:9876`.
It is NOT the marketing website. It should feel like a cockpit, not a brochure.

~~Constraints from ADR-0005: **single-file HTML**, no build step, no frameworks.
All CSS/JS inline. Must work when served by `pd dev` immediately.~~

**ADR-0005 Revised:** The single-file mandate made sense for a 115-line skeleton.
It does not scale to a 12-panel dashboard with SSE, Web Components (Part XXIV),
real-time timelines, and harbor management UI — that's 3,000-4,000 lines in one file,
which is unmaintainable. **New constraint:**

- **No build step** — still mandatory. The dashboard must work from `public/` with
  zero compilation. This is the real value of ADR-0005.
- **No framework** — still mandatory. No React, no Vue, no Svelte. Vanilla JS + Web
  Components (native browser API, not a framework).
- **Multi-file allowed** — `public/index.html` loads `public/js/*.js` and
  `public/css/*.css` via `<script>` and `<link>` tags. The daemon already serves
  `public/` as a static directory. No bundler, no import maps, just files.
- **Each Web Component is one file** — `public/js/pd-harbors-panel.js`,
  `public/js/pd-sessions-panel.js`, etc. Self-contained, lazy-loadable.

This preserves the spirit (zero tooling, instant `pd dev`) while allowing a
maintainable multi-file structure. ADR-0005 should be formally superseded by
ADR-0017 documenting this revision.

## Layout: Four-Quadrant Command Center

```
┌─────────────────────────────────────────────────────────────────┐
│  ⚓ PORT DADDY  v4.0.0   │  ● 3 agents  │  ● 2 harbors  │ 🟢  │
├─────────────┬───────────────────────────────────────────────────┤
│             │                                                   │
│  NAV RAIL   │              MAIN CONTENT                         │
│             │                                                   │
│  Overview   │  ┌─────────────────┐  ┌─────────────────────┐    │
│  Harbors  ← │  │  HARBOR: myapp  │  │  ACTIVE SESSIONS    │    │
│  Sessions   │  │                 │  │                     │    │
│  Agents     │  │  Members:       │  │  ┌─agent-a4f2─────┐ │    │
│  Ports      │  │  ● agent-a4f2  │  │  │ "building auth"│ │    │
│  Locks      │  │  ● agent-b7e1  │  │  │ 12 notes       │ │    │
│  Radio      │  │                 │  │  │ 3 file claims  │ │    │
│  Salvage    │  │  Capabilities:  │  │  │ phase: coding  │ │    │
│  Activity   │  │  code:*, notes:*│  │  └────────────────┘ │    │
│  DNS        │  │                 │  │                     │    │
│  Tunnels    │  │  Channels:      │  │  ┌─agent-b7e1─────┐ │    │
│  Webhooks   │  │  myapp:radio    │  │  │ "frontend UI"  │ │    │
│  Config     │  │  myapp:events   │  │  │ 4 notes        │ │    │
│             │  │                 │  │  │ 1 file claim   │ │    │
│             │  └─────────────────┘  │  └────────────────┘ │    │
│             │                       └─────────────────────┘    │
│             │                                                   │
│             │  ┌───────────────────────────────────────────┐    │
│             │  │  UNIFIED TIMELINE                         │    │
│             │  │                                           │    │
│             │  │  14:32  agent-a4f2  claimed src/auth/*    │    │
│             │  │  14:33  agent-b7e1  published myapp:ready │    │
│             │  │  14:35  agent-a4f2  note: "JWT working"  │    │
│             │  │  14:36  lock auth-module acquired (a4f2)  │    │
│             │  │  14:38  agent-a4f2  note: "tests passing"│    │
│             │  │                                           │    │
│             │  └───────────────────────────────────────────┘    │
└─────────────┴───────────────────────────────────────────────────┘
```

## Panel Specifications

### 1. Overview (Default View)

The first thing you see. Four KPI cards + unified timeline.

```
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│ AGENTS   │ │ HARBORS  │ │ PORTS    │ │ LATENCY  │
│    3     │ │    2     │ │   12     │ │  0.4ms   │
│ ● active │ │ ● active │ │ claimed  │ │ p99      │
└──────────┘ └──────────┘ └──────────┘ └──────────┘

┌─────────────────────────────────────────────────┐
│  UNIFIED TIMELINE (SSE-powered, real-time)      │
│                                                  │
│  Events from: sessions, file claims, pub/sub,   │
│  locks, agent lifecycle — merged chronologically │
│                                                  │
│  Each row: timestamp | source | event | detail  │
│  Color-coded by type (maritime signal colors)    │
│  Click to expand context                         │
└─────────────────────────────────────────────────┘
```

**Data sources:**
- `GET /health` → uptime, version
- `GET /agents` → active count
- `GET /harbors` → harbor count
- `GET /services` → port count
- `GET /metrics` → latency percentiles
- `GET /subscribe/activity` → SSE for timeline (new endpoint)

### 2. Harbors Panel (V4 Centerpiece)

```
┌─────────────────────────────────────────────────┐
│  HARBORS                              [Create]  │
├─────────────────────────────────────────────────┤
│                                                  │
│  ┌─ myapp ──────────────────────────────────┐   │
│  │  Created: 2h ago  │  Expires: never      │   │
│  │  Caps: code:*, notes:*, locks:*          │   │
│  │  Channels: myapp:radio, myapp:events     │   │
│  │                                           │   │
│  │  Members (3):                             │   │
│  │  ┌────────────────────────────────────┐   │   │
│  │  │ ● agent-a4f2   myapp:api:auth     │   │   │
│  │  │   caps: code:*, notes:write        │   │   │
│  │  │   session: "building auth" (34m)   │   │   │
│  │  │   [View Session] [Revoke Card]     │   │   │
│  │  ├────────────────────────────────────┤   │   │
│  │  │ ● agent-b7e1   myapp:web:ui       │   │   │
│  │  │   caps: code:read, notes:write     │   │   │
│  │  │   session: "frontend UI" (12m)     │   │   │
│  │  └────────────────────────────────────┘   │   │
│  │                                           │   │
│  │  Remote Peers:                            │   │
│  │  ● desktop.local:9877  (connected, 2ms)  │   │
│  │  ○ laptop.local:9877   (last seen: 5m)   │   │
│  │                                           │   │
│  └───────────────────────────────────────────┘   │
│                                                  │
│  ┌─ other-project ──────────────────────────┐   │
│  │  Created: 1d ago  │  Expires: 6h         │   │
│  │  Members: 0 (empty)                       │   │
│  │  [Destroy]                                │   │
│  └───────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

**Data sources:**
- `GET /harbors` → list all harbors with members
- `GET /harbors/:name` → detail view
- `GET /harbor/:name/stream` → SSE for member changes (new, V4)

### 3. Sessions Panel

```
┌─────────────────────────────────────────────────┐
│  SESSIONS                    [Active ▼] [Begin] │
├─────────────────────────────────────────────────┤
│                                                  │
│  ┌─ session-7f3k ────────────────────────────┐  │
│  │  "Building JWT auth module"                │  │
│  │  Agent: agent-a4f2  │  Harbor: myapp       │  │
│  │  Phase: ● coding    │  Duration: 34m       │  │
│  │  Files: src/auth/jwt.ts, src/auth/index.ts │  │
│  │                                            │  │
│  │  Notes (12):                               │  │
│  │  ┌──────────────────────────────────────┐  │  │
│  │  │ 14:02  progress  "Started JWT impl" │  │  │
│  │  │ 14:15  progress  "Token signing OK" │  │  │
│  │  │ 14:28  decision  "Using RS256"      │  │  │
│  │  │ 14:35  progress  "Tests passing"    │  │  │
│  │  │        ···  [Show all 12]  ···      │  │  │
│  │  └──────────────────────────────────────┘  │  │
│  │                                            │  │
│  │  [Add Note]  [Set Phase ▼]  [End Session]  │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  ┌─ session-b2c9 ────────────────────────────┐  │
│  │  "Frontend auth UI"  │  agent-b7e1        │  │
│  │  Phase: ● coding     │  4 notes           │  │
│  └────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

### 4. Agents Panel

```
┌─────────────────────────────────────────────────┐
│  AGENTS                                         │
├─────────────────────────────────────────────────┤
│                                                  │
│  Active (3)                                      │
│  ┌──────────────────────────────────────────┐   │
│  │ ● agent-a4f2  myapp:api:auth            │   │
│  │   Heartbeat: 12s ago  │  Harbor: myapp   │   │
│  │   Session: "Building JWT auth" (34m)     │   │
│  │   Type: claude  │  Spawned by: —         │   │
│  ├──────────────────────────────────────────┤   │
│  │ ● agent-b7e1  myapp:web:ui              │   │
│  │   Heartbeat: 3s ago   │  Harbor: myapp   │   │
│  │   Session: "Frontend UI" (12m)           │   │
│  │   Type: cursor  │  Spawned by: —         │   │
│  ├──────────────────────────────────────────┤   │
│  │ ● agent-c9d3  myapp:api:test            │   │
│  │   Heartbeat: 1s ago   │  Harbor: myapp   │   │
│  │   Session: — (no session)                │   │
│  │   Type: spawned │  Spawned by: agent-a4f2│   │
│  │   Caps: code:read, notes:write (attenuated) │
│  └──────────────────────────────────────────┘   │
│                                                  │
│  Stale (1)                                       │
│  ┌──────────────────────────────────────────┐   │
│  │ ⚠ agent-x1y2  myapp:api:old            │   │
│  │   Last heartbeat: 8m ago                 │   │
│  │   Status: stale → salvage in 12m         │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

### 5. Ports Panel

```
┌─────────────────────────────────────────────────┐
│  PORT ASSIGNMENTS                    [Claim]    │
├─────────────────────────────────────────────────┤
│                                                  │
│  Port  │  Identity           │  Agent    │ Since │
│  ──────┼──────────────────── ┼──────────┼────── │
│  3100  │  myapp:api:auth     │  a4f2    │ 34m   │
│  3101  │  myapp:web:ui       │  b7e1    │ 12m   │
│  3102  │  myapp:api:test     │  c9d3    │  2m   │
│  5432  │  myapp:db:postgres  │  —       │  1h   │
│  6379  │  myapp:cache:redis  │  —       │  1h   │
│                                                  │
│  [Cleanup Stale]                                 │
│                                                  │
│  Port Range: 3100-3199 (default)                │
│  Total: 5 claimed / 100 available               │
└─────────────────────────────────────────────────┘
```

### 6. Radio Panel (Pub/Sub)

```
┌─────────────────────────────────────────────────┐
│  SWARM RADIO                        [Publish]   │
├─────────────────────────────────────────────────┤
│                                                  │
│  Channels:                                       │
│  ┌────────────────────────────────────────────┐ │
│  │  myapp:radio      │ 2 subscribers │ 14 msgs│ │
│  │  myapp:events     │ 1 subscriber  │  3 msgs│ │
│  │  resurrection     │ 0 subscribers │  1 msg │ │
│  └────────────────────────────────────────────┘ │
│                                                  │
│  Live Feed (SSE):                                │
│  ┌────────────────────────────────────────────┐ │
│  │  14:33  myapp:radio    "auth module ready" │ │
│  │  14:35  myapp:events   "tests passing"     │ │
│  │  14:36  myapp:radio    "PR created"        │ │
│  │  ●  listening...                           │ │
│  └────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

### 7. Salvage Panel

```
┌─────────────────────────────────────────────────┐
│  SALVAGE QUEUE                                   │
├─────────────────────────────────────────────────┤
│                                                  │
│  Pending (2):                                    │
│  ┌────────────────────────────────────────────┐ │
│  │  ☠ agent-dead1  myapp:api:feature          │ │
│  │    Died: 2h ago  │  Session: "Adding API"  │ │
│  │    Notes: 8  │  File claims: 2             │ │
│  │    Last note: "Halfway through endpoint"   │ │
│  │    [Claim]  [Dismiss]                      │ │
│  ├────────────────────────────────────────────┤ │
│  │  ☠ agent-dead2  myapp:web:style            │ │
│  │    Died: 5h ago  │  Session: "CSS rework"  │ │
│  │    Notes: 3  │  File claims: 0             │ │
│  │    [Claim]  [Dismiss]                      │ │
│  └────────────────────────────────────────────┘ │
│                                                  │
│  Recently Salvaged (1):                          │
│  ✓ agent-old3 → claimed by agent-a4f2 (1d ago) │
└─────────────────────────────────────────────────┘
```

### 8-12. Remaining Panels

| Panel | Content | Data Source |
|-------|---------|-------------|
| **Locks** | Active locks with holder, TTL countdown, contention queue | `GET /locks` |
| **Activity** | Paginated activity log with type filters | `GET /activity` with `?type=` |
| **DNS** | Registered DNS entries, resolver status, setup button | `GET /dns` |
| **Tunnels** | Active tunnels with URLs, status, provider | `GET /tunnels` |
| **Webhooks** | Registered webhooks, delivery history, test button | `GET /webhooks` |
| **Config** | Daemon config (read-only), version, code hash | `GET /config`, `GET /version` |

## Real-Time Strategy

**SSE subscriptions** (not polling) for live panels:

```javascript
// Single SSE connection to activity feed
const events = new EventSource('/subscribe/activity');
events.onmessage = (e) => {
  const event = JSON.parse(e.data);
  timeline.prepend(renderEvent(event));
  updateKPIs(event);
};

// Reconnect on failure (5s backoff)
events.onerror = () => setTimeout(reconnect, 5000);
```

Polling fallback for endpoints without SSE: `setInterval(refreshPanel, 10000)`

## Implementation Approach

Since ADR-0005 mandates single-file HTML with no build step:

1. **Vanilla JS** with template literals for rendering
2. **CSS Grid** for the quadrant layout
3. **CSS custom properties** for the dark theme (already defined)
4. **`<template>` elements** for reusable card structures
5. **Single SSE connection** to activity feed for live updates
6. **Hash-based routing** (`#harbors`, `#sessions`, etc.) for navigation

Estimated size: ~3,000-4,000 lines (HTML + CSS + JS) in one file. Large but manageable
for a dashboard without a framework.

---
---

# Part X: MCP Server — V4 Tool Plan

## Current State

The MCP server (`mcp/server.ts`, 2,702 lines) has:
- **92 tools** across 17 categories
- **10 tools** in default (tiered) mode: Essential 8 + `pd_discover` + hidden `begin`
- **5 resources** (services, sessions, agents, locks, tunnels)
- **Progressive disclosure** via `pd_discover(category)`
- **Stdio transport** (perfect for Claude Code)

### Critical Gap: Zero Harbor Tools

Harbors are fully implemented in the daemon (7 endpoints in `routes/harbors.ts`)
but the MCP server has **no tools for them**. This means Claude agents can't:
- Create or enter harbors
- Check their capabilities
- See who else is in a harbor
- Present harbor cards on requests

## V4 MCP Architecture

### New Essential Tools

The Essential set should expand from 8 to **10** for V4, adding harbor awareness:

```
ESSENTIAL V4 (10 tools — always loaded):

1. begin_session      ← existing (now auto-creates harbor, returns card)
2. end_session_full   ← existing
3. whoami             ← existing (now shows harbor membership + caps)
4. claim_port         ← existing
5. release_port       ← existing
6. add_note           ← existing
7. acquire_lock       ← existing
8. list_services      ← existing
9. harbor_status      ← NEW: show current harbor, members, capabilities
10. pd_discover       ← existing (meta-tool)
```

`harbor_status` replaces no existing tool — it's additive. An agent that calls
`begin_session` automatically enters a harbor. `harbor_status` lets it see who
else is there and what capabilities it has.

### New Harbor Tools Category

```
Category: harbors (8 tools)

harbor_status      — Show agent's current harbor, members, capabilities, remote peers
harbor_create      — Create a new harbor with capabilities and channels
harbor_enter       — Enter a harbor (returns harbor card JWT)
harbor_leave       — Leave a harbor
harbor_list        — List all harbors (with pattern filter)
harbor_show        — Get detailed harbor info with member list
harbor_destroy     — Destroy a harbor (cascades to members)
harbor_capabilities — Check if a capability is granted by current harbor card
```

### New Remote/Discovery Tools Category

```
Category: remote (5 tools)

harbor_connect     — Connect to a remote harbor on another daemon
harbor_disconnect  — Disconnect from a remote peer
harbor_peers       — List connected remote peers for a harbor
harbor_discover    — Scan local network (mDNS) for nearby daemons
lighthouse_register — Register harbor with portdaddy.dev for WAN discovery
```

### New Spawn Tools (Enhanced)

```
Category: spawn (4 tools — replaces current 2)

spawn_agent        — Launch agent with attenuated harbor card
list_spawned       — List running spawned agents
kill_spawned       — Kill a spawned agent
spawn_status       — Get spawn status with capability report
```

The key change: `spawn_agent` now accepts a `capabilities` parameter that creates
a delegated harbor card for the child. The child can only do what the parent allows.

### Updated Tool Count

| Category | V3 | V4 | Change |
|----------|----|----|--------|
| session-lifecycle | 3 | 3 | — |
| ports | 8 | 8 | — |
| sessions | 10 | 10 | — |
| notes | 2 | 2 | — |
| locks | 3 | 3 | — |
| messaging | 4 | 4 | — |
| agents | 10 | 10 | — |
| inbox | 6 | 6 | — |
| webhooks | 8 | 8 | — |
| integration | 3 | 3 | — |
| dns | 9 | 9 | — |
| briefing | 2 | 2 | — |
| tunnels | 3 | 3 | — |
| projects | 4 | 4 | — |
| changelog | 6 | 6 | — |
| activity | 4 | 4 | — |
| system | 6 | 6 | — |
| **harbors** | **0** | **8** | **+8 NEW** |
| **remote** | **0** | **5** | **+5 NEW** |
| **spawn** | **2** | **4** | **+2 enhanced** |
| **TOTAL** | **93** | **108** | **+15** |

### Harbor Card Flow in MCP

Today, MCP tools call the daemon via HTTP with no authentication. In V4:

```
Agent calls begin_session →
  MCP server calls POST /sugar/begin →
    Daemon creates harbor, enters agent, returns harbor card →
      MCP server stores harbor card in memory →
        All subsequent tool calls include X-Harbor-Card header →
          Daemon middleware verifies card → allows/denies
```

The MCP server holds the harbor card for the duration of the session. The agent
never sees the JWT directly — it's transparent infrastructure.

```typescript
// In mcp/server.ts (V4)
let currentHarborCard: string | null = null;

async function daemonRequest(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (currentHarborCard) {
    headers['X-Harbor-Card'] = currentHarborCard;
  }
  // ... existing fetch logic with added header
}

// In begin_session handler:
const result = await daemonRequest('POST', '/sugar/begin', { purpose, identity, ... });
if (result.harborCard) {
  currentHarborCard = result.harborCard;
}
```

### Progressive Disclosure Updates

`pd_discover` category list expands:

```
pd_discover() →

Available tool categories:
  session-lifecycle  (3 tools)  — Begin, end, whoami
  ports              (8 tools)  — Claim, release, health
  sessions           (10 tools) — Lifecycle, files, phases
  notes              (2 tools)  — Add, list
  locks              (3 tools)  — Acquire, release, list
  messaging          (4 tools)  — Pub/sub, channels
  agents             (10 tools) — Register, heartbeat, salvage
  inbox              (6 tools)  — Agent-to-agent messaging
  harbors            (8 tools)  — Permission namespaces      ← NEW
  remote             (5 tools)  — Cross-machine coordination ← NEW
  spawn              (4 tools)  — Launch child agents        ← EXPANDED
  webhooks           (8 tools)  — Event subscriptions
  dns                (9 tools)  — Local DNS management
  ...
```

### MCP Resources (V4 Additions)

```
Existing resources:
  port-daddy://services    — Active port assignments
  port-daddy://sessions    — Active sessions
  port-daddy://agents      — Registered agents
  port-daddy://locks       — Active locks
  port-daddy://tunnels     — Active tunnels

New V4 resources:
  port-daddy://harbors     — Active harbors with members
  port-daddy://peers       — Connected remote daemons
  port-daddy://timeline    — Recent unified timeline events
```

### MCP Server Instructions Update

```typescript
instructions: [
  'Port Daddy is the coordination runtime for AI agent teams.',
  'Services use semantic identities in project:stack:context format.',
  'Same identity always maps to the same port — deterministic hashing.',
  'Start every session with begin_session. This auto-creates a harbor.',  // CHANGED
  'Your harbor card controls what you can do. Check harbor_status.',      // NEW
  'Spawned agents get attenuated capabilities — they can do less than you.', // NEW
  'Check check_salvage before starting new work.',
  'Use pd_discover to find additional tools.',
  'File claims are advisory — they announce intent, not enforce locks.',
  'Notes are immutable — once written, cannot be edited or deleted.',
].join(' ')
```

---
---

# Part XI: Website V2 (portdaddy.dev) — Full Wireframes

> **Relationship to Part IV:** Part IV defines the content strategy and copy direction.
> Part XI implements those decisions as wireframes. Part IV is "what to say," Part XI
> is "where it goes on the page." Content decisions live in Part IV; layout decisions
> live here. Where they overlap (pricing page, blog, comparison page), Part IV takes
> precedence for content and Part XI takes precedence for layout.

## Current State Assessment

The website is **much more complete than expected**:
- 31 pages total (14 main + 17 tutorials)
- ~4,935 lines of page components
- Real content on every page (no stubs)
- Data-driven architecture (blogData.ts, cookbook.ts, integrations.ts, blueprints.ts)
- Live dashboard page with hooks (useDaemonData, useActivityStream, useTimeline)
- Motion animations (framer-motion)
- Dark theme with glassmorphism

The messaging is already agent-coordination-first ("Port Authority for AI Swarms").
The structural work is done. What needs to change for V4:

## Site Map (V4)

```
portdaddy.dev/
├── /                          Landing page (8 sections)
├── /tutorials                 Academy index (16 → 19 tutorials)
│   ├── /tutorials/getting-started
│   ├── /tutorials/harbors     ← UPDATE for enforcement
│   ├── /tutorials/remote-harbors ← UPDATE for connect/discover
│   ├── /tutorials/default-harbors ← NEW (V4 auto-harbor)
│   ├── /tutorials/lighthouse  ← NEW (discovery)
│   ├── /tutorials/windows     ← NEW (platform support)
│   └── ... (14 existing tutorials)
├── /docs                      SDK Manual ← UPDATE for harbor methods
├── /mcp                       MCP Tools ← UPDATE for harbor tools
├── /examples                  Blueprints ← ADD harbor enforcement example
├── /blog                      Engineering Log ← ADD 5 posts
│   ├── /blog/formal-verification (existing)
│   ├── /blog/zero-trust-agents ← NEW
│   ├── /blog/four-agents-one-repo ← NEW
│   ├── /blog/port-daddy-vs-alternatives ← NEW
│   ├── /blog/cross-machine-harbors ← NEW
│   └── /blog/windows-support ← NEW
├── /compare                   ← NEW: vs docker-compose vs detect-port
├── /roadmap                   V4 Roadmap ← UPDATE phases
├── /cookbook                   Recipes (11 existing)
├── /integrations              Framework support (8 existing)
├── /templates                 Blueprints (4 existing)
├── /dashboard                 Live daemon view
└── /pricing                   ← NEW: Free / Pro / Team / Enterprise
```

## Landing Page Revisions

### Hero Section (Updated Copy)

```
┌─────────────────────────────────────────────────────────┐
│                                                          │
│              ⚓ PORT DADDY v4.0                          │
│                                                          │
│     Zero-Trust Coordination for Agent Swarms.            │
│                                                          │
│     Cryptographic harbors. Formally verified with        │
│     ProVerif. The runtime that treats agent security     │
│     as non-negotiable.                                   │
│                                                          │
│     [LAUNCH SWARM]          [SDK MANUAL]                │
│                                                          │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐    │
│  │ Enforced     │ │ Remote       │ │ Windows      │    │
│  │ Harbors      │ │ Harbors      │ │ Support      │    │
│  │ v4.0 — new   │ │ v4.1 — new   │ │ v4.1 — new   │    │
│  └──────────────┘ └──────────────┘ └──────────────┘    │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### New Section: "The Security Story" (After Hero)

```
┌─────────────────────────────────────────────────────────┐
│                                                          │
│     TODAY: Your agents have root access to everything.   │
│                                                          │
│     ┌────────────────────┐                               │
│     │  pd begin "task"   │ ← No boundaries.              │
│     │  Agent can:        │   No capability checks.       │
│     │  • Read all files  │   No formal guarantees.       │
│     │  • Claim any port  │                               │
│     │  • Publish anywhere│                               │
│     │  • Lock anything   │                               │
│     └────────────────────┘                               │
│                                                          │
│     V4: Every agent runs in a cryptographic harbor.      │
│                                                          │
│     ┌────────────────────┐                               │
│     │  pd begin "task"   │ ← Auto-harbor created.        │
│     │  --identity myapp  │   Harbor card issued.         │
│     │                    │   Capabilities enforced.      │
│     │  Agent can ONLY:   │                               │
│     │  • code:read       │   Proven safe by ProVerif.    │
│     │  • notes:write     │   Delegation chains verified. │
│     │  • myapp:* channels│   Algorithm confusion immune. │
│     └────────────────────┘                               │
│                                                          │
│     [READ THE WHITEPAPER]    [SEE THE PROOFS]            │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### New Section: "Cross-Machine Harbors" (Replace or Augment HowItWorks)

```
┌─────────────────────────────────────────────────────────┐
│                                                          │
│     Your MacBook and your desktop. One harbor.           │
│                                                          │
│     ┌──────────┐       mDNS        ┌──────────┐        │
│     │ MacBook  │◄─────────────────►│ Desktop  │        │
│     │ daemon   │   auto-discover    │ daemon   │        │
│     │          │                    │          │        │
│     │ Claude ● │  file claims sync  │ ● Cursor │        │
│     │ agent    │  pub/sub flows     │   agent  │        │
│     └──────────┘  sessions visible  └──────────┘        │
│                                                          │
│     $ pd harbor connect myapp --auto                     │
│     → Scanning local network... found Desktop.local      │
│     → Connected. 2 agents now coordinating.              │
│                                                          │
│     No relay server. No cloud. Direct daemon-to-daemon.  │
│     Authenticated with Ed25519 harbor cards.             │
│                                                          │
│     [REMOTE HARBORS TUTORIAL]                            │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

## New Page: /compare

```
┌─────────────────────────────────────────────────────────┐
│                                                          │
│     Honest Comparisons                                   │
│                                                          │
│  ┌────────────┬──────────────┬───────────┬────────────┐ │
│  │            │  Port Daddy  │  Docker   │ detect-port│ │
│  │            │              │  Compose  │            │ │
│  ├────────────┼──────────────┼───────────┼────────────┤ │
│  │ Port       │ ✅ Atomic    │ ✅ Network│ ✅ Random  │ │
│  │ conflicts  │  assignment  │  isolation│            │ │
│  ├────────────┼──────────────┼───────────┼────────────┤ │
│  │ Same port  │ ✅ Always    │ ✅ Config │ ❌ Random  │ │
│  │ each time  │              │  file     │  each run  │ │
│  ├────────────┼──────────────┼───────────┼────────────┤ │
│  │ Agent      │ ✅ Sessions  │ ❌ None   │ ❌ None    │ │
│  │ coordination│ file claims │           │            │ │
│  │            │  pub/sub     │           │            │ │
│  ├────────────┼──────────────┼───────────┼────────────┤ │
│  │ Security   │ ✅ Harbors   │ ✅ Containers│ ❌ None │ │
│  │ boundaries │  (verified)  │            │           │ │
│  ├────────────┼──────────────┼───────────┼────────────┤ │
│  │ Multi-     │ ✅ Remote    │ ✅ Swarm  │ ❌ No     │ │
│  │ machine    │  harbors     │  / K8s    │            │ │
│  ├────────────┼──────────────┼───────────┼────────────┤ │
│  │ Setup      │ npm i -g     │ Dockerfile│ npm i      │ │
│  │            │ port-daddy   │ compose.yml│ detect-port│ │
│  ├────────────┼──────────────┼───────────┼────────────┤ │
│  │ Overhead   │ ~20MB daemon │ ~2GB Docker│ 0 (library)│ │
│  │            │              │  Desktop   │            │ │
│  └────────────┴──────────────┴───────────┴────────────┘ │
│                                                          │
│     When to use Docker Compose: You already have         │
│     containers and want network isolation.               │
│                                                          │
│     When to use detect-port: You need one port,          │
│     one time, no coordination.                           │
│                                                          │
│     When to use Port Daddy: You have AI agents that      │
│     need to coordinate without stepping on each other.   │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

## New Page: /pricing

```
┌─────────────────────────────────────────────────────────┐
│                                                          │
│     Simple pricing. The daemon is always free.           │
│                                                          │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐    │
│  │   FREE       │ │   PRO        │ │   TEAM       │    │
│  │              │ │   $19/seat   │ │   $49/team   │    │
│  │              │ │   /month     │ │   /month     │    │
│  ├──────────────┤ ├──────────────┤ ├──────────────┤    │
│  │ Daemon       │ │ Everything   │ │ Everything   │    │
│  │ CLI + SDK    │ │ in Free, +   │ │ in Pro, +    │    │
│  │ MCP (108    │ │              │ │              │    │
│  │ tools — V4) │ │              │ │              │    │
│  │ Local harbors│ │ portdaddy.dev│ │ Unlimited    │    │
│  │ (enforced!)  │ │ lighthouse   │ │ remote peers │    │
│  │ Pub/sub      │ │              │ │              │    │
│  │ Sessions     │ │ Remote harbor│ │ Self-hosted  │    │
│  │ Salvage      │ │ (up to 3     │ │ lighthouse   │    │
│  │ mDNS (LAN)  │ │  peers)      │ │              │    │
│  │ Dashboard    │ │              │ │ Team         │    │
│  │              │ │ Session      │ │ dashboard    │    │
│  │              │ │ replays      │ │              │    │
│  │              │ │              │ │ Harbor audit │    │
│  │              │ │              │ │ logs         │    │
│  │              │ │              │ │              │    │
│  │  [Install]   │ │  [Start]     │ │  [Contact]   │    │
│  └──────────────┘ └──────────────┘ └──────────────┘    │
│                                                          │
│     Enterprise? Self-hosted, SAML, SLA.                  │
│     [Talk to us]                                         │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

## Docs Page Updates (V4)

Add harbor section to the SDK Manual:

```
Existing sections:
  1. Atomic Identity (claim, release, find)
  2. Swarm Radio (pub, sub, watch)
  3. Cryptographic Harbors (harbor create, enter, list)  ← EXISTS but needs V4 update

Update section 3 to include:
  - harbor_create with capabilities
  - harbor_enter (returns harbor card)
  - harbor_status (show current harbor)
  - harbor_connect (remote peer)
  - harbor_discover (mDNS scan)
  - Capability attenuation on spawn
```

## MCP Page Updates (V4)

Add harbors to the Essential Tools showcase:

```
Essential 10 (updated from 8):
  begin_session    — "Now auto-creates your harbor"
  harbor_status    — NEW: "See your capabilities and co-members"
  claim_port       — existing
  add_note         — existing
  ...

New category highlight:
  Harbors (8 tools) — "Cryptographic permission namespaces"
  Remote  (5 tools) — "Cross-machine coordination"
```

## Immediate Fixes (Pre-V4)

These are bugs, not features:

1. **GitHub URLs** — 5 files reference `erichowens/port-daddy`:
   - `Nav.tsx:79`
   - `CTABanner.tsx:58,79`
   - `Footer.tsx:96`
   - `GettingStarted.tsx:48`
   - `blogData.ts:89`

2. **OpenGraph tags** — `index.html` has zero social sharing metadata

3. **Brew tap** — `CTABanner.tsx:79` shows `erichowens/port-daddy`

---
---

# Part XII: Remote Harbor Privacy and Trust Tiers

## The Core Question

When your MacBook and desktop share a harbor, how much does each daemon trust the
other? And how much should agents on one machine see of the other machine's state?

## Three Trust Tiers

### Tier 1: Full Trust (Default for Your Own Machines)

```bash
pd harbor connect myapp --trust full
```

Both daemons see everything in the harbor. All sessions, all notes, all file claims,
all pub/sub messages, all KV store entries. This is "my MacBook and my desktop" mode.
You own both machines. There's no reason to hide state from yourself.

The harbor card for remote agents has the same capabilities as local agents.

### Tier 2: Coordinated Trust (Default for Team Members)

```bash
pd harbor connect myapp --trust coordinated
```

Remote agents see coordination state but not session internals:

| Visible | Hidden |
|---------|--------|
| Harbor membership | Session notes (unless `--visibility harbor`) |
| File claims | Agent's internal state |
| Lock state | Inbox messages |
| Pub/sub on harbor channels | Local activity logs |
| KV store (harbor-scoped) | Briefings |
| Agent liveness | Agent type/backend |

This is "I'm working with a colleague, we need to not stomp on each other's files,
but I don't need to read their stream of consciousness notes."

Remote agents get a **restricted capability set**:

```bash
pd harbor create myapp --remote-cap code:read,files:claim,locks:acquire,notes:read
# Remote agents can read code, claim files, acquire locks, read shared notes
# They cannot: write notes to your sessions, publish to arbitrary channels,
#              claim ports, modify your KV entries
```

### Tier 3: Minimal Trust (Default for External / Untrusted)

```bash
pd harbor connect myapp --trust minimal
```

Remote agents can only see that the harbor exists and who's in it. No file claims,
no notes, no KV access. They can publish/subscribe to a single designated channel.

This is "I'm pairing with someone I don't fully trust" or "a CI agent is joining
for the duration of a build."

```
Remote agent sees:
  - Harbor name
  - Member list (names only, no session details)
  - Designated communication channel

Remote agent cannot see:
  - File claims
  - Session notes
  - KV store
  - Lock state
  - Port assignments
```

## Compulsory vs. Private Data

Some harbor state MUST sync for coordination to work. Some state SHOULD sync for
collaboration. Some state MUST NOT sync for privacy.

```
COMPULSORY (sync always — coordination breaks without this):
  - Harbor membership (who is here?)
  - File claim existence (who's working on what?)
  - Lock state (who holds what?)
  - Agent liveness (who's alive?)

OPTIONAL (sync if trust tier allows):
  - Session notes (visibility: harbor)
  - KV store entries (per-key ACL possible)
  - Pub/sub messages (per-channel ACL possible)
  - File claim details (path vs. just "claimed")

PRIVATE (never sync — local only):
  - Harbor card JWTs (local auth tokens)
  - Agent's internal state / environment variables
  - Inbox messages (direct, not broadcast)
  - Local session notes (visibility: local)
  - Daemon config / metrics
  - Activity log entries
```

## Note Visibility

Notes gain a `visibility` field:

```
pd note "JWT implementation working" --visibility harbor
# → syncs to all connected peers in this harbor

pd note "trying a weird hack, might revert" --visibility local
# → stays on this daemon, never syncs

pd note "handoff: auth module ready for review" --visibility harbor --pin
# → syncs AND pinned to top of harbor's shared context
```

Default visibility follows the trust tier:
- Full trust: `harbor` (everything syncs)
- Coordinated: `local` (opt-in to share)
- Minimal: `local` (notes never sync)

---
---

# Part XIII: Intra-Harbor Data Structures

## The Landscape

Agents inside a harbor need shared state. Today they have:
- **Sessions** (per-agent, mutable status, immutable notes)
- **File claims** (advisory, per-session)
- **Pub/sub** (ephemeral messages, no persistence)
- **Locks** (exclusive access, TTL-based)

What's missing: **mutable shared state** (KV store), **semantic memory** (embeddings),
and **structured shared context** (whiteboard).

## 1. Harbor KV Store

A scoped, mutable key-value store per harbor. The harbor's *working memory*.

```bash
# Set a value
pd harbor kv set myapp auth.endpoint "http://localhost:3100/auth"
pd harbor kv set myapp auth.strategy "JWT with RS256"
pd harbor kv set myapp db.schema_version "42"

# Read
pd harbor kv get myapp auth.endpoint
# → http://localhost:3100/auth

# List with prefix
pd harbor kv list myapp auth.*
# → auth.endpoint = http://localhost:3100/auth
# → auth.strategy = JWT with RS256

# Delete
pd harbor kv del myapp auth.strategy

# Watch for changes (SSE)
pd harbor kv watch myapp auth.*
```

### Schema

```sql
CREATE TABLE harbor_kv (
  harbor_name  TEXT NOT NULL REFERENCES harbors(name) ON DELETE CASCADE,
  key          TEXT NOT NULL,
  value        TEXT NOT NULL,           -- JSON-encoded
  updated_at   INTEGER NOT NULL,
  updated_by   TEXT,                    -- agent ID
  version      INTEGER NOT NULL DEFAULT 1,  -- optimistic concurrency
  visibility   TEXT NOT NULL DEFAULT 'harbor',  -- 'harbor' or 'local'
  PRIMARY KEY (harbor_name, key)
);

CREATE INDEX idx_harbor_kv_prefix ON harbor_kv(harbor_name, key);
```

### Properties

- **Mutable** — unlike notes, KV entries can be updated and deleted
- **Scoped** — each harbor has its own namespace. KV keys are in the token trie
- **Versioned** — optimistic concurrency via version field. CAS (compare-and-swap)
  prevents lost updates when two agents write the same key
- **Synced** — entries with `visibility: 'harbor'` sync to remote peers
- **Evicted** — when a harbor is destroyed, its KV store is cascade-deleted
- **Addressed** — `myapp:kv:auth.endpoint` in the universal token namespace

### CAS (Compare-and-Swap)

```bash
pd harbor kv set myapp auth.strategy "OAuth2" --expect-version 1
# → succeeds (version was 1, now 2)

pd harbor kv set myapp auth.strategy "JWT" --expect-version 1
# → fails: version is now 2 (another agent updated it)
# → agent must re-read and retry
```

This prevents the classic lost-update problem without requiring locks for every
KV write. Locks are for exclusive access to resources. CAS is for shared state
that agents update optimistically.

### Relationship to Notes

```
Notes  = "what happened" (immutable journal, append-only, per-session)
KV     = "what is true now" (mutable state, shared, per-harbor)
```

An agent writes a note: "Switched auth strategy from OAuth2 to JWT."
The same agent updates KV: `auth.strategy = "JWT"`.
The note explains WHY. The KV records WHAT. Both are needed.

## 2. Semantic Memory (Optional Embeddings)

When an embedding model is available (Ollama, etc.), KV entries can be
semantically searchable:

```bash
# Store with embedding (requires Ollama or similar)
pd harbor kv set myapp decision.auth "We chose JWT because OAuth2 added too much
  latency for the real-time features. RS256 for asymmetric verification." --embed

# Semantic search
pd harbor kv search myapp "why did we pick this authentication approach?"
# → decision.auth (similarity: 0.92): "We chose JWT because..."
```

### Implementation

```sql
CREATE TABLE harbor_embeddings (
  harbor_name  TEXT NOT NULL,
  key          TEXT NOT NULL,
  embedding    BLOB NOT NULL,          -- float32 vector, 384-1536 dimensions
  model        TEXT NOT NULL,          -- e.g., 'nomic-embed-text'
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (harbor_name, key),
  FOREIGN KEY (harbor_name, key) REFERENCES harbor_kv(harbor_name, key) ON DELETE CASCADE
);
```

### Why Optional

- Port Daddy is infrastructure. It should work without an ML runtime.
- `--embed` flag only works if `pd spawn` can detect an embedding backend
- Semantic search falls back to SQLite FTS5 (full-text search) if no embeddings
- The embedding table is created lazily (only when first `--embed` is used)

### Embedding Backend Detection

```typescript
async function getEmbeddingBackend(): Promise<EmbeddingBackend | null> {
  // Check Ollama
  try {
    const res = await fetch('http://localhost:11434/api/tags');
    const data = await res.json();
    const embedModels = data.models.filter(m => m.name.includes('embed'));
    if (embedModels.length) return { type: 'ollama', model: embedModels[0].name };
  } catch {}

  // No embedding backend available
  return null;
}
```

## 3. The Whiteboard: Structured Shared Context

Notes are append-only. KV is flat key-value. Neither provides *structured shared
context* — a document that multiple agents build together.

The whiteboard is a special KV namespace with Markdown content and section ownership:

```bash
# Agent A starts a whiteboard
pd harbor whiteboard set myapp architecture "
## Auth Module
- JWT with RS256
- Tokens expire after 1h
- Refresh tokens stored in httpOnly cookies
"

# Agent B appends to the whiteboard
pd harbor whiteboard append myapp architecture "
## API Layer
- Express with TypeScript
- Rate limiting: 100 req/min per IP
"

# Agent C reads the whiteboard
pd harbor whiteboard get myapp architecture
# → ## Auth Module
#   - JWT with RS256 ...
#   ## API Layer
#   - Express with TypeScript ...

# Diff since last read
pd harbor whiteboard diff myapp architecture --since 5m
```

### Implementation

The whiteboard is just KV entries with:
- `key` prefix: `whiteboard:<name>`
- `value`: Markdown string
- `append` operation: reads current, concatenates, writes back (with CAS)

No new table needed. It's a convention on top of the KV store.

```bash
# These are equivalent:
pd harbor whiteboard set myapp arch "# Architecture\n..."
pd harbor kv set myapp whiteboard:arch "# Architecture\n..."
```

The `whiteboard` command is sugar for KV operations with Markdown awareness
(section dedup, append semantics, diff support).

---
---

# Part XIV: Regions — Semantic Code Boundaries

## The Problem with File Claims

File claims today are path-based:

```bash
pd files claim src/auth/jwt.ts
pd files claim src/auth/*
```

This breaks down because:

1. **Code isn't organized by concern.** The auth logic might span `src/auth/jwt.ts`,
   `src/middleware/auth.ts`, `src/routes/login.ts`, and `tests/auth.test.ts`. An agent
   claiming "auth" shouldn't need to enumerate four glob patterns.

2. **Functions matter more than files.** Two agents can safely work on the same file
   if they're modifying different functions. File-level claims are too coarse.

3. **Dependencies create implicit claims.** If I'm refactoring `verifyToken()`, I
   implicitly need `issueToken()` too (they share types). But file claims don't
   understand this.

## Regions: Named Semantic Boundaries

A region is a named logical area of code that maps to files, functions, and
their dependency edges:

```bash
# Define a region manually
pd region define auth \
  --files "src/auth/**,src/middleware/auth*,tests/auth*" \
  --functions "verifyToken,issueToken,refreshToken,AuthMiddleware"

# Claim a region (replaces file claims for this scope)
pd region claim auth
# → Claimed region 'auth': 4 files, 4 functions
# → Dependencies: issueToken → verifyToken (internal)
# → Boundary: AuthMiddleware called from src/routes/*.ts (external)

# Another agent sees:
pd regions
# → ● auth    (agent-a4f2, 34m)  4 files, 4 functions
# →   src/auth/jwt.ts, src/middleware/auth.ts, tests/auth.test.ts
# →   verifyToken, issueToken, refreshToken, AuthMiddleware
```

### Auto-Detected Regions

`pd scan --deep` parses the project and suggests regions:

```bash
pd scan --deep
# Scanning... 847 files, 12,341 functions
#
# Suggested regions:
#   auth          4 files, 7 functions   (high cohesion, low coupling)
#   database      6 files, 23 functions  (high cohesion)
#   api-routes    12 files, 45 functions (moderate coupling to auth, database)
#   frontend      34 files, 89 functions (moderate coupling to api-routes)
#   config        3 files, 8 functions   (low coupling)
#   tests         28 files              (mirrors source structure)
#
# Accept suggestions? [Y/n/edit]
```

Detection works by:
1. **Import graph analysis** — which files import which? Strongly connected components
   become region candidates.
2. **Function call graph** — which functions call which? Functions that call each other
   frequently are in the same region.
3. **Naming conventions** — `src/auth/*`, `src/db/*` etc. are natural boundaries.
4. **Co-change history** — (if git is available) files that change together belong
   together.

### Learned Function Hierarchy

The ambitious version: instead of flat regions, build a *hierarchy*:

```
project: myapp
├── auth
│   ├── tokens (verifyToken, issueToken, refreshToken)
│   ├── middleware (AuthMiddleware, requireAuth, optionalAuth)
│   └── storage (storeRefreshToken, revokeRefreshToken)
├── api
│   ├── routes (createRouter, registerRoutes)
│   ├── handlers (handleLogin, handleLogout, handleRegister)
│   └── validation (validateEmail, validatePassword)
├── database
│   ├── connection (createPool, getConnection)
│   ├── queries (findUser, createUser, updateUser)
│   └── migrations (up, down, seed)
└── frontend
    ├── pages (LoginPage, DashboardPage, SettingsPage)
    ├── components (AuthForm, NavBar, UserMenu)
    └── hooks (useAuth, useApi, useUser)
```

Each node in the hierarchy is a region. Claiming `auth` claims all sub-regions.
Claiming `auth:tokens` claims only the token functions. The hierarchy maps to
the universal token namespace:

```
myapp:region:auth                          ← all of auth
myapp:region:auth:tokens                   ← just token functions
myapp:region:auth:tokens:fn:verifyToken    ← specific function
myapp:region:api:handlers                  ← API handlers
```

### Implementation Phases

**V4.0: Manual regions with file patterns**

```sql
CREATE TABLE regions (
  harbor_name  TEXT NOT NULL REFERENCES harbors(name) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  files        TEXT NOT NULL DEFAULT '[]',    -- JSON array of glob patterns
  functions    TEXT NOT NULL DEFAULT '[]',    -- JSON array of function names
  created_by   TEXT,                          -- agent ID
  created_at   INTEGER NOT NULL,
  metadata     TEXT,                          -- JSON
  PRIMARY KEY (harbor_name, name)
);

CREATE TABLE region_claims (
  harbor_name  TEXT NOT NULL,
  region_name  TEXT NOT NULL,
  agent_id     TEXT NOT NULL,
  session_id   TEXT,
  claimed_at   INTEGER NOT NULL,
  PRIMARY KEY (harbor_name, region_name, agent_id),
  FOREIGN KEY (harbor_name, region_name) REFERENCES regions(harbor_name, name) ON DELETE CASCADE
);
```

**V4.1: Import graph analysis**

`pd scan --deep` uses a lightweight parser (regex-based for JS/TS/Python imports,
not full AST) to build the import graph. Suggests regions based on strongly connected
components.

**V4.2: AST-level function tracking**

Use tree-sitter (available as npm package) to parse function definitions and call
sites. Build function call graph. Regions become function groups with dependency edges.

**V5: Live updating**

As agents modify files, the import/call graph updates. Region boundaries shift.
Pheromone traces (see Part XV) mark hot function groups. The system *learns* which
code regions are naturally coupled.

### Backward Compatibility

File claims continue to work. Regions are a layer on top:

```bash
# Old way (still works):
pd files claim src/auth/jwt.ts

# New way (recommended):
pd region claim auth

# Regions decompose into file claims internally:
# When you claim region 'auth', the daemon creates file claims for
# all files matching the region's patterns. Old agents that only
# understand file claims still see the claims.
```

---
---

# Part XV: Stigmergic Coordination

> **Schedule revision:** Pheromones are deferred to **V4.2-V4.3**. The seven
> pheromone types, evaporation engine, and automatic deposition hooks add
> computational overhead to every operation on the hot path. V4.0 ships harbors,
> enforcement, and the binary protocol. V4.1 ships remote harbors and sync. V4.2
> introduces pheromones once the core is stable and benchmarked, starting with the
> two highest-value types (heat and danger) before adding the remaining five in V4.3.
> The existing `lib/pheromone.ts` decay loop continues running as-is until then.

## What Is Stigmergy?

Coordination without direct communication. Agents leave traces in the environment.
Other agents detect the traces and adapt their behavior. No agent needs to know any
other agent exists. They just respond to the state of the world.

Examples in nature: ant pheromone trails, termite mound building, Wikipedia edits.
Examples in software: git commit history, CI status badges, code coverage reports.

## What Port Daddy Already Has

`lib/pheromone.ts` exists. It runs a decay loop every 60 seconds, multiplying
numeric values in metadata by 0.95. Values below 0.01 are evicted.

This is the *evaporation* half of stigmergy. What's missing is the *deposition* half —
agents need to leave traces, and the traces need to mean something.

## Phased Rollout

**V4.2:** Heat + Danger pheromones only. These are the highest-signal types —
"someone is working here" and "someone died here." Two types, two evaporation rates,
minimal hot-path overhead. Benchmark before proceeding.

**V4.3:** Trail, Success, Contention, Attention, Coupling. Roll out incrementally,
each gated on benchmark results showing <0.1ms deposition overhead per operation.

## Seven Pheromone Types

### 1. Heat: File/Region Activity

Every time an agent reads, modifies, or claims a file, the file accumulates *heat*.
Hot files are being actively worked on. Cold files are stable.

```
Trace: heat(file_path, intensity)
Deposition: automatic — daemon increments heat on every file claim, note referencing a file
Evaporation: 5% per minute (configurable)
Read: pd heat src/auth/    → shows heat map of auth directory
Agent use: avoid hot files (reduce conflicts), or seek hot files (join collaboration)
```

```sql
CREATE TABLE pheromones (
  harbor_name  TEXT NOT NULL,
  type         TEXT NOT NULL,           -- 'heat', 'trail', 'danger', etc.
  target       TEXT NOT NULL,           -- file path, region name, channel, etc.
  intensity    REAL NOT NULL DEFAULT 1.0,
  deposited_by TEXT,                    -- agent ID (null = system)
  deposited_at INTEGER NOT NULL,
  hlc_physical INTEGER,                -- HLC for remote sync (Part XVII, added V4.1)
  hlc_counter  INTEGER,                -- NULL until remote harbors are enabled
  hlc_node     TEXT,                    -- Daemon ID that last wrote this entry
  metadata     TEXT,                    -- JSON (type-specific data)
  PRIMARY KEY (harbor_name, type, target)
);
-- Note: HLC columns are nullable for V4.0 (local-only pheromones).
-- V4.1 migration backfills HLC values when remote harbors are enabled.
-- Pheromone sync uses max-wins (higher intensity wins), not LWW — see Part XVII.

CREATE INDEX idx_pheromones_type ON pheromones(harbor_name, type);
CREATE INDEX idx_pheromones_target ON pheromones(harbor_name, target);
```

### 2. Trail: Communication Frequency

When agents publish to a channel, the channel accumulates *trail* intensity. Busy
channels glow. Dead channels fade. A new agent entering a harbor can see which
channels are active without subscribing to all of them.

```
Trace: trail(channel, intensity)
Deposition: automatic — +1.0 per message published
Evaporation: 10% per minute (channels go cold faster than files)
Read: pd trails    → shows active channels ranked by intensity
Agent use: subscribe to hot channels first, ignore cold ones
```

### 3. Danger: Failure Markers

When an agent dies (heartbeat flatlines), a *danger* trace is deposited on
everything it was working on — its file claims, its region, its locks.

```
Trace: danger(target, intensity)
Deposition: automatic — daemon deposits on agent death
Evaporation: 2% per minute (danger fades slowly — 50 minutes to half-life)
Read: pd danger src/auth/   → "⚠ agent-dead1 died here 2h ago"
Agent use: proceed with caution, read the dead agent's notes first
```

This is the stigmergic version of salvage. Instead of explicitly running
`pd salvage`, agents naturally encounter danger traces while working. They
don't need to check a salvage queue — the environment warns them.

### 4. Success: Completion Markers

When an agent completes a session (`pd done`), a *success* trace is deposited
on the files/regions it touched.

```
Trace: success(target, intensity)
Deposition: automatic — on session completion with status 'completed'
Evaporation: 3% per minute (success fades at moderate rate)
Read: pd glow src/auth/   → "✓ recently completed work (agent-a4f2, 1h ago)"
Agent use: confidence signal — this code was recently worked on and the agent
           finished successfully. Probably stable.
```

### 5. Contention: Lock Pressure

Every failed lock attempt deposits a *contention* trace on the lock name.
High contention means agents are fighting over the same resource.

```
Trace: contention(lock_name, intensity)
Deposition: automatic — +1.0 per failed lock attempt
Evaporation: 15% per minute (contention is a momentary signal)
Read: pd contention    → "auth-module: HIGH (4 attempts in 5m)"
Agent use: don't try to acquire high-contention locks immediately.
           Wait, work on something else, try later.
```

### 6. Attention: Read Pressure

When multiple agents read the same file/region without claiming it, an *attention*
trace builds up. "Three agents have looked at src/auth/ in the last 10 minutes
but nobody's claimed it." This signals either:
- It's important and someone should claim it
- It's a dependency that everyone reads but nobody owns

```
Trace: attention(target, intensity)
Deposition: automatic — +0.5 per read/access without claim
Evaporation: 20% per minute (attention is ephemeral)
Read: pd attention    → "src/auth/: 3 agents looking, nobody claiming"
Agent use: if attention is high and you're qualified, claim it.
           If attention is high and someone claims it, that's coordination.
```

### 7. Coupling: Co-Change Correlation

When two files/regions are modified in the same session, a *coupling* trace
accumulates between them. Over many sessions, strongly coupled pairs emerge.

```
Trace: coupling(target_a, target_b, intensity)
Deposition: automatic — +1.0 when both are modified in same session
Evaporation: 1% per hour (coupling is a long-term structural signal)
Read: pd coupling src/auth/   → "strongly coupled with: src/middleware/auth.ts (0.89)"
Agent use: if claiming one, consider claiming the other.
           Feed into region auto-detection (V4.1+ — files that couple should be one region).
```

## The Evaporation Engine (Upgraded)

The current `lib/pheromone.ts` becomes a proper evaporation engine:

```typescript
const EVAPORATION_RATES: Record<string, number> = {
  heat:        0.95,   // 5%/min  — files stay warm for ~20 min
  trail:       0.90,   // 10%/min — channels cool in ~10 min
  danger:      0.98,   // 2%/min  — danger lingers for ~50 min
  success:     0.97,   // 3%/min  — success visible for ~30 min
  contention:  0.85,   // 15%/min — contention clears in ~5 min
  attention:   0.80,   // 20%/min — attention is momentary
  coupling:    0.999,  // 0.1%/hr — coupling is near-permanent
};
```

The engine runs every 30 seconds. Entries below 0.01 are evicted.

## How Agents Use Pheromones

Agents don't need special logic. The MCP tools surface pheromone data alongside
normal responses:

```
Agent calls: claim_port("myapp:api:auth")
Response includes:
  port: 3100
  pheromones:
    heat: 0.73 (active area — another agent was here recently)
    danger: 0.45 (⚠ an agent died working on auth 30m ago)
    success: 0.12 (fading — last successful completion was 2h ago)
    coupling: [{ target: "myapp:api:middleware", strength: 0.89 }]
```

The agent's LLM reads this context and adapts:
- "Heat is high — I should check who's working here and coordinate"
- "Danger marker — I should read the dead agent's notes before proceeding"
- "Coupling to middleware — I should claim that region too"

No explicit pheromone commands needed for reading. The environment speaks.

For writing, most pheromones are deposited *automatically* by the daemon on
existing operations (claim, release, note, publish, lock, die, complete).
Agents can also deposit manually:

```bash
pd pheromone deposit heat src/auth/ 0.5 --reason "investigating auth bug"
pd pheromone deposit danger src/auth/jwt.ts 1.0 --reason "found a security issue"
```

## Harbor-Scoped Pheromones

Pheromones are scoped to a harbor. Heat on `src/auth/` in the `myapp` harbor
is independent of heat on the same file in a different harbor.

In remote harbors, pheromones sync like other harbor state (subject to trust tier).
Full-trust peers see all pheromones. Coordinated-trust peers see heat, danger,
success, contention. Minimal-trust peers see nothing.

## What This Replaces

Pheromones don't replace existing features. They augment them with ambient intelligence:

| Explicit mechanism | Stigmergic equivalent |
|---|---|
| `pd salvage` (check queue) | Danger pheromones on dead agent's files |
| `pd files --all` (check claims) | Heat map shows activity without checking claims |
| `pd channels` (list channels) | Trail intensity shows which channels matter |
| `pd locks` (check contention) | Contention traces show pressure without checking |
| Manual region definition | Coupling traces auto-discover natural boundaries |

The explicit commands still work. The pheromones make the environment itself
informative — agents that don't know to check the salvage queue still encounter
danger traces. That's the point of stigmergy: **coordination emerges from the
environment, not from agent-to-agent protocols.**

---
---

# Part XVI: Agent Skills and Application Templates (Inspired by Firecrawl)

## What Firecrawl Does Well

Firecrawl nails three things we should learn from:

1. **`llms.txt`** — A machine-readable documentation index at `docs.firecrawl.dev/llms.txt`.
   Any LLM can fetch this file and instantly understand every endpoint, guide, and
   integration. It's the "robots.txt for AI agents." We need this.

2. **Template apps as proof of infrastructure** — They don't just document their API.
   They ship complete apps (open-lovable, fireplexity, fire-enrich, open-researcher)
   that demonstrate what you can build ON TOP of Firecrawl. Each app is a standalone
   repo with stars, README, and deployable code. The infrastructure disappears —
   you see the outcome, not the plumbing.

3. **Agent-first onboarding** — `firecrawl-cli init --all` teaches your IDE agent how
   to use Firecrawl. One command. The agent can then use Firecrawl without the human
   understanding the API. The human says "scrape this website" and the agent knows how.

## What Port Daddy Should Do

### 1. `llms.txt` — Machine-Readable Documentation Index

Create `/llms.txt` served by the daemon AND published at `portdaddy.dev/llms.txt`:

```
# Port Daddy — Coordination Runtime for AI Agent Teams
# Version: 4.0.0

## Core Concepts
- Semantic identities: project:stack:context format
- Harbors: cryptographic permission namespaces (enforced)
- Sessions: mutable agent work contexts with immutable notes
- Salvage: dead agent recovery via resurrection queue

## Quick Start
- Install: npm install -g port-daddy
- Start: pd start
- Begin session: pd begin "task description" --identity myapp:api:feature
- Claim port: pd claim myapp:api -q
- Add note: pd note "progress update"
- End session: pd done

## API Reference: https://portdaddy.dev/docs/api
## SDK Reference: https://portdaddy.dev/docs/sdk
## MCP Tools: https://portdaddy.dev/mcp
## Tutorials: https://portdaddy.dev/tutorials

## MCP Installation
npx port-daddy mcp install

## Endpoints (64 total)
- POST /claim/:id — Claim a port
- DELETE /release/:id — Release a service
- GET /services — List services
- POST /harbors — Create harbor
- POST /harbors/:name/enter — Enter harbor (returns harbor card)
- GET /harbors — List harbors
- POST /sessions — Start session
- POST /sessions/:id/notes — Add note
- POST /locks/:name — Acquire lock
- POST /msg/:channel — Publish message
- GET /subscribe/:channel — SSE subscription
- POST /agents/:id — Register agent
- GET /salvage — List salvage queue
... [all 64 endpoints]

## CLI Commands (48 total)
- pd begin <purpose> — Register + start session
- pd done [note] — End session + unregister
- pd whoami — Show current context
- pd claim <identity> — Claim a port
- pd harbor create <name> — Create harbor
- pd harbor connect <name> --peer <host> — Connect remote harbor
- pd spawn --backend <backend> -- <prompt> — Launch child agent
... [all 48 commands]

## SDK Methods (116 total)
- pd.claim(identity, options?) — Claim port
- pd.release(identity) — Release port
- pd.begin(purpose, options?) — Start session
... [all 116 methods]
```

This file is the single artifact that makes Port Daddy agent-accessible. Any LLM
that can fetch a URL can learn Port Daddy's entire API in one request.

**Implementation:** Static file generated from `features.manifest.json` + route
introspection. Served at `GET /llms.txt` by the daemon and deployed to
`portdaddy.dev/llms.txt` as a static asset.

### 2. `pd teach` — Agent Skill Installation

One command that installs Port Daddy knowledge into any MCP-compatible agent:

```bash
pd teach
# → Installing Port Daddy skill for Claude Code...
# → Added MCP server to ~/.claude.json
# → Added skill reference to ~/.claude/skills/
# → Your agent now knows 108 tools across 19 categories.
# →
# → Try: "begin a session for working on auth"

pd teach --cursor
# → Installing for Cursor...
# → Added MCP config to .cursor/mcp.json

pd teach --windsurf
# → Installing for Windsurf...

pd teach --all
# → Installed for: Claude Code, Cursor, Windsurf
```

What `pd teach` does:
1. Detects installed editors/agents
2. Installs MCP server configuration for each
3. Copies the skill reference (SKILL.md + references/) to the agent's skill directory
4. Verifies the daemon is running
5. Runs a self-test (agent calls `pd_discover()` to confirm connectivity)

This replaces the current manual `pd mcp install` workflow. One command, all agents.

**The skill itself** (`skills/port-daddy-agent-skill/SKILL.md`) already exists and is good.
It needs V4 updates:
- Add harbor commands to the CLI mapping table
- Add remote harbor workflow
- Add region commands
- Update tool count (93 → 108)
- Add pheromone awareness instructions

### 3. Template Applications — "Built on Port Daddy"

This is the highest-leverage marketing asset. Each template is a **complete, runnable
application** that demonstrates what you can build when agents have coordination
infrastructure.

#### Template 1: `pd-code-review` — Multi-Agent Code Review Pipeline

**What it is:** 3 agents review a PR simultaneously — one checks correctness, one
checks style, one checks security. They coordinate via Port Daddy to avoid reviewing
the same files.

**Repo structure:**
```
pd-code-review/
├── README.md                    # Setup instructions + architecture diagram
├── .portdaddyrc                 # Harbor config + region definitions
├── agents/
│   ├── correctness-reviewer.ts  # Agent 1: logic and bug checking
│   ├── style-reviewer.ts        # Agent 2: code style and patterns
│   └── security-reviewer.ts     # Agent 3: vulnerability scanning
├── scripts/
│   ├── review.sh                # Entry point: pd begin → spawn 3 agents → pd done
│   └── setup.sh                 # Install deps, verify pd running
└── package.json
```

**What it demonstrates:**
- `pd begin` with identity-scoped harbor
- `pd spawn` with attenuated capabilities (reviewer can only read code)
- File regions (each reviewer claims a logical region, not files)
- Pub/sub coordination (agents signal when their review is complete)
- Session notes as review comments (immutable audit trail)
- `pd done` with summary note

**Why it matters:** Code review is universal. Every developer understands the problem.
Showing 3 AI agents doing it in parallel, coordinated, without conflicts — that's
a demo that sells itself.

#### Template 2: `pd-feature-sprint` — Planner → Coder → Tester Pipeline

**What it is:** One agent plans the feature (breaks into tasks), spawns a coder agent
for each task, then a tester agent validates the output. Full pipeline, one command.

```
pd-feature-sprint/
├── README.md
├── .portdaddyrc
├── agents/
│   ├── planner.ts               # Reads issue, breaks into tasks
│   ├── coder.ts                 # Implements a single task
│   └── tester.ts                # Validates implementation
├── scripts/
│   └── sprint.sh                # pd begin → planner → coders → tester → pd done
└── package.json
```

**What it demonstrates:**
- Hierarchical agent spawning (planner spawns coders with attenuated caps)
- Harbor KV store for shared task list
- Session phases (planning → coding → testing → done)
- Danger pheromones if a coder dies (tester picks up the work)
- Salvage workflow (coder dies → another coder claims the task)

#### Template 3: `pd-research-swarm` — Parallel Deep Research

**What it is:** 4 agents research different aspects of a topic simultaneously, then
a synthesizer agent combines their findings into a report.

```
pd-research-swarm/
├── README.md
├── .portdaddyrc
├── agents/
│   ├── researcher.ts            # Researches one aspect
│   └── synthesizer.ts           # Combines findings
├── scripts/
│   └── research.sh
└── package.json
```

**What it demonstrates:**
- Pub/sub for broadcasting findings
- Harbor whiteboard (shared KV) for accumulating knowledge
- Session notes as research citations (immutable)
- Inbox messaging (synthesizer sends follow-up questions to researchers)
- Remote harbors (researchers could be on different machines)

#### Template 4: `pd-self-healing-infra` — Resilient Service Mesh

**What it is:** 3 services (API, worker, database) running with Port Daddy
orchestration. When one crashes, a watcher agent detects it and restarts it.
If the restarting agent dies, salvage kicks in.

```
pd-self-healing-infra/
├── README.md
├── .portdaddyrc
├── services/
│   ├── api/                     # Express API server
│   ├── worker/                  # Background job processor
│   └── db/                      # Database service
├── agents/
│   └── healer.ts                # Watches for crashes, restarts services
├── scripts/
│   └── up.sh                    # pd scan → pd up → spawn healer
└── package.json
```

**What it demonstrates:**
- `pd scan` + `pd up` (the docker-compose replacement story)
- `pd watch` for event-driven healing
- Health checks via Port Daddy
- Salvage (if the healer itself dies)
- Heat pheromones (shows which services are actively being healed)

#### Template 5: `pd-cross-machine` — Two Machines, One Project

**What it is:** A tutorial-as-template showing how to coordinate development
across a MacBook and a PC desktop using remote harbors.

```
pd-cross-machine/
├── README.md                    # Step-by-step with screenshots
├── .portdaddyrc
├── machine-a/
│   └── setup.sh                 # pd harbor create → pd harbor listen
├── machine-b/
│   └── setup.sh                 # pd harbor connect → pd begin
└── demo/
    └── coordinate.sh            # Show file claims syncing, pub/sub flowing
```

**What it demonstrates:**
- Remote harbor setup (your actual use case)
- mDNS discovery
- Cross-machine file claim visibility
- Trust tiers in practice

### 4. Template Presentation on portdaddy.dev

New route: `/templates` (already exists as a page, needs real content)

```
┌─────────────────────────────────────────────────────────┐
│                                                          │
│     Built on Port Daddy                                  │
│                                                          │
│     Complete applications showing what coordinated       │
│     agent teams can build. Fork, customize, ship.        │
│                                                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │ CODE REVIEW │  │ FEATURE     │  │ RESEARCH    │     │
│  │ PIPELINE    │  │ SPRINT      │  │ SWARM       │     │
│  │             │  │             │  │             │     │
│  │ 3 agents    │  │ planner →   │  │ 4 parallel  │     │
│  │ review a PR │  │ coders →    │  │ researchers │     │
│  │ in parallel │  │ tester      │  │ + synthesizer│     │
│  │             │  │             │  │             │     │
│  │ [Fork →]    │  │ [Fork →]    │  │ [Fork →]    │     │
│  └─────────────┘  └─────────────┘  └─────────────┘     │
│                                                          │
│  ┌─────────────┐  ┌─────────────┐                       │
│  │ SELF-HEALING│  │ CROSS-      │                       │
│  │ INFRA       │  │ MACHINE     │                       │
│  │             │  │             │                       │
│  │ pd up with  │  │ MacBook +   │                       │
│  │ auto-restart│  │ Desktop     │                       │
│  │ and salvage │  │ one harbor  │                       │
│  │             │  │             │                       │
│  │ [Fork →]    │  │ [Fork →]    │                       │
│  └─────────────┘  └─────────────┘                       │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

Each template card links to its GitHub repo. The repo has:
- A README with architecture diagram and step-by-step walkthrough
- A 30-second GIF showing the template running
- A `setup.sh` that handles everything (checks `pd status`, installs deps, runs)
- Less than 500 lines total (excluding deps). Templates should be readable in one sitting.

### 5. Use Cases Page (Outcome-Oriented)

Firecrawl shows 12 use cases focused on *outcomes*, not features. We should do the same:

```
/use-cases

1. "4 Agents, 1 Codebase, 0 Conflicts"
   Multi-agent coding without file stomping. File claims + regions + locks.
   → Link to code-review template

2. "When Your Agent Crashes at 3am"
   Automatic work preservation. Salvage queue + danger pheromones.
   → Link to self-healing template

3. "MacBook at Home, Desktop at the Office"
   Cross-machine coordination. Remote harbors + mDNS discovery.
   → Link to cross-machine template

4. "The AI Feature Factory"
   Planner → coders → tester pipeline. One command, full feature.
   → Link to feature-sprint template

5. "Research That Doesn't Repeat Itself"
   Parallel research with shared whiteboard. No duplicate work.
   → Link to research-swarm template

6. "docker-compose, but for AI Agents"
   pd scan → pd up. Framework detection + port assignment + health monitoring.
   → Link to self-healing template

7. "Formally Verified Agent Security"
   ProVerif-proven harbor cards. Capability attenuation. Zero-trust by default.
   → Link to whitepaper

8. "The 60-Second MCP Setup"
   pd teach --all. Every IDE agent gets 108 tools instantly.
   → Link to MCP page
```

### 6. GitHub Organization Structure

Like Firecrawl's org (`github.com/firecrawl`), create repos under `curiositech`:

```
curiositech/
├── port-daddy              # Main daemon (existing)
├── pd-code-review          # Template: multi-agent code review
├── pd-feature-sprint       # Template: planner → coder → tester
├── pd-research-swarm       # Template: parallel research
├── pd-self-healing-infra   # Template: resilient service mesh
├── pd-cross-machine        # Template: remote harbor tutorial
└── awesome-port-daddy      # Community showcase (like awesome-X lists)
```

Each template repo:
- Has its own README with GIF, architecture diagram, setup instructions
- Is tagged `port-daddy-template` for discoverability
- Links back to `portdaddy.dev/templates`
- Has CI that verifies it works against the latest Port Daddy release

### 7. `pd init` — Project Scaffolding

Like `create-react-app` or `firecrawl init`, a command that scaffolds a coordinated
project:

```bash
pd init my-project --template code-review
# → Created my-project/
# → Installed port-daddy dependency
# → Created .portdaddyrc with harbor config
# → Created agents/ with 3 reviewer agents
# → Created scripts/review.sh
# →
# → Next steps:
# →   cd my-project
# →   pd begin "setting up code review pipeline"
# →   ./scripts/review.sh <pr-url>

pd init my-project --template feature-sprint
pd init my-project --template research-swarm
pd init my-project --blank          # Just .portdaddyrc + basic structure
```

`pd init --blank` gives you:
```
my-project/
├── .portdaddyrc           # Harbor config (project name, default caps)
├── agents/                # Empty directory for agent scripts
└── scripts/
    └── setup.sh           # Verifies pd is running, creates harbor
```

## Content Hierarchy Summary

```
Agent discovers Port Daddy:
  1. Fetches llms.txt (or pd_discover via MCP)       — knows the API
  2. Reads SKILL.md (via pd teach)                     — knows the patterns
  3. Explores templates (via portdaddy.dev/templates)  — sees the outcomes

Human discovers Port Daddy:
  1. Lands on portdaddy.dev                            — sees the hero
  2. Clicks a use case                                 — understands the problem
  3. Forks a template                                  — has running code in 60s
  4. Reads a tutorial                                  — goes deeper
  5. Deploys to their project                          — becomes a user
```

Firecrawl's genius is that the template apps do the selling. Nobody reads API docs
for fun. But people DO browse "cool things built with X" repos. The templates are
the funnel.

---
---

# Part XVII: Distributed State & Conflict Resolution

## The Hardest Problem in This Plan

Part XIII describes a harbor KV store with CAS (compare-and-swap) for concurrency.
Part II says remote harbors sync state between daemons. Neither addresses what happens
when two daemons modify the same key while connected, or worse, while partitioned.

CAS prevents lost updates **on a single node**. With two nodes, both can succeed
locally with conflicting writes. When they sync — who wins?

This section defines the conflict resolution model, the sync protocol, and the
partition tolerance guarantees. These are the decisions that determine whether remote
harbors actually work under real-world conditions.

## Conflict Resolution Model: Hybrid LWW + Conflict Detection

After evaluating CRDTs (LWW-Register, MV-Register, OR-Map), operational transformation,
and per-key conflict detection with manual resolution:

**Decision: Last-Writer-Wins (LWW) with Hybrid Logical Clocks (HLC) as the default,
with opt-in conflict detection for designated keys.**

### Why LWW, Not Full CRDTs

CRDTs (Conflict-free Replicated Data Types) guarantee convergence without coordination.
They're the theoretically correct answer. But:

- **OR-Map / MV-Register CRDTs** require every value to carry a version vector that
  grows with the number of nodes. For 2-10 nodes this is manageable, but the complexity
  cost in implementation, debugging, and storage is significant.
- **Automerge / Yjs** are excellent for document editing but heavyweight for a KV store
  where values are typically short strings or small JSON objects.
- **cr-sqlite** (Vulcan Labs / Expensify's project) merges SQLite databases using
  CRDTs at the row level. It's promising but adds a significant dependency and
  changes the SQLite interaction model.

LWW is simpler, well-understood, and correct for the vast majority of KV use cases
in agent coordination. The key insight: **most KV writes in a harbor are not
contentious.** Agents working on different parts of a codebase write different keys.
Conflicts are rare, and when they happen, "latest timestamp wins" is almost always
the right answer.

**Overwrite audit:** When LWW discards a write during sync, the discarded value is
logged to the activity log as a `kv_overwrite` event (key, old value, new value,
losing node). This is not an undo mechanism — it's a diagnostic trail so operators
can detect silent data loss after the fact. The activity log has its own lifecycle
(Part XXIII) and these entries are pruned with everything else.

### Hybrid Logical Clocks (HLC)

LWW needs a total ordering of writes. Wall-clock timestamps are unreliable (clock
skew between machines). Vector clocks have unbounded size. HLCs are the pragmatic
middle ground:

```
HLC = (physical_time, logical_counter, node_id)

- physical_time: max(local_wall_clock, received_remote_time)
- logical_counter: incremented when physical_time doesn't advance
- node_id: daemon identifier (breaks ties deterministically)
```

HLCs are bounded in size (fixed 3-tuple), monotonically increasing per node, and
respect causality for causally related events (if event A causally precedes event B
via message passing, A's HLC < B's HLC — but concurrent events on disconnected nodes
have no guaranteed ordering). They're used by CockroachDB, TiDB, and other distributed
databases.

**Implementation:** 16 bytes per timestamp (8 bytes physical, 4 bytes counter,
4 bytes node_id_hash). Stored alongside every KV entry and every synced entity.

```sql
-- Updated harbor_kv schema with HLC
CREATE TABLE harbor_kv (
  harbor_name  TEXT NOT NULL REFERENCES harbors(name) ON DELETE CASCADE,
  key          TEXT NOT NULL,
  value        TEXT NOT NULL,
  version      INTEGER NOT NULL DEFAULT 1,  -- Optimistic concurrency (CAS, from Part XIII)
  hlc_physical INTEGER NOT NULL,    -- Physical clock (ms since epoch)
  hlc_counter  INTEGER NOT NULL,    -- Logical counter
  hlc_node     TEXT NOT NULL,       -- Daemon ID (short hash)
  updated_by   TEXT,
  visibility   TEXT NOT NULL DEFAULT 'harbor',
  conflict_mode TEXT NOT NULL DEFAULT 'lww',  -- 'lww' or 'detect'
  PRIMARY KEY (harbor_name, key)
);

-- This schema supersedes Part XIII's harbor_kv definition.
-- CAS via `version` column is preserved for local concurrency (Part XIII).
-- HLC columns are added for remote sync ordering (Part XVII).
-- `conflict_mode` per key enables opt-in conflict detection.
```

### Conflict Detection for Critical Keys

Some keys are too important for "last write wins." For these, opt into conflict
detection:

```bash
pd harbor kv set myapp db.schema_version "42" --conflict-mode detect
# → If this key is modified on two daemons simultaneously,
#   BOTH values are preserved and flagged as conflicting
```

When a conflict is detected during sync:

```json
{
  "key": "db.schema_version",
  "conflict": true,
  "values": [
    {"value": "42", "hlc": "...", "node": "macbook", "updatedBy": "agent-a"},
    {"value": "43", "hlc": "...", "node": "desktop", "updatedBy": "agent-b"}
  ],
  "resolution": "manual"
}
```

The conflict is surfaced via:
- `pd harbor kv conflicts myapp` — list all unresolved conflicts
- Pub/sub notification on `myapp:conflicts` channel
- Dashboard "Conflicts" indicator on the harbor panel
- MCP tool `harbor_kv_conflicts` for agent resolution

Resolution:

```bash
pd harbor kv resolve myapp db.schema_version --pick macbook
# or
pd harbor kv resolve myapp db.schema_version --value "44"
```

### Default Conflict Mode by Data Type

| Data type | Default mode | Rationale |
|-----------|-------------|-----------|
| KV entries | LWW | Most writes are non-contentious |
| File claims | Detect | Two agents claiming the same file IS the conflict |
| Lock state | Authoritative | The daemon that holds the lock is authoritative |
| Session notes | Append-only | No conflicts possible — notes are immutable |
| Pheromones | Max-wins | Take the higher intensity — more conservative |
| Harbors membership | Union | If either side says an agent is a member, it's a member |
| Agent liveness | Latest-heartbeat | Most recent heartbeat wins |

## Sync Protocol

### Architecture: WebSocket Sync + HTTP RPCs

The original plan (Part I) specified "SSE for real-time sync, HTTP for RPCs." But
SSE is unidirectional (server → client). For daemon-to-daemon sync, we need
bidirectional state flow.

**Decision: WebSocket for the persistent sync channel.** Rationale:
- Bidirectional on a single connection
- Binary frames (can send msgpack directly)
- Built-in ping/pong for keepalive
- Native support in Node.js (`ws` library, 0 dependencies for the server)
- HTTP RPCs remain for one-off operations (verify card, query state)

### WebSocket Authentication

The WebSocket connection must be authenticated BEFORE the `sync_hello` exchange.
Authentication happens during the HTTP upgrade request:

1. The initiating daemon sends a harbor card as a query parameter or
   `Authorization: Bearer <harbor-card>` header in the HTTP upgrade request
2. The receiving daemon verifies the card (same verification path as any harbor API
   request — see Part XVIII for key management)
3. If verification fails, the upgrade is rejected with HTTP 401 (no WebSocket is opened)
4. If verification succeeds, the WebSocket opens and proceeds to `sync_hello`
5. The authenticated harbor name is bound to the WebSocket session — a single
   connection syncs a single harbor

This means a daemon with 3 remote harbors maintains 3 authenticated WebSocket
connections. The harbor card's `exp` claim is checked periodically (every 60s) on
established connections. If the card expires mid-session, the connection is closed
with a `card_expired` close frame and the initiating daemon must reconnect with a
fresh card.

```
Daemon A                         Daemon B
   │                                │
   │──── WS connect ───────────────►│
   │◄─── WS accept ────────────────│
   │                                │
   │──── sync_hello {version, hlc} ►│
   │◄─── sync_hello {version, hlc} │
   │                                │
   │──── full_state_hash ──────────►│  (Merkle hash of all synced entities)
   │◄─── full_state_hash ──────────│
   │                                │
   │  If hashes differ:            │
   │──── diff_request ─────────────►│
   │◄─── diff_response ────────────│  (Only changed entities)
   │──── diff_ack ─────────────────►│
   │                                │
   │  Ongoing:                     │
   │◄──► mutation(key, value, hlc)  │  (Real-time bidirectional)
   │◄──► mutation(key, value, hlc)  │
   │                                │
   │  Keepalive:                   │
   │◄──► ping/pong (30s interval)  │
```

### Initial Sync: Merkle Hash Comparison

On connection, each daemon computes a Merkle hash of all synced entities in the
harbor. If hashes match, no sync needed. If they differ, a diff exchange identifies
which entities changed.

```
Merkle tree:
  root_hash
  ├── kv_hash (hash of all KV entries)
  ├── claims_hash (hash of all file claims)
  ├── members_hash (hash of all membership records)
  ├── locks_hash (hash of all lock state)
  └── pheromones_hash (hash of all pheromone entries)
```

If `kv_hash` differs but everything else matches, only KV entries are exchanged.
This minimizes bandwidth for partial divergence.

**Honesty note:** This is a 5-bucket category comparison, not a deep Merkle tree with
per-key granularity. When a category hash differs, ALL entries in that category are
exchanged. For typical harbors (<500 KV entries), a full category exchange is small
(~10-50KB). For harbors approaching the 10,000 KV soft limit, this becomes expensive.
A future optimization (V4.2+) could add a second level of hashing (hash-per-key-prefix)
to narrow the exchange further, but the simple approach is correct and sufficient at
launch scale.

### Bandwidth and Throttling

For a harbor with 500 KV entries, 100 pheromone traces, 50 notes, and 20 file claims:

- Full initial sync: ~50-100KB (compact msgpack encoding)
- Incremental mutations: ~100-500 bytes per change
- At 10 changes/second (heavy usage): ~5KB/s bandwidth

This is negligible for any network. No throttling needed at V4 scale.

For pathological cases (10,000+ KV entries), add:
- `max_sync_batch_size` config (default: 1000 entities per batch)
- Backpressure: if the WebSocket send buffer exceeds 1MB, pause sending until it drains
- Compression: msgpack + optional zstd compression for initial sync (not for mutations)

## Partition Tolerance

### The Fundamental Guarantee: Local-First

**When the network drops, everything local continues to work.** This is non-negotiable.

- Agents on the local daemon can still claim ports, write notes, acquire locks,
  read/write KV, publish messages
- The daemon never blocks waiting for a remote peer
- All local operations complete in <1ms regardless of network state

### What Happens During a Partition

```
Connected:
  MacBook ◄──────► Desktop
  harbor: myapp (synced)

Partition:
  MacBook          Desktop
  harbor: myapp    harbor: myapp
  (local ops       (local ops
   continue)        continue)

  Both sides can:
  - Write KV entries (locally)
  - Claim files (locally)
  - Acquire locks (locally — this means the same lock can be held by both sides!)
  - Publish messages (local subscribers only)
  - Read all local state

Reconnection:
  MacBook ◄──────► Desktop
  1. WebSocket reconnects (exponential backoff: 1s, 2s, 4s, 8s, max 60s)
  2. Merkle hash comparison (what diverged?)
  3. Diff exchange (send changed entities)
  4. Conflict resolution (LWW for KV, detect for file claims, see table above)
  5. Sync complete
```

### The Lock Problem

Locks are the hardest case during partitions. If both sides acquire the same lock
while partitioned, we have two holders. **This violates mutual exclusion.** There is
no way to provide distributed mutual exclusion during a network partition without
blocking (which contradicts the local-first guarantee). We choose availability over
consistency for locks during partitions.

**What this means in practice:** Locks during partitions are advisory only. Work
performed under a preempted lock is NOT automatically rolled back — the `lock_preempted`
event is a notification, not an undo. Agents that hold locks across partitions must
be prepared for preemption. For critical operations, use `conflict_mode: 'detect'`
on the KV entries protected by the lock, so conflicting writes are caught even if the
lock was duplicated.

On reconnection:

**Decision: Fencing tokens.** Each lock acquisition gets a monotonically increasing
fencing token (integer). When the partition heals, the higher fencing token wins.
The loser's lock is force-released, and a `lock_preempted` event is published.

```
Partition:
  MacBook acquires auth-module (fencing token: 17)
  Desktop acquires auth-module (fencing token: 18)

Reconnection:
  Desktop's token (18) > MacBook's token (17)
  → Desktop keeps the lock
  → MacBook's lock is force-released
  → Event published: "lock auth-module preempted: MacBook → Desktop"
  → MacBook's agent sees the event and can react
```

Fencing tokens use a per-lock monotonic counter (not HLC — HLCs are not globally
ordered across partitioned nodes, so a node with faster clock drift would always
win). Each lock maintains an `acquisition_counter` that increments on every acquire.
During sync, the higher counter wins. This is best-effort fairness during partitions:
both sides advance their local counter independently, and the numerically higher value
wins on reconnection. This is explicitly NOT a consensus protocol — it is a tie-breaker
for a scenario (dual lock holders) that should be rare and temporary.

### Split-Brain Detection

If two daemons are partitioned for more than `max_partition_duration` (default: 1 hour),
the sync channel enters "reconciliation mode" on reconnection:

1. Full state comparison (not just Merkle diff)
2. All conflicts surfaced to agents via pub/sub
3. A `partition_healed` event with summary of changes
4. Dashboard shows "Reconciliation in progress" indicator

For partitions shorter than 1 hour, the normal Merkle diff is sufficient.

## What This Architecture Is NOT

This is NOT a general-purpose distributed database. It's a coordination state
synchronizer for 2-10 daemon nodes running on developer machines. The design
reflects this scope:

- **Not CP (consistent + partition-tolerant).** We sacrifice strict consistency
  for availability. Local operations always work, even if they create conflicts
  that are resolved later.
- **Not designed for WAN latency.** Remote harbors over the internet work, but
  the sync protocol assumes reasonable latency (<500ms). For higher latency,
  batch mutations and sync less frequently.
- **Not designed for large datasets.** If your harbor has >10,000 KV entries,
  you're using it wrong. The KV store is for coordination metadata, not data
  storage.

## Files to Create

- `lib/hlc.ts` — Hybrid Logical Clock implementation (~80-100 lines with serialization)
- `lib/sync-protocol.ts` — WebSocket sync protocol, Merkle hashing, diff exchange (~800-1200 lines; this is one of the most complex modules in the codebase, encompassing connection state machine, frame encoding, Merkle tree builder, diff algorithm, reconnection logic, and partition timer)
- `lib/conflict-resolver.ts` — LWW resolution, conflict detection, manual resolution (~200-300 lines)
- `tests/unit/hlc.test.js` — HLC property tests (monotonicity, causality)
- `tests/unit/sync-protocol.test.js` — Sync protocol unit tests
- `tests/unit/conflict-resolver.test.js` — Conflict resolution unit tests
- `tests/integration/partition.test.js` — Two-daemon partition simulation

## ADR-0015: Conflict Resolution Model

**Status:** Proposed
**Context:** Remote harbors require a strategy for handling concurrent writes from
different daemons. Full CRDTs are complex. No resolution means data loss.
**Decision:** LWW with HLC as the default. Opt-in conflict detection for designated
keys. Fencing tokens for locks. Max-wins for pheromones. Union for membership.
**Consequences:** Occasional data loss for contentious keys in LWW mode (mitigated
by conflict detection opt-in). Simple implementation. Well-understood semantics.

---
---

# Part XVIII: Key Management & Operational Security

## The Problem

Part I says "HMAC signed harbor cards" and Part II says "Ed25519 for remote." Neither
addresses where the keys live, how they rotate, how you migrate between them, or what
happens when they're compromised. The ProVerif proofs verify the *protocol*. They say
nothing about the *operational* security of the keys themselves.

This section closes that gap.

## Key Storage: The "age" Pattern

After evaluating OS keychain (macOS Keychain, Linux Secret Service), environment
variables, SQLite storage, and separate files, the answer is clear: **separate file
with restricted permissions.** This is what SSH, age, and GPG all do.

Rationale for rejecting alternatives:
- **OS keychain**: A launchd/systemd daemon runs headlessly. macOS Keychain requires
  interactive prompts unless you preconfigure "always allow" for a specific binary path,
  which breaks on `npm install` updates. Linux has no universal keychain daemon.
- **Environment variables**: Leak into `/proc/<pid>/environ`, shell histories, and logs.
  The 12-factor recommendation is for cloud deployments, not local daemons.
- **SQLite storage**: Puts the key alongside the data it protects. An attacker who gets
  the DB file gets the key. This is locking the safe key inside the safe.

### File Layout

```
~/.config/port-daddy/
├── keys/
│   ├── hmac-active.key       # Current HMAC signing key (32 bytes, hex)
│   ├── hmac-retired-1710460800.key  # Previous key (still verifies)
│   └── ed25519-active.pem    # Ed25519 private key (V4.1+)
└── port-daddy.conf           # Optional config overrides
```

All key files: `0600` (owner read/write only).
Key directory: `0700` (owner access only).

### Generation and Verification

On first run:
1. `crypto.randomBytes(32)` → hex-encode → write to `hmac-active.key`
2. Set permissions to `0600` via `fs.chmodSync` immediately after creation
3. On every subsequent startup, verify permissions haven't been loosened
4. If permissions are too open: **refuse to start** with a clear error message,
   matching SSH's `WARNING: UNPROTECTED PRIVATE KEY FILE` behavior

```typescript
// lib/key-manager.ts
function loadSigningKey(): { kid: string; secret: Buffer; state: 'active' | 'retired' } {
  const keyPath = path.join(configDir, 'keys', 'hmac-active.key');
  const stat = fs.statSync(keyPath);
  const mode = stat.mode & 0o777;
  if (mode !== 0o600) {
    throw new Error(
      `Key file ${keyPath} has permissions ${mode.toString(8)}, expected 600. ` +
      `Fix with: chmod 600 ${keyPath}`
    );
  }
  return { kid: kidFromPath(keyPath), secret: fs.readFileSync(keyPath), state: 'active' };
}
```

### Why Not SQLCipher?

SQLCipher encrypts the entire SQLite database. The problem: you need a key to decrypt
it, and where does *that* key live? In a file? Then just put the signing key in the
file directly. SQLCipher adds complexity without meaningful security gain for an
auto-starting daemon with no user interaction.

## Key Rotation: Zero-Downtime

Every JWT gets a Key ID (`kid`) in its header:

```json
{ "alg": "HS256", "kid": "k-1710460800" }
```

### Key States

```
pending → active → retired → revoked

pending:  Generated but not yet signing. Used for pre-distribution in remote harbors.
active:   Signs new tokens. Only ONE key is active at a time.
retired:  No longer signs. Still verifies. Tokens signed by this key are accepted.
revoked:  No longer verifies. Tokens signed by this key are rejected.
```

### Rotation Procedure

1. Generate new key, write to a temp file (`hmac-new.key.tmp`), `fsync` it
2. Mark old key as `retired` in the `signing_keys` metadata table (inside a transaction)
3. Insert new key's `kid` as `active` in the same transaction
4. COMMIT the metadata transaction
5. Atomic rename: `hmac-new.key.tmp` → `hmac-active.key`, old key → `hmac-retired-{ts}.key`

**Crash safety:** If crash occurs before step 4, no metadata change — the temp file
is orphaned and cleaned up on startup. If crash occurs after step 4 but before step 5,
the metadata points to a `kid` whose file doesn't yet exist — `loadSigningKey()` falls
back to the retired key until the rename completes on next startup. This is the same
write-ahead pattern used by SQLite itself.

**Encoding note:** Keys are stored as raw bytes (32 bytes from `crypto.randomBytes(32)`),
not hex-encoded. `fs.readFileSync(keyPath)` returns the raw Buffer directly. This
avoids the subtle bug where hex-encoding doubles the key length to 64 ASCII bytes.
6. All new tokens signed with new key
7. Verification logic: look up key by `kid` → if `active` or `retired`, verify;
   if `revoked` or unknown, reject
8. After `max_token_lifetime + 5min` (clock skew buffer), mark old key `revoked`
9. After 24h, delete the retired key file

This is the exact pattern Auth0 and Firebase Auth use. At Port Daddy's scale
(1-50 active JWTs), the retired key window is trivially short.

### Metadata Table (Not Key Material)

```sql
CREATE TABLE signing_keys (
  kid         TEXT PRIMARY KEY,           -- e.g., "k-1710460800"
  algorithm   TEXT NOT NULL,              -- 'HS256' or 'EdDSA'
  state       TEXT NOT NULL DEFAULT 'active',  -- active/retired/revoked
  created_at  INTEGER NOT NULL,
  retired_at  INTEGER,
  revoked_at  INTEGER
);
-- Key material is NOT in this table. Only metadata.
-- Key material lives in the filesystem at ~/.config/port-daddy/keys/
```

### CLI Surface

```bash
pd keys list              # Show all keys with state and age
pd keys rotate            # Generate new key, retire current
pd keys revoke <kid>      # Immediately revoke a specific key
pd keys verify            # Check permissions, validate key integrity
```

## JTI Revocation: Bounded Growth

### The Problem

Every harbor card has a JTI (JWT ID). When an agent dies, its JTIs are revoked.
Without cleanup, the revocation table grows forever.

### The Solution: TTL-Based Cleanup

At Port Daddy's scale (1-50 active JWTs), this is a non-problem solved trivially:

```sql
CREATE TABLE revoked_jtis (
  jti        TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,      -- Token's original exp claim
  revoked_at INTEGER NOT NULL,
  reason     TEXT                    -- 'agent_death', 'manual', 'key_rotation'
);

CREATE INDEX idx_revoked_expires ON revoked_jtis(expires_at);
```

Cleanup runs on daemon startup and every hour:

```sql
DELETE FROM revoked_jtis WHERE expires_at < unixepoch();
```

Once a token's natural expiry has passed, there's no reason to track its revocation —
it would fail verification anyway due to the `exp` claim. This is the exact pattern
Keycloak uses.

**Why not bloom filters?** Bloom filters shine at millions of entries where memory
savings matter. At 50 entries, a bloom filter is more complex and less accurate than
a SQLite table. Don't optimize for a scale you don't have.

**Worst-case growth:** Even if 100 agents crash per day (catastrophic scenario), with
1-hour token TTLs, the table never exceeds ~100 rows at steady state. With 24-hour
TTLs, it peaks at ~2400 rows. Both are trivially small for SQLite.

## HMAC → Ed25519 Migration

### Why Migrate

HMAC (symmetric): The same secret signs and verifies. Anyone who can verify can forge.
Fine when only the local daemon verifies. Breaks when remote daemons need to verify
without being able to mint tokens.

Ed25519 (asymmetric): Private key signs, public key verifies. You can distribute the
public key to every remote peer. They verify but can't forge.

### Migration Protocol

**Phase 1 (V4.0):** HMAC only. All tokens are `alg: HS256`. Single daemon, single key.

**Phase 2 (V4.1, when remote harbors ship):**
1. Generate Ed25519 keypair. Private key in `~/.config/port-daddy/keys/ed25519-active.pem`.
   **Note:** This introduces `~/.config/port-daddy/` as a new directory. The database
   lives in `<project-root>/port-registry.db` (per CLAUDE.md). Keys are deliberately
   separated from data: keys are per-user identity (shared across projects), while the
   database is per-project state. The daemon creates this directory on first key
   generation with `0700` permissions.
   Public key published at `GET /.well-known/jwks.json`.
2. All new tokens signed with Ed25519 (`alg: EdDSA`).
3. Verification accepts BOTH:
   - `alg: EdDSA` + valid `kid` → verify with Ed25519 public key
   - `alg: HS256` + valid `kid` in `retired` state → verify with HMAC secret
4. **Critical security rule:** The verifier NEVER trusts the `alg` header alone.
   It looks up the key by `kid`, checks the key's declared algorithm, and only then
   verifies. This prevents the classic `alg: none` downgrade attack. Already
   implemented in `lib/harbor-tokens.ts:207-209`.

**Phase 3 (V4.2, after max_token_lifetime has elapsed):**
1. All HMAC tokens have naturally expired.
2. Remove HMAC verification path from code.
3. Revoke and delete HMAC keys.
4. This prevents future downgrade attacks.

Node.js has native Ed25519 support (`crypto.generateKeyPairSync('ed25519')`) since
Node 12. The `jose` library handles EdDSA JWTs. No new dependencies needed.

## Dashboard Authentication

### The Problem

The dashboard at `localhost:9876` currently has no authentication. With remote harbors,
the daemon listens on `0.0.0.0:9877`. If the dashboard is served on the remote port,
anyone who can reach it can destroy harbors, kill agents, and end sessions.

### The Solution: Port Separation + Optional Token

**Rule 1:** The dashboard is ONLY served on the local interface. The remote harbor
sync port (`0.0.0.0:9877`) serves ONLY sync endpoints and health checks. No dashboard,
no destructive API endpoints.

```typescript
// server.ts — Three server instances from two Express apps
import http from 'http';
const localApp = express();   // Dashboard + full API
const remoteApp = express();  // Sync endpoints only

// Two servers for the local app (TCP + Unix socket)
const localTcp = http.createServer(localApp);
const localSock = http.createServer(localApp);
localTcp.listen(9876, '127.0.0.1');        // Localhost TCP
localSock.listen('/tmp/port-daddy.sock');   // Unix socket

if (remoteHarborsEnabled) {
  const remoteSrv = http.createServer(remoteApp);
  remoteSrv.listen(9877, '0.0.0.0');       // Remote peers only
}
```

Note: Express's `app.listen()` creates a new `http.Server` internally. To share one
Express app across two transports, use `http.createServer(app)` explicitly.

**Rule 2:** Remote-facing endpoints require harbor cards. No exceptions.
The `remoteApp` has the harbor middleware on every route.

**Rule 3:** Optional dashboard token for paranoid users.

```bash
pd config set dashboard.token "$(openssl rand -hex 16)"
# → Dashboard now requires ?token=<hex> or cookie
```

This protects against local privilege escalation (another user on a shared machine).
Optional because single-user developer machines don't need it.

### CSRF Protection

The dashboard makes mutating API calls (destroy harbor, end session). Even on
localhost, CSRF is possible if a malicious website triggers a request to
`localhost:9876`. Protection:

- All mutating dashboard requests use `fetch()` with `Content-Type: application/json`
- **Middleware explicitly rejects** any POST/PUT/DELETE without `Content-Type: application/json`.
  This is enforced, not just checked — requests with missing or wrong Content-Type get
  HTTP 415 (Unsupported Media Type).
- `Content-Type: application/json` is NOT in the CORS "simple request" safe list,
  so it triggers a CORS preflight. The server denies preflight for cross-origin requests
  (CORS is already configured to reject cross-origin, existing code).

This is a defense-in-depth measure, not a complete CSRF solution on its own. The
Content-Type enforcement + CORS denial together prevent cross-origin mutation.
`fetch()` with `mode: 'no-cors'` downgrades the content type and would be rejected
by the Content-Type middleware. No CSRF tokens needed for localhost-only services.

## mDNS Information Leakage

### The Risk

mDNS advertisements in `_portdaddy._tcp.local.` include the harbor name in the TXT
record. In a shared office or co-working space, anyone running
`dns-sd -B _portdaddy._tcp local.` sees your project names.

### Mitigations

**Tier 1 (default):** mDNS is opt-in only. The `--advertise` flag is required.
Auto-discovery without `--advertise` uses unicast probing (direct IP, not broadcast).

**Tier 2:** Hash the harbor name in the advertisement. The TXT record contains
`harbor_hash=sha256(harbor_name + salt)[:12]` instead of the plaintext name. Peers
that already know the harbor name can compute the hash to match. Passive observers
see a random-looking string.

**Tier 3:** Silent mode. `pd harbor listen myapp --silent` opens the sync port but
does NOT advertise via mDNS. Connection requires explicit `pd harbor connect --peer
<ip:port>`. Zero network visibility.

```bash
pd harbor listen myapp --advertise          # Tier 1: plaintext name in mDNS
pd harbor listen myapp --advertise --hash   # Tier 2: hashed name
pd harbor listen myapp                      # Tier 3: no mDNS, manual connect only
```

Default is Tier 3 (silent). You must explicitly opt into network visibility.

## Lighthouse Threat Model

### What the Registry Knows

The portdaddy.dev registry stores: harbor name + owner, connection endpoint (IP:port),
public key, heartbeat timestamp. It does NOT store harbor cards, secrets, or data.

### Threat Scenarios

| Threat | Impact | Mitigation |
|--------|--------|------------|
| Registry DDoS | WAN discovery down, LAN + manual connect unaffected | CDN (Cloudflare Worker is already DDoS-resistant) |
| Registry compromise (attacker modifies endpoints) | Could redirect connections to attacker-controlled daemon | Harbor card exchange fails — the attacker's daemon can't issue valid cards without the harbor's signing key |
| Privacy: registry reveals user activity patterns | Knows which users are online, project names, when they work | Hash harbor names in registry (same as mDNS Tier 2). Require account authentication for registration. |
| Rogue lighthouse (self-hosted, compromised) | Same as registry compromise | Same mitigation — harbor card verification catches it |
| Registration without consent | Someone registers your harbor name | Registration requires signed challenge — daemon proves it controls the Ed25519 key |

### Data Retention

- Heartbeat entries expire after 24h without renewal (stale cleanup)
- No historical data stored — the registry is a phone book, not a log
- Users can delete their registrations: `pd lighthouse unregister myapp`
- Privacy policy published at `portdaddy.dev/privacy`

### The Key Insight

The lighthouse/registry is a **convenience layer**, not a security layer. Security
comes from harbor cards (ProVerif-verified). If the registry is compromised, wrong,
or offline, the worst case is that auto-discovery doesn't work — you fall back to
manual `pd harbor connect --peer <ip>`. No data is exposed, no tokens are compromised.

---
---

# Part XIX: Schema Migration & Rollback Strategy

## Current State

Port Daddy has ~15 SQLite tables. V4 adds ~8 new tables plus column additions to
existing tables. There is no migration system — `server.ts` uses `CREATE TABLE IF
NOT EXISTS` on startup, which only works for new installations.

## Migration Runner: Custom, ~100-150 Lines, Zero Dependencies

After evaluating better-sqlite3-migrations (doesn't exist as a package), Knex (~1.5MB
dependency), Drizzle (requires schema DSL), and Umzug (async-first, fights better-sqlite3),
the answer is the same thing every successful better-sqlite3 project does: a custom
migration table.

### Schema

```sql
CREATE TABLE IF NOT EXISTS _migrations (
  version   INTEGER PRIMARY KEY,
  name      TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Migration Files

```
migrations/
├── 001_initial_schema.sql           # V1-V3 baseline (all existing tables)
├── 002_harbor_enforcement.sql       # V4.0: signing_keys, revoked_jtis
├── 003_harbor_kv.sql                # V4.0: harbor_kv table
├── 004_pheromones.sql               # V4.0: pheromones table
├── 005_regions.sql                  # V4.0: regions, region_claims tables
├── 006_agents_identity_columns.sql  # V4.0: ALTER agents ADD identity_project etc.
├── 007_harbor_embeddings.sql        # V4.1: harbor_embeddings (lazy, optional)
├── 008_remote_sync.sql              # V4.1: sync_peers, sync_state tables
└── 009_lighthouse.sql               # V4.2: lighthouse_registrations
```

### Runner Logic

On daemon startup:

```
1. CREATE TABLE IF NOT EXISTS _migrations (...)
2. SELECT MAX(version) FROM _migrations → current_version
3. List migration files, sort by version number
4. For each migration where version > current_version:
   a. BEGIN TRANSACTION
   b. Execute the SQL file
   c. INSERT INTO _migrations (version, name)
   d. COMMIT
   e. If any step fails: ROLLBACK, log error, refuse to start
5. Log: "Migrations applied: {current} → {new}"
```

Each migration runs in its own transaction. If migration 005 fails, migrations
001-004 are already applied. The daemon logs the failure and refuses to start,
rather than running with a partially-migrated schema.

**SQLite DDL rollback caveat:** `CREATE TABLE` and `ALTER TABLE ADD COLUMN` are
transaction-safe in SQLite and will roll back correctly. However, `ALTER TABLE RENAME`
and some older DDL operations may not be fully rollback-safe in all SQLite versions.
Rule: migration files should use only `CREATE TABLE`, `ALTER TABLE ADD COLUMN`,
`CREATE INDEX`, `INSERT`, `UPDATE`, and `DELETE` — all of which are transaction-safe.
For structural changes requiring `ALTER TABLE RENAME`, use the copy-table rebuild
pattern (see below) which handles this explicitly.

### The Initial Migration Problem

Existing installations have all V1-V3 tables but no `_migrations` table. On first
V4 startup:

```
1. Check: does _migrations table exist?
2. If not: check for ALL expected V1-V3 baseline tables (services, sessions,
   session_notes, agents, locks, messages, webhooks — the full set, not just one)
3. If all baseline tables found:
   a. CREATE _migrations
   b. INSERT version=1 (mark baseline as applied)
   c. Proceed with migrations 002+
4. If some but not all baseline tables found:
   → Error: "Corrupt or partial database. Expected tables: {list}.
     Missing: {missing}. Restore from backup or delete the database."
5. If no existing tables (fresh install):
   a. CREATE _migrations
   b. Apply ALL migrations from 001
6. If database file doesn't exist: create it fresh, apply all migrations
```

This detects whether we're upgrading or fresh-installing without user intervention.

## Backup-Before-Migrate

Before applying any migration:

```
1. Copy port-registry.db → port-registry.db.pre-v{N}.bak
2. Keep the 3 most recent backups, delete older ones
3. Log: "Database backed up to port-registry.db.pre-v{N}.bak"
```

If migration fails, the database is unchanged (SQLite transactions are atomic).
If the new daemon code is buggy, the user has the backup file.

**Restore command:**

```bash
pd db restore                    # Restore from most recent backup
pd db restore --backup <path>    # Restore from specific backup
pd db backups                    # List available backups
```

## Forward-Only Migrations (No Down Migrations)

Down migrations are not worth the maintenance cost. Rationale from evaluating
Obsidian, VS Code, Logseq, Linear, and other local-first tools: **none of them
implement down migrations.** They all use forward-only migrations with backup.

Down migrations for data transforms are often lossy or impossible (you can add
a column but removing it loses data; you can split a table but re-merging may
lose relationships). In practice, down migrations are untested, rot quickly,
and give false confidence.

## Version Compatibility Guard

Each daemon version declares the schema versions it supports:

```typescript
const SUPPORTED_SCHEMA = { min: 1, max: 9, current: 9 };
```

On startup:

```
1. Read current schema version from _migrations
2. If schema_version > SUPPORTED_SCHEMA.max:
   → Error: "Database was created by a newer version of Port Daddy.
     Your version supports schema up to v{max}, but the database is at v{actual}.
     Upgrade Port Daddy or restore from backup."
3. If schema_version < SUPPORTED_SCHEMA.min:
   → Error: "Database is too old for this version. Expected at least schema v{min}."
4. If schema_version < SUPPORTED_SCHEMA.current:
   → Run migrations to bring it up to current
```

This prevents a downgraded daemon from silently corrupting a database it doesn't
understand.

## Safe Column Addition Patterns

### Adding Nullable Columns (90% of cases)

```sql
-- Migration 006: Add identity columns to agents
ALTER TABLE agents ADD COLUMN identity_project TEXT DEFAULT NULL;
ALTER TABLE agents ADD COLUMN identity_stack TEXT DEFAULT NULL;
ALTER TABLE agents ADD COLUMN identity_context TEXT DEFAULT NULL;
ALTER TABLE agents ADD COLUMN worktree_id TEXT DEFAULT NULL;

-- Backfill from existing identity strings where possible
UPDATE agents SET identity_project = (
  CASE WHEN identity IS NOT NULL AND identity LIKE '%:%'
  THEN substr(identity, 1, instr(identity, ':') - 1)
  ELSE NULL END
);
```

### Adding NOT NULL Columns with Defaults

SQLite 3.32.0+ (better-sqlite3 bundles 3.44+) supports this:

```sql
ALTER TABLE agents ADD COLUMN harbor_membership TEXT NOT NULL DEFAULT '[]';
```

Existing rows get the default value. New rows must provide a value or get the default.

### Structural Changes (Copy-Table Rebuild)

When you need to change column types, add constraints, or restructure:

```sql
PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;

CREATE TABLE agents_new (
  id TEXT PRIMARY KEY,
  -- ... new schema ...
);

INSERT INTO agents_new (id, ...) SELECT id, ... FROM agents;
DROP TABLE agents;
ALTER TABLE agents_new RENAME TO agents;

-- Recreate indexes
CREATE INDEX idx_agents_project ON agents(identity_project);

COMMIT;
PRAGMA foreign_keys = ON;
```

This runs inside `PRAGMA foreign_keys = OFF` and a single transaction.
**Important:** `PRAGMA foreign_keys` is a connection-level setting. This migration
must run on a **dedicated connection** separate from the daemon's main connection,
or during startup before any other operations use the connection. Since migrations
run during daemon startup (before the HTTP server starts), the main connection is
not yet shared and this is safe by default. Never run copy-table rebuilds on a connection that is concurrently serving requests.

**WAL mode interaction:** Migrations run before the server starts, so WAL
checkpoint contention is not an issue. However, the backup-before-migrate step
(above) copies the database file. In WAL mode, you must also copy the `-wal` and
`-shm` files to get a consistent backup, OR run `PRAGMA wal_checkpoint(TRUNCATE)`
before the copy to flush WAL to main DB. The migration runner should checkpoint
before backup.

## Testing Migrations

### Fixture-Based Testing

```
tests/
├── fixtures/
│   ├── schema-v1.sql    # Snapshot of V1 schema with realistic data
│   ├── schema-v3.sql    # Snapshot of V3 schema (current baseline)
│   └── schema-v4.sql    # Expected V4 schema for assertions
├── unit/
│   └── migrations.test.js
```

Each test:
1. Creates an in-memory SQLite DB from a fixture
2. Runs migrations
3. Asserts schema correctness using `PRAGMA table_info()`, `PRAGMA index_list()`
4. Asserts data was backfilled correctly
5. Asserts the daemon's API works against the migrated schema

### CI Strategy

- **Test 1:** Apply ALL migrations from empty → current. Catches ordering issues.
- **Test 2:** Apply migrations from V3 fixture → V4. Catches data migration bugs.
- **Test 3:** Verify that a V4 daemon refuses to start with a V5 database. Catches version guard.
- **Test 4:** Verify backup creation before migration.

---
---

# Part XX: Observability & Debugging

## The Problem

Port Daddy is becoming a distributed system (remote harbors, daemon-to-daemon sync,
pheromone propagation). The current observability story is `console.error` with emoji
prefixes. This is not adequate for debugging a multi-daemon, multi-agent system where
a request might cross machine boundaries.

## Structured Logging: pino

After evaluating pino, winston, and bunyan: **pino.** It's the fastest Node.js logger
(5-10x faster than winston), JSON-native, minimal API, and used by Fastify and
Platformatic. For a daemon that runs continuously, throughput matters.

### Configuration

```typescript
// lib/logger.ts
import pino from 'pino';

const isDev = process.env.NODE_ENV === 'development';

// pino-pretty is a devDependency — graceful fallback if missing
function tryPinoPretty() {
  try { require.resolve('pino-pretty'); return { target: 'pino-pretty' }; }
  catch { return undefined; }
}

export const logger = pino({
  level: process.env.PORT_DADDY_LOG_LEVEL || 'info',
  transport: isDev ? tryPinoPretty() : undefined,
  base: { pid: process.pid, daemon: 'port-daddy' },
  serializers: {
    err: pino.stdSerializers.err,
  },
});
```

**Output in daemon mode (JSON to file):**
```json
{"level":30,"time":1710000000000,"pid":1234,"daemon":"port-daddy","msg":"port claimed","service":"myapp:api:main","port":3000,"agentId":"agent-a4f2","requestId":"abc-123"}
```

**Output in dev mode (pretty-printed):**
```
[14:32:05] INFO: port claimed service=myapp:api:main port=3000 agentId=agent-a4f2
```

### Log Levels

| Level | Name | When to use |
|-------|------|-------------|
| 60 | fatal | Process is about to exit. DB corruption, port bind failure. |
| 50 | error | Request failed but daemon continues. Webhook delivery failed, lock timeout. |
| 40 | warn | Degraded but functional. Late heartbeat, approaching rate limit, permissions too open on key file. |
| 30 | info | Normal operations worth recording. Port claimed, session started, agent registered. **Default.** |
| 20 | debug | Internal details. SQL queries, lock timing, SSE lifecycle, harbor card verification. |
| 10 | trace | Extremely verbose. Raw HTTP bodies, full request/response dumps, msgpack frames. |

### Subsystem-Based Debug Tracing (The Syncthing Pattern)

Syncthing uses `STTRACE=model,protocol,db` to enable debug logging for specific
subsystems without drowning in noise from others. Port Daddy should do the same:

```bash
PORT_DADDY_DEBUG=sync,agents,locks pd start
# → Only sync, agent, and lock operations log at debug level
# → Everything else stays at info
```

**Subsystems (facilities):**

| Facility | What it traces |
|----------|---------------|
| `sync` | Daemon-to-daemon harbor sync, state reconciliation, conflict resolution |
| `agents` | Agent registration, heartbeat, death detection, salvage |
| `locks` | Lock acquisition, release, contention, TTL expiry |
| `sessions` | Session lifecycle, notes, file claims, phase transitions |
| `messaging` | Pub/sub publish, subscribe, channel lifecycle |
| `harbors` | Harbor creation, membership changes, capability checks |
| `sqlite` | SQL queries (parameterized, never with inline values), transaction timing |
| `http` | Request/response logging, middleware timing |
| `keys` | Key loading, rotation, verification (never log key material) |
| `pheromones` | Deposition, evaporation, intensity changes |
| `trie` | Token trie insertions, lookups, capability checks |

Implementation: each subsystem creates a child logger (`logger.child({ facility: 'sync' })`).
The facility filter checks `PORT_DADDY_DEBUG` before emitting.

## Distributed Tracing: Request ID Propagation (Not OpenTelemetry)

OpenTelemetry adds ~15-25MB to `node_modules` and assumes a collector (Jaeger, Zipkin)
is running. That is unreasonable for a developer tool daemon.

Instead, use the pattern that Syncthing and Tailscale use: **request ID propagation.**
This gives 90% of tracing's value at 1% of the cost.

### How It Works

1. Generate a request ID at the entry point: `crypto.randomUUID()` (or nanoid for shorter IDs)
2. Attach to every log line via pino's child logger or `req.id`
3. Pass in daemon-to-daemon requests via `X-Request-Id` header
4. Remote daemon logs the same ID

```typescript
// Middleware
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] as string || crypto.randomUUID();
  req.log = logger.child({ requestId: req.id });
  next();
});
```

### Causality Chains

For operations that trigger other operations (request → webhook → spawn):

```json
{"requestId":"abc-123","spanId":"span-1","parentId":null,"op":"claim-port"}
{"requestId":"abc-123","spanId":"span-2","parentId":"span-1","op":"fire-webhook"}
{"requestId":"abc-123","spanId":"span-3","parentId":"span-2","op":"spawn-agent"}
```

This gives a tree of operations reconstructable from JSON logs with `jq`.

## Metrics: In-Memory, Self-Served

No Prometheus. No StatsD. The daemon serves its own metrics via the existing
`GET /metrics` endpoint, extended for V4:

### Core Metrics

**Process health (always collected):**
- `process.memory.rss` — RSS in bytes (detect leaks)
- `process.memory.heapUsed` / `heapTotal` — V8 heap
- `process.eventLoopLag.p50/p95/p99` — via `perf_hooks.monitorEventLoopDelay()`
- `process.openFileDescriptors` — important for SQLite + SSE
- `process.uptime` — seconds

**Business metrics (counters and gauges):**
- `agents.active` (gauge) — currently registered agents
- `harbors.active` (gauge) — active harbors
- `ports.claimed` (gauge) — claimed ports
- `sessions.active` (gauge) — active sessions
- `locks.active` (gauge) — held locks
- `locks.contentionRate` (counter) — failed lock attempts per minute
- `requests.total` (counter by method + path)
- `requests.errors` (counter by status code)
- `sync.peersConnected` (gauge) — remote harbor peers
- `sync.operationsTotal` (counter) — sync operations performed
- `sync.conflictsTotal` (counter) — conflicts detected
- `pheromones.active` (gauge) — non-evaporated traces
- `salvage.queueDepth` (gauge) — pending salvage entries

**Implementation:** In-memory `Map<string, number>` with helper functions.
No dependency needed. Counters reset on configurable interval (1 minute).

## Runtime Debug Controls

### API Endpoints

```
POST /log-level         {"level": "debug"}      — Change log level at runtime
POST /debug/facility    {"enable": ["sync"]}    — Enable debug tracing for facilities
GET  /debug/state       — Dump current daemon state (agents, harbors, sessions, locks)
GET  /debug/metrics     — Extended metrics with histograms
GET  /logs              — Recent log entries as JSON (ring buffer, last 1000 lines)
GET  /logs?traceId=abc  — Filter logs by trace ID
```

### Signal Handling

```
SIGUSR1  → Toggle between info and debug log level (Docker pattern)
SIGUSR2  → Dump full state to log file (diagnostic snapshot)
```

### CLI Surface

```bash
pd debug level debug         # Set log level
pd debug level info          # Reset
pd debug trace sync,agents   # Enable subsystem tracing
pd debug state               # Dump current state
pd debug bugreport           # Collect everything into a diagnostic file
```

## The Bugreport Command (Tailscale Pattern)

`pd bugreport` or `pd debug bugreport` collects everything needed for debugging
into a single file:

```
pd-bugreport-2026-03-15T14-32-05.txt
├── Version: 4.0.0 (code hash: abc123)
├── Platform: darwin arm64
├── Node: v22.5.0
├── Uptime: 3h 42m
├── Schema version: 9
├── Process: pid=1234, rss=45MB, heapUsed=22MB, eventLoopLag=0.4ms
├── Active agents: 3
├── Active harbors: 2
├── Active sessions: 3
├── Active locks: 1
├── Sync peers: 1 (connected)
├── Recent errors (last 20):
│   [14:30:05] ERROR: webhook delivery failed ...
├── Recent activity (last 50):
│   [14:28:00] agent-a4f2 claimed src/auth/*
│   [14:29:00] agent-b7e1 published myapp:ready
├── Configuration:
│   port=9876, enforce-harbors=warn, ...
├── Key status:
│   hmac-active: k-1710460800 (2h old, permissions OK)
│   ed25519: not configured
└── Database:
    size=2.3MB, wal_size=45KB, tables=23, migrations=v9
```

This file contains NO secrets. Enforced by a **redaction allowlist** — only known-safe
config keys are emitted (port, enforce-harbors, log-level, database-path). Keys that
could contain credentials are explicitly excluded: `dashboard.token`, webhook URLs,
environment variable overrides. The bugreport command logs which keys were redacted
so users know what was omitted. No key material, no harbor card JWTs, no token values.
Safe to share in GitHub issues or support requests.

## Cross-Daemon Log Correlation

When debugging a sync issue between two daemons, the unified view is critical.

### Pattern: Query + Merge (Not Centralized Logging)

Each daemon exposes `GET /logs?since=<timestamp>&traceId=<id>` **on the local
interface only** (registered on `localApp`, never on `remoteApp`). The `/logs`,
`/debug/*`, and `/log-level` endpoints are explicitly excluded from the remote-facing
Express app. This prevents remote peers from reading operational logs.

The CLI fetches from both daemons and interleaves by timestamp:

```bash
pd debug sync-log --harbor myapp
# → Fetching logs from localhost:9876... (42 entries)
# → Fetching logs from desktop.local:9877... (38 entries)
# → Merged timeline:
#   [14:32:05.001] MacBook   → sync push initiated (traceId: abc-123)
#   [14:32:05.003] Desktop   ← sync push received (traceId: abc-123)
#   [14:32:05.005] Desktop   → conflict detected: auth.strategy (v2 vs v2)
#   [14:32:05.006] Desktop   → resolved: LWW, Desktop wins (later timestamp)
#   [14:32:05.008] MacBook   ← sync ack received
```

No centralized logging infrastructure. Each daemon is authoritative for its own
logs. The CLI is the aggregation layer.

### Log Retention

- In-memory ring buffer: last 1000 entries (queryable via API)
- File: JSON lines, rotated at 10MB, keep 3 files (pino file transport)
- Total disk: ~30MB maximum for logs

---
---

# Part XXI: UX Complexity Management & Error Design

## The Complexity Cliff

V3 has 48 CLI commands and 93 MCP tools. V4 adds harbors, remote, regions,
pheromones, KV, whiteboard, teach, init, lighthouse, keys, debug. The product is
becoming harder to learn, not easier.

The lesson from git, kubectl, and docker: **tools that grow commands without growing
clarity lose users.** kubectl has 60+ commands and people still google "kubectl cheat
sheet" daily. git has excellent documentation and people still fear it.

## Progressive Complexity Strategy

### Layer 0: Zero Commands (It Just Works)

`pd begin "building auth" --identity myapp:api:auth` should do everything:
- Register agent, start session, create harbor, enter harbor, issue card, check
  salvage queue, report pheromone context — all automatic, all invisible.

The user types ONE command and gets a working, secure, coordinated session.
Everything else is opt-in.

### Layer 1: The Essential Six (Day 1)

```bash
pd status                      # Is the daemon running?
pd begin "task description"    # Start everything
pd note "progress update"      # Leave breadcrumbs
pd claim myapp:api             # Get a port
pd whoami                      # Where am I?
pd done                        # End everything
```

A new user's first action is `pd status` (CLAUDE.md already says "Before any session,
verify: pd status"). The remaining five commands cover the full session lifecycle.
The MCP equivalent: `check_status`, `begin_session`, `add_note`, `claim_port`,
`whoami`, `end_session_full`.

### Layer 2: Coordination (Week 2+)

```bash
pd files claim src/auth/*      # Advisory file claims
pd lock auth-module            # Exclusive access
pd msg myapp:radio "ready"     # Pub/sub
pd salvage                     # Check for dead agents
pd harbors                     # See your harbor
```

### Layer 3: Power User (Month 2+)

```bash
pd harbor kv set ...           # Shared state
pd region claim auth           # Semantic boundaries
pd spawn --backend claude ...  # Child agents
pd harbor connect ...          # Remote harbors
pd debug bugreport             # Diagnostics
```

### Implementation: CLI Help Tiers

```bash
pd help                        # Shows ONLY Layer 1 commands
pd help --all                  # Shows everything
pd help harbors                # Shows harbor-specific commands
pd help --examples             # Shows common workflows
```

The default `pd help` output is SHORT — five commands with one-line descriptions.
Not a wall of text. Not 48 commands. Five.

```
Port Daddy — Coordination for Agent Teams

  pd begin <purpose>     Start a coordinated session
  pd note <message>      Add a progress note
  pd claim <identity>    Claim a port
  pd whoami              Show your context
  pd done [note]         End your session

  pd help --all          See all 60+ commands
  pd help harbors        Harbor commands
  pd help remote         Remote coordination
```

## First-Run Experience

When `pd begin` is run for the first time in V4 (detected via the `_migrations` table —
if the latest applied migration is a V4 migration and no V4 sessions exist, this is
either a fresh install or a V3→V4 upgrade). For upgrades, the welcome message includes
a "What's new in V4" summary instead of the full onboarding flow:

```
$ pd begin "setting up my project"

  ⚓ Welcome to Port Daddy v4.0

  Creating your first harbor...
  → Harbor 'my-project' created (auto-detected from directory name)
  → Harbor card issued (capabilities: *)
  → Session started: "setting up my project"

  You're ready. Your agent ID is agent-7f3k.

  Useful commands:
    pd note "progress"    Leave a breadcrumb
    pd claim myapp:api    Get a port (e.g., 3100)
    pd whoami             See your context
    pd done               Wrap up

  Learn more: https://portdaddy.dev/tutorials/getting-started
```

No wall of features. No configuration wizard. Just start working, here are four
commands you might need.

## Error Message Design: The Elm Pattern

Good error messages have three parts:
1. **What happened** (not a stack trace, not an error code — plain English)
2. **Why it happened** (context)
3. **What to do next** (actionable fix)

### Bad (Current)

```
Error: harbor card required
```

### Good (V4)

```
Error: Harbor card required for POST /sessions/abc/notes

  Your request was rejected because no harbor card was provided.
  This endpoint requires a valid harbor card since V4.0.

  To fix this:
    1. Start a session with: pd begin "your task" --identity myapp:api
       This automatically creates a harbor and issues a card.
    2. If you're using the SDK, the harbor card is managed automatically.
    3. If you're calling the API directly, include the card as:
       X-Harbor-Card: <your-token>

  If this worked before V4, you may be in grace period mode.
  Check: pd config get enforce-harbors
```

### Error Catalog

Every error gets a code and a URL:

```
PD-E001  Harbor card required
PD-E002  Harbor card expired
PD-E003  Insufficient capabilities (requires X, you have Y)
PD-E004  Harbor not found
PD-E005  Agent not registered
PD-E006  Session not found
PD-E007  Lock contention (held by agent X, expires in Y)
PD-E008  File claim conflict (claimed by agent X)
PD-E009  Remote peer unreachable
PD-E010  Schema version mismatch
PD-E011  Key file permissions too open
PD-E012  Sync conflict detected (key X has conflicting values)
...
```

Each code links to `portdaddy.dev/errors/PD-E001` with detailed explanation,
common causes, and resolution steps. This is what Rust, Elm, and Deno do.

### CLI Error Formatting

```bash
pd claim myapp:api --port 3000

  Error PD-E008: Port 3000 already claimed by agent-b7e1
  Fix: pd claim myapp:api (auto-assigns), or --force to take
  Docs: https://portdaddy.dev/errors/PD-E008
```

**Default is compact (3 lines).** For the full Elm-style explanation with context
and options, use `--verbose` or set `PORT_DADDY_VERBOSE_ERRORS=1`:

```bash
pd claim myapp:api --port 3000 --verbose

  Error PD-E008: Port 3000 is already claimed

  Claimed by: agent-b7e1 (myapp:web:ui)
  Session: "building frontend" (started 12m ago)
  Harbor: myapp

  Options:
    1. Use a different port: pd claim myapp:api (auto-assigns)
    2. Wait for release: pd watch myapp:web:ui -- "pd claim myapp:api --port 3000"
    3. Force claim: pd claim myapp:api --port 3000 --force (takes from agent-b7e1)

  Docs: https://portdaddy.dev/errors/PD-E008
```

The compact default is critical for MCP tool responses (LLM agents waste context
window tokens on verbose output) and for experienced CLI users. The verbose mode
is for debugging and onboarding.

## Accessibility in the Dashboard

### WCAG AA Requirements

The dashboard glassmorphism theme (dark backgrounds, blur effects, translucent
panels) is a WCAG risk. Specific requirements:

- **Color contrast:** All text must have 4.5:1 contrast ratio against its background.
  Semi-transparent panels over dark backgrounds often fail this. Test every panel with
  browser DevTools contrast checker.
- **Keyboard navigation:** Every interactive element (buttons, links, tabs, panels)
  must be reachable via Tab key. Focus indicators must be visible.
- **Screen reader:** Panel headers use semantic HTML (`<h2>`, `<h3>`). Data tables
  use `<table>` with `<th>`. Status indicators use `aria-label` (not just color).
- **Reduced motion:** Respect `prefers-reduced-motion`. Disable CSS transitions and
  animations when this media query matches. The timeline auto-scroll becomes manual.
- **Focus management:** When switching panels via nav rail, focus moves to the panel
  content. Modal dialogs trap focus.

### Implementation

```css
/* Respect reduced motion */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    transition-duration: 0.001ms !important;
  }
}

/* Visible focus indicators */
:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

/* Ensure contrast on glassmorphism panels */
.panel {
  background: rgba(0, 0, 0, 0.85);  /* Darker than typical glassmorphism */
  /* Test: white text (#fff) on rgba(0,0,0,0.85) = 15.4:1 contrast ✓ */
}
```

---
---

# Part XXII: Market Positioning & Validation

## Competitive Landscape: What Port Daddy Actually Competes With

The comparison page (Part IV) covers docker-compose and detect-port. Those are the
wrong competitors. The real competitive landscape:

### Tier 1: Direct Competitors (Agent Coordination)

**LangGraph / LangChain:**
- Multi-agent orchestration framework. Defines agent graphs, handles routing.
- **Port Daddy is NOT this.** LangGraph is an agent framework. Port Daddy is agent
  infrastructure. LangGraph tells agents *what to do*. Port Daddy gives agents *a
  place to coordinate*. They're complementary, not competing.
- **Positioning:** "Use LangGraph to build your agents. Use Port Daddy to coordinate
  them."

**CrewAI:**
- Role-based multi-agent framework. Agents have roles, goals, backstories.
- Same distinction: framework vs. infrastructure. CrewAI handles agent behavior.
  Port Daddy handles agent coordination (ports, files, locks, sessions, comms).
- **Positioning:** "CrewAI agents need ports, file claims, and pub/sub too."

**AutoGen (Microsoft):**
- Multi-agent conversation framework. Agents talk to each other in chat.
- Agent-to-agent messaging is AutoGen's core. Port Daddy has pub/sub but it's
  a coordination primitive, not a conversation framework.
- **Positioning:** "AutoGen agents can use Port Daddy for resource management
  and session tracking."

**Key insight:** There is no exact competitor for "daemon-level agent coordination
infrastructure," but the adjacent space is not empty:
- **e2b, composio, toolhouse:** Agent infrastructure platforms — but cloud-hosted,
  not local-first. Different trust model and deployment topology.
- **process-compose, overmind, foreman:** Process managers that handle service
  orchestration — but without agent identity, harbor isolation, sessions, or
  coordination primitives.
- **mise, devenv, direnv:** Dev environment managers — but focused on versions
  and environment variables, not runtime coordination.

Port Daddy's moat is the combination: local-first daemon + agent lifecycle +
coordination primitives + security model. No single tool covers all four.

### Tier 2: Adjacent Tools (Dev Environment)

**Turborepo / Nx:**
- Monorepo build orchestration. Task scheduling, caching, dependency graphs.
- They manage *build tasks*. Port Daddy manages *running services and agents*.
- **Positioning:** "Turborepo builds your code. Port Daddy runs it."

**DevContainers / Codespaces:**
- Isolated development environments. Docker-based. Cloud or local.
- They provide *environment isolation*. Port Daddy provides *coordination within
  an environment*.
- **Positioning:** "Port Daddy runs inside your DevContainer. Or outside it."

**Daytona / Gitpod:**
- Cloud dev environments. Provisioning, lifecycle, multi-service.
- Similar to DevContainers but cloud-native. Port Daddy is local-first.
- **Positioning:** "Port Daddy is what you use when you don't want a cloud IDE."

### Tier 3: Workflow Orchestration

**Temporal / Inngest:**
- Durable workflow execution. Retry, scheduling, state machines.
- They orchestrate *business logic workflows*. Port Daddy orchestrates *development
  workflows*.
- **Positioning:** Different domain entirely. Temporal is for production workloads.
  Port Daddy is for development coordination.

### The Positioning Statement

```
For AI-powered development teams
who need agents to coordinate without conflicts,
Port Daddy is the daemon-level coordination runtime
that provides atomic resource management, cryptographic security boundaries,
and cross-machine synchronization.

Unlike agent frameworks (LangGraph, CrewAI, AutoGen),
Port Daddy is infrastructure, not application logic.
Unlike container tools (Docker, DevContainers),
Port Daddy coordinates agents, not environments.
```

## User Research Plan

### What We Need to Know (Before Building V4.1+)

1. **How many people actually run agents on multiple machines today?**
   - Survey existing users (if any) and the Claude Code / Cursor / Windsurf communities
   - Hypothesis: <5% today, but growing fast as agent capabilities improve

2. **Do developers care about harbor-level security?**
   - Hypothesis: They don't care until an agent does something destructive
   - Validation: Ask "has an AI agent ever modified a file you didn't want it to?"

3. **How often do agents actually crash mid-task?**
   - Instrument: add anonymous telemetry for session completion rate
   - Hypothesis: 10-20% of sessions end in abandonment (agent crash, context window, user cancellation)

4. **What's the actual pain point today?**
   - Hypothesis: port conflicts and "which agent is working on what" confusion
   - Validation: interviews, GitHub issues, community posts

### Research Methods

**Lightweight (do now):**
- GitHub Discussions / Discord: "What's your biggest pain point with multi-agent dev?"
- Twitter/X poll: "How many AI agents do you run simultaneously?"
- Instrument `pd begin` with anonymous, opt-in usage counter (count only, no PII)

**Medium effort (V4.0 launch):**
- Post-install survey (3 questions, shown once): biggest pain point, # agents,
  primary editor (Claude Code / Cursor / Windsurf / other)
- Crash reporting (opt-in): anonymous session completion rates

**Full effort (V4.1+):**
- User interviews (5-10 users): 30-minute calls, recorded, transcribed
- Usage telemetry dashboard (aggregate, anonymous): feature adoption rates

## Analytics & Telemetry Plan

### What to Measure (Anonymous, Opt-In)

```bash
pd config set telemetry true    # Opt-in (default: false)
```

**Counters only (no PII, no content, no identifiers):**
- `install_count` — how many people install
- `begin_count` — sessions started per day
- `done_count` — sessions completed per day
- `crash_count` — sessions abandoned (agent died)
- `spawn_count` — child agents launched
- `harbor_connect_count` — remote harbors connected
- `mcp_tool_calls` — which MCP tools are used (tool name only, no args)
- `cli_commands` — which CLI commands are used (command only, no args)
- `error_codes` — which errors occur (PD-E001, PD-E007, etc.)
- `platform` — darwin / linux / win32
- `version` — Port Daddy version

**Never collected:**
- Harbor names, project names, agent IDs, identity strings
- Note content, KV values, file paths
- IP addresses, usernames, hostnames
- Any harbor card or JWT content

**Implementation:** Ping `telemetry.portdaddy.dev/v1/events` with a batch of
counters every 24 hours. Cloudflare Worker + Analytics Engine. No database.
Total cost: $0 (free tier).

### portdaddy.dev Analytics

- Plausible Analytics (privacy-friendly, no cookies, GDPR compliant)
- Track: page views, tutorial completion rates, template fork clicks
- A/B test: hero copy variants, pricing page layout

## Pricing Validation

### Concerns with Current Pricing

The plan (Part V) assumes 4% Pro conversion. Developer tool benchmarks:

**Cloud services** (higher perceived ongoing value):
| Tool | Free users | Paid conversion | Price |
|------|-----------|----------------|-------|
| Tailscale | ~2M | ~2-3% (estimated) | $6/user/mo |
| Vercel | ~1M | ~1-2% | $20/user/mo |
| Railway | ~500K | ~3% | $5/user/mo |
| Supabase | ~1M | ~2% | $25/org/mo |

**Local CLI tools** (harder to convert — users don't perceive ongoing value from a local binary):
| Tool | Model | Price |
|------|-------|-------|
| ngrok | Freemium | $10/mo |
| Warp | Free/Team | Free/$15/user/mo |
| Raycast | Free/Pro | Free/$8/mo |
| Fig/Amazon Q | Free (acquired) | — |

4% is optimistic for a CLI tool with no established brand. Local CLI tools have even
lower conversion than cloud services because users don't perceive ongoing hosting value.
**Revise to 2% for projections, celebrate if you beat it.**

### Pricing Adjustment

The "up to 3 peers" limit in Pro is punitive. A developer with a laptop, desktop,
and CI runner is already at 3. Hitting a paywall on peer #4 creates resentment.

**Revised Pro ($14/seat/month):**
- Up to 5 remote peers (laptop, desktop, CI, staging, one to spare)
- Lighthouse registration
- Priority support
- $14 is "I'll put it on my credit card" territory globally

**Revised Team ($39/team/month, up to 10 seats):**
- Unlimited peers
- Self-hosted lighthouse
- Team dashboard
- Harbor audit logs

**The real question:** Is Pro even necessary? The "free + team" model (Tailscale
pattern) might work better:
- Free: everything local, mDNS discovery, up to 3 remote peers
- Team ($39/team): unlimited peers, lighthouse, audit, dashboard
- Enterprise: custom

This eliminates the awkward individual tier and focuses revenue on teams
(where the money actually is).

---
---

# Part XXIII: Storage Lifecycle & CI/CD Integration

## Storage Growth Problem

Port Daddy is a long-running daemon backed by SQLite. Over months of heavy use:

- **Session notes** are immutable and never deleted by design
- **Activity log** entries accumulate continuously
- **Pheromone traces** evaporate but create/delete churn
- **KV entries** persist until explicitly deleted
- **Embedding BLOBs** are large (384-1536 floats per entry)

Without lifecycle management, the SQLite file grows unbounded.

## Growth Projections

| Component | Growth rate | 6 months | 1 year |
|-----------|-----------|----------|--------|
| Session notes | ~50/day (5 agents × 10 notes) | ~9K rows, ~2MB | ~18K rows, ~4MB |
| Activity log | ~200/day | ~36K rows, ~5MB | ~72K rows, ~10MB |
| Pheromones | ~100/day created, ~80/day evaporated | ~3.6K rows, ~0.5MB | Net ~7.2K rows, ~1MB |
| KV entries | ~20/day created, ~5/day deleted | ~2.7K rows, ~0.5MB | ~5.4K rows, ~1MB |
| Embeddings | ~10/day (if enabled) | ~1.8K BLOBs, ~10MB | ~3.6K BLOBs, ~20MB |
| **Total** | | **~18MB** | **~36MB** |

For a developer tool, 36MB/year is acceptable. The concern is not total size
but query performance on large tables and the WAL file during heavy writes.

## Lifecycle Policies

### Archival: Old Sessions

Sessions completed more than 90 days ago are archived:

```bash
pd db archive --older-than 90d
# → Archived 142 sessions (847 notes) to port-registry-archive-2026-Q1.db
# → Active database reduced by 3.2MB
```

Archive is a separate SQLite file. Old sessions can still be queried:

```bash
pd sessions --archive         # List archived sessions
pd notes --session <id> --archive  # Read notes from archive
```

**Implementation:** Use `ATTACH DATABASE 'archive.db' AS archive_db` on the same
connection, then run both operations in a single transaction:
```sql
BEGIN;
INSERT INTO archive_db.sessions SELECT ... WHERE completedAt < :threshold;
DELETE FROM main.sessions WHERE completedAt < :threshold;
COMMIT;
```
This is atomic because both databases share the same connection and transaction.
If the process crashes between INSERT and DELETE, the transaction is rolled back
and no data is duplicated. The archive query includes an idempotency check
(`INSERT OR IGNORE` keyed on session ID) so re-running after a partial failure
is safe.

### Pruning: Activity Log

Activity log entries older than 30 days are pruned by default:

```bash
pd db prune --older-than 30d
# → Pruned 5,832 activity log entries
```

Configurable: `pd config set retention.activity 90d`

### Eviction: Pheromones

Pheromone evaporation already handles this — traces below 0.01 intensity are
deleted. No additional lifecycle management needed. The evaporation engine
IS the garbage collector.

### Compaction: VACUUM

SQLite doesn't reclaim disk space when rows are deleted. The file stays the same
size (the space is reused internally). To actually shrink the file:

```bash
pd db vacuum
# → Database compacted: 45MB → 32MB (saved 13MB)
```

**Auto-vacuum:** Enable `PRAGMA auto_vacuum = INCREMENTAL` on database creation.
Run `PRAGMA incremental_vacuum(100)` after archival/pruning operations to reclaim
space without the full-table lock of `VACUUM`.

### WAL Management

The WAL (Write-Ahead Log) file can grow large during heavy write periods. Run
`PRAGMA wal_checkpoint(TRUNCATE)` periodically (every 5 minutes) to keep the
WAL file bounded.

### CLI Surface

```bash
pd db status              # Show database size, table counts, WAL size
pd db archive             # Archive old sessions
pd db prune               # Prune old activity entries
pd db vacuum              # Compact database
pd db backup              # Create manual backup
pd db restore             # Restore from backup
pd db backups             # List available backups
```

### Automatic Lifecycle (Default)

On daemon startup, if it hasn't run in >24 hours:
1. Prune activity log entries older than `retention.activity` (default: 30d)
2. Archive sessions older than `retention.sessions` (default: 90d)
3. Clean up revoked JTIs past their expiry
4. Run `PRAGMA incremental_vacuum(100)`
5. Log summary: "Housekeeping: pruned 42 entries, archived 3 sessions, reclaimed 1.2MB"

## CI/CD Integration

### The Problem

Agents running in CI (GitHub Actions, GitLab CI) are a major use case. But:
- CI runners are ephemeral — daemon state is lost between runs
- CI runners may not have network access to a lighthouse
- Harbor cards need to be provisioned for CI agents
- The daemon must start, do work, and stop within minutes

### GitHub Action: `curiositech/port-daddy-action`

```yaml
# .github/workflows/review.yml
name: AI Code Review
on: [pull_request]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: curiositech/port-daddy-action@v1
        with:
          version: '4.0'       # Port Daddy version
          identity: '${{ github.repository }}:ci:pr-${{ github.event.number }}'

      - name: Run review agents
        run: |
          pd begin "reviewing PR #${{ github.event.number }}"
          pd spawn --backend claude --wait -- "Review the changes in this PR"
          pd done --note "CI review complete"

      - name: Post results
        run: |
          pd notes --json | jq '.notes[].content' > review.md
          gh pr comment ${{ github.event.number }} --body-file review.md
```

### What the Action Does

1. Installs Port Daddy (cached via actions/cache)
2. Starts the daemon in ephemeral mode (`pd start --ephemeral`)
3. Creates a harbor scoped to the CI run
4. Sets `PORT_DADDY_AGENT_ID` in the environment
5. On job completion, stops the daemon and discards the database

### Ephemeral Mode

```bash
pd start --ephemeral
# → Database: in-memory (no disk persistence)
# → No service installation (no launchd/systemd)
# → Auto-shutdown after 30 minutes of inactivity
# → No telemetry, no lighthouse registration
```

This is the CI-optimized mode. Fast startup, no cleanup needed, no state leakage
between CI runs.

**Important:** In ephemeral mode, notes and session data exist only while the daemon
is running. The `pd notes --json` step in the CI workflow must run BEFORE `pd stop`.
The `pd done` command does NOT stop the daemon — it only ends the session. The daemon
stays alive until explicitly stopped or the 30-minute inactivity timeout. The `--wait`
flag on `pd spawn` blocks until the spawned agent completes, ensuring notes are
written before `pd done` runs.

### Remote Harbor from CI

CI agents can connect to a developer's harbor for coordination:

```yaml
- uses: curiositech/port-daddy-action@v1
  with:
    harbor-connect: '${{ secrets.HARBOR_PEER }}'
    harbor-token: '${{ secrets.HARBOR_TOKEN }}'
```

The CI agent joins the developer's harbor, sees their file claims, and can
coordinate via pub/sub. Useful for "CI agent reviews the code that the dev
agent is working on."

### GitLab CI / Generic CI

For CI systems without a dedicated action:

```bash
# In any CI script
npm install -g port-daddy
pd start --ephemeral
pd begin "CI task" --identity myrepo:ci:build-$CI_JOB_ID
# ... do work ...
pd done
pd stop
```

## Contributor Guide

### CONTRIBUTING.md Structure

```markdown
# Contributing to Port Daddy

## Quick Start (5 minutes)
1. Fork + clone
2. npm install
3. npm run dev (starts daemon in dev mode)
4. npm test (runs all tests)

## Architecture Overview
Port Daddy is a daemon + CLI + SDK + MCP server.
See CLAUDE.md for full architecture.

## Adding a New Feature (The Parity Checklist)
Every feature must exist in ALL surfaces. Before your PR:
1. [ ] API route in routes/
2. [ ] CLI command in cli/commands/
3. [ ] SDK method in lib/client.ts
4. [ ] MCP tool in mcp/server.ts
5. [ ] Shell completions in completions/*.{bash,zsh,fish}
6. [ ] Unit tests in tests/unit/
7. [ ] Integration tests in tests/integration/ (if applicable)
8. [ ] CLAUDE.md updated
9. [ ] CHANGELOG.md updated

## Module Stability
| Module | Stability | Notes |
|--------|-----------|-------|
| lib/services.ts | Stable | Core port assignment, rarely changes |
| lib/sessions.ts | Stable | Session lifecycle |
| lib/harbors.ts | Evolving | V4 enforcement changes expected |
| lib/harbor-sync.ts | Experimental | Remote sync protocol |
| lib/pheromone.ts | Experimental | Stigmergic system |

## Code Style
- TypeScript strict mode
- No default exports
- Dependency injection (factory functions, not classes)
- SQLite: parameterized queries, no string interpolation

## Testing
- Unit tests: no daemon required, in-memory SQLite
- Integration tests: ephemeral daemon auto-started by Jest
- See tests/setup-unit.js for test DB factory

## PR Process
1. Branch from main
2. Write tests first (or concurrently)
3. Run full test suite: npm test
4. Run type check: npm run typecheck
5. Open PR with description of what + why
6. CI must pass
```

---
---

# Part XXIV: Testing Emergent Behavior & Dashboard Architecture

## Testing Pheromones and Stigmergy

### The Problem

Pheromone-based coordination is emergent — the whole point is that behavior arises
from environmental traces, not explicit protocols. Traditional unit tests verify
inputs and outputs. How do you test "agents naturally avoid hot files"?

### Property-Based Testing

Instead of testing specific scenarios, test **invariants** that must always hold:

```
Property 1: Monotonic evaporation
  For all pheromone types, after one evaporation cycle:
    new_intensity <= old_intensity
  Exception: coupling (near-permanent, only evaporates 0.1%/hr)

Property 2: Bounded intensity
  For all pheromone entries: 0.0 <= intensity <= MAX_DEPOSIT_INTENSITY
  MAX_DEPOSIT_INTENSITY = 10.0 (enforced by daemon, see Part XXV §XV amendment)
  Total intensity per target is bounded by rate limit (100 deposits/min × 10.0 max)

Property 3: Eviction threshold
  After sufficient evaporation cycles with no new deposits, every pheromone entry
  is evicted (intensity drops below 0.01).
  For fast-decay types (heat at 10%/hr): intensity 10.0 → <0.01 in ~70 hours
  For slow-decay types (coupling at 0.1%/hr): intensity 10.0 → <0.01 in ~6900 hours
  Test coupling with accelerated time (set evaporation interval to 1ms in test config)

Property 4: Deposition monotonicity
  After a deposit, the target's intensity is >= its pre-deposit intensity

Property 5: Harbor scoping
  Pheromones in harbor A are never visible in harbor B's queries

Property 6: Causal ordering
  If agent A claims a file BEFORE agent B, the heat trace from A
  has a lower HLC than the trace from B
```

Use `fast-check` (property-based testing library for JS/TS) to generate
random sequences of deposits and evaporations and verify these properties.

### Simulation Harness

For testing emergent behavior (not just correctness), build a simulation:

```typescript
// tests/simulation/pheromone-sim.ts

interface SimAgent {
  id: string;
  behavior: 'random' | 'heat-avoiding' | 'heat-seeking' | 'danger-aware';
}

interface SimConfig {
  agents: number;
  files: number;
  steps: number;
  behaviors: Record<string, number>; // behavior -> count
}

function runSimulation(config: SimConfig): SimResult {
  // 1. Create N agents with specified behaviors
  // 2. For each step:
  //    a. Each agent chooses a file to claim
  //    b. Heat-avoiding agents prefer low-heat files
  //    c. Heat-seeking agents prefer high-heat files
  //    d. Danger-aware agents avoid files with danger traces
  //    e. Random agents choose randomly
  //    f. Record conflicts (two agents claiming same file)
  //    g. Run evaporation
  // 3. Return: conflict count, file distribution, convergence time
}
```

**What to measure:**
- Conflict rate: heat-avoiding agents should have fewer conflicts than random agents
- File distribution: heat-avoiding agents should spread across files more evenly
- Danger response: danger-aware agents should avoid recently-dead agents' files
- Convergence: how many steps until the system reaches steady state

### Integration Tests

```javascript
// tests/integration/pheromones.test.js

test('danger trace prevents file claim conflict', async () => {
  // 1. Agent A claims file X
  // 2. Agent A dies (heartbeat flatlines)
  // 3. Danger trace deposited on file X
  // 4. Agent B begins, sees danger trace on file X
  // 5. Verify: danger trace is present in Agent B's context
  // 6. Verify: Agent B's claim response includes pheromone data
});

test('heat evaporates over time', async () => {
  // 1. Agent A claims file X (deposits heat)
  // 2. Wait for 3 evaporation cycles
  // 3. Query heat for file X
  // 4. Verify: heat < original (0.95^3 ≈ 0.857)
});

test('coupling accumulates across sessions', async () => {
  // 1. Session 1: modify files A and B
  // 2. Session 2: modify files A and B again
  // 3. Query coupling between A and B
  // 4. Verify: coupling intensity ≈ 2.0 (two deposits)
});
```

## Dashboard Architecture: Revisiting ADR-0005

### The Tension

ADR-0005 mandates single-file HTML, no build step. At 115 lines, this was fine.
At 4000+ lines with SSE connections, hash routing, 12 interactive panels, and
real-time data — it becomes unmaintainable.

### Options

**Option A: Keep single-file, use Web Components (Recommended)**

Web Components are native browser APIs. No build step. No framework. Components
encapsulate their own HTML, CSS, and JS. The main file imports them:

```html
<!-- public/index.html — stays as the entry point -->
<script type="module">
  import './dashboard/components/harbor-panel.js';
  import './dashboard/components/session-panel.js';
  import './dashboard/components/timeline.js';
  // ... etc
</script>
<harbor-panel></harbor-panel>
<session-panel></session-panel>
```

The components are separate `.js` files served by Express alongside `index.html`.
No build step. No bundler. Just ES modules in the browser.

**Cache busting:** Import URLs include the daemon's version hash:
`import('./components/harbor-panel.js?v=${codeHash}')`. The `codeHash` is already
computed by `server.ts` (dynamic `readdirSync` hash of all source files). Express
sets `Cache-Control: no-cache` on `index.html` (which contains the version-stamped
imports) and `Cache-Control: immutable, max-age=86400` on component `.js` files
(which are addressed by hash, so new versions get new URLs).

**Loading state:** CSS rule `:not(:defined) { display: none; }` hides unregistered
custom elements until their JS loads. The main `index.html` contains a lightweight
skeleton that displays until components register.

**Total files:** 1 HTML + ~12 JS component files + 1 shared CSS file.
**Build step:** None. Express serves `public/` directory as-is.
**Dependency:** None. Web Components are native.

This is a **minimal violation** of ADR-0005's spirit (no build step, no framework)
while avoiding the unmaintainability of 4000 lines in one file.

**Option B: Single file with `<template>` elements**

Keep everything in one file. Use `<template>` elements and
`document.importNode()` for reusable structures. Each panel is a function
that clones a template and populates it.

**Downside:** Still 4000 lines in one file. Difficult to navigate, test, or
have multiple people work on simultaneously.

**Option C: Build step with lit-html (~5KB)**

Use `lit-html` for declarative templates. Requires a build step (esbuild,
<1 second). Produces a single output file.

**Downside:** Introduces a build step (violates ADR-0005 literally).

### Recommendation: Option A (Web Components)

Amend ADR-0005 to allow multiple files in `public/` served statically, but
no build step, no npm dependencies for the dashboard, no framework.

### ADR-0016: Dashboard Component Architecture

**Status:** Proposed
**Context:** ADR-0005 mandated single-file HTML. The dashboard has grown beyond
what a single file can maintain. Build-step-free alternatives exist.
**Decision:** Use native Web Components in separate ES module files. No build step.
No framework. Express serves `public/` directory as-is.
**Consequences:** Amends ADR-0005. Multiple source files for the dashboard.
Still no build step, no bundler, no framework dependency.

## API Versioning

### The Problem

V4 changes the API contract (harbor cards required). Future versions may change
it again. External integrations and SDK clients need stability guarantees.

### Decision: Header-Based Versioning (Not URL Path)

URL path versioning (`/v4/claim/myapp`) is ugly, creates parallel route trees,
and breaks when you forget to update a URL. Header-based versioning is cleaner:

```
X-Port-Daddy-Version: 4
```

### Behavior

- If no version header: assume latest version (V4)
- If `X-Port-Daddy-Version: 3`: disable harbor card requirement (backward compat)
- If `X-Port-Daddy-Version: 4`: enforce harbor cards
- If `X-Port-Daddy-Version: 99`: reject with `PD-E013: Unsupported API version`

### Interaction with Grace Period (Part I)

The grace period and version header serve different purposes and must not conflict:

- **Grace period** controls the daemon-wide enforcement mode (warn vs. reject).
  It's a time-based transition for existing installations upgrading to V4.
- **Version header** controls per-request compatibility. A V3 client always gets
  V3 behavior regardless of grace period state.

Precedence rules:
1. `X-Port-Daddy-Version: 3` → always exempt from harbor card enforcement, even
   after grace period ends. V3 clients are explicitly backward-compatible.
2. `X-Port-Daddy-Version: 4` (or no header) during grace period → warnings only
3. `X-Port-Daddy-Version: 4` (or no header) after grace period → enforce strictly
4. The version header CANNOT escalate enforcement — a V4 header during grace period
   still gets warnings, not rejections (the grace period is a daemon-wide safety net)

### Daemon-to-Daemon Protocol Versioning

The WebSocket sync protocol includes version negotiation in the handshake:

```json
{
  "type": "sync_hello",
  "protocol_version": 1,
  "daemon_version": "4.0.0",
  "supported_protocol_versions": [1],
  "capabilities": ["kv", "file_claims", "pheromones", "locks"]
}
```

If the remote daemon's `protocol_version` is unsupported, reject the connection
with a clear error. Capabilities are negotiated — if one daemon supports pheromones
and the other doesn't, pheromone sync is skipped (not an error).

### SDK Version Pinning

```typescript
const pd = new PortDaddy({ version: 4 }); // Sends X-Port-Daddy-Version: 4
```

The SDK includes the version header on every request. This ensures consistent
behavior even if the daemon is upgraded underneath the SDK.

## NAT Traversal Strategy

### The Honest Assessment

Full NAT traversal (STUN/TURN, ICE, hole punching) is complex to implement and
unreliable. Tailscale spent years getting this right. Port Daddy should not
attempt to replicate Tailscale's NAT traversal.

### The Strategy: Leverage Existing Solutions

```
Tier 1: Same LAN — mDNS (works through any router)
Tier 2: VPN/Overlay — Tailscale, WireGuard, ZeroTier (user provides)
Tier 3: Port forwarding — User configures their router (fallback)
Tier 4: Relay — portdaddy.dev relay service (V4.3+, paid tier)
```

**V4.0-V4.2:** Document that remote harbors across the internet require a VPN
(Tailscale free tier works). Don't build NAT traversal.

**V4.3+:** Add an optional relay service at `relay.portdaddy.dev`. This is a
WebSocket proxy that forwards sync traffic between two daemons that can't
reach each other directly. Team/Enterprise tier only.

The relay sees encrypted WebSocket frames but cannot read harbor card content
(end-to-end encryption between daemons using their Ed25519 keys). The relay
is a dumb pipe, not a man-in-the-middle.

```bash
pd harbor connect myapp --via relay.portdaddy.dev
# → Connecting via relay (direct connection failed)
# → Relay latency: ~50ms (vs ~2ms direct)
# → All traffic is end-to-end encrypted
```

### Why Not Build STUN/TURN

- STUN/TURN requires running infrastructure (TURN server costs ~$50-200/month)
- NAT hole punching success rate varies (60-80% depending on NAT type)
- Tailscale already solves this problem perfectly and has a free tier
- Port Daddy's value is coordination, not networking

---
---

# Part XXV: Retrospective Amendments to Parts I-XVI

## Part I Amendments: Harbor Enforcement

### Missing: Error Recovery

What happens when harbor card verification fails mid-session? The agent has
a valid session but its card is rejected (expired, revoked, key rotated).

**Recovery flow:**
1. Agent receives 403 from daemon
2. Error response includes `code: 'HARBOR_CARD_EXPIRED'` and `renewUrl`
3. Agent (or MCP server) automatically calls `POST /harbors/:name/renew`
   with the **expired card** in the `Authorization` header
4. Daemon verifies the card's **signature is valid** (the key that signed it is
   still `active` or `retired`) but the `exp` claim has passed. If the signature
   is invalid or the signing key is `revoked`, renewal is rejected — the agent
   must re-enter the harbor from scratch.
5. Daemon issues a new card (if the agent is still a valid member)

**Security note:** The expired-but-signed card serves as proof of previous identity.
Without it, any agent could request a card for any other agent's ID, which is a
privilege escalation. The renewal endpoint NEVER accepts just an agent ID — it
requires a previously-issued card as authentication.
6. MCP server updates its stored card transparently

This is **automatic for MCP users** — the MCP server handles renewal without
the agent's LLM needing to understand JWT mechanics.

### Missing: Grace Period Implementation Detail

The grace period mode (`--enforce-harbors=warn`) is implemented in the harbor
middleware (`lib/harbor-middleware.ts`):

```typescript
// In harbor middleware
if (enforceMode === 'warn') {
  if (!validCard) {
    graceViolationCount++;  // Atomic counter in daemon state
    logger.warn({ path: req.path, agentId, missing: requiredCap },
      'harbor_enforcement_would_reject');
    return next();  // Allow through with warning
  }
}
```

The violation counter is exposed via:
- `pd status` output: `"⚠ 47 requests would have been rejected by harbor enforcement"`
- `GET /metrics` response: `grace_period_violations: 47`
- `pd enforce-harbors dry-run` — reads the grace violation log (stored in the
  activity table with type `grace_violation`) and groups by endpoint + agent

### Missing: Testing Strategy

- Unit test: `harbor-middleware.test.js` — verify every route has correct capability
  requirements, test expired/revoked/missing card paths
- Integration test: full `pd begin` → API calls with card → `pd done` flow
- Regression test: ensure V3 API calls work in grace period mode

## Part II Amendments: Windows Support

### Missing: Named Pipe Behavior Differences

Windows named pipes have different semantics than Unix sockets:
- Maximum concurrent connections is configurable (Unix sockets have no explicit limit)
- Named pipes support overlapped I/O (async) which Node.js handles automatically
- Named pipe names are global — two Port Daddy instances need different pipe names.
  Use port number AND username: `\\.\pipe\port-daddy-${username}-${port}` to avoid
  collision between users on shared machines (e.g., dev servers with multiple logins)
- Named pipes survive process restart (unlike Unix sockets which must be unlinked)

### Missing: Testing on Windows

- GitHub Actions `windows-latest` runner for CI
- PowerShell script equivalents for all bash test helpers
- Named pipe connectivity test
- Windows-specific service installation test (node-windows)
- Cross-platform test matrix: macOS-latest, ubuntu-latest, windows-latest

## Part III Amendments: Lighthouse Discovery

### Missing: mDNS Failure Modes

- mDNS doesn't work on some corporate networks (multicast blocked)
- VPN connections often don't bridge mDNS between physical and virtual interfaces
- Docker Desktop on macOS isolates mDNS from the host in some configurations
- **Fallback:** If mDNS discovery returns no results after 5 seconds, suggest
  manual connection with `pd harbor connect --peer <ip:port>`

## Part V Amendments: Monetization

### Missing: Billing Infrastructure

Pricing is defined but implementation isn't:
- License key generation and validation server (Stripe + Cloudflare Worker)
- `pd license activate <key>` implementation
- Grace period when license server is unreachable (7 days)
- Feature gating implementation (check license before `pd harbor connect`)
- License key format: `PD-XXXX-XXXX-XXXX-XXXX` (human-readable, typeable)

## Part VII Amendments: Semantic Trie

### Missing: Trie Consistency

The trie is an in-memory cache of SQLite state. Consistency risks:
- If a SQLite write succeeds but trie update fails (OOM, bug), the trie diverges
- **Fix:** Trie updates are synchronous and wrapped in the same transaction:

```typescript
// In harbors.ts — every write that affects the trie
const txn = db.transaction(() => {
  db.prepare('INSERT INTO harbors ...').run(name, ...);
  trie.insert(name, capabilities);  // Throws on failure → txn rolls back
});
txn();
```

- **Rebuild:** `pd debug rebuild-trie` forces a full trie rebuild from SQLite.
  Also runs automatically on daemon startup.

### Missing: Multi-Process

If multiple processes access the same SQLite database (unlikely but possible with
tools like `sqlite3` CLI), the trie won't reflect external changes.
- **Fix:** On startup, hash the SQLite data and compare to trie state. If they
  differ, rebuild. This is the same startup-rebuild pattern described above.

## Part VIII Amendments: Socket-First Transport

### Missing: Backpressure

When the daemon is under heavy load, the msgpack socket channel needs backpressure:

```typescript
// In lib/socket-transport.ts
function sendFrame(socket: net.Socket, frame: Buffer): boolean {
  const ok = socket.write(frame);
  if (!ok) {
    // Buffer is full — pause accepting new inbound frames
    socket.pause();
    socket.once('drain', () => socket.resume());
  }
  return ok;
}
```

Thresholds:
- High watermark: 64KB (Node.js `net.Socket` default is 16KB — increase via
  `socket.setNoDelay(true)` and `new net.Socket({ highWaterMark: 65536 })`)
- Clients should handle `false` return from write: queue locally, retry on `drain`

### Missing: Protocol Error Handling

What happens when the daemon receives malformed msgpack?
- Parse failure → respond with error frame, do NOT close the connection
- Frame too large (>1MB) → respond with error frame, close the connection
- Unknown method → respond with `{error: 'unknown method', method: 'xyz'}`

## Part IV Amendments: Website V2 — Copy and Content Strategy

### Missing: Harbor-First Messaging

The website copy was written before harbor enforcement became the central concept.
Every page needs a messaging pass:
- **Hero section:** "Your agents need a port authority" → emphasize harbors, not just ports
- **Features page:** Harbor enforcement is the headline, not a bullet point
- **Pricing page:** Free tier should lead with "enforced harbor isolation" as the default

### Missing: OG Tag Validation

OG tags render differently on Twitter, Slack, Discord, LinkedIn, and iMessage.
- Test each platform manually before launch (or use a social preview tool)
- The `og:image` needs to be at least 1200x630 for Twitter Cards
- Slack unfurls use different metadata priority than Twitter

### Missing: Broken Link Testing

The GitHub/brew link fixes are mechanical but error-prone. Add:
- A CI job that crawls the built site and verifies all links resolve (dead-simple with `lychee`)
- Pre-deploy: `lychee public/index.html --no-progress` catches broken links

## Part VI Amendments: ADRs and White Paper

### Missing: ADR Review Process

Self-authored ADRs are better than no ADRs, but they benefit from at least one review:
- Post each ADR as a GitHub Discussion (or PR) for community feedback before finalizing
- ADR-0015 (conflict resolution) and ADR-0016 (dashboard architecture) are the most
  consequential — these should have explicit "alternatives considered" sections with
  quantified trade-offs (not just prose)

### Missing: White Paper V2 Content

The white paper needs to incorporate material from Parts XVII-XXIV:
- HLC timestamps and Merkle sync (Part XVII) — this is academically publishable
- Stigmergic coordination (Part XV) — cite Grassé 1959, Dorigo ant colony optimization
- The "infrastructure not framework" positioning (Part XXII) is the thesis statement
- If the ProVerif models from V3 covered only HMAC auth, they need extension for
  Ed25519 key rotation (Part XVIII) and WebSocket sync (Part XVII)

### Missing: ADR Numbering

Part VI proposes ADR-0011 through ADR-0016. Part XXIV adds ADR-0016 (dashboard).
Verify there's no numbering collision. If Part VI already has ADR-0016 for something
else, renumber.

## Part IX Amendments: Dashboard

Part XXIV defines the Web Components architecture (ADR-0016) that supersedes
Part IX's conceptual wireframes. Specific reconciliation needed:

### Missing: Wireframe-to-Component Mapping

Part IX defines a 12-panel layout. Part XXIV phases this as 6+6 across V4.1 and V4.2.
The mapping should be explicit:

**V4.1 (6 panels):** Services, Agents, Sessions, Harbors, Activity Log, Health
**V4.2 (6 panels):** Salvage Queue, Locks, Messaging, Pheromone Heatmap, Metrics, Config

Verify this matches Part IX's original 12 panels. If Part IX had different panels,
note which were dropped and why.

### Missing: Data Fetching Strategy

Part IX's wireframes show data but never specify how it's fetched. The dashboard needs:
- Initial load: `GET /metrics` + `GET /services` + `GET /agents` (3 parallel requests)
- Live updates: SSE subscription to `/subscribe/dashboard` (or a new aggregate channel)
- Polling fallback: If SSE disconnects, poll every 5s until reconnection
- No WebSocket for dashboard — SSE is sufficient for unidirectional server→browser updates

## Part X Amendments: MCP Server — V4 Tool Plan

### Missing: Harbor Card Integration

The MCP server holds a persistent connection to the daemon. When harbor enforcement
is active, every MCP tool call needs a valid harbor card:
- The MCP server should obtain a harbor card on startup (auto-entering a default harbor)
- Card renewal: the MCP server must handle card expiry and re-enter the harbor
- If the card is revoked (harbor destroyed, agent evicted), all MCP tools should
  return a clear error: "Harbor card expired. Re-enter harbor with pd begin."

### Missing: Grace Period Interaction

When a harbor enters grace period (Part I), the MCP server should:
- Continue operating (grace period means old rules still apply)
- Surface a warning in tool responses: "⚠️ Harbor entering enforcement — update your workflow"
- After grace period ends, enforce strictly

### Missing: Testing Strategy for 108 Tools

Part X proposes 108 MCP tools but no testing strategy:
- Each tool needs at least one happy-path test and one error-path test → 216 minimum tests
- Group tests by module (harbor tools, remote tools, spawn tools)
- Use the existing Jest setup from `tests/setup-unit.js` with in-memory SQLite
- Integration tests: verify 5-10 critical tool flows end-to-end against a live daemon

## Part XI Amendments: Website V2 Full Wireframes

### Missing: Harbor Enforcement UX in Wireframes

The wireframes predate harbor enforcement. Key additions:
- **Pricing page:** The free tier box should prominently feature "Harbor Isolation (enforced)"
  as the first bullet, not buried in a feature list
- **Documentation wireframes:** Need a "Getting Started" flow that shows harbor enforcement
  as the default, not an opt-in feature
- **Trust tier selector:** If the pricing page shows remote harbor options, it needs a
  visual explainer of the three trust tiers (full, coordinated, minimal) from Part XII

## Part XII Amendments: Remote Harbor Privacy and Trust Tiers

### Missing: Trust Tier Transitions

What happens when a trust tier changes on a live connection?

**Downgrade (full → coordinated → minimal):**
- Already-synced data that exceeds the new tier's visibility is NOT deleted from the
  remote (that would require the remote to trust a delete instruction, which contradicts
  the lower trust level)
- Instead: stop syncing new data that exceeds the tier, and mark the existing data as
  "stale" (not refreshed after tier change)
- The remote daemon's local copy naturally ages out via storage lifecycle (Part XXIII)

**Upgrade (minimal → coordinated → full):**
- New data types start syncing immediately
- Historical data is NOT backfilled (would be a large sync burst)
- The remote gets current state, not full history

### Missing: Trust Tier Verification

How does a remote daemon verify that the claimed trust tier is legitimate?
- The trust tier is set by the harbor owner in their harbor config
- The trust tier is signed with the daemon's key (Part XVIII)
- A remote daemon can verify the signature but not override the tier
- Mismatch between claimed and signed tier → reject connection

### Missing: Testing Trust Tier Visibility Rules

Trust tiers control what data types sync across 6+ categories (notes, KV, pheromones,
file claims, agent presence, capability lists). That's 3 tiers × 6+ categories = 18+
visibility rules.
- Each rule needs an explicit test: "In coordinated trust, session notes sync but
  pheromone attention does not"
- Use a test matrix, not individual test cases — easier to verify completeness

### Missing: Integration with Part XVII Sync Protocol

Part XVII's Merkle tree has branches for KV, claims, members, locks, and pheromones.
The trust tier must filter which branches are included in the Merkle hash:

| Merkle Branch | Full Trust | Coordinated Trust | Minimal Trust |
|---------------|-----------|-------------------|---------------|
| KV entries | All | Public keys only | None |
| File claims | All | Claim existence (no content) | None |
| Members | All | Presence only (no capabilities) | Count only |
| Locks | All | Lock names (no holder details) | None |
| Pheromones | All types | heat, danger, success, contention | None |
| Session notes | All | Summary only (no full text) | None |

The Merkle hash comparison in `lib/sync-protocol.ts` must be trust-tier-aware:
compute the hash only over branches allowed by the trust tier. If both sides compute
hashes over different branch sets (because of misconfigured tiers), the hash will
never match — the trust tier verification step (above) prevents this by rejecting
connections with mismatched tiers.

## Part XIII Amendments: Harbor KV, Counters, and Logs

Part XVII addresses KV conflict resolution via HLC and LWW. But Part XIII also
defines **counters** and **append-only logs**, which have different conflict semantics.

### Missing: Counter Conflict Resolution

LWW is **wrong for counters**. If daemon A increments from 5→6 and daemon B increments
from 5→6, LWW picks one and the other increment is lost. The correct count is 7.

**Resolution:** Use a state-based G-Counter (grow-only counter) for non-negative counters
and a PN-Counter (positive-negative counter) for general counters:

```
-- G-Counter state per daemon:
-- { "daemon-a": 3, "daemon-b": 4 }
-- Value = sum of all entries = 7
-- Merge = max per entry (idempotent, commutative, associative)
```

This is simple to implement (~50 lines) and doesn't require the full CRDT machinery
that Part XVII intentionally avoided. The counter state is stored as JSON in the
`value` column of `harbor_kv` with `conflict_mode = 'counter'`.

### Missing: Append-Only Log Merge

For append-only logs shared across daemons, the merge strategy is:
- Each log entry has an HLC timestamp (from Part XVII)
- Merge = union of entries, deduplicated by (timestamp + node_id), sorted by HLC
- This is a grow-only set (G-Set), another simple CRDT
- Stored as JSON array in `harbor_kv` with `conflict_mode = 'log'`

### conflict_mode Summary

| Mode | Use Case | Merge Strategy |
|------|----------|----------------|
| `lww` | General KV, config, state | Last-Writer-Wins by HLC |
| `detect` | Critical keys (schema version, leader election) | Reject conflicting writes, require manual resolution |
| `counter` | Metrics, vote counts, resource tracking | G-Counter / PN-Counter merge |
| `log` | Audit trails, event streams | G-Set with HLC ordering |

## Part XIV Amendments: Regions

### Missing: Region Conflict with File Claims

When an agent claims a region, and another agent has file-level claims that overlap:
- Region claims decompose into file claims (as stated in Part XIV)
- If a file in the region is already claimed by another agent, this IS a conflict
- The conflict is surfaced the same way as a regular file claim conflict
- Region claims do NOT override existing file claims — they are additive and
  advisory, just like file claims themselves

## Part XV Amendments: Stigmergy

### Missing: Pheromone Deposition Rate Limiting

Without limits, an agent could flood the pheromone system:
- Max deposits per agent per minute: 100 (prevents runaway loops)
- Max intensity per deposit: 10.0 (prevents single-deposit domination)
- These limits are enforced by the daemon, not by agent cooperation

### Missing: Pheromone Privacy in Remote Harbors

Pheromone sync follows the trust tier model:
- **Full trust:** All pheromone types sync
- **Coordinated trust:** heat, danger, success, contention sync. Attention and
  coupling are local-only (they reveal too much about agent behavior)
- **Minimal trust:** No pheromones sync

## Part XVI Amendments: Agent Skills & Templates

### Missing: Template Maintenance Burden

Five templates is ambitious. Each needs maintenance against API changes, CI, docs.
**Revised strategy:** Ship 2 templates at V4.0 launch (code-review and cross-machine),
add 1 per minor release. This spreads the maintenance burden and gives each template
time for polish.

### Missing: `pd teach` Failure Modes

- Claude Code not installed → helpful error with install instructions
- Daemon not running → start it automatically
- MCP server already configured → update in place (don't duplicate)
- Permission denied on config file → explain which file and what permissions needed

---
---

# Part XXVI: Cross-Pollination — Harvested Ideas

A parallel planning effort produced its own V4 plan (`docs/plans/V4-MASTER-PLAN.md`),
test suite (`docs/plans/V4-TEST-SUITE.md`), marketing plan (`docs/plans/V4-MARKETING-MONETIZATION.md`),
and ADRs 0011-0016 (`docs/adr/`). This section harvests the best ideas from that work
and integrates them into our plan. Ideas are evaluated by effort-to-value ratio and
alignment with our local-first, incremental architecture.

## Harvested: Hash-Chained Session Notes

**Source:** V4-MASTER-PLAN.md §Phase 2, ADR-0012
**Value:** High. ~10 lines of code. Gives tamper detection for free.

Session notes are currently append-only but have no integrity chain. If the SQLite
database is modified externally (backup restore, manual edit, corruption), there's
no way to detect whether notes were altered or removed.

**Change:** Each note stores `SHA256(previous_note_content || previous_note_hash)`.
The first note in a session uses `SHA256(session_id)` as its "genesis" hash.

```sql
ALTER TABLE session_notes ADD COLUMN prev_hash TEXT;
-- Migration: backfill existing notes with NULL (pre-chain era)
```

```typescript
// In sessions.ts addNote()
const prevNote = db.prepare(
  'SELECT content, prev_hash FROM session_notes WHERE session_id = ? ORDER BY created_at DESC LIMIT 1'
).get(sessionId);

const prevHash = prevNote
  ? sha256(prevNote.content + (prevNote.prev_hash || ''))
  : sha256(sessionId);

db.prepare('INSERT INTO session_notes (session_id, content, prev_hash, ...) VALUES (?, ?, ?, ...)')
  .run(sessionId, content, prevHash);
```

**Verification:** `pd notes --verify <sessionId>` walks the chain and reports
any breaks. Also exposed via `GET /sessions/:id/notes?verify=true`.

**When:** V4.0. It's too simple and valuable to defer. Add `prev_hash` column
in schema migration v4 (the harbor enforcement migration).

## Harvested: Harbor Bitmask Optimization for Trie

**Source:** ADR-0012, V4-MASTER-PLAN.md §Phase 2
**Value:** Medium. Clever optimization for wildcard skip in the trie.

Each harbor gets a 64-bit bitmask. Each trie node stores the OR of all harbors
that have tokens in its subtree. Wildcard queries like `*:api:*` can skip entire
branches where `(node.harborMask & queryHarborMask) === 0`.

**Change to Part VII (Semantic Trie):**

```typescript
interface TrieNode {
  segment: string;
  children: Map<string, TrieNode>;
  values: Set<{ type: string; id: string }>;
  harborMask: bigint;  // OR of all harbor bits in this subtree
}
```

Harbor IDs are assigned sequential bit positions (harbor 0 = bit 0, harbor 1 = bit 1).
With `bigint`, this works for any number of harbors (no 64-bit limit in practice).

**Limitation:** The bitmask helps most when queries target specific harbors.
For `*:api:*` queries across all harbors, every branch matches and the optimization
is a no-op. This is fine — the optimization targets the common case (scoped queries
within a harbor).

**When:** V4.0 (Part VII implementation). Add it when building the trie, not as a
retrofit.

## Harvested: Lazy Token Promotion

**Source:** ADR-0012, V4-MASTER-PLAN.md §Phase 2
**Value:** Medium. Reduces trie memory for inactive tokens.

Not every registered token needs to be in the trie immediately. Most tokens are
written once and rarely queried. Only promote tokens to the trie when they're
involved in an interaction (query, capability check, pheromone lookup).

**Strategy:**

```
Token registered → stored in SQLite only (cold)
Token queried/checked → promoted to trie (hot)
Token not accessed for 1 hour → evicted from trie (cold again)
```

This keeps the trie small (only active tokens) while maintaining correctness
(cold tokens are always available via SQL fallback).

**When:** V4.1. The V4.0 trie should be built naively (load everything). Lazy
promotion is an optimization for scale, not correctness.

## Harvested: Filesystem Heartbeat Watchdog (Bosun Pattern)

**Source:** ADR-0015, MUTUAL_ASSURED_RESURRECTION.md
**Value:** High. Solves a real reliability gap.

The current heartbeat mechanism is HTTP-based: agents send `PUT /agents/:id/heartbeat`
every 5 minutes. Problem: if the daemon crashes, no one detects it. The agent
keeps heartbeating into the void (or fails silently). And if the agent process dies
without cleanup, the daemon only notices after the heartbeat timeout (20 minutes).

**The Bosun pattern:** Write a heartbeat file to disk instead of (or in addition to)
HTTP. A lightweight watchdog process (or the daemon itself) monitors the file.

```
~/.port-daddy/heartbeats/
  agent-a4f2.beat     # last modified = last heartbeat time
  agent-b3c1.beat     # inotify/FSEvents watches for staleness
  daemon.beat         # daemon writes this every 30s
```

**Benefits:**
- Survives daemon restarts (files persist)
- Agents can detect daemon death by watching `daemon.beat`
- External tools (cron, launchd) can monitor `daemon.beat` for process supervision
- No network overhead for local heartbeats

**Implementation:**

```typescript
// In agents.ts heartbeat()
const beatPath = path.join(heartbeatDir, `${agentId}.beat`);
fs.writeFileSync(beatPath, JSON.stringify({ ts: Date.now(), agentId }));
// Also update SQLite as before (for query/history)
```

The daemon's reaper checks file modification times in addition to the `lastHeartbeat`
column. This is a **belt-and-suspenders** approach — either signal alone is sufficient
to keep the agent alive.

**When:** V4.0. The heartbeat directory creation is trivial. The dual-signal reaper
is ~20 lines of additional code. Too valuable for agent reliability to defer.

## Harvested: Hard Test Invariants (T1-T5)

**Source:** V4-TEST-SUITE.md (Gauntlet methodology)
**Value:** High. Concrete, measurable targets prevent performance regression.

The other plan defines 5 hard invariants that every CI run must verify. These are
excellent because they're specific numbers, not vague "should be fast":

| ID | Invariant | Target | Test Method |
|----|-----------|--------|-------------|
| T1 | Trie lookup latency | <300μs p99 for 100k tokens | Benchmark test with `performance.now()` |
| T2 | Memory ceiling | <50MB RSS for 100k tokens | `process.memoryUsage()` after bulk insert |
| T3 | SIGKILL recovery | <5s from cold start to serving | Kill daemon, restart, time first successful request |
| T4 | Harbor scope isolation | Zero cross-harbor leaks | Exhaustive property test: create 2 harbors, verify no data crosses |
| T5 | Event loop lag | <5ms under 100 concurrent requests | `monitorEventLoopDelay()` during load test |

**Integration into Part XXIV (Testing):**

These invariants join the existing property-based tests. Add a `tests/benchmarks/`
directory with:
- `trie-benchmark.test.js` — T1 and T2
- `recovery-benchmark.test.js` — T3
- `isolation-benchmark.test.js` — T4
- `load-benchmark.test.js` — T5

CI runs benchmarks on every PR. If any invariant regresses, the PR is blocked.
Use `--benchmark` flag to skip in normal `npm test` (benchmarks are slow).

**When:** T4 at V4.0 (critical for harbor enforcement). T1, T2, T3, T5 at V4.1
(need the trie and socket transport first).

## Harvested: `pd self-test --adversarial`

**Source:** V4-TEST-SUITE.md
**Value:** Medium. Great for user confidence and support diagnostics.

A built-in self-test command that verifies the daemon is functioning correctly:

```bash
pd self-test
# → ✓ Daemon reachable
# → ✓ SQLite writable
# → ✓ Harbor enforcement active
# → ✓ Socket transport responding
# → ✓ Agent heartbeat cycle working
# → 5/5 checks passed

pd self-test --adversarial
# → ✓ Basic checks (above)
# → ✓ Harbor card with wrong key rejected
# → ✓ Expired card renewal works
# → ✓ Rate limit triggers at threshold
# → ✓ Concurrent lock acquisition serialized correctly
# → ✓ Cross-harbor data isolation verified
# → 9/9 checks passed (adversarial)
```

**Implementation:** The basic `pd self-test` is essentially a health check that
exercises every subsystem. The `--adversarial` flag adds negative tests (invalid
inputs, boundary conditions, security properties).

**When:** V4.0 for basic self-test (6 checks). V4.1 for adversarial (adds
harbor-specific and security tests once those features exist).

## Harvested: Two-Tier Scheduler

**Source:** ADR-0011 (Reactive Coordination Kernel)
**Value:** Medium. Prevents log/telemetry work from delaying critical paths.

The daemon currently processes all work on the same event loop with no priority.
A background telemetry flush or log rotation can delay a lock acquisition.

**Two tiers:**

| Tier | Operations | Priority |
|------|-----------|----------|
| Critical | Lock acquire/release, heartbeat, port claim, harbor card verify | Immediate (next tick) |
| Batched | Activity log write, telemetry flush, pheromone evaporation, webhook delivery | Deferred (setImmediate or 100ms batch) |

**Implementation:** The batched tier uses a simple queue that flushes periodically:

```typescript
const batchQueue: Array<() => void> = [];
let batchTimer: NodeJS.Timeout | null = null;

function enqueueBatch(fn: () => void) {
  batchQueue.push(fn);
  if (!batchTimer) {
    batchTimer = setTimeout(flushBatch, 100);
  }
}

function flushBatch() {
  batchTimer = null;
  const batch = batchQueue.splice(0);
  // Execute all in one tick
  for (const fn of batch) fn();
}
```

Activity log writes, webhook deliveries, and pheromone evaporation use `enqueueBatch`.
Lock operations, heartbeats, and port claims call their module functions directly.

**When:** V4.1. The current architecture handles V4.0 load fine. This is an
optimization for when remote harbors increase throughput.

## Harvested: SDDL for Windows Named Pipes

**Source:** ADR-0016 (Hardened Cross-Platform IPC)
**Value:** Medium. Critical for Windows security.

The Part II Windows support section specifies named pipes but doesn't define the
security descriptor. The other plan specifies a concrete SDDL string:

```
D:(A;;GA;;;BA)(A;;GA;;;SY)(A;;GRGW;;;IU)(D;;WP;;;NS)
```

Translation:
- `BA` (Built-in Admins): Full access
- `SY` (System): Full access
- `IU` (Interactive Users): Read + Write (only the logged-in user)
- `NS` (Network Service): Denied write — **prevents NTLM relay attacks**

The `NS` deny entry is the key security addition. Without it, a compromised
network service could write to the named pipe and issue daemon commands.

**Amendment to Part II:** Add the SDDL string to the named pipe creation code.
Use `node-windows` or the native `win32pipe` module to set the security descriptor.

**When:** V4.1 (with Windows support).

## Not Harvested (With Rationale)

The following ideas from the other plan were evaluated and intentionally excluded:

| Idea | Source | Why Not |
|------|--------|---------|
| Bun/Fastify migration | ADR-0011 | Massive rewrite risk. Express is fine for our scale. Performance gains come from socket-first transport, not HTTP framework swap. |
| Credit economy / FloatPlan / Anchor Protocol | ADR-0014, V4-MASTER-PLAN §Phase 3 | **Reconsidered → adopted as Part XXVII.** Structured task lifecycle (V4.1), bilateral receipts (V4.2), credits/escrow (V4.2+), marketplace (V4.3). Credits only after multi-machine harbors work. |
| $29/$99 pricing tiers | V4-MARKETING-MONETIZATION.md | Too high. Our Part V pricing ($14/$39) is validated against developer tool comps (Part XXII). Port Daddy is infrastructure, not an IDE — it shouldn't cost more than GitHub Pro. |
| "Trust-as-a-Service" (TaaS) narrative | V4-MARKETING-MONETIZATION.md | Too abstract. Developers buy tools that solve concrete problems, not narratives. Our messaging should stay concrete: "no more port conflicts, automatic agent coordination." |
| Marketplace UI | V4-MARKETING-MONETIZATION.md | Premature. Need users before a marketplace. Revisit for V5. |
| Bitmask-based template matching for agent capabilities | ADR-0012 | Our capability model (string-based wildcards in harbor cards) is simpler and sufficient. Bitmasks add complexity for a marginal performance gain that only matters at >1000 agents. |
| Merkle-ized evidence chains | ADR-0014 | Overkill for local coordination. Hash-chained notes (harvested above) give 80% of the tamper-evidence benefit at 5% of the complexity. |

## ADR Numbering Conflict

Both our plan and the other plan use ADR numbers 0011-0016, but for different topics:

| Number | Our Plan (Part VI) | Their Plan (docs/adr/) |
|--------|-------------------|----------------------|
| 0011 | Harbor-First Security Model | Reactive Coordination Kernel |
| 0012 | Platform Adapter | Semantic Token Graph |
| 0013 | Remote Harbor Sync Protocol | Unified Harbor Model |
| 0014 | Lighthouse Discovery | Anchor Protocol |
| 0015 | Conflict Resolution Model | Layered Resurrection |
| 0016 | Dashboard Components | Hardened Cross-Platform IPC |

**Resolution:** Our ADR numbers are authoritative (they're defined in the plan that
maps to the actual implementation). The other plan's ADRs should be renumbered to
0017-0022 if any are adopted. For now, the harvested ideas above are integrated
into the existing parts rather than creating new ADRs.

---
---

# Part XXVII: The Anchor Protocol — Structured Task Economy

## The Insight

Sessions and notes are journals — they record what happened. But they don't define
what *should* happen. An agent runs `pd begin`, writes some notes, runs `pd done`.
There's no formal task definition, no completion criteria, no verifiable evidence
chain, and no way for one agent to request work from another with accountability.

The Anchor Protocol adds **structured accountability** in three layers:
1. **Task Lifecycle** (V4.1) — define, assign, track, complete, verify
2. **Bilateral Receipts** (V4.2) — signed completion proofs for disaster recovery
3. **Credit Economy** (V4.2+) — coordination credits, escrow, settlement, marketplace

**Critical constraint:** Layers 2 and 3 (receipts, credits, escrow, marketplace,
coordination tax) ship ONLY AFTER multi-machine remote harbors are working (V4.1).
The economy requires cross-machine coordination to be meaningful — local-only credits
are a currency with no foreign exchange.

## Layer 1: Structured Task Lifecycle (V4.1)

### The Anchor Primitive

An **anchor** is a structured work agreement between agents:

```bash
# Agent A creates a task
pd anchor create \
  --task "Fix authentication race condition in session middleware" \
  --files src/auth.ts src/middleware/session.ts \
  --criteria "All auth tests pass, no race condition on concurrent login" \
  --priority high

# → Anchor created: anch_7f3k92
# → Status: OPEN
# → Files claimed: src/auth.ts, src/middleware/session.ts

# Agent B accepts the task
pd anchor accept anch_7f3k92

# → Anchor anch_7f3k92: OPEN → ACTIVE
# → Assigned to: agent-b3c1
# → Files claimed by agent-b3c1

# Agent B works, logs evidence
pd anchor log anch_7f3k92 "Root cause: session.save() not awaited in concurrent handler"
pd anchor log anch_7f3k92 "Fix: wrapped in mutex, added integration test"

# Agent B completes
pd anchor complete anch_7f3k92

# → Anchor anch_7f3k92: ACTIVE → COMPLETED
# → Evidence chain: 2 log entries
# → Completion criteria: awaiting verification
```

### Schema

```sql
CREATE TABLE anchors (
  id           TEXT PRIMARY KEY,              -- 'anch_' + nanoid(8)
  harbor_name  TEXT NOT NULL REFERENCES harbors(name) ON DELETE CASCADE,
  task         TEXT NOT NULL,                 -- human-readable task description
  criteria     TEXT,                          -- completion criteria (nullable for informal tasks)
  priority     TEXT NOT NULL DEFAULT 'normal', -- low, normal, high, critical
  status       TEXT NOT NULL DEFAULT 'open',  -- open, active, completed, verified, abandoned
  created_by   TEXT NOT NULL,                 -- agent ID of requester
  assigned_to  TEXT,                          -- agent ID of worker (NULL when open)
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  verified_at  TEXT,
  prev_hash    TEXT                           -- hash chain (same pattern as session notes)
);

CREATE TABLE anchor_files (
  anchor_id    TEXT NOT NULL REFERENCES anchors(id) ON DELETE CASCADE,
  file_path    TEXT NOT NULL,
  PRIMARY KEY (anchor_id, file_path)
);

CREATE TABLE anchor_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  anchor_id    TEXT NOT NULL REFERENCES anchors(id) ON DELETE CASCADE,
  agent_id     TEXT NOT NULL,
  content      TEXT NOT NULL,
  prev_hash    TEXT,                          -- hash chain within anchor
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_anchors_harbor ON anchors(harbor_name, status);
CREATE INDEX idx_anchors_assigned ON anchors(assigned_to, status);
```

### State Machine

```
OPEN ──────► ACTIVE ──────► COMPLETED ──────► VERIFIED
  │            │                │
  │            │                └──► DISPUTED (V4.2+, requires credits)
  │            │
  │            └──► ABANDONED (worker gave up or died)
  │                    │
  └────────────────────┘ (returns to OPEN for re-assignment)
```

- **OPEN:** Task defined, waiting for a worker
- **ACTIVE:** Worker assigned, in progress
- **COMPLETED:** Worker says done, evidence logged
- **VERIFIED:** Requester (or automated check) confirms criteria met
- **ABANDONED:** Worker stopped (crash, timeout, explicit abandon). Task returns to OPEN.
- **DISPUTED:** (V4.2+) Worker completed but requester disputes quality. Requires credits.

### Relationship to Sessions

Anchors and sessions are complementary, not competing:

```
Session  = "I'm working" (agent lifecycle, notes, file claims)
Anchor   = "I'm working on THIS" (task definition, criteria, evidence, assignment)
```

When an agent accepts an anchor, a session note is automatically appended:
`"Accepted anchor anch_7f3k92: Fix authentication race condition"`. When the anchor
completes, another note: `"Completed anchor anch_7f3k92"`. This keeps the session
journal continuous while the anchor tracks structured task state.

An agent can have multiple anchors in a single session (multi-tasking), or a single
anchor spanning multiple sessions (long-running task with breaks).

### Integration with Salvage

When an agent dies with active anchors:
1. Anchors move to ABANDONED status
2. Files are released
3. The salvage queue entry includes anchor IDs and their evidence logs
4. A new agent running `pd salvage claim` gets the anchor context:
   - Task definition and criteria
   - All evidence log entries from the dead agent
   - File list (re-claimed for the new agent)
5. The new agent's session note: `"Salvaged anchor anch_7f3k92 from dead agent-b3c1"`

This is the "structured resurrection" pattern: the new agent doesn't just get raw notes,
it gets a formal task definition with completion criteria and prior evidence.

### CLI Commands

```bash
pd anchor create --task "..." [--files ...] [--criteria "..."] [--priority high]
pd anchor accept <id>
pd anchor log <id> "message"
pd anchor complete <id>
pd anchor verify <id>
pd anchor abandon <id>
pd anchor list [--status open|active|completed] [--mine]
pd anchor show <id>                    # full detail with evidence chain
pd anchor search "keyword"             # search task descriptions
```

### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/anchors` | POST | Create anchor |
| `/anchors` | GET | List anchors (filterable by status, harbor, agent) |
| `/anchors/:id` | GET | Get anchor detail with evidence chain |
| `/anchors/:id` | PUT | Update anchor (accept, complete, verify, abandon) |
| `/anchors/:id` | DELETE | Delete anchor (only if OPEN or VERIFIED) |
| `/anchors/:id/log` | POST | Add evidence log entry |
| `/anchors/:id/log` | GET | Get evidence log |

## Layer 2: Bilateral Receipts (V4.2)

### The Problem Receipts Solve

If the daemon's SQLite database is lost (corruption, disk failure, accidental deletion),
all task history disappears. Agents that completed work have no proof. Sessions, notes,
and anchors are gone.

### The Solution: Agent-Held Receipts

When an anchor reaches VERIFIED status, the daemon produces a **signed receipt** — a
self-contained JSON document that proves the work happened:

```json
{
  "type": "anchor_receipt",
  "version": 1,
  "anchor_id": "anch_7f3k92",
  "harbor": "myapp",
  "task": "Fix authentication race condition in session middleware",
  "criteria": "All auth tests pass, no race condition on concurrent login",
  "requester": "agent-a4f2",
  "worker": "agent-b3c1",
  "evidence_hash": "sha256:a3f2c9...",
  "completed_at": "2026-07-15T14:32:00Z",
  "verified_at": "2026-07-15T14:35:00Z",
  "daemon_signature": "ed25519:...",
  "daemon_id": "daemon-macbook-erich"
}
```

The receipt is signed with the daemon's Ed25519 key (from Part XVIII). The
`evidence_hash` is the Merkle root of all anchor log entries (using the same
hash-chain from Part XXVI).

### Storage

Receipts are stored in two places:
1. **Daemon:** In the `anchor_receipts` SQLite table (authoritative)
2. **Agent:** In `~/.port-daddy/receipts/<anchor_id>.json` (backup)

The agent-side storage is the key innovation. If the daemon dies, agents can
present their receipts to a new daemon instance:

```bash
pd receipts import ~/.port-daddy/receipts/
# → Imported 47 receipts
# → Verified 47 signatures (daemon key: daemon-macbook-erich)
# → Reconstructed 12 anchor records
```

### Schema

```sql
CREATE TABLE anchor_receipts (
  anchor_id        TEXT PRIMARY KEY REFERENCES anchors(id),
  receipt_json     TEXT NOT NULL,           -- full signed receipt
  evidence_hash    TEXT NOT NULL,           -- Merkle root of evidence
  daemon_signature TEXT NOT NULL,           -- ed25519 signature
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Limitations

Receipts prove that work was completed and verified. They do NOT reconstruct:
- The full evidence log (only the hash)
- Session notes unrelated to the anchor
- Pheromone state, KV entries, or other ephemeral state

Receipts are a **disaster recovery** mechanism, not a full backup. For full backup,
use `pd backup` (Part XXIII).

## Layer 3: Credit Economy (V4.2+)

**Prerequisite:** Multi-machine remote harbors must be working (V4.1 ships Q3 2026).
Credits are meaningless without cross-machine coordination — they're a coordination
signal between agents that may be on different machines.

### Why Credits

Without credits, task assignment is implicit: whoever runs `pd anchor accept` first
gets the task. This works for cooperative agents on a single machine, but breaks down
when:
- Multiple agents compete for high-value tasks
- You want to prioritize urgent work over routine work
- You need to track which agents contribute the most value
- Cross-machine agents need an incentive to help each other

Credits solve this by making task value explicit: "This task is worth 500 credits
to me. Who wants it?"

### The Credit Unit

Credits are an **internal coordination currency**, not real money. They represent
"how much of the harbor's attention this task deserves."

```
1 credit ≈ 1 minute of agent compute time (rough heuristic)
```

This is intentionally imprecise. Credits are a signal, not a price. The daemon does
not enforce that 500 credits = 500 minutes of work. It enforces that the requester
has 500 credits to spend and the worker receives them on completion.

### Credit Allocation

Each harbor has a **credit pool**. When a harbor is created, it's seeded with a
configurable number of credits (default: 10,000):

```sql
ALTER TABLE harbors ADD COLUMN credit_pool INTEGER NOT NULL DEFAULT 10000;
```

When an agent enters a harbor, it receives an initial credit allocation from the pool:

```sql
CREATE TABLE agent_credits (
  agent_id     TEXT NOT NULL,
  harbor_name  TEXT NOT NULL REFERENCES harbors(name) ON DELETE CASCADE,
  balance      INTEGER NOT NULL DEFAULT 0,
  earned       INTEGER NOT NULL DEFAULT 0,   -- lifetime earnings
  spent        INTEGER NOT NULL DEFAULT 0,   -- lifetime spending
  PRIMARY KEY (agent_id, harbor_name)
);
```

Credit allocation on harbor entry:
- Default: 1,000 credits per agent (configurable per harbor)
- Credits come from the harbor pool (pool decreases)
- If pool is depleted, new agents get 0 credits (they must earn by doing work)

### Escrow

When an agent creates an anchor with a bounty, the credits are escrowed:

```bash
pd anchor create \
  --task "Fix auth bug" \
  --bounty 500 \
  --criteria "Tests pass"

# → Credits: 1000 → 500 (500 escrowed for anch_7f3k92)
```

```sql
CREATE TABLE escrow (
  anchor_id    TEXT PRIMARY KEY REFERENCES anchors(id) ON DELETE CASCADE,
  amount       INTEGER NOT NULL,
  from_agent   TEXT NOT NULL,
  harbor_name  TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'held',  -- held, released, refunded
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Escrow state transitions:
- **held:** Credits locked, anchor in OPEN or ACTIVE state
- **released:** Anchor VERIFIED, credits transferred to worker
- **refunded:** Anchor ABANDONED with no worker, credits returned to requester

All escrow operations use `BEGIN EXCLUSIVE` transactions. Double-spend is impossible
because the balance check and deduction are atomic.

### Settlement

When an anchor reaches VERIFIED:

```sql
BEGIN EXCLUSIVE;
  -- Debit escrow
  UPDATE escrow SET status = 'released' WHERE anchor_id = ?;
  -- Credit worker
  UPDATE agent_credits SET balance = balance + ?, earned = earned + ?
    WHERE agent_id = ? AND harbor_name = ?;
  -- Record in activity log
  INSERT INTO activity (type, details) VALUES ('credit_settlement', ...);
COMMIT;
```

The receipt (Layer 2) includes the credit amount settled, providing an audit trail.

### Dispute Resolution (Simple)

If the requester believes the work is incomplete:

```bash
pd anchor dispute anch_7f3k92 --reason "Tests still failing on CI"
# → Anchor anch_7f3k92: COMPLETED → DISPUTED
# → Escrow remains held
# → Both agents notified via pub/sub
```

Dispute resolution is manual: the agents communicate (via notes or pub/sub) and
one of them resolves it:

```bash
pd anchor resolve anch_7f3k92 --release    # worker gets credits
pd anchor resolve anch_7f3k92 --refund     # requester gets credits back
pd anchor resolve anch_7f3k92 --split 60   # 60% to worker, 40% refunded
```

There is no automated dispute resolution. For local agent swarms, the human
operator is the ultimate arbiter. The dispute mechanism exists to prevent
auto-settlement when quality is unclear.

### CLI Commands (Credit Extensions)

```bash
pd credits                                 # show my balance in current harbor
pd credits --harbor myapp                  # specific harbor
pd credits transfer <agent-id> 200         # send credits to another agent
pd credits history                         # transaction log

pd anchor create --bounty 500 ...          # create with credit bounty
pd anchor bid <id> --ask 400               # bid on open anchor (less than bounty)
```

### API Endpoints (Credit Extensions)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/credits` | GET | Get current agent's balance |
| `/credits/transfer` | POST | Transfer credits between agents |
| `/credits/history` | GET | Transaction history |
| `/anchors/:id/bid` | POST | Bid on open anchor |
| `/anchors/:id/dispute` | POST | Dispute completed anchor |
| `/anchors/:id/resolve` | POST | Resolve dispute |

## Layer 3b: Marketplace & Coordination Tax (V4.3+)

**Prerequisite:** Credits (V4.2) and lighthouse relay (V4.3) must be working.
The marketplace is a cross-harbor, cross-machine feature.

### The Marketplace

The marketplace is where agents from different harbors can post and bid on tasks:

```bash
pd marketplace list                        # browse open tasks across harbors
pd marketplace post anch_7f3k92            # make local anchor visible on marketplace
pd marketplace bid <anchor-id> --ask 400   # bid from another harbor
```

The lighthouse relay (`relay.portdaddy.dev`) acts as the marketplace broker.
Tasks are advertised via the relay, and bids are routed back to the originating daemon.

### Coordination Tax

Port Daddy takes a **15% coordination tax** on marketplace settlements
(cross-harbor credit transfers). This is the revenue model for the relay service:

```
Worker completes task worth 500 credits
→ Worker receives 425 credits (85%)
→ Port Daddy receives 75 credits (15%)
→ Port Daddy credits convert to real revenue via Pro/Team subscription billing
```

The coordination tax ONLY applies to cross-harbor, relay-mediated settlements.
Local settlements (same harbor, same machine) are tax-free. This incentivizes
local-first coordination while monetizing the relay infrastructure.

### Credit-to-Currency Bridge (V5.0)

Credits start as internal coordination signals. In V5.0, Pro/Team customers can
optionally attach real bounties:

```bash
pd anchor create --task "..." --bounty-usd 50.00
# → Requires Pro subscription
# → Stripe hold on requester's payment method
# → Settlement via Stripe Connect to worker's account
```

This is the bridge from coordination credits to real money. It's explicitly V5.0
because it requires:
- Payment processing infrastructure (Stripe Connect)
- Legal/compliance review
- Tax reporting (1099 for US workers)
- Fraud detection
- All of which are orthogonal to the coordination problem Port Daddy solves

### What Credits Are NOT

- **Not cryptocurrency.** No blockchain, no mining, no speculation. Credits are
  database integers in SQLite.
- **Not mandatory.** Anchors work without credits. `--bounty` is optional. The
  task lifecycle (Layer 1) is fully functional without the economy (Layer 3).
- **Not transferable outside Port Daddy.** Credits have no external value until
  the V5.0 currency bridge.
- **Not a reputation system.** Agent reputation is tracked separately (lifetime
  earned/spent ratio, completion rate). Credits are a medium of exchange, not
  a trust signal.

## Files to Create

| File | Layer | When |
|------|-------|------|
| `lib/anchors.ts` | 1 | V4.1 |
| `routes/anchors.ts` | 1 | V4.1 |
| `cli/commands/anchors.ts` | 1 | V4.1 |
| `tests/unit/anchors.test.js` | 1 | V4.1 |
| `lib/receipts.ts` | 2 | V4.2 |
| `lib/credits.ts` | 3 | V4.2 |
| `routes/credits.ts` | 3 | V4.2 |
| `cli/commands/credits.ts` | 3 | V4.2 |
| `tests/unit/credits.test.js` | 3 | V4.2 |
| `lib/marketplace.ts` | 3b | V4.3 |
| `routes/marketplace.ts` | 3b | V4.3 |

## ADR-0017: Anchor Protocol and Credit Economy

**Status:** Proposed
**Context:** Sessions and notes provide unstructured agent journaling. The Anchor
Protocol adds structured task lifecycle, verifiable evidence chains, and an optional
credit economy for cross-harbor coordination.
**Decision:** Three-layer architecture: task lifecycle (V4.1), bilateral receipts
(V4.2), credit economy (V4.2+). Credits are internal coordination signals, not
cryptocurrency. Marketplace and coordination tax require working remote harbors.
**Consequences:** Additional schema tables (anchors, anchor_log, escrow,
agent_credits). Credit economy adds complexity but enables cross-machine task
coordination and creates a revenue path via coordination tax. Economy layers are
optional — the task lifecycle works without credits.

---
---

# Consolidated Execution Timeline (Revised)

| Phase | What | When | Revenue |
|-------|------|------|---------|
| **V4.0** | Harbor enforcement, auto-harbor on begin, capability delegation, grace period | Q2 2026 | — |
| **V4.0** | Semantic trie for token namespace resolution (Part VII) | Q2 2026 | — |
| **V4.0** | Socket-first transport: msgpack over Unix domain socket (Part VIII) | Q2 2026 | — |
| **V4.0** | Semantic regions: code boundary claims (Part XIV) | Q2 2026 | — |
| **V4.0** | Stigmergy: pheromone deposition, decay, 6 pheromone types (Part XV) | Q2 2026 | — |
| **V4.0** | MCP server: harbor tools (8), enhanced spawn tools (Part X) | Q2 2026 | — |
| **V4.0** | Hash-chained session notes (Part XXVI) | Q2 2026 | — |
| **V4.0** | Filesystem heartbeat watchdog — Bosun pattern (Part XXVI) | Q2 2026 | — |
| **V4.0** | Harbor bitmask optimization in trie (Part XXVI) | Q2 2026 | — |
| **V4.0** | `pd self-test` basic checks (Part XXVI) | Q2 2026 | — |
| **V4.0** | T4 hard invariant: harbor scope isolation test (Part XXVI) | Q2 2026 | — |
| **V4.0** | Migration runner, schema v1-v6 (incl. agent identity columns, prev_hash), backup-before-migrate | Q2 2026 | — |
| **V4.0** | Key management (file-based storage, rotation, JTI cleanup) | Q2 2026 | — |
| **V4.0** | Structured logging (pino), debug facilities, bugreport command | Q2 2026 | — |
| **V4.0** | Error catalog (PD-E001+), CLI help tiers, first-run experience | Q2 2026 | — |
| **V4.0** | GitHub link fix, OG tags, website copy updates, broken link CI (Part IV) | Q2 2026 | — |
| **V4.0** | ADR-0011 through ADR-0016, white paper V2 with HLC/stigmergy content (Part VI) | Q2 2026 | — |
| **V4.0** | 2 template apps (code-review, cross-machine) | Q2 2026 | — |
| **V4.0** | `pd teach` for Claude Code, Cursor, Windsurf | Q2 2026 | — |
| **V4.0** | `llms.txt` generation and serving | Q2 2026 | — |
| **V4.0** | Opt-in anonymous telemetry | Q2 2026 | — |
| **V4.0** | GitHub Action (curiositech/port-daddy-action) | Q2 2026 | — |
| **V4.0** | CONTRIBUTING.md | Q2 2026 | — |
| **V4.1** | Windows support via platform adapter | Q3 2026 | User base growth |
| **V4.1** | Lazy token promotion for trie (Part XXVI) | Q3 2026 | — |
| **V4.1** | Two-tier scheduler: critical vs batched operations (Part XXVI) | Q3 2026 | — |
| **V4.1** | T1/T2/T3/T5 hard invariants + benchmark CI (Part XXVI) | Q3 2026 | — |
| **V4.1** | `pd self-test --adversarial` (Part XXVI) | Q3 2026 | — |
| **V4.1** | SDDL security descriptor for Windows named pipes (Part XXVI) | Q3 2026 | — |
| **V4.1** | Remote harbors: WebSocket sync, HLC, LWW + counter/log CRDTs (Parts XIII, XVII) | Q3 2026 | — |
| **V4.1** | MCP server: remote harbor tools (5) (Part X) | Q3 2026 | — |
| **V4.1** | Trust tier enforcement for remote harbors (Part XII) | Q3 2026 | — |
| **V4.1** | mDNS discovery (LAN, opt-in, hashed names) | Q3 2026 | — |
| **V4.1** | HMAC → Ed25519 migration | Q3 2026 | — |
| **V4.1** | Dashboard v1 (Web Components, 6 panels: Services, Agents, Sessions, Harbors, Activity, Health) | Q3 2026 | — |
| **V4.1** | Anchor Protocol Layer 1: structured task lifecycle (Part XXVII) | Q3 2026 | — |
| **V4.1** | 1 additional template (feature-sprint) | Q3 2026 | — |
| **V4.2** | Anchor Protocol Layer 2: bilateral receipts for DR (Part XXVII) | Q4 2026 | — |
| **V4.2** | Anchor Protocol Layer 3: credits, escrow, settlement (Part XXVII) | Q4 2026 | — |
| **V4.2** | portdaddy.dev lighthouse, API versioning (header-based) | Q4 2026 | — |
| **V4.2** | Pro tier launch ($14/seat), license key system | Q4 2026 | First revenue |
| **V4.2** | Blog content pipeline (5 posts) | Q4 2026 | SEO traffic |
| **V4.2** | Dashboard v2 (6 panels: Salvage, Locks, Messaging, Pheromone Heatmap, Metrics, Config) | Q4 2026 | — |
| **V4.2** | Storage lifecycle (archive, prune, vacuum automation) | Q4 2026 | — |
| **V4.3** | Anchor Protocol Layer 3b: marketplace + 15% coordination tax (Part XXVII) | Q1 2027 | Marketplace revenue |
| **V4.3** | Self-hosted lighthouse, Team tier ($39/team) | Q1 2027 | Team revenue |
| **V4.3** | Relay service at relay.portdaddy.dev | Q1 2027 | — |
| **V4.3** | arXiv preprint submission | Q1 2027 | Credibility |
| **V4.3** | Remaining templates (research-swarm, self-healing) | Q1 2027 | — |
| **V5.0** | Credit-to-currency bridge (Stripe Connect), real-money bounties | Q2 2027 | Transaction revenue |
| **V5.0** | Enterprise tier, cloud spawn, SAML/SSO | Q2 2027 | Enterprise revenue |

### Scope Risk: V4.0

V4.0 has 18 line items for Q2 2026. For a small team (or solo developer), this is
aggressive. The honest assessment:

**Must-ship for V4.0** (harbor enforcement is the thesis — everything else is optional):
- Harbor enforcement + grace period + auto-harbor on begin
- Migration runner + schema v1-v6 (including `prev_hash` column)
- Error catalog (PD-E001+) and first-run experience
- `pd teach` (primary distribution channel)
- Hash-chained session notes (10 lines of code, massive integrity value)
- `pd self-test` basic (user confidence from day one)

**Can slip to V4.0.1 or V4.1** without undermining the release:
- Structured logging (pino) — the existing console logging works for launch
- Key management — HMAC is sufficient until remote harbors ship in V4.1
- Website copy updates, OG tags — polish, not blocking
- `llms.txt`, telemetry, GitHub Action — nice-to-have
- Filesystem heartbeat watchdog — valuable but HTTP heartbeats work for launch
- Harbor bitmask in trie — optimization, not correctness

**Mitigation:** Treat V4.0 as a 2-month release with a hard cut date. Anything not
done by cut date ships in V4.0.1. Do not let scope creep delay the core harbor
enforcement launch.

---
---

# Part XXVIII: Harbor Gap Analysis — Twelve Unsolved Problems

## Preamble

Parts I–XXVII design a harbor-first architecture where daemons sync coordination
state across machines. But the plan has structural gaps — questions that users will
hit the moment they try to do anything beyond "two machines on a LAN sharing file
claims." This Part identifies twelve gaps, proposes solutions for each, and
establishes three new sub-protocols: **Harbor File Protocol** (HFP), **Departure
Protocol**, and **Harbor Co-op Governance**.

---

## Gap 1: File Transport Layer — `harbor.json` Offers Files, But How?

### The Problem

The harbor.json spec declares:
```json
"offers": { "files": ["src/auth/**", "src/api/**"] }
```

But the sync protocol (Part XVII) syncs *metadata* — agents, sessions, locks,
pheromones, harbor_kv. File claims are advisory ("I intend to edit src/auth.ts"),
not a transport mechanism. There is no way for a remote agent to actually *read*
the contents of `src/auth/jwt.ts` from the offering daemon.

### Proposed Solution: Harbor File Protocol (HFP)

Three-layer design:

#### Layer 1: File Manifest (Syncs Automatically)

The sync protocol (Part XVII) gets a 6th Merkle bucket: `file_manifest`.

```sql
CREATE TABLE harbor_file_manifest (
  harbor_name  TEXT NOT NULL REFERENCES harbors(name) ON DELETE CASCADE,
  file_path    TEXT NOT NULL,
  content_hash TEXT NOT NULL,     -- sha256 of file content
  size_bytes   INTEGER NOT NULL,
  modified_at  TEXT NOT NULL,
  hlc_physical INTEGER,          -- HLC columns for sync
  hlc_counter  INTEGER,
  hlc_node     TEXT,
  PRIMARY KEY (harbor_name, file_path)
);
```

The offering daemon watches files matching `offers.files` globs (via `fs.watch` or
`chokidar` for recursive watching). On change:
1. Recompute content hash
2. Update `harbor_file_manifest` row
3. Merkle bucket for `file_manifest` updates
4. Sync protocol propagates the hash change to connected peers

This is metadata only — hashes and sizes, not content. The manifest for 10,000
files is ~500KB. It syncs cheaply.

#### Layer 2: Content Fetch (On Demand)

New WebSocket frame types in the sync channel:

```typescript
// Request (consumer → provider)
interface FileRequest {
  type: 'file-fetch';
  path: string;           // e.g., "src/auth/jwt.ts"
  harbor: string;         // harbor name
  expectedHash?: string;  // optional — skip if cached hash matches
}

// Response (provider → consumer)
interface FileResponse {
  type: 'file-content';
  path: string;
  hash: string;           // sha256 of content
  content: Buffer;        // raw bytes
  truncated: boolean;     // true if file exceeds 10MB limit
}

// Cache hit response (provider → consumer)
interface FileUnchanged {
  type: 'file-unchanged';
  path: string;
  hash: string;           // confirms hash still matches
}
```

The providing daemon enforces glob checks on every request:
1. Parse `path` against `offers.files` globs from harbor.json
2. If path not covered by any glob → reject with `file-access-denied`
3. If path matches → read from disk, hash, serve

Content-addressed caching on the consumer side:
- Files cached in `~/.port-daddy/file-cache/<harbor>/<hash>/`
- Cache key is content hash, not path (same content at different paths = one cache entry)
- Cache eviction: LRU, 500MB default cap, configurable via `pd config set file-cache-limit`

#### Layer 3: Access Modes

The harbor.json `offers` section declares the access mode:

```json
"offers": {
  "files": ["src/auth/**", "src/api/**"],
  "file_access": "read-only"
}
```

Three modes:

| Mode | Behavior | Use Case |
|------|----------|----------|
| `read-only` (default) | Consumer can fetch, not write. Changes go through anchors or external PRs. | Cross-team collaboration, security audits |
| `copy-on-write` | Consumer gets copy, edits locally, submits diff back as `file-changeset` frame. Provider shows changeset in review queue. | Tandem vibe coding with review gate |
| `direct-write` | Writes proxy through sync channel, provider applies to disk. Requires `full` trust tier AND explicit opt-in. | Pair programming with full trust |

Copy-on-write changesets:

```typescript
interface FileChangeset {
  type: 'file-changeset';
  harbor: string;
  agent: string;
  anchor_id?: string;       // link to anchor if applicable
  changes: Array<{
    path: string;
    original_hash: string;  // hash at time of read
    patch: string;          // unified diff
  }>;
  message: string;          // "Fixed JWT expiry logic"
}
```

Provider daemon receives changeset → stores in `harbor_changesets` table →
surfaces in dashboard review queue → provider approves/rejects.

#### CLI Surface

```bash
pd fs list myapp:src/auth/         # list files in remote harbor
pd fs read myapp:src/auth/jwt.ts   # fetch file content (cached)
pd fs diff myapp:src/auth/jwt.ts   # diff remote vs local (if both exist)
pd fs submit myapp --message "..."  # submit changeset (copy-on-write mode)
pd fs review                        # review incoming changesets
pd fs accept <changeset-id>         # apply changeset
pd fs reject <changeset-id>         # reject changeset
```

#### Integration with Token Namespace

Files live in the trie:
```
myapp:files:src/auth/jwt.ts        → address a specific file
myapp:files:src/auth/*             → glob query
myapp:files:manifest               → the manifest metadata
myapp:changesets:<id>              → a pending changeset
```

`pd query myapp:files:src/auth/*` returns file manifest entries. The trie
resolves `myapp` to local-or-remote, `files` to the HFP layer, and the path
is either a disk read or a sync-channel fetch.

#### DAG Position

HFP depends on:
- Part XVII (sync protocol for manifest bucket + WebSocket frame types)
- Part I (harbor enforcement — glob checks use harbor card capabilities)
- Part XII (trust tiers — `direct-write` requires `full` trust)

New LOE: ~600 lines (`lib/harbor-files.ts`, `routes/harbor-files.ts`, CLI commands)

---

## Gap 2: Departure Protocol — Taking Work Home

### The Problem

Bob connects to Alice's harbor. Bob's agents read files, write notes, complete
anchors, build local context. Then Bob disconnects (`pd harbor disconnect`).
What happens to Bob's work?

The current plan says: disconnected. State stays in the harbor. If Bob reconnects
later, his notes are still there. But what if Bob never reconnects? What if Bob
needs to reference that work on his local machine, offline?

### Proposed Solution: The Departure Manifest

When an agent or peer disconnects from a harbor, the daemon produces a **departure
manifest** — a self-contained archive of everything that agent contributed plus
everything it needs to continue working independently.

```bash
pd harbor depart myapp --reason "switching to local development"
# → Generating departure manifest...
# → Bundled: 3 sessions, 47 notes, 2 anchors, 12 file claims
# → Cached files: 8 files (142KB) from offers.files
# → Manifest: ~/.port-daddy/departures/myapp-2026-03-16T14:30:00Z.json
# → You can continue working locally. Reconnect anytime to sync back.
```

#### What the Manifest Contains

```typescript
interface DepartureManifest {
  version: 1;
  harbor: string;
  peer_id: string;
  departed_at: string;           // ISO 8601
  reason?: string;

  // Everything this agent contributed
  contributions: {
    sessions: Session[];         // full session objects with notes
    anchors: Anchor[];           // with evidence logs
    file_claims: FileClaim[];    // advisory claims made
    kv_entries: KVEntry[];       // harbor KV entries written by this agent
    pheromones: Pheromone[];     // pheromones deposited
    messages: Message[];         // pub/sub messages published
  };

  // Everything this agent consumed (for offline reference)
  context: {
    file_cache: FileRef[];       // content-hash refs to cached files
    other_sessions: Session[];   // sessions this agent read (not wrote)
    other_notes: Note[];         // notes this agent was mentioned in
    harbor_state_snapshot: {     // point-in-time state
      agents: Agent[];
      active_anchors: Anchor[];
      open_locks: Lock[];
    };
  };

  // Reconnection info
  reconnect: {
    harbor_name: string;
    lighthouse_url?: string;     // for easy reconnection
    peer_pubkey: string;         // Ed25519 public key of harbor owner
    last_merkle_root: string;    // for delta sync on reconnect
  };
}
```

#### Reconnection is a Delta Sync

The departure manifest stores `last_merkle_root`. When Bob reconnects:
1. Exchange Merkle roots (Part XVII HASH_EXCHANGE state)
2. Bob's daemon has the departure root → only diffs since departure sync
3. Bob's local changes (sessions continued offline) merge via conflict resolver
4. Result: seamless continuation as if the connection never dropped

#### Graceful vs. Ungraceful Departure

| Type | Trigger | Manifest? | State |
|------|---------|-----------|-------|
| **Graceful** | `pd harbor depart` | Yes, generated and stored | Clean exit, Merkle root saved |
| **Timeout** | No heartbeat for 1 hour | Auto-generated on provider side | Agent marked stale, enters salvage queue |
| **Crash** | Process dies | None generated | Salvage takes over (existing Part VIII pattern) |

For timeout departures, the providing daemon auto-generates a departure manifest
and holds it for 7 days. If the peer reconnects within 7 days, it gets the manifest
for delta sync. After 7 days, full sync required.

#### What About Intellectual Property?

The departure manifest bundles files that the departed agent cached. This is
intentional — if you offered files to a harbor, you accepted that connected peers
would read them. The departure manifest doesn't grant *new* access; it preserves
access that already existed during the session.

For sensitive harbors, the harbor.json can declare:

```json
"departure_policy": {
  "allow_file_cache_export": false,  // files purged on disconnect
  "allow_context_export": true,      // notes/sessions exportable
  "manifest_retention": "24h"        // auto-delete manifests after 24h
}
```

---

## Gap 3: Tunnels In and Out of Harbors

### The Problem

Port Daddy already has tunnels (`pd tunnel start <service>` → creates a cloudflare/
ngrok tunnel). But the plan never connects tunnels to harbors. Questions:

1. If Alice creates a tunnel for `myapp:api:main`, do Bob's agents (in the same
   harbor) get the tunnel URL?
2. Can Bob's agents create tunnels on Alice's machine?
3. Can a harbor *require* that certain services have tunnels?

### Proposed Solution: Harbor-Scoped Tunnel Propagation

#### Tunnel URLs Sync Through the Harbor

When a tunnel is created for a service in a harbor, the tunnel URL is stored in
harbor KV and syncs to all peers:

```
Key:   myapp:tunnels:api:main
Value: { url: "https://abc123.trycloudflare.com", provider: "cloudflare",
         created_by: "alice-macbook", port: 3001 }
```

This means Bob's agents automatically know the public URL for Alice's API. They
don't need to create their own tunnel — they use Alice's.

#### Remote Tunnel Requests

Bob's agent can *request* a tunnel on Alice's machine via the harbor protocol:

```bash
pd tunnel request myapp:api:main --provider cloudflare
# → Sent tunnel request to alice-macbook (harbor owner)
# → Waiting for approval...
# → Tunnel created: https://abc123.trycloudflare.com
```

This sends a `tunnel-request` frame over the sync channel. Alice's daemon can
auto-approve (if configured) or queue for manual approval.

```json
// harbor.json
"offers": {
  "tunnels": {
    "auto_approve": true,        // or false for manual approval
    "providers": ["cloudflare"], // allowed providers
    "max_concurrent": 3          // limit tunnel count
  }
}
```

#### Tunnel Requirements

A harbor can declare that certain services MUST be tunneled:

```json
// harbor.json
"requires": {
  "tunnels": ["api:main", "web:dev"]
}
```

When Bob enters the harbor, his daemon checks if `api:main` and `web:dev` have
active tunnels. If not, the CLI warns:

```
⚠️ Harbor myapp requires tunnels for: api:main, web:dev
Run: pd tunnel start myapp:api:main
```

#### Harbor-Internal vs External Tunnels

Distinguish between:
- **Internal tunnels**: Expose a service to other harbor members (via harbor sync).
  No public URL needed — the sync channel IS the transport.
- **External tunnels**: Expose a service to the internet (cloudflare/ngrok).
  Needed for webhooks, mobile testing, third-party integrations.

For internal access between harbor peers, the daemon can proxy requests through
the sync channel without needing a public tunnel at all:

```
Bob's agent → Bob's daemon → [sync channel] → Alice's daemon → Alice's :3001
```

This is a reverse proxy through the harbor. No cloudflare needed. The sync
channel already has an authenticated WebSocket — just add HTTP proxying frames.

New frame type:
```typescript
interface HarborProxyRequest {
  type: 'proxy-request';
  service: string;     // "api:main"
  method: string;      // "GET"
  path: string;        // "/api/users"
  headers: Record<string, string>;
  body?: Buffer;
}

interface HarborProxyResponse {
  type: 'proxy-response';
  status: number;
  headers: Record<string, string>;
  body?: Buffer;
}
```

This effectively gives every harbor an internal service mesh for free.

---

## Gap 4: Salvage Across Remote Harbors

### The Problem

Agent-A runs on Alice's machine in the `myapp` harbor. Agent-A dies. The existing
salvage protocol puts Agent-A in the resurrection queue. But:

1. Can Bob's agents on a different machine claim the salvage?
2. Does the salvage include context from the remote harbor (files, notes)?
3. What if Agent-A had open anchors with files on Alice's machine?

### Proposed Solution: Cross-Peer Salvage

#### Salvage State Syncs Through the Harbor

The `resurrection_queue` table already syncs as part of the `agents` Merkle bucket
(Part XVII). When Agent-A dies on Alice's machine, all connected peers see it in
`pd salvage`. No change needed for visibility.

#### Cross-Peer Claiming

When Bob's agent runs `pd salvage claim agent-A`:

1. Bob's daemon sends a `salvage-claim` frame to Alice's daemon
2. Alice's daemon verifies Bob's agent has sufficient capabilities (harbor card)
3. Claim is recorded on BOTH daemons (conflict resolution: first-writer-wins by HLC)
4. Bob's agent receives:
   - The departure manifest for Agent-A (same format as Gap 2)
   - All anchor context (task definitions, evidence logs, criteria)
   - File manifest for any files Agent-A had claimed

5. If Agent-A had files from Alice's `offers.files`:
   - Bob's agent can fetch them via HFP (Gap 1)
   - Files are pre-authorized because Agent-A had access, and Bob is inheriting

#### Salvage Hint on Harbor Entry

When any agent enters a harbor with pending salvage:

```
⚓ Entered harbor: myapp
⚠️ 2 dead agent(s) in this harbor:
   agent-a4f2 (alice-macbook) — died 15m ago, 1 active anchor
   agent-c7e1 (alice-macbook) — died 2h ago, session only
Run: pd salvage --harbor myapp
```

This already exists conceptually in the "Context-Aware Salvage" feature (CLAUDE.md)
but needs to work cross-peer.

#### Anchor Continuity

When Bob's agent claims Agent-A's salvage that includes anchors:
1. Anchor status: ABANDONED → ACTIVE (re-assigned to Bob's agent)
2. Anchor files: re-claimed by Bob's agent
3. Evidence log: new entry: `"Salvaged from agent-a4f2 by agent-b3c1 (cross-peer)"`
4. Bob can fetch the actual files via HFP to continue the work

This means anchors are truly portable across machines. The work follows the task,
not the machine.

---

## Gap 5: Always-On Requirements for Remote Harbors

### The Problem

Port Daddy assumes an always-on daemon (`launchd` service on macOS). But remote
harbors create new assumptions:

1. Alice closes her laptop lid. Bob's agents lose the harbor.
2. Alice's machine reboots for an OS update. 30 minutes of downtime.
3. Alice is on flaky WiFi. Connection drops every 10 minutes.

The plan has partition detection (Part XVII: no pong for 1 hour → partition
detected), but no strategy for what agents DO during the partition.

### Proposed Solution: Harbor Resilience Tiers

#### Tier 1: Best-Effort (Default)

Connection drops → agents operate on cached state. When connection resumes,
delta sync reconciles. This is what Part XVII already provides. Good enough for
most LAN setups.

During partition:
- Local reads from cache continue working
- Local writes (notes, KV) queue and sync later
- File fetches from cache hit → succeed; cache miss → fail gracefully
- Pheromones decay locally on schedule (may diverge, reconciles on reconnect)

#### Tier 2: Resilient (Lighthouse Relay)

For setups that need higher availability, the lighthouse acts as a store-and-forward
relay, not just a phone book:

```json
// harbor.json
"resilience": {
  "tier": "resilient",
  "relay": "relay.portdaddy.dev",
  "buffer_hours": 24
}
```

When Alice goes offline:
1. Bob's daemon detects disconnect
2. Switches to relay mode: mutations are sent to the relay
3. Relay buffers mutations for up to 24 hours
4. Alice comes back → relay flushes buffered mutations → delta sync

The relay stores only encrypted sync frames (harbor-card-signed). The relay
operator cannot read the content. This is the "mailbox" pattern.

**New component:** `relay.portdaddy.dev` — a lightweight service that accepts
WebSocket connections and buffers frames between peers. ~400 lines. Could be
a Cloudflare Durable Object for zero-ops deployment.

#### Tier 3: Federated (Multi-Provider)

For critical harbors, designate multiple providers:

```json
"providers": [
  { "id": "alice-macbook", "role": "primary" },
  { "id": "alice-desktop", "role": "replica" },
  { "id": "bob-workstation", "role": "replica" }
]
```

If the primary goes down, a replica promotes to primary. File manifests are
replicated across providers so file fetches continue working even if the
original provider is offline.

This is the distributed systems rabbit hole. Probably V4.3+ territory.
For V4.0-V4.2, Tiers 1 and 2 are sufficient.

---

## Gap 6: `harbor.json` Formal Specification

### The Problem

The plan references harbor.json in passing but never fully specifies it.
What are all the fields? How is it discovered? What's the lifecycle?

### Proposed Specification

```json
{
  "$schema": "https://portdaddy.dev/schemas/lighthouse.v1.json",
  "version": 1,
  "harbor": "myapp",
  "owner": "alice",

  "listen": {
    "addr": "0.0.0.0",
    "port": 9877,
    "protocol": "wss"
  },

  "discovery": {
    "mdns": true,
    "lighthouse_url": "https://registry.portdaddy.dev",
    "advertise_name": "myapp@alice"
  },

  "offers": {
    "agents": true,
    "compute": false,
    "memory": true,
    "files": ["src/auth/**", "src/api/**", "tests/**"],
    "file_access": "copy-on-write",
    "tunnels": {
      "auto_approve": true,
      "providers": ["cloudflare"],
      "max_concurrent": 3
    }
  },

  "requires": {
    "trust_tier": "coordinated",
    "harbor_card_algorithm": "HS256",
    "tunnels": []
  },

  "limits": {
    "max_peers": 10,
    "max_agents_per_peer": 5,
    "file_cache_limit_mb": 500,
    "bandwidth_limit_mbps": 50
  },

  "departure_policy": {
    "allow_file_cache_export": true,
    "allow_context_export": true,
    "manifest_retention": "7d",
    "graceful_disconnect_timeout": "5m"
  },

  "resilience": {
    "tier": "best-effort",
    "relay": null,
    "buffer_hours": 0
  },

  "identity": {
    "pubkey": "ed25519:base64...",
    "daemon_version": "4.0.0"
  }
}
```

#### Lifecycle

1. Created by `pd harbor create myapp --remote` → generates `harbor.json`
   in the project root (or `~/.port-daddy/harbors/myapp/harbor.json`)
2. Editable by the harbor owner (directly or via `pd harbor config myapp`)
3. Served at `GET /harbor/:name/harbor.json` (public, no auth required)
4. Synced to connected peers as part of harbor metadata
5. Changes trigger a `harbor-config-update` frame on the sync channel

#### Discovery

When `pd harbor connect myapp` runs without explicit flags:
1. Check `./harbor.json` in the current directory
2. Check `~/.port-daddy/harbors/myapp/harbor.json` (cached from previous connection)
3. mDNS browse for `_portdaddy._tcp.local.` with TXT `harbor=myapp`
4. Query `registry.portdaddy.dev/lookup?harbor=myapp`
5. Fail with helpful message

---

## Gap 7: Harbor Co-op Governance

### The Problem

The plan assumes harbors have a single owner (the daemon that created it). But
real collaboration needs shared governance:

1. Who can invite new members?
2. Who can evict misbehaving agents?
3. Who can change harbor.json settings?
4. What if the owner goes offline permanently?

### Proposed Solution: Three Governance Models

#### Model 1: Dictator (Default)

One daemon owns the harbor. All authority flows from the owner.
- Only owner can invite/evict
- Only owner can modify harbor.json
- If owner goes offline, harbor degrades to cached state

This is the simplest model and covers 90% of use cases (one developer with
multiple machines, or a team lead hosting for the team).

#### Model 2: Council

Multiple daemons share governance. Stored in harbor.json:

```json
"governance": {
  "model": "council",
  "members": [
    { "id": "alice-macbook", "role": "admin" },
    { "id": "bob-desktop", "role": "admin" },
    { "id": "carol-laptop", "role": "member" }
  ],
  "quorum": 2
}
```

Admin actions (invite, evict, config change) require quorum agreement.
Implemented as a simple vote: admin proposes action via `harbor-governance`
frame → other admins approve/reject → action executes when quorum reached.

No blockchain, no consensus protocol. Just a voting table:

```sql
CREATE TABLE harbor_votes (
  id           TEXT PRIMARY KEY,
  harbor_name  TEXT NOT NULL,
  action       TEXT NOT NULL,       -- 'invite', 'evict', 'config-change'
  payload      TEXT NOT NULL,       -- JSON details
  proposed_by  TEXT NOT NULL,
  votes_for    TEXT DEFAULT '[]',   -- JSON array of daemon IDs
  votes_against TEXT DEFAULT '[]',
  status       TEXT DEFAULT 'pending', -- pending, approved, rejected, expired
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL        -- votes expire after 24h
);
```

#### Model 3: Open (Trust Network)

Any member with sufficient trust tier can invite others. No explicit governance.
The trust tier IS the governance:

```json
"governance": {
  "model": "open",
  "invite_tier": "coordinated",  // minimum trust to invite
  "evict_tier": "full"           // minimum trust to evict
}
```

This is the "co-op" model — good for open source projects where anyone
trusted enough to contribute can also bring in collaborators.

---

## Gap 8: Tandem Vibe Coding — The Killer App

### The Problem

The plan treats harbors as coordination infrastructure. But the actual use case
that will make people CARE is **tandem vibe coding**: two developers, each with
their own AI agents, working on the same codebase simultaneously with real-time
awareness of each other's work.

This is not in the plan. It should be the banner feature.

### What Tandem Vibe Coding Looks Like

```
┌─── Alice's Machine ────────────────────────────────────────┐
│                                                             │
│  Claude agent-a: "Building JWT auth in src/auth/jwt.ts"     │
│  ├── Session: active, 12 notes                              │
│  ├── File claims: src/auth/jwt.ts, src/auth/middleware.ts   │
│  ├── Anchor: anch_7f3k "Implement JWT refresh tokens"       │
│  └── Pheromone trail: hot on src/auth/**                    │
│                                                             │
└────────────────────────── harbor: myapp ────────────────────┘
                                │
                         sync channel (WS)
                                │
┌─── Bob's Machine ──────────────────────────────────────────┐
│                                                             │
│  Cursor agent-b: "Building login UI in src/pages/login.tsx" │
│  ├── Session: active, 8 notes                               │
│  ├── File claims: src/pages/login.tsx, src/api/auth.ts      │
│  ├── Anchor: anch_9d2m "Login page with OAuth buttons"      │
│  └── Pheromone trail: hot on src/pages/**                   │
│                                                             │
│  ┌── What Bob's agent SEES from Alice's harbor ──────────┐  │
│  │ 🔥 src/auth/** is HOT (pheromone: 0.87)               │  │
│  │ 🔒 src/auth/jwt.ts claimed by agent-a                 │  │
│  │ 📋 Anchor anch_7f3k: "JWT refresh tokens" — ACTIVE    │  │
│  │ 📝 Latest note: "JWT rotation working, adding tests"  │  │
│  │ 📄 Can read src/auth/jwt.ts via HFP (copy-on-write)   │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                             │
│  Bob's agent decides:                                       │
│  "Auth module is in flux. I'll code against the INTERFACE   │
│   (reading jwt.ts via HFP) but not modify auth files.       │
│   My login page will call the auth API once Alice finishes." │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### The Five Primitives That Enable This

1. **File claims** (existing) → prevents collision
2. **Pheromones** (Part XV) → ambient awareness of activity hotspots
3. **HFP** (Gap 1) → read remote files to code against interfaces
4. **Anchors** (Part XXVII) → structured task visibility
5. **Pub/sub** (existing) → real-time event notifications

### What's Missing: The Awareness Layer

The primitives exist but there's no unified "awareness" that an AI agent can
consume. Each agent needs to understand, in one API call:

```bash
pd awareness
# → Harbor: myapp (2 peers connected)
# → Active agents: 2
# →
# → HOT ZONES (pheromone heat > 0.5):
# →   src/auth/**     heat: 0.87  claimed by: agent-a (alice-macbook)
# →   src/pages/**    heat: 0.65  claimed by: agent-b (bob-desktop)
# →
# → ACTIVE ANCHORS:
# →   anch_7f3k  "JWT refresh tokens"     → agent-a  ACTIVE
# →   anch_9d2m  "Login page + OAuth"     → agent-b  ACTIVE
# →
# → FILE CONFLICTS: none
# → RECENT EVENTS (last 5m):
# →   agent-a noted: "JWT rotation working, adding tests"
# →   agent-b claimed: src/api/auth.ts
# →
# → SUGGESTIONS:
# →   src/api/auth.ts is claimed by BOTH agents — coordinate or split
```

This becomes an MCP tool: `harbor_awareness` — returns a structured snapshot
that the AI agent can reason about for task planning.

### Banner Feature: "Live Pair Programming for AI Agents"

Marketing framing: "Your Claude and their Cursor, in the same harbor, aware of
each other's work, avoiding conflicts automatically."

This is the feature that makes harbors tangible. Not "cryptographic capability
tokens" (true but boring). **Two AI agents pair-programming across machines.**

---

## Gap 9: Cross-Harbor Agent Mobility

### The Problem

An agent starts in the `myapp` harbor. It needs to consult a shared knowledge
base in the `team-kb` harbor. Currently, it would need to disconnect from one
and connect to the other. Can an agent be in multiple harbors?

### Proposed Solution: Multi-Harbor Membership

An agent can hold harbor cards for multiple harbors simultaneously. Each request
specifies which harbor it's operating in (via the `X-Harbor-Card` header).

```bash
pd harbor enter team-kb --cap kb:read
# → Now in 2 harbors: myapp (full), team-kb (kb:read only)

pd query team-kb:kb:auth-patterns
# → [reading from team-kb harbor]

pd note "Applied auth pattern from team-kb to our JWT module"
# → [note written to myapp harbor — determined by active session]
```

The agent's "primary" harbor is determined by its active session. Other harbors
are "auxiliary" — the agent can read from them but writes go to the primary.

This enables a knowledge-sharing pattern:
- `team-kb` harbor: shared engineering knowledge, read-only for most agents
- `myapp` harbor: active development, read-write for project agents
- An agent reads patterns from `team-kb`, applies them in `myapp`

---

## Gap 10: Data Sovereignty and Source of Truth

### The Problem

Two daemons sync bidirectionally. Both have copies of session notes, anchors, and
KV entries. Which one is the source of truth? If they diverge (partition), which
one wins?

The plan says "LWW by HLC" (last-writer-wins by Hybrid Logical Clock). But this
doesn't address the *semantic* question: who OWNS the data?

### Proposed Solution: Origin Tagging

Every piece of synchronized data gets an `origin_node` field:

```sql
ALTER TABLE sessions ADD COLUMN origin_node TEXT;        -- daemon that created it
ALTER TABLE session_notes ADD COLUMN origin_node TEXT;
ALTER TABLE harbor_kv ADD COLUMN origin_node TEXT;
ALTER TABLE anchors ADD COLUMN origin_node TEXT;
```

Rules:
1. **Creator owns**: The daemon that created a record is the origin
2. **Origin wins on conflict**: If two daemons modify the same record during a
   partition, the origin's version wins (not just latest-by-HLC)
3. **Non-origin can append, not overwrite**: Bob's daemon can add notes to Alice's
   session, but can't modify Alice's existing notes (they're immutable anyway)
4. **Deletes require origin**: Only the origin daemon can delete a record. Other
   daemons can request deletion via a `delete-request` frame.

This preserves data sovereignty: your data lives on your machine. Other machines
have replicas, but you're the authority.

---

## Gap 11: Bandwidth and Resource Limits

### The Problem

The plan has rate limiting for HTTP (100 req/min) but nothing for harbor sync.
A rogue peer could:
- Request every file in `offers.files` simultaneously (DoS via file fetch)
- Flood the sync channel with mutations
- Exhaust disk space with large KV entries or file changesets

### Proposed Solution: Harbor Resource Quotas

In harbor.json (already covered in Gap 6):

```json
"limits": {
  "max_peers": 10,
  "max_agents_per_peer": 5,
  "file_cache_limit_mb": 500,
  "bandwidth_limit_mbps": 50,
  "max_file_fetch_concurrent": 3,
  "max_file_size_mb": 10,
  "max_kv_entry_size_kb": 256,
  "max_changesets_pending": 20,
  "sync_frame_rate_limit": 100    // frames per second per peer
}
```

Enforcement happens at the providing daemon. Exceeded limits return
`rate-limited` frames with backoff instructions. The consuming daemon
backs off exponentially (same pattern as Part XVII reconnection).

---

## Gap 12: The `harbor.json` → Existing Tunnel Feature Bridge

### The Problem

Port Daddy already has `lib/tunnel.ts` with cloudflare/ngrok support. Part III
describes `pd lighthouse serve` for discovery. These were two unrelated features
that shared a name collision when the config was called `lighthouse.json`.

### Proposed Solution: Clean Separation

| Concept | What It Is | File |
|---------|-----------|------|
| **Tunnel** | Public URL for a local port (cloudflare/ngrok) | `lib/tunnel.ts` |
| **Lighthouse** | Discovery registry for harbor endpoints | `lib/lighthouse-server.ts` |
| **harbor.json** | Harbor configuration manifest | `lib/harbor-config.ts` |
| **Relay** | Store-and-forward buffer for offline peers | `lib/relay.ts` (new) |

**Decision: `harbor.json`.** No alternatives, no waffling. The maritime metaphor
makes it obvious:

| Concept | Metaphor | Name |
|---------|----------|------|
| Harbor configuration manifest | "Here are the rules" | `harbor.json` |
| Discovery registry | "I'm here, come find me" | Lighthouse |
| Public URL pipe | "Traffic flows through" | Tunnel |
| Store-and-forward buffer | "Messages waiting for you" | Buoy / Relay |

All references to `lighthouse.json` in this document mean `harbor.json`.
The file `lighthouse.json` does not exist. The lighthouse is a *service*, not a file.

---

## Summary: Impact on V4 DAG

| Gap | New Module(s) | LOE | Ships In | Depends On |
|-----|--------------|-----|----------|------------|
| 1. File Transport (HFP) | `lib/harbor-files.ts` | ~600 | V4.1 | XVII, I, XII |
| 2. Departure Protocol | `lib/departure.ts` | ~400 | V4.1 | XVII, XXVIII.1 |
| 3. Harbor Tunnels | amendments to `lib/tunnel.ts` | ~300 | V4.1 | XVII, existing tunnels |
| 4. Cross-Peer Salvage | amendments to `lib/resurrection.ts` | ~200 | V4.1 | XVII, XXVII |
| 5. Resilience Tiers | `lib/relay.ts` | ~400 | V4.2 | XVII, lighthouse |
| 6. harbor.json Spec | `lib/harbor-config.ts` | ~200 | V4.0 | I |
| 7. Co-op Governance | `lib/harbor-governance.ts` | ~300 | V4.2 | XVII, harbor.json |
| 8. Awareness Layer | `lib/awareness.ts`, MCP tool | ~300 | V4.1 | XV, XVII, XXVII |
| 9. Multi-Harbor Membership | amendments to middleware | ~200 | V4.1 | I |
| 10. Origin Tagging | schema + conflict resolver | ~150 | V4.0 | XVII |
| 11. Resource Quotas | amendments to sync protocol | ~200 | V4.1 | XVII |
| 12. Naming Clarification | renames + docs | ~50 | V4.0 | — |

**Total new LOE:** ~3,300 lines (roughly equal to the existing critical path)

**Critical insight:** Gaps 1 (HFP), 2 (Departure), 8 (Awareness), and 10
(Origin Tagging) should be considered for the critical path. Without file
transport, remote harbors are coordination-only (no code sharing). Without
departure, disconnection is data loss. Without awareness, agents can't reason
about each other. Without origin tagging, partitions cause data sovereignty
violations.

### Proposed Addition to Critical Path

```
                    Part XVII (Sync)
                         │
            ┌────────────┼────────────┐
            ▼            ▼            ▼
      Gap 1 (HFP)   Gap 10       Gap 8
      File Transport  Origin Tags  Awareness
            │            │            │
            ▼            ▼            ▼
      Gap 2          Parts II/III   Gap 4
      Departure      Remote Harbors Cross-Peer Salvage
```

### Three Killer App Scenarios

**1. Tandem Vibe Coding** (Gap 8)
Two developers, each with AI agents, same codebase, real-time awareness.
"Cursor on your laptop and Claude on your desktop, pair-programming through
the harbor." This is the demo that sells the product.

**2. Harbor Co-op** (Gap 7)
An open-source project creates a harbor. Contributors enter, claim anchors,
submit work. The harbor is the CI/CD-free coordination layer. "GitHub Issues
but for AI agents, with cryptographic accountability."

**3. Knowledge Foraging** (Gap 9)
An agent reads from a shared `team-patterns` harbor, applies knowledge to its
local `myapp` harbor. Cross-pollination without merge conflicts. "Your agents
learn from the team's collective intelligence, automatically."

---

## What's NOT in This Analysis (Deferred)

1. **Harbor marketplace** — agents bidding on anchors across harbors. This is
   Part XXVII Layer 3 territory. Build the local economy first.
2. **Harbor federation** — harbors connecting to other harbors (not peers).
   This is a meta-coordination problem for V5+.
3. **AI-to-AI negotiation** — agents autonomously negotiating anchor terms.
   Cool but dangerous. Needs the credit economy (V4.2+) first.
4. **File conflict resolution** — what if two agents edit the same file via
   `direct-write` mode? CRDTs for code are an unsolved problem. For now,
   `copy-on-write` with human review is the safe default.
5. **Harbor inheritance** — a child harbor that inherits permissions from a
   parent. Interesting for monorepo workspaces but adds complexity.

---
---

# Appendix A: Killer Apps at V4.0 Release

## The Question

What ships on launch day that makes someone install Port Daddy and tell a friend?
Not the architecture, not the formal proofs, not the 28-part plan — what's the
demo that sells itself in 60 seconds?

## The Answer: VS Code Extension for Tandem Vibe Coding

The highest-leverage release artifact is a **VS Code extension** that surfaces
harbor awareness directly in the editor. Not a standalone dashboard. Not a CLI
workflow. An extension that makes the coordination **visible** while you code.

### Why VS Code (Not CLI, Not Dashboard)

- **Distribution**: VS Code marketplace has 15M+ active users. One click to install.
- **Where developers live**: Agents run inside editors (Cursor IS VS Code, Windsurf
  IS VS Code, Claude Code runs in terminals alongside VS Code). The editor is the
  natural surface for coordination awareness.
- **Competitive moat**: No agent coordination tool has an editor extension. This is
  a first-mover opportunity.
- **Works for Cursor too**: Cursor is a VS Code fork. The same extension works in both.

### What the Extension Shows

**Status bar item**: `⚓ myapp (3 agents)` — always visible, one glance tells you
the harbor is active and how many agents are coordinating.

**Sidebar panel: Harbor Awareness**

```
┌─ HARBOR: myapp ──────────────────────────┐
│                                           │
│  YOU: agent-a4f2 (Claude Code)            │
│  Session: "Building JWT auth" (34m)       │
│  Caps: code:*, notes:write                │
│                                           │
│  ALSO HERE:                               │
│  ● agent-b7e1 (Cursor) — Bob's desktop   │
│    "Frontend login page" (12m)            │
│    Files: src/pages/login.tsx             │
│                                           │
│  HOT ZONES:                               │
│  🔥 src/auth/**     (0.87) ← you         │
│  🔥 src/pages/**    (0.65) ← agent-b7e1  │
│                                           │
│  RECENT:                                  │
│  14:35 agent-b7e1 "OAuth buttons done"    │
│  14:33 you claimed src/auth/middleware.ts  │
└───────────────────────────────────────────┘
```

**File decorations**: Files claimed by other agents get a gutter icon (⚓) and a
hover tooltip showing who claimed it and when. Hot files (high pheromone heat)
get a subtle background tint.

**CodeLens**: Above functions in claimed files:
```
⚓ Claimed by agent-b7e1 (Bob) — "building login page" | 📝 3 notes
function LoginPage() {
```

### What the Extension Does NOT Do

- **No editing**. It's read-only awareness. You don't manage harbors from the extension.
- **No agent control**. You don't spawn or kill agents from VS Code. That's the CLI.
- **No build step for the extension itself**. It talks to `localhost:9876` over HTTP
  and subscribes to SSE for live updates. ~500 lines of TypeScript.

### The 60-Second Demo

```
1. Alice opens VS Code on her MacBook. Extension shows: ⚓ myapp (1 agent)
2. Bob opens Cursor on his desktop. Extension shows: ⚓ myapp (2 agents)
3. Alice's sidebar updates: "● agent-b7e1 (Cursor) just joined"
4. Bob claims src/pages/login.tsx — Alice sees the ⚓ icon appear on that file
5. Alice's agent writes a note "JWT refresh working" — Bob sees it in his sidebar
6. Both developers see each other's activity in real time, in their editors,
   with zero configuration beyond `pd begin`
```

That's the demo. Two editors, two agents, one harbor, real-time awareness.

### The Three Release-Day Killer Apps

**1. Tandem Vibe Coding** (VS Code extension + remote harbors)
"Your Claude and their Cursor, pair-programming through a harbor."
Target: two developers who already use AI coding assistants.

**2. Solo Multi-Agent Coordination** (CLI + MCP + dashboard)
"Run 3 Claude agents on different tasks, zero conflicts."
Target: power users already running multiple agents.

**3. `pd teach --all`** (one-command agent onboarding)
"Every IDE agent learns 108 coordination tools in one command."
Target: anyone curious about agent coordination.

### Extension Implementation

| Component | LOE | Notes |
|-----------|-----|-------|
| `package.json` (extension manifest) | ~50 lines | activation events, contributes sidebar |
| `src/extension.ts` (entry point) | ~100 lines | activate, connect to daemon, register providers |
| `src/harbor-panel.ts` (sidebar webview) | ~200 lines | HTML panel, SSE subscription, live updates |
| `src/file-decorations.ts` (gutter icons) | ~80 lines | file claim decorations, heat tinting |
| `src/codelens-provider.ts` (CodeLens) | ~70 lines | claim info above functions |
| **Total** | **~500 lines** | No dependencies beyond `vscode` API |

Ship it on the VS Code marketplace as `port-daddy` on V4.0 launch day.
The extension is the top of the funnel. It makes the coordination tangible.
Everything else (harbors, sync, pheromones) is infrastructure that the
extension makes visible.
