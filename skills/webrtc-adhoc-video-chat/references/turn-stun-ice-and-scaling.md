# TURN/STUN/ICE Mechanics, Bandwidth Budgeting, and Group-Call Scaling

Read this when you need the actual mechanics of NAT traversal and cost
budgeting for TURN, or when a group call's UI/CPU is falling over past
6-8 visible participants and you need the simulcast + active-speaker fix.
For topology/vendor selection, see `references/sfu-selection-guide.md`.

## STUN, TURN, ICE — what each one actually does

**STUN (Session Traversal Utilities for NAT)**: a lightweight protocol a
client uses to ask a public server "what is my public IP:port, as seen from
the outside?" This lets two peers behind NAT discover addresses they can
potentially reach each other on, without a public IP being permanently
allocated. STUN servers are cheap to run (they don't relay any media, just
answer a lookup) and many are free/public.

**TURN (Traversal Using Relays around NAT)**: when direct connectivity fails
— because of a **symmetric NAT** (a NAT that assigns a different external
port for every destination, defeating the STUN-discovered address), a
restrictive corporate/school firewall, or carrier-grade NAT — the client
falls back to relaying its media *through* a TURN server. The TURN server
sits in the actual media path and forwards every packet. This makes TURN
fundamentally different in cost profile from STUN: **TURN relay consumes
real, sustained bandwidth proportional to call volume and duration**, not a
handful of lookup packets.

**ICE (Interactive Connectivity Establishment)**: the overall framework that
gathers a set of candidate addresses (host/local, STUN-reflexive, TURN-relay)
for each peer, exchanges them via the signaling channel, and tries them in
priority order (direct/host candidates first, STUN-reflexive next, TURN-relay
last) until a working pair is found. "ICE negotiation" is this
candidate-gathering-and-pairing process; "ICE restart" is re-running it
mid-call when the network path changes (e.g. Wi-Fi to cellular handoff).

## Budget TURN relay bandwidth as its own infrastructure line item

A commonly cited industry figure is that **roughly 10-20% of real-world
WebRTC connections require TURN relay** to succeed at all — symmetric NATs,
locked-down corporate networks, and some mobile carrier NATs are common
enough that "most connections go direct or through a light STUN-assisted
path" is not a safe assumption at any real scale.

Practical implications:
- TURN bandwidth is **not** a rounding error once you have meaningful
  traffic. If 15% of participant-minutes relay through TURN at full video
  bitrate, that's real, budgeted infrastructure cost — model it explicitly
  (server bandwidth pricing × expected relay percentage × expected
  participant-minutes), not as an afterthought bolted onto the SFU bill.
- Self-hosting TURN (e.g. coturn) means operating and scaling that relay
  bandwidth yourself. Managed platforms (LiveKit Cloud, Daily, Twilio,
  Agora) typically bundle TURN, but check whether relay bandwidth is billed
  separately or capped — it's a common place for surprise overage costs.
- Always configure **both** a STUN server and a TURN server (with
  credentials) in your ICE server list. A STUN-only configuration will
  simply fail to connect for the fraction of users behind symmetric NATs —
  there's no fallback, the call just doesn't work for them, silently.

## Group-call scaling: don't render every tile unconditionally

The naive group-call UI subscribes to and decodes every remote participant's
video track and renders every tile, all the time. This works fine at 2-4
participants and starts costing you real client CPU/battery/bandwidth well
before you'd guess — most teams notice trouble somewhere around **6-8
visible tiles**, though the exact threshold depends on resolution and device.

Two techniques fix this, and you generally want both:

**Simulcast**: the *publishing* client encodes and sends multiple resolution/
bitrate layers of its own video (e.g. 180p, 360p, 720p) simultaneously. The
SFU then forwards **the appropriate layer** to each subscriber based on that
subscriber's available bandwidth and how large the tile is actually rendered
on their screen — a participant shown in a small grid tile gets the 180p
layer; a participant in the focused/pinned speaker view gets 720p. This is
what lets an SFU-based group call gracefully degrade instead of falling over:
the server-side forwarding decision adapts per-subscriber without the
publisher having to know anything about who's watching or how.

**Active-speaker detection**: use server- or client-side audio-level signals
to identify which 1-4 participants are actually speaking right now, and
prioritize decoding/rendering full-resolution video for *those* tiles while
other participants' tiles stay at a low-resolution layer (via simulcast) or
are paused/not decoded at all in large rooms. This is what makes 20+, 50+,
or 100+ participant rooms viable on ordinary client hardware: the client
never has to fully decode more video than a viewer can meaningfully look at
in a grid.

Without these, a room with 10 unconditionally-decoded 720p tiles will
saturate mid-range mobile CPUs and drain battery fast — the fix is
architectural (simulcast + active-speaker), not "just lower resolution for
everyone," which degrades quality for the small-room case that didn't need it.

## Anti-Pattern: Rendering All Video Tiles Unconditionally

**Novice**: "We subscribe to every participant's track and render every tile
in the grid — it's simpler code, and the SFU handles the relay so client cost
isn't our problem."

**Expert**: Client cost absolutely is your problem — decode cost, render
cost, and battery drain scale with the number of tiles actually decoded at
full resolution, and none of that is absorbed by the SFU. Past roughly 6-8
visible tiles on typical hardware, unconditional full-resolution rendering
degrades the experience for everyone in the room, often invisibly (dropped
frames, fan spin-up, battery drain) rather than with an obvious error. The
fix is subscribing to lower simulcast layers for off-screen or small tiles
and reserving full resolution for the active speaker / pinned view.

**Timeline**: This became the standard expectation once simulcast support
matured across major SFUs (Janus, mediasoup, LiveKit) and became a checkbox
feature in the SDK layer rather than something teams hand-rolled — by the
early 2020s "does your group-call UI do simulcast + active-speaker
prioritization" was a reasonable question to ask in an architecture review,
and by 2026 shipping without it on any room size above a small huddle is a
known scaling gap, not a stylistic choice.
