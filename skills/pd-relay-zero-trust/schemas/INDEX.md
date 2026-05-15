# schemas/ — Index

| File | When to load |
|------|--------------|
| `script-io.schema.json` | You are writing or validating any script in this skill — all scripts wrap stdin/stdout against this envelope |
| `harbor-card.schema.json` | You are implementing or validating Phase 2 harbor card JWT payloads |
| `attenuated-card.schema.json` | You are implementing or validating Phase 3 attenuated card chains |
| `event-envelope.schema.json` | You are specifying or validating the wire format for events on the relay |
| `merkle-chain-head.schema.json` | You are implementing or validating signed Merkle chain heads |
| `relay-handshake.schema.json` | You are implementing or validating the daemon → relay opening exchange |
