# MESH COORDINATION · How daemons find and talk to each other

> *"How do I connect two computers in the same room?"* — user
>
> And the harder version: "...same while at a coffeehouse. Maybe one day
> from phone."

**Status:** Architecture decision — 2026-04-20
**Scope:** Daemon ↔ daemon connectivity for remote harbor membership,
cross-machine Merkle forest witnessing, resource sharing (use the
gaming PC's GPU while you vibe-code on a laptop). Complements
`USER-ACCOUNTS-KMS.md` (account identity) and the Bonded Commons
revocation protocol.
**Informed by:** Iroh, libp2p, Tailscale, WebRTC/STUN/TURN,
Hypercore/Holepunch, Signal's multi-device protocol, Syncthing.

---

## The three scenarios, honestly

1. **Same LAN** — laptop and gaming PC in the same room, same Wi-Fi.
   *Easy.* mDNS/Bonjour discovery + direct WebSocket on LAN IP works
   reliably, near-zero latency, no cloud touch.
2. **Cross-network** — coffeeshop laptop ↔ home gaming PC.
   *Hard.* Both behind NAT, often symmetric (carrier-grade). Needs
   hole-punching (STUN) with relay fallback (TURN) when punching
   fails. Every "P2P" product you've used has a coordination server
   even when data flows peer-to-peer — pretending otherwise is a lie.
3. **Phone** — iOS/Android as a peer.
   *Hardest.* Aggressive sleep, background-network kills, carrier
   NAT, battery. Treating a phone as a full mesh peer is a bad
   engineering-and-product bet. Treat it as a **viewer**: phone talks
   to our KMS/relay over plain HTTPS + WebSocket; daemons push state
   to the relay for it to consume.

## Decision

**Tier the solution. Don't pick one primitive.**

| Tier | Scope | Primitive | Status |
|---|---|---|---|
| T0 | Same LAN | mDNS discovery + WebSocket | Build first |
| T1 | Cross-network | Iroh or libp2p-js sidecar | Build second |
| T2 | Phone / viewer | HTTPS + WebSocket to our relay | Last |
| Tx | Power-user override | Detect + prefer Tailscale IPs | One-line detect |

Each tier is additive and independently shippable. A user can get LAN
mesh without the cloud-broker ever being built; they can get cross-
network support by opting into T1 without affecting T0 behavior; they
can get phone support without touching T0 or T1.

## Why not pick one "pure P2P" solution

Tempting to say "just use libp2p everywhere." Two reasons not to:

1. **Same-LAN should never round-trip through a DHT.** mDNS gives us
   5ms discovery in the local case; libp2p's DHT adds hundreds of ms
   and network dependency for no benefit.
2. **No P2P is truly serverless across the internet.** Every
   production P2P product (WebRTC, Signal, Zoom, Tailscale) has a
   rendezvous/coordination/relay service. Even libp2p's circuit-relay
   is a service, run by someone. The "no servers" framing sells books;
   real deployments always have one.

## T0: LAN tier (first to ship)

### Discovery: mDNS / Bonjour

Each daemon advertises on mDNS as `_portdaddy._tcp.local` with TXT
records carrying:
- `pubkey=<base64 Ed25519 public key>` (the daemon's Phase 2 public key)
- `account=<user-id>` (so only same-account daemons auto-pair)
- `harbors=<comma-separated harbor names>` (advertise what's here)

Node's `mdns` module or Go-style `zeroconf` (via Node binding) handles
this. The library choice matters less than adopting the protocol.

### Handshake

Two daemons on the same LAN, same account:

1. Each sees the other via mDNS.
2. Initiator opens WebSocket to `ws://<lan-ip>:<daemon-port>/mesh`.
3. Mutual Harbor Card exchange. Each verifies the other signed with
   an Ed25519 key corresponding to the advertised pubkey.
4. Session established. End-to-end authenticated; no CA required
   because the keys are pinned to account-registered devices.

### Transport

Plain WebSocket framing on top of existing HTTPS server. Already wired
for the dashboard — adding `/mesh` is a route, not a new transport.

### Capabilities over the channel

- Remote session creation: "run this Float Plan on your daemon."
- Harbor root witness: "here is my latest Merkle root; please sign
  that you've seen it."
- Revocation filter sync: deltas to the cuckoo filter described in
  `WHITEPAPER-EXPANSION.md` §3.
- Streaming activity log: the viewer machine subscribes, sees live
  events from the gaming PC's daemon.

### Out of scope for T0

- NAT traversal (this is literally "same LAN").
- Phone (phones don't emit mDNS aggressively enough to be reliable).
- Shared GPU primitives (that's a service-level question — "here's my
  gaming PC's GPU as a service" — solved ABOVE the transport).

## T1: Cross-network tier

### The primitive

Recommend **Iroh** (Rust, battle-tested NAT traversal, QUIC transport,
relay fallback, small binary we can ship alongside like `better-sqlite3`
prebuilts). Alternative: **libp2p-js** (pure Node, heavier, works in
browsers too). Either works.

### How it fits

- Iroh sidecar runs per daemon, listens on localhost for Port Daddy's
  mesh commands, handles node-id addressing and transport.
- Port Daddy daemon speaks to Iroh over local HTTP or Unix socket.
- Iroh handles: discovery (via DNS-based or ticket-based addressing),
  hole-punching, relay fallback.
- Port Daddy stays unaware of transport details. From Port Daddy's
  perspective, a remote daemon is addressable by a NodeId; it writes
  to the NodeId and Iroh gets the bytes there.

### Discovery across the internet

Port Daddy issues "mesh tickets" from the KMS. A ticket is a short
string (~80 chars, base32) encoding: daemon NodeId + preferred relay
hint + HMAC from the account's key. User pastes into the other
machine's `pd mesh connect <ticket>`. One-time use; tickets expire.

For always-on pairing (e.g., "my gaming PC is always this daemon"),
the account registry stores confirmed pubkey → NodeId mappings; no
per-session ticket needed.

### When direct punching fails: relay

Iroh ships a relay protocol. We host a relay (small Cloudflare
Workers Durable Object or a Fly.io instance) OR use iroh.network's
public relay. Relay carries encrypted bytes; it can't read them.

## T2: Phone / viewer

Phone connects to `wss://relay.portdaddy.dev/viewer` with its passkey
challenge-response auth. Daemon(s) push state changes to the user's
channel on the relay. Phone receives via WebSocket (foreground) and
via APNs/FCM push (background, for violations/bond alerts).

Phone signs low-stakes actions (approve Shipwright proposal, bump
budget cap) with its device keypair. Signed actions go back through
the relay to the daemon, which verifies the signature against the
account's device registry before executing.

Out of scope: phone running a full daemon. Not a good engineering
bet.

## Tx: Tailscale escape hatch

`pd mesh use-tailnet` detects whether Tailscale is installed and
running. If yes, prefer Tailscale IPs over Iroh when connecting to
peers in the same tailnet. Users who already live in Tailscale-land
get mesh connectivity for free; we don't ship Tailscale as a dep.

## What this unblocks

- **Resource sharing.** "Run this fleet on gaming-pc" — the daemon on
  the laptop hands a Float Plan to the daemon on the gaming PC, which
  runs it (uses the GPU, the RAM, whatever), streams results back.
- **Remote harbors.** Harbor membership that spans machines. A harbor
  running on `gaming-pc` can accept agents from `macbook`.
- **Merkle witness pooling.** Daemons gossip harbor roots; the KMS
  witness becomes a backup, not the only record.
- **Phone-as-remote.** Approve spawns, monitor runs, get notified
  when something breaches — all from the phone.

## What this does NOT solve

- Global leader election across the mesh (we don't need it).
- Strong consistency of harbor state across machines (eventual +
  causal is enough given our use case).
- Data locality guarantees ("this plan MUST run on machine X") —
  that's a scheduling question, not a mesh question.

## Implementation order

1. T0 mDNS + LAN WebSocket mesh. Small PR. 2-3 days.
2. Relay (T2 infrastructure) — a Durable Object or small service
   hosting viewer and cross-network relay. Shared with Phone tier.
3. T1 Iroh sidecar integration. Bigger PR, needs Iroh binary
   packaging. Probably a week.
4. Phone app (T2 viewer client). Separate codebase.
5. Tx Tailscale detection. One afternoon.

---

*Companion: `USER-ACCOUNTS-KMS.md` for account identity, `WHITEPAPER-EXPANSION.md §3` for revocation, `SECURITY-ASSESSMENT.md` for the threat model that frames all of this.*

---

## Addendum — LAN story for 2+ computers: Float Plans, not SSH mutations

The tiered transport in §T0/T1/T2 answers *how* bytes move between machines. It does not answer *what* those bytes mean — in particular, how a laptop user tells their gaming PC to "run this task with your GPU." That design question is the scope of `NEXT-SESSION-PROMPTS.md §12` (and Track 7). The short version:

**The unit of cross-machine coordination is a Float Plan, not a file mutation.** Each machine keeps its own clone + git worktrees. Laptop sends a plan (branch + commit + task + acceptance criteria + bond) via the mesh; the remote daemon checks out the branch into a fresh worktree, runs the agent there, commits, pushes. Laptop pulls. Git is the state-sync layer (it already handles conflicts); the mesh is the coordination layer (file claims span it); Port Daddy is the accountant.

What this explicitly rejects:
- SSH + remote filesystem mutation (no audit, no conflict reconciliation).
- Continuous file-level sync (Syncthing-style) (redundant with git + fragile).

See `NEXT-SESSION-PROMPTS.md §7 + §12` for the full design, the `pd mesh spawn` CLI sketch, and the handling of GPU/ML artifacts too large for git.
