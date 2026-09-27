# Codec and Transport Selection for Group Video Calling (2026)

## Video Codecs

| Codec | RTC maturity (2026) | Notes |
|---|---|---|
| H.264/AVC | Production-default | Universal hardware encode/decode; the interop fallback |
| VP8 | Production-dominant | Still >90% of WebRTC video sessions per Google-cited stats; software-only but cheap to encode |
| VP9 | Production, selective | Google Meet's production codec via VP9 SVC; royalty-free; often needs software decode fallback since VP9 SVC isn't broadly hardware-decoded |
| H.265/HEVC | Early production, fragmented | Chrome shipped WebRTC H.265 send/receive in Chrome 136 (blink-dev Intent-to-Ship, March 2025), gated behind Finch flags. Firefox and Safari's WebRTC stacks do not support it. Edge doesn't support H.265 send. Multiple unresolved patent pools (MPEG-LA, Access Advance, Velos Media) discourage open-source/smaller-vendor adoption |
| AV1 | Experimental/opportunistic in production | Royalty-free, best compression, but real-time *encoding* — not decoding — is the blocker |

### AV1 hardware reality (the actual blocker)

- **Decode**: broadly available — Apple M3-class silicon, Snapdragon 8 Gen
  2+, Exynos 2200, Google Tensor, MediaTek Dimensity chips. Chrome/Edge
  decode AV1 nearly universally. Safari is the holdout: macOS Safari AV1
  decode is present on only ~24% of sessions, iOS Safari ~33%, because many
  deployed Apple devices lack hardware AV1 decode and Apple ships no
  software fallback.
- **Encode**: hardware AV1 encoders exist on desktop/workstation GPUs
  (NVIDIA RTX 40-series/Ada Lovelace, Intel Arc, Apple Silicon). **Mobile
  hardware AV1 encode is essentially absent in 2025-2026** — Qualcomm has
  skipped AV1 hardware encode on mainline Snapdragon SoCs; the Snapdragon 7
  Gen 4 (May 2025) added AV1 support that appears decode-only. For most
  smartphone callers in 2026, "AV1 in a video call" still means *software*
  encoding, not viable for sustained real-time calls on battery.
- **Industry projection**: Tsahi Levent-Levi (bloggeek.me, Dec 2025)
  projects AV1 won't be RTC-dominant until around **2028**, given VP9 never
  fully displaced VP8/H.264 after a decade.

### Bandwidth savings (concrete numbers)

- AV1 (Aurora1 encoder) vs H.264/AVC: ~50% coding-efficiency gain at
  equivalent quality (Visionular benchmarks).
- AV1 SVC vs OpenH264/VP9-SVC: AV1 needs only ~35% of the bitrate for equal
  quality; disabling SVC nets an additional ~10% (up to ~75% total savings).
- AV1 (Aurora1) vs libaom-RT reference, real-time presets: ~33-34% more
  efficient at Superfast/Ultrafast.
- AV1 encode CPU cost vs VP9: ~3-5x more CPU-intensive on typical desktop
  CPUs; some sources cite 5-10x at aggressive presets.
- AV1 screen-content coding (Google Meet's `contentHint`-driven pre-call
  experiments): ~25%+ frame-size/bitrate reduction for screen/tab-share
  content.
- Netflix (VOD context, not RTC): AV1 uses roughly one-third less bandwidth
  than H.264/H.265 at equal-or-higher quality.

### Remaining adoption blockers

1. Mobile hardware encode gap — the single largest practical blocker;
   software AV1 encode is unworkable on phone thermal/battery budgets.
2. Encode latency at real-time presets — even fast presets (SVT-AV1 preset
   10, libaom-RT) remain tighter/slower than VP9/H.264 real-time modes.
3. H.265 licensing — multiple unresolved patent pools make it commercially
   risky for open-source SFU projects to bundle by default.
4. Browser fragmentation — no single AV1/H.265 codec is negotiable across
   Chrome, Safari, and Firefox simultaneously in 2026, forcing multi-codec
   offer/answer as the practical mitigation.

## SVC vs. Simulcast

**Simulcast**: the sender encodes the *same* source N independent times at
different resolutions/bitrates, each an independent encoder instance
producing an independent RTP stream (distinct SSRCs). The SFU picks which
whole stream to forward per subscriber. Codec-agnostic — works with H.264,
VP8, VP9, AV1.

**SVC (Scalable Video Coding)**: a single encoder pass produces one
bitstream containing embedded spatial and temporal layers. The SFU can
drop/forward individual layers from the same stream without multiple
encodes, and layer switches don't need a new keyframe the way whole-stream
simulcast switches do.

