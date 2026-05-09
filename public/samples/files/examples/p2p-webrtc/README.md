# WebRTC Signaling Over Agent Inboxes

This example uses Port Daddy agent inboxes as the signaling layer for a WebRTC
handshake.

It does not open a media connection. That would require browser or native WebRTC
bindings. Instead, it demonstrates the hard coordination part: Agent A sends an
offer, Agent B reads the offer from its durable inbox, Agent B sends an answer,
and Agent A reads the answer back from its own inbox.

## Run It

Start the daemon:

```bash
pd status
```

Run the complete signaling exchange:

```bash
npx tsx examples/p2p-webrtc/webrtc-signaling.ts
```

Run it with explicit agent ids:

```bash
npx tsx examples/p2p-webrtc/webrtc-signaling.ts --caller camera-agent --receiver analysis-agent
```

## What It Demonstrates

- register two local agents
- send an SDP offer through the receiver inbox
- read unread inbox messages
- send an SDP answer back to the caller inbox
- mark inboxes read and unregister the demo agents

Use this shape when the daemon should coordinate who may connect, but the high
bandwidth stream should move directly over WebRTC, WebTransport, or another
peer-to-peer channel.
