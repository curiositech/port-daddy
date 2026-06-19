# Relay PKI Tutorial

ADR-0025 chooses an OIDC-first relay identity model with ACME reserved as a
first-class proof method and Web-of-Trust limited to self-hosted, harbor-local
deployments.

## Reproduce The Decision Matrix

```bash
printf '%s\n' '{"kind":"request","version":"1","command":"pki.score","payload":{"options":["ACME","OIDC","WoT","Hybrid"]}}' \
  | python3 skills/pd-relay-zero-trust/scripts/pki_decision.py \
  | jq -r '.result.ranked[] | "\(.option) \(.score)"'
```

Expected output:

```text
OIDC 153
Hybrid 153
WoT 141
ACME 137
```

The tie does not auto-decide the architecture. ADR-0025 applies reversibility,
operational bus factor, security-research surface, and ProVerif modeling cost
to choose OIDC-first for v0.

## v0 Boundary

- Managed/default bootstrap: OIDC exchange into short-lived Port Daddy cards.
- ACME: proof metadata for DNS/name control, not the daemon transport
  credential.
- WoT: self-hosted and harbor-local only, with explicit admin-approved
  fingerprint allowlists or signed pairing receipts.
- Relay payloads: encrypted end-to-end; PKI does not grant the relay plaintext.
