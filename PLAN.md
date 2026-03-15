# Port Daddy V4: Harbor-First Architecture Plan

## The Thesis

You said three things, and they're actually one thing:

1. **Default harbors** — agents shouldn't have access to everything
2. **Networked harbors** — your desktop and MacBook should coordinate
3. **`pd team` is just `pd harbor remote`** — harbors ARE the coordination unit

The insight is: **harbors are not a feature. Harbors are the security model.** Everything
flows through a harbor. Local harbors are just remote harbors where the remote is localhost.

The ProVerif proofs (all 4 models in `analyses/`) already verify this. The formal property
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

#### 5. `pd begin` without `--identity`

If no identity is given, use the current directory name as project:
```
cd ~/code/myapp && pd begin "working on auth"
→ identity: myapp:default:session-abc123
→ harbor: myapp (auto-created)
```

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

SSE for real-time sync (you already have SSE everywhere), HTTP for RPCs:

```
POST /harbor/:name/sync    — push local state changes
GET  /harbor/:name/stream  — SSE stream of remote state changes
POST /harbor/:name/verify  — verify a harbor card from the other daemon
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
- `lib/harbor-sync.ts` — Remote harbor state synchronization
- `routes/harbor-sync.ts` — HTTP/SSE endpoints for daemon-to-daemon sync

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
- `tests/unit/harbor-sync.test.js` — sync protocol unit tests
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

**Implementation:** Cloudflare Worker + KV store. <100 lines of code. Free tier handles
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
<200 line Express app that stores harbor endpoints in SQLite.

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

### Pro ($19/seat/month)

For individual developers who work across machines:

- **portdaddy.dev lighthouse registration** — register harbors for WAN discovery
- **Remote harbor connections** (up to 3 peers) — sync across machines
- **Session replays** — timeline view of all actions in a session
- **Priority mDNS** — faster discovery, persistent peer memory
- **Email support**

**Why $19:** Low enough for an individual to expense. The value prop is "my MacBook
and my desktop work together without me typing IP addresses."

### Team ($49/team/month, up to 10 seats)

For teams running multi-developer agent swarms:

- Everything in Pro
- **Unlimited remote peers** — whole team's machines coordinate
- **Self-hosted lighthouse** — `pd lighthouse serve` for internal networks
- **Team dashboard** — aggregate view of all agents across all machines
- **Harbor audit logs** — who did what, when, where (exportable)
- **SAML/SSO** (roadmap) — enterprise auth

**Why $49/team:** A team of 5 devs each running 2-3 agents is 10-15 agents that need
coordination. That's real infrastructure value. $49 is below the "needs procurement
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

### Revenue Projections (Conservative)

| Quarter | Users | Pro ($19) | Team ($49) | Enterprise | MRR |
|---------|-------|-----------|------------|------------|-----|
| Q3 2026 | 500 | 20 | 2 | 0 | $478 |
| Q4 2026 | 2,000 | 80 | 10 | 1 | $2,510 |
| Q1 2027 | 5,000 | 200 | 30 | 3 | $6,770 |
| Q2 2027 | 10,000 | 500 | 80 | 8 | $17,420 |

This assumes 4% Pro conversion, 0.5% Team conversion, and <0.1% Enterprise.
Conservative but realistic for a developer tool with no VC funding.

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
- Wire protocol: HTTP for RPCs, SSE for real-time state streaming
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

# Consolidated Execution Timeline

| Phase | What | When | Revenue |
|-------|------|------|---------|
| **V4.0** | Harbor enforcement, auto-harbor on begin, capability delegation, grace period | Q2 2026 | — |
| **V4.0** | GitHub link fix, OG tags, website copy updates | Q2 2026 | — |
| **V4.0** | ADR-0011 (harbor-first), ADR-0012 (platform adapter) | Q2 2026 | — |
| **V4.0** | White paper V2 (implementation status + enforcement) | Q2 2026 | — |
| **V4.1** | Windows support via platform adapter | Q3 2026 | User base growth |
| **V4.1** | Remote harbors (daemon-to-daemon sync) | Q3 2026 | — |
| **V4.1** | mDNS discovery (LAN) | Q3 2026 | — |
| **V4.1** | ADR-0013 (remote sync), ADR-0014 (lighthouse) | Q3 2026 | — |
| **V4.2** | portdaddy.dev lighthouse, Pro tier launch | Q4 2026 | First revenue |
| **V4.2** | Blog content pipeline (5 posts) | Q4 2026 | SEO traffic |
| **V4.2** | Comparison page, tutorial updates | Q4 2026 | Conversion |
| **V4.3** | Self-hosted lighthouse, Team tier | Q1 2027 | Team revenue |
| **V4.3** | arXiv preprint submission | Q1 2027 | Credibility |
| **V5.0** | Enterprise tier, cloud spawn | Q2 2027 | Enterprise revenue |
