# WebRTC Ad-Hoc Video Chat

Architectural skill for designing ad-hoc WebRTC video/audio chat: 1:1 calls,
group calls, and shareable "party link" rooms. Covers mesh/SFU/MCU topology
choice, LiveKit vs mediasoup vs fully-managed platform selection, TURN/STUN/
ICE bandwidth budgeting, simulcast/active-speaker scaling, and party-link
security plus live-moderation controls.

## Structure

```
webrtc-adhoc-video-chat/
├── SKILL.md                                    # Core decision trees, anti-patterns
├── CHANGELOG.md                                # Version history
├── README.md                                   # This file
├── references/
│   ├── sfu-selection-guide.md                  # Mesh/SFU/MCU + LiveKit/mediasoup/managed trade-offs
│   ├── turn-stun-ice-and-scaling.md            # NAT traversal mechanics, TURN budgeting, simulcast
│   └── party-link-and-moderation.md            # Room-token pattern, live moderation, recording data handling
└── scripts/
    ├── topology_bandwidth_calculator.py        # kbps/Mbps math for mesh vs SFU vs MCU (stdlib only)
    └── party_link_token.py                     # Runnable room-token create/mint/verify demo (stdlib only)
```

## Quick Start

1. Read SKILL.md for the topology/platform decision tree and the three
   headline anti-patterns.
2. Run `python3 scripts/topology_bandwidth_calculator.py --participants 4 8 20`
   to see why mesh collapses past ~4 participants, in real numbers.
3. Run `python3 scripts/party_link_token.py demo` to see the full room-token
   create → mint → verify → tamper → reject flow end to end.
4. Drill into `references/` only for the topic you actually need — each file
   stands alone.
