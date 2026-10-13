# E2EE Key-Management Patterns for Group Video Calls

Four production patterns exist as of 2026. They are genuinely different
architectures, not variants of one idea — pick based on group size, churn
rate, and what infrastructure you already have, not by copying a name you've
seen in someone else's marketing.

## 1. Leader Fan-Out (Zoom)

**Primary source**: Zoom Video Communications, *"E2E Encryption for Zoom
Meetings"* whitepaper, v3.2 (Oct 29 2021) through v4.7 (June 24 2025).
https://github.com/zoom/zoom-e2e-whitepaper

**Correction worth stating plainly**: Zoom's whitepaper (read directly,
Sections 3.1–3.10, plus the full 16-entry changelog) never mentions MLS,
Messaging Layer Security, or TreeKEM. This is a custom design, not an MLS
deployment — an easy but incorrect assumption to make by analogy with
Discord/Wire/Webex.

**Mechanics**:
- Roadmap has 4 phases: Phase I "Client Key Management" (the part fully
  specified), Phase II "Identity" (SSO/IDP-bound key attestation), Phase III
  "Transparency Tree" (Certificate-Transparency-style auditing of Zoom's key
  claims), Phase IV "Real-Time Security" (device-add attestation).
- One client is always the **meeting leader** (initially the host; Zoom's
  servers arbitrarily reassign leader on dropout).
- The leader generates a fresh 32-byte symmetric meeting key `MK` locally —
  Zoom's servers never see it. This is the key architectural change from
  Zoom's pre-E2EE design, where the server generated and distributed the key.
- For each participant `i`, the leader uses `Box.Enc` (libsodium
  `crypto_box`: X25519 + XChaCha20-Poly1305) to individually encrypt `MK`
  for that participant's ephemeral public key, posting ciphertext to a
  per-meeting "bulletin board" over the signaling channel. This is **O(n)
  leader fan-out** — cheaper than pairwise O(n²), but without MLS's O(log n)
  rekey cost or "any member can rotate" property. The leader is a single
  point of coordination for every rekey.
- Rekey on join/leave, throttled to **no more than every 15 seconds** to
  avoid thrashing. New joiners can see up to ~15s of stale history
  back-decrypted; departing users can decrypt forward for a similar window.
  Each `MK` carries a monotonic `mkSeqNum`.
- **Meeting leader security code**: `Digits(SHA256(SHA256("Zoombase-1-
  ClientOnly-MAC-SecurityCode") || SHA256(IVK_leader)))` — a 39-digit code
  every client computes independently from the leader's long-term identity
  key. The host reads it aloud; participants confirm a match. Explicitly
  benchmarked by the whitepaper against Apple FaceTime/iMessage, not Signal.
- **Primitives**: AES-256-GCM for A/V, HKDF for derivation, X25519 +
  XChaCha20-Poly1305 for the public-key layer, Ed25519 for signing — all via
  libsodium.
- **Post-quantum**: hybrid Kyber768/ML-KEM (NIST FIPS 203) added May 24 2024
  (whitepaper v4.4), extended to Zoom Phone (v4.5, June 2024) and
  device-managed encryption/Zoom Mail (v4.6, Dec 2024).
- **Feature limitations when E2EE is on** (whitepaper §1.3/§3.2 + Zoom
  support KB0075502): no Join Before Host, no cloud recording, no
  dial-in/PSTN/SIP/H.323/legacy-device/browser participants (they'd need a
  transcoding proxy — architecturally incompatible), no live transcription,
  no breakout rooms *in early versions* (later versions support them with
  per-room re-keying — see the platform case studies file), no polling, no
  1:1 private chat, capped at 1,000 participants. Webinars (up to 50,000,
  receive-only) are out of scope for this design entirely.

**When this pattern fits**: small-to-medium, relatively stable groups where
simplicity and a single coordination point are acceptable trade-offs against
O(n) rekey cost.

## 2. Pairwise Fan-Out Over Existing Sessions (Signal)

**Primary sources**: Signal, *"How to build large-scale end-to-end
encrypted group video calls"* (Dec 15 2021); *"Adding Encrypted Group Calls
to Signal"* (Dec 14 2020). https://signal.org/blog/how-to-build-encrypted-group-calls/

