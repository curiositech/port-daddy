# GitHub App — Deploy Runbook (registered → live)

How to take the Port Daddy Fleet GitHub App from **registered** (the
irreversible manifest-create step the operator has already done) to **live**
(a real `pull_request` webhook fires a ship that posts back on the PR).

This is a *how-to* (Diátaxis). It assumes the App is already registered and its
credentials exist locally. It does **not** cover re-registering the App — that
manifest-create flow is one-time and done.

> **Audience.** An operator with shell access to the daemon host and the
> Cloudflare account that will host the receiver Worker. No prior knowledge of
> the receiver internals is assumed.

---

## 0. What already exists (do not redo)

The GitHub App is registered. Its credentials live in
`/Users/erichowens/coding/port-daddy/.env.local`:

| Var | Meaning |
| --- | --- |
| `GITHUB_APP_ID` | numeric App ID, from the App settings page |
| `GITHUB_APP_INSTALLATION_ID` | per-install ID, from the post-install redirect URL |
| `GITHUB_WEBHOOK_SECRET` | 64-char HMAC secret registered on the App's webhook |
| `GITHUB_PRIVATE_KEY_PATH` | path to the App's PEM (`~/.port-daddy/github-app-private-key.pem`, present) |

**`GITHUB_WEBHOOK_SECRET` is the single value that must match in three places:**
the GitHub App webhook settings, the **receiver Worker** secret, and (because
the daemon route also supports direct-HMAC auth) optionally the daemon's
`PD_GITHUB_WEBHOOK_SECRET`. Treat it as the load-bearing shared secret.

---

## 1. The dispatch path (what you are wiring)

```
GitHub  ──webhook (HMAC-signed)──►  Receiver Worker (Cloudflare)
                                       │ verifies X-Hub-Signature-256
                                       │ normalizes → envelope
                                       │ POST DAEMON_FORWARD_URL
                                       │   Authorization: Bearer FORWARD_AUTH_TOKEN
                                       ▼
                          Daemon route  POST /webhooks/github
                          (routes/github-webhook.ts)
                                       │ authenticates the forward
                                       │ resolves repo → project (per-project routing)
                                       │ messaging.publish(channels…)
                                       ▼
                          Fleet engine subscriptions (pd-fleet.yml triggers)
                                       ▼
                          postAs(ship, op) ──► GitHub API as port-daddy-fleet[bot]
```

Two endpoints matter and they are **not** the same string:

- **Receiver Worker public URL** — what you paste into the GitHub App's
  *Webhook URL* field. The Worker only accepts inbound requests under `/msg/*`
  and returns **404** for every other path (the `/msg/*` guard added in #313
  hides the rest of the daemon surface), so the Webhook URL **must** include a
  `/msg/*` path, e.g.
  `https://github-app-receiver.<subdomain>.workers.dev/msg/github:webhook:dispatch`.
  A bare-root Webhook URL silently 404s every delivery.
- **Daemon inbound route** — `POST /webhooks/github` (note the order:
  `/webhooks/github`, **not** `/github/webhook`). This is what
  `DAEMON_FORWARD_URL` must end with. (Distinct from the inbound `/msg/*` path
  above: GitHub → Worker is `/msg/*`; Worker → daemon is `/webhooks/github`.)

> **Doc drift to be aware of.** `apps/github-app-receiver/README.md` and the
> App manifest still reference `/github/webhook` in a couple of examples. The
> route that actually exists in the daemon is `POST /webhooks/github`
> (`routes/index.ts` registers `githubWebhookPlugin`). Always set
> `DAEMON_FORWARD_URL` to `…/webhooks/github`.

---

## 2. Deploy the receiver Worker

```bash
cd apps/github-app-receiver
npm install
npm run typecheck   # tsc --noEmit  (expect clean)
npm test            # vitest        (expect 22 passing)
```

### 2a. Authenticate wrangler

Two ways. **Pick one.**

- **Interactive (recommended for a human at a terminal):**

  ```bash
  npx wrangler login
  ```

  This OAuths a browser session with full Workers-deploy scope.

- **API token (for CI / headless):** export `CLOUDFLARE_API_TOKEN`. The token
  **must** carry the **`Workers Scripts:Edit`** permission (plus
  `Account Settings:Read`). See the blocker note in §5 — the token currently in
  `.env.local` does **not** have this scope.

### 2b. Set the Worker secrets

```bash
# Use the SAME 64-char value as the GitHub App's webhook secret.
printf '%s' "$GITHUB_WEBHOOK_SECRET" | npx wrangler secret put GITHUB_WEBHOOK_SECRET

# Recommended for prod: a bearer the daemon will check on every forward.
FORWARD_AUTH_TOKEN="$(openssl rand -hex 32)"
printf '%s' "$FORWARD_AUTH_TOKEN" | npx wrangler secret put FORWARD_AUTH_TOKEN
# ^ Keep this value. The daemon needs it as PD_GITHUB_FORWARD_TOKEN (step 3).
```

### 2c. Point the Worker at the daemon

Edit `apps/github-app-receiver/wrangler.toml`, `[vars]`:

