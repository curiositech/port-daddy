type: security

- **Fleetbot publication now requires one exact, daemon-signed authority grant.** Relay binds each expiring capability to the account, daemon key generation, session, repository, operation, base, head, and canonical request; consumes its nonce durably; bounds the envelope before parsing; fences D1 leases; scans complete GitHub pagination; and recovers ambiguous writes through stable-marker readback instead of blind retries.
