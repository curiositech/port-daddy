# github-app-receiver

Cloudflare Worker that receives webhook POSTs from a GitHub App, verifies the
`X-Hub-Signature-256` HMAC against `GITHUB_WEBHOOK_SECRET`, and runs the PR
review fleet in Cloudflare Workers AI under the `port-daddy-fleet[bot]` GitHub
App identity.

The Worker can also mirror remote activity back into Port Daddy. Set
`PORT_DADDY_TELEMETRY_URL` to a daemon/tunnel URL ending in
`/telemetry/cloud-app`, set the matching daemon token as
`PD_CLOUD_APP_TELEMETRY_TOKEN` or `PD_REMOTE_TELEMETRY_TOKEN`, and store the same
value in the Worker secret `PORT_DADDY_TELEMETRY_TOKEN`.

## Response codes

| Code | Meaning |
| ---- | ------- |
| 202  | Signature verified, fleet dispatch accepted |
| 400  | Missing GitHub headers or malformed JSON |
| 401  | Missing or invalid signature |
| 405  | Non-POST request |
| 500  | Worker misconfigured (required secret unset) |

A 401 is not recoverable until the GitHub App webhook secret matches the Worker.

## Envelope shape

```json
{
  "received_at": "2026-05-22T18:04:11.812Z",
  "event": "pull_request",
  "delivery": "01HXP6...",
  "channel": "github:webhook:pull_request",
  "action": "opened",
  "repository": { "full_name": "curiositech/port-daddy", "id": 100 },
  "installation_id": 9999,
  "sender": { "login": "octocat", "id": 1 },
  "payload": { "...": "raw GitHub payload, unmodified" }
}
```

Remote telemetry requests are separate from the webhook envelope and POST JSON
to `/telemetry/cloud-app` with `authorization: Bearer <PORT_DADDY_TELEMETRY_TOKEN>`.

## Environment

Set via `wrangler.toml` (`[vars]`) or `wrangler secret put`.

| Name | Kind | Required | Notes |
| ---- | ---- | -------- | ----- |
| `GITHUB_WEBHOOK_SECRET` | secret | yes | Must match the secret on the GitHub App |
| `GITHUB_APP_ID` | var | yes | Numeric GitHub App ID |
| `GITHUB_APP_PRIVATE_KEY` | secret | yes | RSA private key PEM, raw or base64 |
| `PORT_DADDY_TELEMETRY_URL` | var | no | HTTPS URL ending in `/telemetry/cloud-app` |
| `PORT_DADDY_TELEMETRY_TOKEN` | secret | no | Bearer token checked by the daemon telemetry route |
| `PORT_DADDY_TELEMETRY_TIMEOUT_MS` | var | no | Telemetry POST timeout, default 3000 |

## Operator setup

```bash
# 1. Install dependencies
cd apps/github-app-receiver
npm install

# 2. Authenticate wrangler (one-time per machine)
npx wrangler login

# 3. Set the webhook secret. Use the same value when registering the
#    webhook on the GitHub App.
echo "$(openssl rand -hex 32)" | npx wrangler secret put GITHUB_WEBHOOK_SECRET

# 4. Set the GitHub App private key.
cat ~/.cloudflared/github-app.pem | base64 | npx wrangler secret put GITHUB_APP_PRIVATE_KEY

# 5. Optional telemetry mirror back into Port Daddy.
TELEMETRY_TOKEN="$(openssl rand -hex 32)"
printf '%s' "$TELEMETRY_TOKEN" | npx wrangler secret put PORT_DADDY_TELEMETRY_TOKEN
# Set the daemon side to the same value as PD_CLOUD_APP_TELEMETRY_TOKEN or
# PD_REMOTE_TELEMETRY_TOKEN, then point PORT_DADDY_TELEMETRY_URL at:
#   https://<tunnel-or-host>/telemetry/cloud-app

# 6. Deploy
npx wrangler deploy
# → Published github-app-receiver
#   https://github-app-receiver.<account>.workers.dev

# 7. Register that URL on the GitHub App's webhook settings, using the
#    same secret from step 3.
```

## GitHub App webhook URL

Paste the URL printed by `wrangler deploy` into the GitHub App's
**Webhook URL** field. It follows this pattern:

```
https://github-app-receiver.<your-cloudflare-subdomain>.workers.dev
```

The webhook secret field on the GitHub App must match the value passed to
`wrangler secret put GITHUB_WEBHOOK_SECRET`. Subscribe to whichever events
your `pd-fleet.yml` cares about (typically `pull_request`, `push`,
`check_run`, `check_suite`, `issue_comment`).

## Daemon-side telemetry intake

Remote fleet activity lands in Port Daddy at `POST /telemetry/cloud-app`.
The route fails closed unless the daemon has `PD_CLOUD_APP_TELEMETRY_TOKEN` or
`PD_REMOTE_TELEMETRY_TOKEN` set and the Worker sends the same value as a bearer
token. Operators can read the mirrored activity at `GET /telemetry/cloud-app`;
`GET /metrics/cost` also includes a `remote.cloudApp` block beside local spawner
spend.

## Smoke test

After `wrangler dev` (or against a deployed Worker), with the secret in
your shell:

```bash
GITHUB_WEBHOOK_SECRET=<same-value-as-the-Worker-secret> \
  ./scripts/smoke-test.sh

# Or against deployed:
WORKER_URL=https://github-app-receiver.<acct>.workers.dev \
GITHUB_WEBHOOK_SECRET=<prod-secret> \
  ./scripts/smoke-test.sh
```

The script POSTs a synthetic `pull_request.opened` payload with a valid
signature, expects 202, then re-POSTs with a zeroed signature and
expects 401.

## Tests

```bash
npm install
npm test          # vitest run
npm run typecheck # tsc --noEmit
```

Tests cover signature verification (pass, fail, missing, wrong prefix),
constant-time compare, envelope normalization, forwarding (success,
non-2xx, network error, timeout headers), and Worker fetch handler
status codes for every branch.
