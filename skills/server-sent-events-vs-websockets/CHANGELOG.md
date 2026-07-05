# Changelog — server-sent-events-vs-websockets

## [0.2.0] — 2026-07-04

Brought to the agentic-family standard: added io-contract/provenance/pairs-with frontmatter; added deterministic audit helper (`scripts/sse_ws_channel_audit.mjs`), draft-07 schema, verified sample input; added Quality Gates.

## [0.1.0]

Initial authoring: single-file `SKILL.md` covering the SSE-vs-WebSocket decision diagram, wire formats (WHATWG `text/event-stream`, RFC 6455 frames), reconnection models (`Last-Event-ID`, jittered backoff), the HTTP/1.1 6-per-origin limit, heartbeats and backpressure, and the proxy-buffering silent killer. Grounded in WHATWG, RFC 6455, MDN.
