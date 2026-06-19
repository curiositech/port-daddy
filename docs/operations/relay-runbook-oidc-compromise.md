# Runbook: OIDC Issuer Compromise — Port Daddy Relay

**Triggers this runbook**: Suspected or confirmed compromise of an OIDC issuer used by the relay
(e.g., GitHub Actions OIDC). Symptoms: unexpected token exchanges from unknown repositories,
GitHub security advisory, GitHub themselves announcing a compromise.

**ADR**: ADR-0049 acceptance criterion #5. See also ADR-0025 (PKI decision, acceptance conditions).

**Threat**: A8 (compromised PKI authority). An A8 adversary can mint OIDC tokens that the relay
accepts for identity exchanges, injecting forged daemon fingerprints into the identity registry.

---

## Step 1: Disable the compromised issuer (≤2 minutes)

```bash
export RELAY_URL=https://relay.portdaddy.dev
export OPERATOR_TOKEN=<your-relay-operator-token>

curl -X PUT "${RELAY_URL}/v1/config/issuers/https%3A%2F%2Ftoken.actions.githubusercontent.com" \
  -H "Authorization: Bearer ${OPERATOR_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"disabled": true}'
```

Expected response: `{"ok":true,"issuer_id":"...","disabled":true}`

**Effect**: All future `/v1/exchange` requests from this issuer are immediately rejected with
`ISSUER_DISABLED`. Existing valid PD cards continue to work until they expire (≤1h TTL).

---

## Step 2: Invalidate the JWKS cache (≤1 minute)

```bash
curl -X DELETE "${RELAY_URL}/v1/cache/jwks/https%3A%2F%2Ftoken.actions.githubusercontent.com" \
  -H "Authorization: Bearer ${OPERATOR_TOKEN}"
```

Expected response: `{"ok":true,"issuer_id":"..."}`

**Effect**: The relay's Workers KV cache for this issuer's JWKS is evicted. Any cached keys
from the compromised issuer are cleared. The relay will not serve stale JWKS under the
fail-soft path.

---

## Step 3: Bulk revoke tokens from the compromise window (≤5 minutes)

You need to know when the compromise started (`iat_min`) and ended (`iat_max`).
Use Unix timestamps. If you don't know, be conservative: start from your last
known-good snapshot, end at now.

```bash
# Example: compromise suspected from 2026-06-10T08:00Z to 2026-06-10T10:00Z
IAT_MIN=1749542400   # 2026-06-10T08:00Z
IAT_MAX=1749549600   # 2026-06-10T10:00Z

curl -X POST "${RELAY_URL}/v1/revoke-by-issuer" \
  -H "Authorization: Bearer ${OPERATOR_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"issuer\": \"https://token.actions.githubusercontent.com\",
    \"iat_min\": ${IAT_MIN},
    \"iat_max\": ${IAT_MAX},
    \"reason\": \"oidc-issuer-compromise-2026-06-10\"
  }"
```

Expected response: `{"ok":true,"revoked_count":N,"revoked_jtis":[...]}`

**Effect**: All PD harbor cards exchanged from this issuer in the window are revoked. The relay
broadcasts each revocation on `_relay:revocations`. SLO: ≤5s per batch.

---

## Step 4: Audit — identify affected channels

```bash
# Query audit log for all actions during the compromise window
# Replace FINGERPRINT with any suspicious fingerprint from the revoke response

# First, get list of suspicious fingerprints
echo '(inspect revoked_jtis from step 3 output — map jti → fingerprint via identity registry)'

# Then audit each fingerprint
START_TS=${IAT_MIN}
END_TS=$(date +%s)

curl "${RELAY_URL}/v1/audit?fingerprint=FINGERPRINT&from=${START_TS}&to=${END_TS}" \
  -H "Authorization: Bearer ${OPERATOR_TOKEN}"
```

**Effect**: Provides a full action log (handshakes, publishes, subscriptions, exchanges) for
each affected daemon fingerprint. Use this to identify which channels received injected events.

---

## Step 5: Notify affected harbor members

For each harbor that received events from a revoked fingerprint during the compromise window:

1. Post to `_relay:revocations` channel (already done via bulk revoke broadcast).
2. Send out-of-band notification (Slack, email) to harbor administrators:

   > **Security Notice**: The GitHub Actions OIDC issuer was compromised on [DATE].
   > The relay has revoked all cards issued during [IAT_MIN–IAT_MAX].
   > If your harbor subscriptions include channels that received events in this window,
   > treat those events as potentially forged. Verify against your external Merkle chain anchors.
   > Re-enroll via WoT allowlist or wait for GitHub to restore OIDC integrity and re-enable the issuer.

---

## Step 6: Re-enable issuer after GitHub confirms resolution

Once GitHub confirms the OIDC compromise is resolved:

```bash
curl -X PUT "${RELAY_URL}/v1/config/issuers/https%3A%2F%2Ftoken.actions.githubusercontent.com" \
  -H "Authorization: Bearer ${OPERATOR_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"disabled": false}'
```

New OIDC exchanges will use a fresh JWKS fetch. Daemons and CI runners can re-bootstrap.

---

## Estimated timeline

| Step | Action | Time |
|------|--------|------|
| T+0 | Detection (GitHub advisory or internal alert) | — |
| T+2m | Disable issuer (Step 1) | curl |
| T+3m | Invalidate JWKS cache (Step 2) | curl |
| T+8m | Bulk revoke compromise window (Step 3) | curl |
| T+15m | Audit + identify affected channels (Step 4) | curl + analysis |
| T+30m | Notify harbor members (Step 5) | manual |
| T+Xh | Re-enable issuer after GitHub resolution (Step 6) | curl |

---

## WoT fallback during outage

If the outage is prolonged, daemons can continue publishing via the WoT escape hatch:

1. Operator manually approves daemon Ed25519 fingerprint in the relay's identity registry via
   a direct D1 query:

   ```sql
   INSERT INTO identities (daemon_fingerprint, pub_key, proof_method, proof_metadata)
   VALUES ('<fingerprint>', '<pub_key>', 'wot', '{"approved_by":"operator","reason":"oidc-outage"}');
   ```

2. Daemon uses its existing harbor card (still valid for up to 1h TTL) or gets a new card via
   the WoT path.

---

## Post-incident

After the incident is resolved:

- [ ] Open a `docs/operations/incident-YYYY-MM-DD-oidc-compromise.md` report
- [ ] Document: timeline, affected fingerprints, revoked JTIs, channels impacted
- [ ] Review: was the 5s revocation SLO met? Were there missed fingerprints?
- [ ] Consider: shorten OIDC card TTL from 1h to 15m for this issuer
- [ ] File a follow-up to implement Merkle chain anchor verification so harbor members can
  independently verify event integrity
