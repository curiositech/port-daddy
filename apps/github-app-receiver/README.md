# github-app-receiver

Cloudflare Worker that receives webhook POSTs from a GitHub App, verifies the
`X-Hub-Signature-256` HMAC against `GITHUB_WEBHOOK_SECRET`, normalizes the
payload into a stable envelope, and forwards it to the operator's Port Daddy
daemon.

The daemon-side fleet engine subscribes to the resulting
`github:webhook:<event>` tube channel and dispatches whichever ships are
declared in the target repository's `pd-fleet.yml`.

## Response codes

| Code | Meaning |
| ---- | ------- |
| 204  | Signature verified, envelope forwarded |
| 400  | Missing GitHub headers or malformed JSON |
| 401  | Missing or invalid signature |
| 405  | Non-POST request |
| 500  | Worker misconfigured (secret or forward URL unset) |
| 502  | Forward to daemon failed (after timeout / non-2xx) |

A 502 is recoverable: GitHub's redelivery queue will retry. A 401 is not.

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

Forward requests also carry these headers for routing without re-parsing the
body:

- `x-pd-webhook-event`
- `x-pd-webhook-delivery`
- `x-pd-webhook-channel`
- `authorization: Bearer <FORWARD_AUTH_TOKEN>` (only if set)

## Environment

Set via `wrangler.toml` (`[vars]`) or `wrangler secret put`.

| Name | Kind | Required | Notes |
| ---- | ---- | -------- | ----- |
| `GITHUB_WEBHOOK_SECRET` | secret | yes | Must match the secret on the GitHub App |
| `DAEMON_FORWARD_URL`    | var    | yes | HTTPS URL the daemon (or its public tunnel) accepts POSTs on |
| `FORWARD_AUTH_TOKEN`    | secret | no  | Bearer token the daemon checks; recommended for prod |
| `FORWARD_TIMEOUT_MS`    | var    | no  | Forward timeout in ms, default 8000 |

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

# 4. (Optional) Set a bearer token the daemon will check on forward.
echo "$(openssl rand -hex 32)" | npx wrangler secret put FORWARD_AUTH_TOKEN

# 5. Edit wrangler.toml and set DAEMON_FORWARD_URL to the HTTPS URL the
#    daemon (or its tunnel) accepts. Examples:
#      - dev:  https://smee.io/<your-channel>
#      - prod: https://<tunnel>.trycloudflare.com/github/webhook
#              https://<host>/github/webhook   (any reverse proxy)

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

## Daemon-side intake

The forward target is whatever HTTPS URL the operator exposes. Two common
patterns:

- **Dev**: point `DAEMON_FORWARD_URL` at a smee.io channel and run
  `smee --url <channel> --target http://127.0.0.1:9876/github/webhook`
  alongside the daemon. The daemon then has a small HTTP handler that
  reads the envelope and publishes it to the
  `github:webhook:<event>` channel via the existing
  `POST /msg/:channel` route.

- **Prod**: front the daemon with a tunnel (`cloudflared`, `ngrok`,
  Tailscale Funnel) and set `DAEMON_FORWARD_URL` to the public URL.
  Set `FORWARD_AUTH_TOKEN` so the daemon can reject unauthenticated
  requests.

The envelope shape is stable across both — the daemon does not need to
know which transport delivered it.

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
signature, expects 204, then re-POSTs with a zeroed signature and
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