```toml
[vars]
DAEMON_FORWARD_URL = "https://<your-tunnel-or-host>/webhooks/github"
FORWARD_TIMEOUT_MS = "8000"
```

For `<your-tunnel-or-host>` see §4 (the daemon binds loopback; it needs a
public ingress).

### 2d. Deploy

```bash
npx wrangler deploy
# → Published github-app-receiver
#   https://github-app-receiver.<subdomain>.workers.dev   ← paste this in step 6
```

A `--dry-run` (build-only, no API call) is a useful pre-flight; it succeeds even
without deploy scope:

```bash
npx wrangler deploy --dry-run
```

---

## 3. Secret coordination: receiver ↔ daemon

The receiver and the daemon authenticate to each other with **two** secrets.

| Secret | Set on the Worker as | Set on the daemon as | Purpose |
| --- | --- | --- | --- |
| GitHub webhook secret | `GITHUB_WEBHOOK_SECRET` | (optional) `PD_GITHUB_WEBHOOK_SECRET` | GitHub→Worker HMAC; the daemon can also verify it directly |
| Forward bearer | `FORWARD_AUTH_TOKEN` | `PD_GITHUB_FORWARD_TOKEN` | Worker→daemon auth on `POST /webhooks/github` |

The daemon route (`routes/github-webhook.ts::authenticate`) accepts **any** of:

1. **Bearer** `Authorization: Bearer <PD_GITHUB_FORWARD_TOKEN>` — the receiver
   path. Set `PD_GITHUB_FORWARD_TOKEN` on the daemon to the same value as the
   Worker's `FORWARD_AUTH_TOKEN`. **This is the recommended prod setup.**
2. **HMAC** `X-Hub-Signature-256` over the raw body, keyed by
   `PD_GITHUB_WEBHOOK_SECRET` — used if GitHub hits the daemon directly (no
   Worker) or if the Worker forwards the original signature.
3. **Dev bypass** `PD_GITHUB_WEBHOOK_ALLOW_UNAUTH=1` — local only, never prod.

If neither `PD_GITHUB_FORWARD_TOKEN` nor `PD_GITHUB_WEBHOOK_SECRET` is set, the
route rejects every request with 401 (fail-closed).

Put the daemon-side secrets in the daemon's environment (the daemon reads
`.env.local` at boot via `lib/env-loader.ts`):

```bash
# in /Users/erichowens/coding/port-daddy/.env.local
PD_GITHUB_FORWARD_TOKEN=<same as the Worker's FORWARD_AUTH_TOKEN>
# optional, for the direct-HMAC path:
PD_GITHUB_WEBHOOK_SECRET=<same as GITHUB_WEBHOOK_SECRET>
```

Then restart the daemon so it picks them up (`pd restart`, or the brew service
restart — see `docs/operations/daemon-and-supervision.md`).

---

## 4. DAEMON_FORWARD_URL — exposing the daemon

The daemon binds loopback (`127.0.0.1:9876` by default). The Worker runs on
Cloudflare's edge, so it needs a **public** HTTPS ingress to the daemon.

- **Dev (smee.io):**

  ```bash
  # DAEMON_FORWARD_URL = https://smee.io/<your-channel>
  npx smee --url https://smee.io/<your-channel> \
           --target http://127.0.0.1:9876/webhooks/github
  ```

- **Prod (Cloudflare Tunnel — recommended, same account as the Worker):**

  ```bash
  cloudflared tunnel --url http://127.0.0.1:9876
  # prints https://<random>.trycloudflare.com
  # DAEMON_FORWARD_URL = https://<random>.trycloudflare.com/webhooks/github
  ```

  For a stable hostname, create a named tunnel + DNS route instead of the
  quick `--url` form. `ngrok` and Tailscale Funnel work the same way.

Whatever the host, **`DAEMON_FORWARD_URL` must end in `/webhooks/github`.**

---

## 5. ⚠ Current blocker — Cloudflare token lacks Workers-deploy scope

`npx wrangler deploy` was attempted on 2026-06-05 with the
`CLOUDFLARE_API_TOKEN` from `.env.local`. Result:

```
✘ [ERROR] A request to the Cloudflare API
  (/accounts/1f7b49a13841037a867d879bd01af641/workers/services/github-app-receiver) failed.
  Authentication error [code: 10000]
```