**W3C standardization**: `webrtc-svc` is a W3C Working Draft (checked
2026-09-14, still not a full Recommendation). Defines 40+ scalability modes
(temporal-only L1T1/L1T2/L1T3; spatial+temporal L2T1...L3T3 plus "h"
1.5:1-ratio variants; single-stream-simulcast "S" modes; key-frame-dependent
`_KEY`/`_KEY_SHIFT` variants). **Codec capability matters**: H.264, VP8, and
H.265 support only *temporal* scalability and can only simulcast on
distinct SSRCs; only **VP9 and AV1** support full spatial+temporal SVC in a
single stream.

**Why the industry is moving toward SVC**: bandwidth efficiency (enhancement
layers are differentially coded against the base rather than separately
compressed full streams) and faster adaptive switching without new
keyframes. **Trade-off keeping simulcast alive**: SVC requires all
endpoints to support VP9 or AV1; simulcast requires only the
least-capable codec (often H.264/VP8), the safer default for heterogeneous
device fleets.

**Verified production support**:
- **LiveKit**: simulcast by default for VP8/H.264 publishers; automatically
  switches to SVC for VP9/AV1 publishers, defaulting to `L3T3_KEY` (3
  spatial × 3 temporal layers). Caveat: LiveKit's Dynacast bandwidth
  optimizer can only pause *entire* SVC streams, not individual layers,
  unlike simulcast where individual layers can be turned off.
- **mediasoup**: first-class support for both simulcast and SVC (including
  K-SVC for VP9) in its C++ worker core; AV1 SVC added ahead of many peer
  projects but with open GitHub issues around specific multi-spatial-layer
  modes — treat AV1 SVC in mediasoup as production-used but not fully
  hardened.
- **Google Meet**: VP9 SVC (`L3T3_KEY`-style) in production for webcam
  video, toggled based on participant count; AV1 was piloted only in a
  narrow "pre-call" bandwidth-estimation window (`L1T2`, 320x180), not the
  main call — a deliberately cautious rollout. Caveat: VP9 SVC currently
  forces software decode on many clients since hardware decoders often
  can't process the SVC-layered bitstream.
- **Zoom**: not WebRTC-based for its core protocol; uses proprietary
  architecture and chose **H.264 Annex G (SVC)** rather than VP9/AV1 SVC —
  a useful data point that the two biggest production systems (Meet, Zoom)
  both use SVC but via *different* codecs, and neither has moved bulk
  traffic to AV1 SVC as of 2026.

## Audio Codecs

**Opus remains the unambiguous default in 2026** — mandatory across all
WebRTC implementations, every major browser sends/receives it. Opus 1.5
(Xiph.Org, March 2024) added ML-based components (e.g., improved
redundancy/PLC) *inside* the traditional pipeline rather than being
displaced by an external neural codec.

