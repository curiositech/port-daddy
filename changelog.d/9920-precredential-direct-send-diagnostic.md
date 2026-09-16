type: fixed

- **Pre-credential direct-message contexts now fail locally with a successor-session instruction.** `pd send` and `pd inbox send` refuse to transmit a persisted session that has no daemon-minted credential, preserve the no-recovery boundary, and point the caller to `pd session takeover`; `tests/integration/cli.test.js` proves neither alias delivers the message.
