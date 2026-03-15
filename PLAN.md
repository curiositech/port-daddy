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
- The trie is ~100 lines of code and eliminates SQL from the hot path entirely
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
  REMOTE CLIENTS ─► │  TCP :9877 (harbor sync)    │ ◄── HTTP path
  (other daemons)   │    HTTP + JSON + TLS         │     Full Express stack
                    │    SSE for streaming          │     ~0.5ms per call
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

This is a big change. Phase it:

1. **V4.0:** Keep current HTTP-over-Unix-socket as-is. Add harbor middleware.
2. **V4.1:** Add binary protocol as **optional** fast path alongside HTTP on the socket.
   SDK detects protocol support and upgrades automatically.
3. **V4.2:** Make binary protocol the default for local. HTTP stays for remote only.
4. **V4.3:** Remove HTTP listener from Unix socket entirely. HTTP only on TCP for remote.

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

### Benchmark Targets

| Path | Current | V4 Target |
|------|---------|-----------|
| CLI → daemon (claim) | ~2ms | <0.5ms |
| SDK → daemon (claim) | ~1.5ms | <0.3ms |
| MCP → daemon (claim) | ~3ms | <1ms |
| Remote daemon → daemon (sync) | ~5ms | ~5ms (HTTP stays) |

---
---

---
---

# Part IX: Dashboard UI — Wireframes and Plan

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

Constraints from ADR-0005: **single-file HTML**, no build step, no frameworks.
All CSS/JS inline. Must work when served by `pd dev` immediately.

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
│  │ MCP (98 tools│ │              │ │              │    │
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
  metadata     TEXT,                    -- JSON (type-specific data)
  PRIMARY KEY (harbor_name, type, target)
);

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
