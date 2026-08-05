# GitHub App receiver deployment

The GitHub App receiver is a Cloudflare Worker. It receives GitHub webhooks,
verifies GitHub's `X-Hub-Signature-256`, runs the configured cloud review fleet,
and posts back as the GitHub App. The core dispatch path does **not** forward a
webhook into a laptop daemon and does not require a tunnel.

GitHub documents HMAC-SHA256 verification and constant-time comparison in
[Validating webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries).
Cloudflare documents Worker secret storage in
[Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

## Runtime path

```text
GitHub webhook
  -> github-app-receiver Worker
     -> verify exact raw payload and X-Hub-Signature-256
     -> select the declared cloud fleet
     -> run Workers AI reviewers
     -> mint an installation token
     -> publish checks/comments as the App
```

Optional telemetry is a separate outbound Worker call to
`POST /telemetry/cloud-app`. It may use a named Cloudflare Tunnel to reach a
selected daemon, but telemetry failure must not change webhook acceptance or
review completion.

## Build and configure

```bash
cd apps/github-app-receiver
bun install
bun run typecheck
bun run test
cp wrangler.toml.example wrangler.toml
```

Set non-secret bindings such as `GITHUB_APP_ID` in the untracked
`wrangler.toml`. Put credentials in Worker secrets:

```bash
bunx wrangler login
bunx wrangler secret put GITHUB_WEBHOOK_SECRET
bunx wrangler secret put GITHUB_APP_PRIVATE_KEY
```

The webhook secret must exactly match the GitHub App setting. The private key
is the App credential; never commit it or pass it in argv. `wrangler secret
put` creates a deployed Worker version, so record the resulting revision in
the release evidence.

## Deploy and wire GitHub

```bash
bunx wrangler deploy --dry-run
bunx wrangler deploy
```

Paste the deployed Worker URL into the GitHub App's Webhook URL field and
subscribe only to events used by the fleet configuration. Keep the webhook
secret synchronized with `GITHUB_WEBHOOK_SECRET`.

The receiver returns:

| Status | Meaning |
|---|---|
| `202` | Signature verified and dispatch accepted |
| `400` | Required GitHub headers or JSON are malformed |
| `401` | Signature missing or invalid |
| `405` | Method is not POST |
| `500` | Required Worker binding or secret is absent |

## Optional daemon telemetry

Stable and named development daemons publish their own loopback endpoints.
Resolve the selected profile before starting a tunnel; never type a daemon
port or cache an endpoint from another profile.

```bash
eval "$(pd use stable)" # or: pd use <named-feature-daemon>
: "${PORT_DADDY_URL:?pd use did not publish a daemon URL}"
cloudflared tunnel --url "$PORT_DADDY_URL"
```

Quick tunnels are development-only; Cloudflare recommends a named tunnel for
production ingress. See [Cloudflare Tunnel setup](https://developers.cloudflare.com/tunnel/setup/).

Configure the Worker:

```toml
[vars]
PORT_DADDY_TELEMETRY_URL = "https://<named-host>/telemetry/cloud-app"
PORT_DADDY_TELEMETRY_TIMEOUT_MS = "3000"
```

Generate one bearer value. Store it as `PORT_DADDY_TELEMETRY_TOKEN` in the
Worker and as a managed daemon credential (`PD_CLOUD_APP_TELEMETRY_TOKEN` or
`PD_REMOTE_TELEMETRY_TOKEN`) through FleetBar Credentials. Do not fall back to
a repository `.env.local`.

## Verification

```bash
cd apps/github-app-receiver
WORKER_URL=https://<deployed-worker> \
GITHUB_WEBHOOK_SECRET=<matching-test-secret> \
  ./scripts/smoke-test.sh
```

The smoke sends one signed event and one invalid signature. Then create or
redeliver a real GitHub event and prove all of the following from the same
deployed Worker revision:

- GitHub records a successful delivery;
- the receiver records the delivery id and accepted dispatch;
- the expected reviewers run once;
- the App publishes the expected check/comment;
- optional telemetry, if enabled, appears at the selected daemon with the same
  correlation id;
- no secret value appears in logs, receipts, process arguments, or artifacts.

Do not call the deployment complete from a dry run, `wrangler whoami`, or a
synthetic response alone.
