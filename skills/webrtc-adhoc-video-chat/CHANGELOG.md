# Webrtc Adhoc Video Chat — Changelog

## v1.0.0 (2026-09-19)

- Initial skill creation.
- Core decision tree covering mesh vs SFU vs MCU and LiveKit vs mediasoup vs
  fully-managed platforms (Daily.co, Twilio Video, Agora).
- Three anti-patterns: mesh topology past 4 participants, guessable room IDs
  for party links, rendering all video tiles unconditionally.
- References: `sfu-selection-guide.md`, `turn-stun-ice-and-scaling.md`,
  `party-link-and-moderation.md`.
- Runnable scripts: `topology_bandwidth_calculator.py` (stdlib-only bandwidth
  math for the three topologies), `party_link_token.py` (stdlib-only
  room-scoped token create/mint/verify/tamper-reject demo).