**Mechanics**:
- 1:1 calls ride the standard Signal Protocol (X3DH + Double Ratchet)
  session already established for messaging; call signaling and SRTP keys
  are negotiated over that channel.
- For group calls, Signal built its **own SFU in Rust** rather than adapting
  an open-source one — their stated reason: evaluated multiple open-source
  SFUs, found only two with adequate congestion control, and even heavily
  modified versions "couldn't reliably scale past 8 participants due to high
  server CPU usage."
- **RingRTC** (github.com/signalapp) is the open-source Rust library
  handling frame encryption and call setup/join logic on top of libwebrtc.
- **Key management**: when a participant joins or leaves, each client
  generates a new key and sends it to all other clients via ordinary
  encrypted Signal Protocol messages — i.e., group-call keys ride on top of
  the *pre-existing pairwise messaging fabric* rather than a dedicated
  group-ratchet primitive. Opposite trade-off from MLS: no shared-tree state
  to keep consistent, but O(n) fan-out per key-holder change, and depends on
  the messaging layer's availability.
- Frame-level encryption is conceptually similar to SFrame: "the contents of
  each frame are encrypted before being divided into packets."
- **Video pipeline note**: VP8 lacks native SVC, so Signal's SFU rewrites
  RTP sequence numbers/timestamps/VP8 Picture IDs to turn simulcast layers
  into one continuous stream per receiver. Congestion control uses Google's
  "googcc," tuned to prioritize low latency over throughput.
- **Post-quantum**: Signal's 2025 "Triple Ratchet" (Double Ratchet + Sparse
  Post-Quantum Ratchet) hardens the *messaging* channel that group-call keys
  travel over. No published claim that RingRTC's media path itself is
  PQ-hardened — treat the messaging-layer PQ upgrade and calling PQ status
  as separate, unconfirmed-for-calling claims.

**When this pattern fits**: products that already maintain pairwise E2E
messaging sessions between every pair of group members — reuses existing
infrastructure instead of introducing a new group-ratchet primitive. Doesn't
scale as gracefully as MLS for very large or high-churn groups.

## 3. MLS / TreeKEM (Discord's DAVE, Wire, Cisco Webex)

**Primary source**: IETF RFC 9420, *"The Messaging Layer Security (MLS)
Protocol,"* published July 2023 after ~5 years of WG development.
https://datatracker.ietf.org/doc/html/rfc9420

**The scaling problem it solves**: naive pairwise key exchange costs O(n²)
for a full rekey; a leader/star fan-out (Zoom, Signal above) costs O(n) per
rekey. MLS's core primitive, **TreeKEM**, arranges group members' key
material as leaves of a binary tree, so a single member update (join,
leave, rotation) only re-encrypts the **O(log n)** nodes on the path to the
root — not every pairwise relationship. This lets MLS target groups from 2
up to tens of thousands of members with near-optimal communication cost.

**Security properties**: Continuous Group Key Agreement (CGKA) providing
**forward secrecy** (past traffic stays safe if current keys leak) and
**post-compromise security** (future traffic recovers safety once
compromised members rotate) — both requiring active participation from
affected members to update their tree path.

**Who deploys it for real-time calls**:
- **Discord's DAVE protocol** (Discord Audio/Video End-to-End Encryption) —
  launched Sept 2024, audited by Trail of Bits, open-sourced
  (github.com/discord/dave-protocol). Explicitly combines "WebRTC encoded
  transforms and Message Layer Security (MLS) for encryption and group key
  exchange respectively." Per-sender symmetric media keys; membership
  changes trigger a new MLS "epoch." Rollout: opt-in-when-supported from
  Sept 2024, all official clients required to support it from 2025, and
  E2EE became the mandatory default for essentially all calls (DMs, group
  DMs, server voice channels, Go Live) around March 2026, formally announced
  May 18 2026. Stage channels (broadcast-to-large-audience format) are
  explicitly excluded.
- **Wire** — markets itself as the first enterprise collaboration platform
  entirely secured by MLS, including federated deployment.
- **Cisco Webex** — wrote its own C++ MLS implementation, marketed as
  Webex's "highest level of E2E security available that works at scale."

