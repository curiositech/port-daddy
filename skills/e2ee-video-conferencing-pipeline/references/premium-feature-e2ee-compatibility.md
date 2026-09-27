# Premium Feature Implementation and E2EE Compatibility

The single load-bearing fact underneath this whole file: **WebRTC Insertable
Streams places the E2EE encryption boundary after the codec encoder and
before RTP packetization.** Any effect applied to raw camera/mic data
*before* it reaches the encoder is automatically compatible with E2EE, at
zero extra design cost. Anything requiring a *third party* (cloud API,
server-side compositor) to see plaintext media cannot coexist with a true
E2EE guarantee unless that party is explicitly issued a decryption key as a
trusted call participant.

## Virtual Backgrounds / Background Blur

**Implementation**: real-time person segmentation via a small CNN —
MediaPipe Tasks' Image Segmenter (`selfie_multiclass` model, successor to
the deprecated "Selfie Segmentation" solution). Research alternatives:
Robust Video Matting (RVM, recurrent temporal matting, 4K@76fps on
high-end GPU), BackgroundMattingV2. Runs via TFLite-in-WASM with a WebGL or
increasingly WebGPU compute backend — WebGPU gives a reported 3-5x speedup
over WebGL and is default-on in Chrome/Edge since v113 (2023) and Firefox
141 (mid-2025); ~8% of Chrome installs still fall back to WebGL (GPU
blacklisted).

**Where it runs**: client-side, pre-encoder, on the raw camera frame, in
virtually every mainstream product. Server-side GPU segmentation exists
mainly as a low-end-device fallback and is far less common — it costs
GPU-seconds per participant per second plus a round-trip latency hit.

**E2EE compatibility**: ✅ Fully compatible — applied before the encoder,
before the E2EE boundary. The server never needs the pixel data.

## Noise Suppression / Audio Enhancement

**Implementation**: RNNoise (open, WASM, ~10ms latency, used by Jitsi),
DeepFilterNet2 (open, heavier/higher quality), Krisp (commercial, on-device
SDK for Windows/macOS/Linux/Android/iOS/Browser-WASM, ~15-25ms latency,
powers Discord's noise suppression via a licensing partnership since April
2020, expanded to a WASM browser SDK in Nov 2023 — a partnership, not an
acquisition; Krisp remains independent).

**Where it runs**: client-side, before encoding, inside an AudioWorklet, in
every implementation surveyed — noise suppression on already-encoded/
transmitted audio is far harder and lossier than on raw PCM.

**E2EE compatibility**: ✅ Fully compatible for the same reason as
backgrounds — a pre-encoder transform. Caveat: some enterprise vendor
deployment modes route audio through a cloud service for suppression
instead of running on-device; that specific configuration does see
plaintext audio server-side and breaks an E2EE claim for that path.

## Live Captions / Real-Time Transcription

**Implementation**:
- On-device: whisper.cpp compiled to WASM+SIMD (v1.9.3, Aug 2026); tiny/base
  models are the realistic ceiling for real-time in-browser inference;
  distil-whisper variants similarly deployable.
- Browser-native: Web Speech API — multiple 2025-2026 sources characterize
  it as prototype-grade, not production-viable.
- Cloud: Deepgram (Nova-3/Flux, sub-300ms latency), AssemblyAI
  (Universal-Streaming/Universal-3.5 Pro Real-Time, ~300ms latency,
  $0.15/hr), ElevenLabs Scribe v2 Realtime, Google/Azure streaming STT.
- Diarization: pyannoteAI streaming, Streaming Sortformer (2025) for
  multi-talker scenarios. In an SFU-routed call, per-track identity is a
  free/trivial diarization signal, avoiding the need for a diarization
  model entirely when captioning per-participant tracks (only needed for a
  pre-mixed single stream, e.g. PSTN dial-in).

**Where it runs**: cloud STT APIs dominate production live-captioning
because on-device models trade accuracy (accents, cross-talk, vocabulary)
for privacy; on-device whisper.cpp is viable and improving fast but
generally tiny/base tier only as of 2026.

**E2EE compatibility**: ⚠️ Split. On-device transcription of a client's own
already-legitimately-decrypted audio is E2EE-compatible — no third party
ever sees plaintext. **Cloud STT APIs fundamentally require sending
plaintext audio to a third party and are NOT compatible with a true E2EE
guarantee** — this is exactly why Zoom explicitly disables live
transcription when its E2EE mode is enabled (Zoom support KB0065408).

## Recording Architecture

**Implementation**:
- **Track Egress** (per-track): raw per-participant track dump, no
  transcoding/muxing — cheapest, lightest.
- **Track Composite Egress**: mux one audio+one video track pair per
  participant into a single file, no layout engine.
- **Room Composite Egress** (LiveKit): a full headless Chrome instance
  renders an HTML layout template of the whole room exactly as a viewer
  would see it; output piped through a GStreamer pipeline into a single
  mixed file/stream. Coordinated via a horizontally scalable worker pool
  (Redis pub/sub job assignment).
- **Client-side recording**: a participant's browser uses
  MediaRecorder/Canvas capture on its own already-decrypted, already-
  composited view, then uploads the result.

**Where it runs**: server-side (SFU or dedicated egress worker pool) for
both track and composite modes in mainstream products; client-side
recording is rarer in non-E2EE products but is the only option that
preserves a true E2EE guarantee.