**Neural/learned codecs** (Google's Lyra v1/2021, Lyra v2/Sept 2022, built
on SoundStream; Meta's EnCodec) target very low bitrates (~3 kbps class) on
weak networks. They are **not part of the WebRTC mandatory codec set (RFC
7874)**, keeping them out of standard browser-negotiated RTC. Their real
2026 home is voice-AI pipelines (speech tokenization for LLM consumption),
not peer-to-peer conferencing. Treat any neural codec as an experimental
low-bitrate fallback at most, not a 2026 production requirement — ship Opus.

## Congestion Control

- **Google Congestion Control (GCC)** is the libwebrtc baseline — combines a
  delay-based estimator (transport-wide packet arrival-time deltas) and a
  loss-based estimator, taking the more conservative of the two.
- **Transport-Wide Congestion Control (transport-cc/TWCC)**: sender-driven,
  reports per-packet feedback across the whole transport rather than
  per-SSRC — the area Google has historically invested most in.
- **RFC 8888** ("RTCP Feedback for Congestion Control," Jan 2021): reports
  per-SSRC (not transport-wide), adds an explicit ECN-CE marking field.
  Mutually exclusive with transport-cc on a given connection. Some stacks
  (e.g., pion/webrtc) added CCFB support, but it's **not yet the
  libwebrtc/Chrome default** as of 2026 — this is where most current
  movement is happening, not a shipped baseline.
- **L4S** (Low Latency, Low Loss, Scalable throughput): standardized at
  RFC 9330 (architecture) and RFC 9331 (ECN protocol) — both published RFCs.
  For WebRTC, requires client-side RFC 8888 ECN feedback plus an
  L4S-compliant sender algorithm (e.g., "UDP Prague"). Academic prototypes
  (ACM MMSys 2026) show ~10x queuing-latency reduction and ~2x faster
  bitrate convergence, but this is **experimental/academic-prototype
  maturity for real-time media in 2026, not production** — it needs
  network-path ECN/L4S support (still limited on residential broadband),
  browser-side RFC 8888 support (not default), and a maturing
  congestion-control ecosystem, all at once. Do not plan a 2026 launch
  around L4S being available end-to-end on the public internet.

## Newer Transport Protocols

### Media over QUIC (MoQ)

Bridges WebRTC's near-zero-latency-but-stateful-per-connection model and
HLS/DASH's CDN-cacheable-but-multi-second-latency model, via a
publish/subscribe-over-"tracks" design that ordinary QUIC-aware relays
(including CDN edge nodes) can cache and fan out.

- **Standardization**: core transport spec `draft-ietf-moq-transport`, at
  -17 as of March 2, 2026 (later revisions continuing), still an advanced
  draft, not yet an RFC. Companion drafts: `draft-ietf-moq-secure-objects`
  (E2E secure objects for MoQ), `draft-ietf-moq-requirements`.
- **Production deployment**: Cloudflare states it launched the first MoQ
  relay network in production, August 2025, spanning 330+ cities. At NAB
  Show 2026 (April), 11 vendors (Ant Media, AWS, Bitmovin, Broadpeak,
  CacheFly, Cloudflare, Nomad Media, Norsk, Oracle, Red5, Synamedia)
  demonstrated interoperable MoQ implementations.
- **Relevance to group calling**: MoQ's demonstrated sweet spot is
  large-scale one-to-many/live-broadcast fan-out, not symmetric,
  low-latency, many-to-many group calls — its pub/sub-over-relay model
  fits webinar/live-event/broadcast products better than the interactive
  core of a group call, where SFU-based WebRTC remains the proven approach.

### WHIP / WHEP

- **WHIP** (WebRTC-HTTP Ingestion Protocol): **RFC 9725**, published March
  2025, IETF Standards Track, "frozen and stable for production use." A
  standard HTTP-based signaling handshake so any WHIP-compliant
  encoder/camera can push a WebRTC stream into any WHIP-compliant ingest
  server without bespoke per-platform signaling.
- **WHEP** (WebRTC-HTTP Egress Protocol): as of May 2026, **still an
  expired Internet-Draft** (`draft-ietf-wish-whep-03`) — not RFC status.
  Despite that, already in production at Cloudflare Stream, Dolby
  Millicast, OvenMediaEngine, MediaMTX, Janus, LiveKit, and Ant Media.
  LiveKit's self-hosted OSS offering exposes native WHIP ingress and WHEP
  egress endpoints directly.
- **Relation to group conferencing**: WHIP/WHEP standardize the *edges* of
  a broadcast-style (one producer, many low-interactivity consumers)
  pipeline — not a replacement for the N-way signaling a true symmetric
  group call needs (each participant both publishes and subscribes to
  potentially many others), which is still handled by the SFU's native
  signaling protocol. Practical use: WHIP for bringing external
  broadcast-quality sources into a room (an OBS-based co-host, a hardware
  encoder); WHEP for low-friction spectator/viewer egress (a "watch the
  call" webpage that doesn't need to join as a full participant).
- Even the largest live platforms (e.g., Twitch as of May 2026) still
  ingest general creator streams via legacy RTMP; WHIP is used only for
  experimental low-latency events — real but still early momentum relative
  to RTMP/HLS.

## Decision Framework

1. **Negotiate multiple video codecs, don't bet on one.** Mandatory floor:
   H.264 (Constrained Baseline) + VP8. Add VP9 when both peers support it
   (unlocks VP9 SVC for group calls above moderate participant count —
   Google Meet's actual pattern). Add AV1 opportunistically for confirmed
   hardware-encode-capable desktop/laptop peers only — never rely on it for
   mobile-originated video in 2026. Treat H.265 as out of scope unless
   you've resolved licensing and only need Chrome-136+↔Chrome-136+.
2. **Audio: just ship Opus.** No decision needed.
3. **Congestion control: use your stack's default GCC/transport-cc.** Don't
   hand-roll it. Watch RFC 8888 CCFB as emerging, don't require it for
   launch. Treat L4S as a 2027+ research bet, not a 2026 requirement.
4. **Core interactive transport: standard WebRTC (ICE/DTLS/SRTP over UDP
   via an SFU).** Add MoQ only if a meaningful part of the product is
   large-scale one-to-many broadcast/fan-out layered on top of the core
   call.
5. **Use WHIP for external professional source ingest; WHEP for lightweight
   standardized spectator egress** if needed, understanding WHEP is still
   pre-RFC.
6. **Keep codec/transport choices pluggable, not hardcoded.** Given AV1
   mobile-encode lag (~2028 projection), H.265's browser fragmentation, and
   MoQ/WHEP's pre-final-RFC status, the highest-leverage architectural
   decision is a renegotiable codec-preference list and an abstraction
   layer between core call logic and the ingest/egress transport.
