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