**E2EE compatibility**: ❌ Server-side composite (and even server-side
per-track) recording requires the recording service to hold plaintext —
structurally breaks true E2EE unless the recorder is explicitly issued a
decryption key as a trusted party, which most vendors treat as
unacceptable (Zoom disables cloud recording entirely when E2EE is on;
LiveKit's own docs state encrypted media "cannot be directly recorded or
processed by server-side systems without decryption access"). ✅
Client-side recording preserves E2EE, at the cost of quality/reliability
being tied to one participant's device and connection, plus needing local
storage and a separate upload/transcode pipeline.

## Breakout Rooms

**Implementation**: modeled as independent room objects at the
media-server layer (LiveKit's "Room" abstraction; Zoom Video SDK's
"Subsessions"; Daily Prebuilt's admin-driven room-assignment API).
Participants leave the parent session and join a session/room object for
the sub-room, then can be moved back. Requires issuing freshly-scoped join
tokens/credentials per participant per sub-room rather than reusing parent
credentials, since permissions — and, under E2EE, the room's encryption
key — are scoped per-room.

**Where it runs**: signaling/room-management logic is necessarily
server-side (who's-in-which-room bookkeeping), but no plaintext media
processing is required by the mechanism itself.

**E2EE compatibility**: ✅ Compatible with a small design addition — Zoom's
own documentation confirms breakout rooms remain functional under E2EE
specifically because "each breakout room will have its own unique meeting
encryption key," i.e. the server only ever handles membership/routing
metadata and re-keying events, never plaintext.

## Spatial/Positional Audio

**Implementation**: per-remote-track Web Audio graph —
`MediaStreamAudioSourceNode` → `PannerNode` (HRTF or equal-power panning
model, `distanceModel` typically `'exponential'`, tunable `refDistance`/
`maxDistance`/`rolloffFactor`) → `AudioContext.destination`. 2D/3D world
position mapped onto the PannerNode's coordinate space, smoothed via
`setTargetAtTime()` (~20ms time-constant) rather than snapping. Position
data travels out-of-band over a data channel or the room's presence layer.

**Where it runs**: entirely client-side/receiver-side, applied
independently to each already-decoded incoming remote track — requires
SFU (not MCU) topology so raw unmixed per-participant tracks are
available. CPU cost scales linearly with the number of simultaneously
panned remote tracks.

**E2EE compatibility**: ✅ Fully compatible — spatialization happens after
each client has already legitimately decrypted the remote track; the
server never needs plaintext audio or position semantics, only to keep
forwarding individual encrypted tracks as opaque frames.

## Low-Bandwidth Side-Channel Features (Reactions, Raise-Hand, Annotation)

**Implementation**: WebRTC DataChannel (SCTP over the existing ICE/DTLS
path) carrying small JSON/binary messages, typically configured
unreliable/unordered for ephemeral events (a dropped "thumbs up" doesn't
need guaranteed delivery, and this minimizes retransmission latency).

**Where it runs**: signaling/data plane, parallel to but independent from
the media plane — doesn't compete with audio/video bandwidth since it uses
a separate SCTP-over-DTLS channel.

**E2EE compatibility**: ⚠️ Nuanced. DataChannel traffic through an SFU is
only encrypted hop-by-hop via DTLS (SFU-to-client), not sender-to-receiver
— the SFU can read plaintext DataChannel contents by default. A product
claiming full E2EE needs to apply its own SFrame-style application-layer
encryption to DataChannel payloads (using the same key material as media)
if it wants raise-hand/reaction/annotation data to carry the same E2EE
guarantee, rather than assuming "it's WebRTC so it's already E2E."

## Bot/AI Participants (Notetakers, Agents)

**Implementation**: any automated participant that needs to *understand*
media content (an AI notetaker, a translation bot, a moderation-signal
agent) is architecturally just another call participant from the SFU's
perspective.

**E2EE compatibility**: ⚠️ Only if explicitly admitted. LiveKit's documented
pattern: "if your application uses LiveKit Agent hosting and the agent
needs to participate in an E2EE session... you need to provide the agent
with access to decryption keys" — the bot becomes a cryptographically
trusted call member, not a magic server-side exception. This is the
correct general pattern for any feature that seems to need "just a little"
server-side content access: make the access explicit and keyed, don't
carve a silent hole in the encryption boundary.

## Summary Table

| Feature | Survives E2EE? | Redesign needed if not |
|---|---|---|
| Virtual backgrounds/blur | ✅ | — |
| Noise suppression | ✅ (if on-device) | Move off cloud-processing SDK mode |
| Active-speaker detection | ✅ | Use RFC 6464 cleartext header extension |
| Breakout rooms | ✅ | — (per-room re-key is built into the pattern) |
| Spatial audio | ✅ | — |
| On-device captions | ✅ | — |
| Cloud captions/transcription | ❌ | Move to on-device ASR, or admit as trusted participant |
| Server-side composite recording | ❌ | Move to client-side recording, or admit recorder as trusted participant |
| DataChannel messages | ⚠️ | Apply SFrame-style encryption to DataChannel payloads too |
| Bot/AI participants | ⚠️ | Issue real decryption keys; treat as a trusted member |

## Decision Framework

For each planned feature, ask in order:
1. **Does this need decoded/plaintext media, or only metadata** (loudness,
   layer selection, congestion signals, packet loss)? Metadata-only can
   ride in cleartext RTP header extensions alongside E2E-encrypted payload
   — no compromise needed.
2. **If it needs decoded media, can the processing move client-side**
   (segmentation, noise suppression, on-device ASR)? If yes, do that — it's
   usually cheaper than server-side processing anyway, independent of any
   E2EE requirement.
3. **If it must run server-side or via a third-party API, admit that
   processor as a cryptographically trusted participant** with real
   decryption keys, and disclose the trust boundary in the product UI —
   don't market "end-to-end encrypted" while silently piping plaintext to
   an unlisted trusted party.
