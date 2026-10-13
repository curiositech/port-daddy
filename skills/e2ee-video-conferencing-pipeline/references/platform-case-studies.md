# Platform Case Studies: Zoom, Telegram, Google Meet, Discord (2025-2026)

Verified against platform-owned sources (engineering blogs, whitepapers,
official API docs) as of 2026, with independent corroboration where
official detail was thin.

## Comparison Table

| Platform | Media Topology | E2EE for GROUP calls? | Codecs | Transport | Key Sources |
|---|---|---|---|---|---|
| **Zoom** | Distributed SFU via proprietary "Multimedia Router" (MMR) + Zone Controller per "Meeting Zone" — one uplink, multiple selectable downlinks | Yes, opt-in, capped at 1,000 participants; disables cloud recording, live transcription, polling, join-before-host, streaming, 1:1 private chat | Video: H.264 + Annex G SVC extension (up to 4 simultaneous H.264 streams per sender); AV1 available, falls back to H.264 under CPU pressure. Audio: Opus-family | WebRTC-adjacent but proprietary SFU/MMR and SVC handling | Zoom Cryptography Whitepaper v4.7 (June 24 2025); Zoom post-quantum E2EE announcement (May 21 2024); EUROCRYPT 2023 paper |
| **Telegram** | Two separate systems: (1) legacy "Group Video Chats" via `tgcalls`, SFU relay, up to 30 broadcasters + 1,000 viewers; (2) new "Conference Calls" (Apr 30 2025), up to 200 participants | Split. Legacy Voice Chats: NOT E2E (TLS-in-transit only). Conference Calls (Apr 30 2025): genuinely E2E, per-frame encryption + distributed ledger key-consensus on top of MTProto signaling, 4-emoji verification | Custom `tgcalls`/`libtgvoip` stack; Opus for audio | MTProto 2.0 signaling; custom UDP media transport, not standard SRTP/DTLS | core.telegram.org/api/end-to-end/group-calls (new E2E); core.telegram.org/api/end-to-end/video-calls (1:1); core.telegram.org/api/group-calls (legacy, non-E2E); Telegram Blog, Apr 30 2025 |
| **Google Meet** | SFU — Meet Media API spec requires exactly 3 receive-only audio + 1-3 receive-only video descriptions per client, consistent with forwarding not mixing | No, not by default. Standard Meet: TLS/SRTP-in-transit with Google holding server-side decrypt capability (needed for live captions/recording/noise cancellation). Separate opt-in "Client-Side Encryption" (CSE): video (Aug 2022) → chat (May 2023) → mobile (Aug 2023) → external participants (Apr 2024), Enterprise Plus/Education tier, admin-configured, requires third-party IdP+key-service — architecturally distinct from Signal/DAVE-style E2EE | Audio: Opus. Video: VP9-SVC primary once 2+ participants join (`L3T3_KEY`); AV1 piloted only in solo "pre-call warmup" phase; screen share uses VP8 simulcast | WebRTC; SRTP (RFC 3711) secured by DTLS (RFC 9147); data channels over SCTP (RFC 9260) | Google Meet Media API Concepts; webrtcHacks "The Hidden AV1 Gift in Google Meet"; Google Workspace Updates blog (2022-2024) |
| **Discord** | Homegrown C++ SFU (not mediasoup/Janus); Elixir Gateway for signaling; etcd for voice-server discovery/load. 2018 scale: 850+ voice servers, 13 regions/30+ datacenters, 2.6M concurrent voice users, 220+ Gbps egress | Yes — the most complete of the four. DAVE launched opt-in Sept 2024, became mandatory default for essentially all calls (DMs, group DMs, server voice channels, Go Live) around March 2026 (announced May 18 2026). Stage channels (broadcast format) excluded. Real MLS (RFC 9420) for group key agreement, per-sender ratcheted keys via WebRTC Encoded Transforms, epoch rekeying on join/leave. Open-sourced, Trail of Bits audited | Audio: Opus. Video: VP8/H.264 baseline; AV1/HEVC hardware-accelerated where GPU supports it (2025: VAAPI on AMD/Linux, zero-copy Steam Deck/Gamescope encoding) | WebRTC-based signaling/negotiation; custom SFU media relay; DAVE adds an E2EE layer on top | Discord Engineering Blog "How Discord Handles 2.5M Concurrent Voice Users" (Sept 10 2018); "Meet DAVE" (Sept 2024); github.com/discord/dave-protocol; "Every Voice and Video Call on Discord Is Now E2E Encrypted" (May 18 2026) |

## Narrative