**2025–2026 direction**: GSMA's RCS Universal Profile 3.0 (published March
2025) is the first RCS spec revision to formally define E2EE using MLS;
cross-platform iPhone↔Android RCS E2EE built on this went live around May 11
2026 — evidence MLS is spreading into carrier-level messaging standards, not
just dedicated calling apps. A post-quantum MLS extension is in IETF
Internet-Draft stage as of 2025–2026, not yet an adopted RFC.

**When this pattern fits**: large or frequently-churning groups needing real
forward secrecy/post-compromise security with cheap rekeys — the right
default for new builds targeting genuine scale (thousands of concurrent
rooms, frequent join/leave).

## 4. Distributed Ledger Key-Consensus (Telegram Conference Calls)

**Primary sources**: Telegram, *"E2E Group Calls"* API spec
(core.telegram.org/api/end-to-end/group-calls); Telegram Blog, *"Extra-
Secure Group Calls, Automated Accounts, and More"* (Apr 30 2025).

**Important context — Telegram runs two structurally different
group-calling products, not one**:

1. **Legacy "Voice Chat"** (voice added Dec 2020, video added ~May 2021) —
   an always-joinable "virtual office"/live-broadcast room inside a group or
   channel, up to thousands of listeners. Uses ordinary MTProto
   client-server encryption (same model as Cloud Chats) — **Telegram's
   servers can access plaintext media** here. Not end-to-end encrypted.
2. **"Conference Calls"** (launched Apr 30 – May 1 2025) — ad hoc call
   links, up to 200 participants, explicitly end-to-end encrypted, verified
   via 4-emoji comparison (same UX family as Zoom's security code / Signal
   safety numbers). Telegram states these "use blockchain-like technology to
   ensure that, unlike in other apps, no one — not even Telegram — can
   secretly join as a listener."

**Mechanics of the E2E product**: a shared, append-only ledger (a
"blockchain") of participant list, permissions, and shared keying material
that all clients must apply identically — "Clients must only apply blocks
received from the server, even those they proposed themselves." This gives
public, verifiable consensus on membership without trusting the server to
honestly report who's in the call. Frame-level audio/video encryption sits
on top, plus a commit-reveal scheme for the emoji verification. Participants
who can't decrypt the current key (stale app, corrupted state) must exit
immediately — a liveness/consistency safeguard.

**Telegram's unrelated 1:1 call design** (unchanged, long-standing): a
three-message Diffie-Hellman with commit-then-reveal specifically to prevent
an active MitM from adapting its response after seeing the honest party's
commitment — caller sends `SHA256(g^a)` first, callee responds with `g^b`
without having seen the real `g^a`, caller reveals `g^a`, both derive
`key := g^(ab) mod p`, verified via 4 emojis derived from
`SHA256(key || g^a)`.

**Bottom line**: as of 2026, "Telegram group calls aren't E2E" is no longer
categorically true — it depends on which product is in use. The always-on,
large-audience Voice Chat feature remains server-relayed/non-E2E; the newer,
smaller, ad hoc Conference Call feature is genuinely E2E via a third
architectural pattern distinct from both MLS/TreeKEM and Zoom's
leader-fan-out.

