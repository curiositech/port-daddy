# Example: Phase 3 Attenuation for a GitHub Action

End-to-end walkthrough of using attenuated cards to let a GitHub Action publish to a single channel for the duration of a workflow run, with no long-lived secrets.

## Scenario

Erich's daemon holds a card for `myapp:fleet` with broad caps:
- `pubsub` on `9f1d…c488:myapp:*`
- 120 events / minute
- 128 KB max payload
- 1 hour expiry

He wants the GitHub Action triggered by `workflow_run` to publish PR-opened events on `9f1d…c488:myapp:ci:pr-opened`, capped to 5 events/min, 8KB max, 10 minutes max, no further delegation, audience-restricted to `relay.portdaddy.dev`.

## Step 1 — Daemon-side: mint a delegation key

When the workflow runs, the daemon (or a trusted issuer service) needs to issue an attenuated card to the GH Action. We cannot give the Action the daemon's private key.

Two approaches:

**Approach A** (preferred): The daemon issues a Phase 3 attenuation in advance, sealed for the GH Action's ephemeral key.

**Approach B** (composes with OIDC ADR-0025): The relay accepts the GH Action's OIDC token, verifies claims (`repository == erichowens/port-daddy`), and mints a Phase 3 attenuated card on Erich's behalf using a delegation authority Erich pre-registered.

We walk through Approach B (more dynamic, scales to many actions).

## Step 2 — In the GH Action workflow

```yaml
# .github/workflows/notify-pd.yml
permissions:
  id-token: write     # required for OIDC
  contents: read

jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - name: Get OIDC token for relay
        id: oidc
        run: |
          TOKEN=$(curl -sH "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
            "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=relay.portdaddy.dev/erichowens")
          echo "::add-mask::$TOKEN"
          echo "token=$TOKEN" >> "$GITHUB_OUTPUT"

      - name: Exchange OIDC for attenuated card
        id: card
        run: |
          curl -sX POST https://relay.portdaddy.dev/v1/exchange \
            -H "Authorization: Bearer ${{ steps.oidc.outputs.token }}" \
            -H "Content-Type: application/json" \
            -d '{
              "request": {
                "channels": ["9f1d…c488:myapp:ci:pr-opened"],
                "ops": ["pub"],
                "rate_per_min": 5,
                "max_payload_bytes": 8192,
                "exp_seconds": 600
              }
            }' > attenuated-card.json

      - name: Publish PR-opened event
        run: |
          curl -sX POST https://relay.portdaddy.dev/v1/publish \
            -H "Content-Type: application/json" \
            -H "X-PD-Card: $(cat attenuated-card.json)" \
            -d '{
              "channel": "9f1d…c488:myapp:ci:pr-opened",
              "payload_b64": "<base64 ciphertext envelope>"
            }'
```

## Step 3 — Relay-side: exchange logic

When `/v1/exchange` is hit:

1. Verify Bearer is a valid OIDC JWT signed by `https://token.actions.githubusercontent.com`.
2. Verify `aud` includes `relay.portdaddy.dev/erichowens`.
3. Look up Erich's account by `repository_owner == erichowens` claim.
4. Look up Erich's pre-registered delegation policy: "GH Actions in repo `erichowens/port-daddy` may attenuate to `myapp:ci:*` channels."
5. Build a Phase 3 attenuated card per the request, validating contraction:
   - `channels_allow ⊆ Erich's delegation channels`
   - `ops_allow ⊆ {pub}` (delegation forbids sub for CI)
   - `exp ≤ min(request.exp_seconds, Erich's policy max)`
   - `rate_per_min_max ≤ Erich's policy max`
   - `delegation_allowed = false` (always for OIDC-bootstrapped)
6. Sign the new hop with the relay's per-account delegation key (or with Erich's daemon-issued delegation card on file).
7. Return the chain.

## Step 4 — Publish flow with attenuated card

The GH Action submits the card on every publish. Relay verifies on each request:

1. Parse `X-PD-Card` chain.
2. Walk the chain bottom-up: verify each hop's signature against the previous hop's hash.
3. Apply each caveat to the running effective caps, ensuring **only contraction**.
4. Check the publish request against the leaf caps:
   - `channel` must be in `channels_allow`
   - `op == "pub"` must be in `ops_allow`
   - rate must be within `rate_per_min_max`
   - payload size must be within `max_payload_bytes_max`
   - request time must be within `exp_max`
5. If all pass, persist the event and fan-out.

## Step 5 — Card expires, GH Action job ends

After 10 minutes the card is unusable. If the action's machine is compromised post-run, the leaked card has no value.

If the action needs to keep running longer, it requests a fresh card from `/v1/exchange` (subject to OIDC token validity, which is short-lived).

## Test the verification logic locally

```bash
# Build a chain and verify
echo '{"kind":"request","version":"1","command":"card.attenuate","payload":{
  "verify": true,
  "chain": <paste templates/attenuated-card.json>,
  "request": {"op": "pub", "channel": "9f1d...c488:myapp:ci:pr-opened",
              "exp": 1714061000, "payload_bytes": 4096}
}}' | python scripts/attenuate_card.py
```

Expected: `verdict: "allow"`.

Try `op: "sub"` → `verdict: "deny"` because hop 1 contracted to `pub` only.

Try a too-large payload → `verdict: "deny"`.

## Common mistakes

- **Forgetting `delegation_allowed: false`** — the GH Action could mint further children. Lock it down.
- **Using OIDC token directly on every publish** — wasteful, slow. Exchange once per job, use the card.
- **Not pinning the relay's pubkey** — accept-anything relay defeats the threat model. Pin to a known fingerprint.
- **Letting the relay re-issue from a "service account" daemon key** — that's a high-blast-radius credential. Use per-account delegation keys, rotate.
- **Logging the attenuated card** — they're capability tokens; treat like passwords. Mask in logs.

## Composition

This same pattern works for:
- Slack bot (OIDC from Slack's identity service)
- Linear webhook (Linear OAuth → exchange)
- Browser page (a different bootstrap; see future ADR for browser-WebAuthn flow)
- Custom internal services (mTLS or self-issued OIDC)

The wire format and verifier are the same. Only the bootstrap changes.

## Reading

- `references/harbor-card-attenuation.md`
- `references/pki-options-oidc.md`
- ADR-0014 §2.3 (Phase 3 Delegated)
- Macaroons paper (Birgisson et al., NDSS 2014)
- `templates/attenuated-card.json`