**Zoom** runs a distributed-SFU design (Multimedia Router / Zone
Controller) — architecture detail here comes mostly from third-party
system-design writeups rather than an official Zoom architecture blog, a
real transparency gap relative to Discord. What Zoom *does* publish in
depth is cryptography: a custom (non-MLS) protocol — Curve25519 ECDH +
Ed25519 signatures classically, plus a Kyber768/ML-KEM (FIPS 203) hybrid
post-quantum layer added May 2024. E2EE is opt-in per meeting, capped at
1,000 participants, and disables several core features (cloud recording,
live transcription, breakout-room-adjacent features in early versions,
polling) — a real trade-off, validated academically at EUROCRYPT 2023. Be
skeptical of the frequently-repeated "300 million daily meeting
participants" statistic in 2025-2026 marketing roundups — it dates to the
April 2020 pandemic surge; more current verifiable figures are ~192,600
enterprise customers and ~$4.67B fiscal-2026 revenue.

**Telegram requires the most careful correction of a common
misconception.** The claim "E2EE only in Secret Chats and 1:1 calls,
everything else server-side" was accurate through 2024, but Telegram
shipped a genuine, separate E2EE group-calling feature on **April 30,
2025** ("Conference Calls"), capped at 200 participants, verified via
4-emoji comparison, using per-frame encryption plus a distributed
"blockchain-like" key-consensus mechanism layered on MTProto signaling.
This is a **distinct, separately-initiated call flow** — not retroactively
applied to Telegram's older (2021-era) group video chats inside existing
groups/channels, which remain SFU-relayed via `tgcalls` and are **not**
E2E (up to 30 broadcasters, 1,000 viewers). Ordinary Cloud Chats (1:1 and
group text) also remain server-side-encrypted only. So: the old claim is
still true for default/legacy chats and legacy group video chats, but as
of 2025 it's false to say Telegram has *no* E2EE group-call option.

**Google Meet** is the most conventional SFU-only design of the four, and
the one platform among these four **without a default E2EE story for group
calls at all**. Its media pipeline needs plaintext server access for live
captioning, cloud recording, and AI noise suppression, making true default
E2EE architecturally incompatible with those features as currently built.
Google's answer, "Client-Side Encryption" (CSE), is a genuinely different
security model (customer-held keys via IdP+key-service) from Discord's or
Telegram's newer consumer-facing E2EE — worth framing as "encryption Google
can't access" rather than "true E2EE by default" in any teaching doc.
Meet's codec story is well-documented via rare public WebRTC-community
reverse engineering: VP9-SVC is the production video codec once a second
participant joins; AV1 has only been piloted in a solo "warmup" phase due
to hardware-decode limitations with AV1+SVC combined.

**Discord has the most transparent, and now the most complete, engineering
story.** Its 2018 blog post remains the best public description of a
homegrown SFU at real scale. More significant for 2025-2026: Discord's DAVE
protocol, launched September 2024, open-sourced with a published
whitepaper and a Trail of Bits audit, uses actual IETF MLS (RFC 9420) for
group key agreement combined with per-sender ratcheted keys applied via
WebRTC's Encoded Transforms API. As of ~March 2026 (announced May 18,
2026), **E2EE became mandatory and default for essentially every call
type** (DMs, group DMs, voice channels, Go Live), with only large-broadcast
Stage channels excluded. Correction to a common framing: Discord's Krisp
noise suppression is a **licensing/technology partnership** (April 2020,
expanded November 2023 to a WebAssembly browser SDK), not an acquisition —
Krisp remains an independent company.

## Cross-Cutting Engineering Lesson

All four platforms independently arrived at **SFU (not MCU)** as the
scalable topology, because SFU avoids server-side decode/re-encode — which
is also precisely what makes E2EE hard to retrofit onto SFU architectures
(the server can't do content-aware adaptive simulcast selection on
encrypted media the way it can on plaintext). Discord's and Telegram's
newer E2EE group-call designs both solve this the same way: encrypt at the
frame level, above the RTP/SFU layer, so the SFU can still forward
encrypted opaque frames without needing plaintext access. This is the
current (2025-2026) state of the art for "E2EE + SFU-scale group video,"
and the pattern this skill's core mechanism section (SFrame + Insertable
Streams) generalizes from.

## What to Take From Each Platform for a New Build

- **From Zoom**: the leader-fan-out pattern is a legitimate, simple choice
  for smaller/stable meetings — but don't claim you're using MLS if you're
  not, and be explicit about which features you're disabling under E2EE
  rather than letting users discover it.
- **From Telegram**: it's reasonable to ship two structurally different
  products (a large, non-E2E "always-on room" feature and a smaller,
  genuinely E2E "private call" feature) rather than forcing one
  architecture to serve both use cases.
- **From Google Meet**: customer-managed-key encryption (CSE) is a
  legitimate, different security model from true E2EE — don't conflate the
  two in product messaging, and recognize CSE's admin/IdP dependency makes
  it an enterprise feature, not a consumer default.
- **From Discord**: MLS/TreeKEM + Encoded Transforms is the most complete,
  audited, and now broadly-deployed-by-default pattern for a 2026 build
  targeting real scale and frequent membership churn — the strongest
  reference architecture of the four for a new "Telegram rooms or Zoom"
  style product with E2EE as a hard requirement.