**When this pattern fits**: products wanting public/verifiable membership
consensus with zero server trust, at a bounded scale (Telegram caps this
product at 200 — much smaller than its non-E2E product's thousands).

---

## The Mechanism Underneath All Four: SFrame + Insertable Streams

Every pattern above needs a way to actually apply the agreed key to media
frames without breaking the SFU's ability to forward/route. That mechanism
is shared across all of them:

- **WebRTC Insertable Streams** ("Encoded Transform" API) — W3C Working
  Draft, most recent WD 2025-10-09, not yet Candidate Recommendation.
  https://www.w3.org/TR/2025/WD-webrtc-encoded-transform-20251009 — exposes
  encoded frames after the encoder/before the packetizer (send side) and the
  mirror point on receive. Browser support: Chromium (2020), Safari (2022),
  Firefox (2023) — all three now support it, part of the cross-browser
  Interop 2025 effort, though `generateKeyFrame()` and some naming details
  still differ slightly per engine.
- **SFrame** — now **RFC 9605** (IETF, Aug 2024), *"Secure Frame (SFrame):
  Lightweight Authenticated Encryption for Real-Time Media."* Originated as
  `draft-omara-sframe` (2021), progressed through the SFRAME working group.
  Defines encryption/authentication of whole media *frames* (not per-packet)
  so SFUs can read forwarding metadata without media access, and is
  transport-independent (works beyond RTP). Adoption is real but uneven:
  LiveKit's frame cryptor cites the earlier `draft-omara-sframe-00` for its
  key-ratchet design rather than being bit-for-bit RFC 9605; check each
  SDK's changelog for which draft/RFC version its frame format matches.
- **Hard limitation**: SFU-only. Fundamentally incompatible with MCU
  topologies (which must decode/mix/re-encode — there's no way to composite
  ciphertext).
- **The RFC 6464 trick**: active-speaker detection normally needs decoded
  audio, but RFC 6464 defines a 4-byte cleartext RTP header extension
  carrying sender-computed audio level (plus an optional voice-activity
  bit) — shipped in Chrome/Firefox/Safari since early WebRTC. Because
  SFrame only encrypts the payload, an SFU reads this header and does
  accurate active-speaker detection without ever touching decrypted audio.
  This is the template for every other "does the server really need this"
  question: separate what the server needs to *route* (headers, cleartext)
  from what it must never *see* (payload, E2E-encrypted).

## Per-Library E2EE Support (2026 snapshot)

| Library/SDK | Mechanism | Maturity |
|---|---|---|
| Browser Encoded Transform (`RTCRtpScriptTransform`) | Native W3C hook | Production-usable; spec still evolving (WD, not CR) |
| libwebrtc built-in FrameCryptor | C++ implementation inside libwebrtc (built for Google Duo/Meet) | Production; what LiveKit's native SDKs build on |
| LiveKit | libwebrtc FrameCryptor: AES-GCM (128-bit default, 256-bit supported), key ratchet via salt (`"LKFrameEncryptionKey"`), 16-key ratchet window for out-of-order frames, cites `draft-omara-sframe-00` §4.3.5.1 | Production, documented at docs.livekit.io/transport/encryption/. Explicit documented trade-off: "server-side features that require media processing — such as server-side recording (egress), transcription, or simulcast layer switching — may be limited or unavailable" with E2EE on |
| mediasoup | Insertable Streams demonstrated in the mediasoup-demo app (GitHub issue #383, opened Apr 2020), not a first-class core-library feature | Demo/reference-implementation maturity — application developers wire it up themselves on top of mediasoup's transport |
| Discord DAVE | MLS (RFC 9420) + Encoded Transform | Production, Trail-of-Bits-audited, mandatory across official clients from 2025 |
| Zoom | Custom leader fan-out + hybrid PQ (Kyber768/ML-KEM) | Production since Oct 2020 GA, PQ since May 2024 |
| Google Meet | "Client-side encryption" (customer-managed keys via third-party IdP+key service) — architecturally distinct from true default E2EE; standard meetings remain server-decryptable for live captions/recording/noise cancellation | Production but scoped/opt-in (Enterprise Plus/Education tier), not the default |

## Decision Checklist

1. **Confirm SFU, not MCU.** Any leg requiring server-side decode+recompose
   (legacy PSTN/SIP/H.323 bridging, classic MCU mixing) cannot be E2EE for
   that leg — exclude those participant types, as Zoom does.
2. **Audit every "smart" feature** for whether it needs decoded media or
   only metadata (see `references/premium-feature-e2ee-compatibility.md`).
3. **Pick the key-management pattern by scale/churn**, not by copying a
   platform's name: leader fan-out for small/stable, pairwise fan-out if you
   already have pairwise E2E sessions, MLS/TreeKEM for large/high-churn,
   ledger consensus if you need public verifiable membership with zero
   server trust.
4. **Decide your stance on incompatible features up front** and communicate
   it as a deliberate trade-off (Zoom greys out cloud recording/
   transcription UI when E2EE is on; Telegram keeps two separate products
   rather than compromising one).
5. **If you need post-quantum resilience**, budget for hybrid classical+PQ
   key exchange (X25519 + ML-KEM-768/Kyber768, the emerging default
   combination) — added handshake cost is small (~80 microseconds of KEM
   computation) next to ordinary ICE/DTLS negotiation (200-500ms), but plan
   for a migration path since MLS-level PQ standardization isn't finalized.