`wrangler whoami` **succeeds** with this token (it reads account settings), and
`wrangler deploy --dry-run` builds clean — so the build and the credential are
fine. The token simply **lacks the Workers-deploy permission**. (This is the
same token that 401'd on Workers AI earlier.)

**Exact remaining manual step (operator's hands required):**

Either —

- **A. Mint a token with the right scope** at
  `https://dash.cloudflare.com/1f7b49a13841037a867d879bd01af641/api-tokens`
  with at least:
  - **Account › Workers Scripts › Edit**
  - **Account › Account Settings › Read**
  - (if you later add KV/D1/R2 bindings, add those Edit scopes too)

  Then replace `CLOUDFLARE_API_TOKEN` in `.env.local` and re-run
  `npx wrangler deploy`.

- **B. Or use interactive auth** (simplest if a human is at the machine):

  ```bash
  cd apps/github-app-receiver
  npx wrangler login        # OAuth, full deploy scope
  npx wrangler deploy
  ```

Everything else in this runbook is ready; only this scope grant gates the
deploy.

---

## 6. The installation-id handoff

When the App was installed on a repo, GitHub redirected to a URL containing
`?installation_id=<N>`. That `<N>` is already captured as
`GITHUB_APP_INSTALLATION_ID` in `.env.local`. It is what
`apps/github-app-fleet/lib/auth.ts::getOctokitForInstallation()` uses to mint a
per-install token so the bot can post.

- The installation ID is **per repo/org install**, not global. If you install
  the App on a second org, that install has its own ID; multi-install support
  means storing a `repo → installation_id` map (not yet built — single-install
  today).
- It is **not** a secret on its own; the private key is the credential.

Verify auth is live:

```bash
node -e "
import('./apps/github-app-fleet/lib/auth.js').then(async (m) => {
  const oct = await m.getOctokitForInstallation();
  const me = await oct.apps.getAuthenticated();
  console.log('App slug:', me.data.slug);   // → port-daddy-fleet
});
"
```

---

## 7. Per-project routing (who fires for which repo)

The daemon route does **per-project routing** (added alongside the dispatch
loop): a webhook for `owner/repo` is published on a project-scoped channel so
**only that project's fleet fires**, not every installed repo's.

A project claims a repo two ways (see `lib/github-repo-registry.ts`):

1. **Explicit** in the project's `pd-fleet.yml` (authoritative):

   ```yaml
   github:
     repo: curiositech/port-daddy
     # or several:
     # repos: [curiositech/port-daddy, curiositech/example-service]
   ```

2. **Inferred** from the project's git `origin` remote when no explicit
   declaration exists.

A ship then subscribes with a **bare** trigger — the fleet channel resolver
project-scopes it automatically, so it matches only its own repo:

```yaml
fleet:
  agents:
    reviewer:
      trigger: github:webhook:pull_request          # project-scoped (this repo only)
      # trigger: github:webhook:pull_request:opened # only the "opened" action
```

The unscoped `global:` channels are still published for backward compatibility,
so an existing `trigger: global:github:webhook:pull_request` ship keeps working
(but it fan-outs across every installed repo — prefer the bare, project-scoped
form for new ships).

---

## 8. End-to-end test with a real webhook

### 8a. Smoke the Worker in isolation

```bash
cd apps/github-app-receiver
WORKER_URL=https://github-app-receiver.<subdomain>.workers.dev \
GITHUB_WEBHOOK_SECRET="$GITHUB_WEBHOOK_SECRET" \
  ./scripts/smoke-test.sh
# POSTs a signed pull_request.opened → expects 204
# re-POSTs with a zeroed signature   → expects 401
```

### 8b. Fire a real event from GitHub

1. In the GitHub App settings → **Advanced → Recent Deliveries**, or just open
   and close a PR on an installed repo.
2. Watch the daemon log for the route hit:

   ```bash
   tail -f /Users/erichowens/coding/port-daddy/port-daddy.log | grep github_webhook
   # github_webhook_received  event=pull_request action=opened
   #   repository=curiositech/port-daddy routed_project_dir=/…/port-daddy
   ```

   `routed_project_dir` being non-null confirms per-project routing matched.
3. Confirm a ship posted back on the PR as `port-daddy-fleet[bot]` with a
   `**[pd-<ship>]**` header.

### 8c. Replays and failures

- GitHub keeps a **redelivery** queue. A `502` (daemon/tunnel down) is
  recoverable — redeliver from the App's *Recent Deliveries* once the daemon is
  back. A `401` is not (fix the secret, then redeliver).
- If the Worker returns 204 but no ship fires: the forward reached the daemon
  but no `trigger:` matched. Check the project's `pd-fleet.yml` `github.repo`
  and that the ship's trigger event matches the delivered event.

---

## 9. Quick checklist

- [ ] Worker secrets set: `GITHUB_WEBHOOK_SECRET`, `FORWARD_AUTH_TOKEN`
- [ ] `wrangler.toml` `DAEMON_FORWARD_URL` ends in `/webhooks/github`
- [ ] **`npx wrangler deploy` succeeded** ← blocked on token scope, see §5
- [ ] Worker URL pasted into the GitHub App's *Webhook URL*; webhook secret matches
- [ ] Daemon env has `PD_GITHUB_FORWARD_TOKEN` (= Worker `FORWARD_AUTH_TOKEN`); daemon restarted
- [ ] Public ingress live (tunnel/smee) pointing at `127.0.0.1:9876/webhooks/github`
- [ ] Installed repo's `pd-fleet.yml` declares `github.repo` + at least one ship trigger
- [ ] `getOctokitForInstallation()` prints `port-daddy-fleet`
- [ ] Smoke test green (204 + 401)
- [ ] A real PR event shows `github_webhook_received` with non-null `routed_project_dir`
