# E2EE Video Conferencing Pipeline

Architects the encryption, codec/transport, and premium-feature layer of a group video-calling product — the layer that sits on top of an already-chosen SFU topology (see `webrtc-adhoc-video-chat` for that layer).

## Structure

```
e2ee-video-conferencing-pipeline/
├── SKILL.md                                      # Core process, decision trees, anti-patterns
├── CHANGELOG.md
├── README.md                                     # This file
├── references/
│   ├── e2ee-key-management-patterns.md           # Zoom/Signal/MLS-TreeKEM/Telegram approaches
│   ├── codec-and-transport-selection.md          # AV1/VP9 SVC, Opus, WHIP/WHEP, Media-over-QUIC
│   ├── premium-feature-e2ee-compatibility.md     # What survives E2EE vs. what structurally can't
│   └── platform-case-studies.md                  # Zoom/Telegram/Discord/Meet internals
└── scripts/
    └── rekey_cost_calculator.py                  # Group-rekey cost estimator for membership changes
```

## Composes with

`webrtc-adhoc-video-chat` (topology/platform choice), `managed-video-streaming-pipeline` (shares codec/transport ground for one-way delivery), `realtime-messaging-backend-architecture` (DataChannel signaling overlap).

## Quick Start

1. Confirm topology/platform is already chosen (`webrtc-adhoc-video-chat`) — this skill assumes an SFU exists.
2. Read `SKILL.md`'s core decision tree to pick an E2EE key-management pattern.
3. Consult `references/premium-feature-e2ee-compatibility.md` before promising any "premium" feature under an E2EE claim.
