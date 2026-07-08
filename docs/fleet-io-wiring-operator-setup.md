# Fleet I/O Wiring — Operator Setup Runbook

**Audience:** the operator (you) standing up fleet triggers/outputs on your own machine.
**Status of surfaces:** live vs. pending is called out per section — nothing here is aspirational.
**Trust model:** every *external* event (webhook/email/calendar/github) is `ANONYMOUS_EXTERNAL`
and must clear an operator approval gate before it can spawn — see ADR-0093. Read the
**Security caveats** at the bottom before arming any external trigger.

---

## 0. One-time: deploy the email-ingress Worker (only if you use email)

The Worker deploys under **OAuth wrangler**, not a repo API token (the repo token lacks the
Email Routing binding scope). **`cd` into the Worker dir first** — running `wrangler deploy`
from the repo root makes wrangler misdetect the repo as a static site and fail on `npx hugo`.
Keep the `cd` in the command so it can't run from the wrong place:

```bash
cd apps/email-ingress && \
  env -u CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID=1f7b49a13841037a867d879bd01af641 \
  npx wrangler@4.107.0 deploy
```

The local wrangler config (gitignored, account-scoped) must exist with a real `account_id`
and a bound KV namespace named `ENVELOPE_DLQ` (dead-letter durability) — copy it from
`apps/email-ingress/wrangler.toml.example` and fill both if it's missing; without the KV
binding, envelopes that fail to reach the daemon during an outage are lost instead of replayed.
Confirm health after deploy:

```bash
curl -s https://<your-worker>.workers.dev/healthz | jq
# { ok, inbound, outbound, dlqDepth, dlqAlert }   ← dlqAlert=true means the backlog needs a look
```

---

## 1. Email OUT — send mail as the operator  ·  **LIVE**

Pick **one** transport (checked in preference order):

| Transport | Env vars | Notes |
|---|---|---|
| Worker (no mailbox creds) | `PD_EMAIL_WORKER_URL`, `PD_EMAIL_WORKER_SECRET` | Cloudflare only delivers to **verified** Email Routing destinations — a structural recipient allowlist. |
| SendGrid | `PD_EMAIL_SENDGRID_KEY`, `PD_EMAIL_FROM` | |
| Postmark | `PD_EMAIL_POSTMARK_KEY`, `PD_EMAIL_FROM` | |

Raw SMTP (`PD_EMAIL_SMTP_*`) is intentionally **not implemented** — a SMTP-only config
reports `{ready:false}` honestly rather than pretending.

**Consent (required):** sending mail as you is high-PII.
```bash
pd fleet consent grant --sink email --tier high     # add a --recipient allowlist if you can
```

---

## 2. Email IN — trigger fleets on inbound mail  ·  **PARTIAL — see ADR-0095**

Today's shipped path: the deployed Worker POSTs an HMAC-signed envelope to the daemon's
`/webhooks/fleet/email-inbound` receiver. That requires the daemon to be **reachable from
Cloudflare** — i.e. a tunnel. **You rejected exposing the daemon over a tunnel** (loopback =
operator trust; a public `:9876` is a wholesale auth-bypass), so email-IN is **paused
pending ADR-0095** (email ingress over the Relay's outbound-dial fabric — no inbound port).

Env vars the receiver path uses (for when ADR-0095 lands or if you accept a tunnel):
`PD_FORWARD_URL` (daemon receiver base), `PD_EMAIL_INBOUND_SECRET` (HMAC),
`PD_EMAIL_INBOUND_CHANNEL` (default `email-inbound`), `PD_FALLBACK_FORWARD` (DLQ fallback).

**Manual step (when you proceed):** add a Cloudflare **Email Routing rule** routing the
address you want to the `pd-email-ingress` Worker.

---

## 3. Calendar — trigger on / create events  ·  **LIVE (two backends)**

**macOS EventKit (local calendars):**
```bash
pd fleet calendar grant      # prompts the OS EventKit permission; one-time
```

**Google Calendar (creds-gated):** set all of —
`PD_GCAL_CLIENT_ID`, `PD_GCAL_CLIENT_SECRET`, `PD_GCAL_REFRESH_TOKEN`,
`PD_GCAL_CALENDAR_ID` (default `primary`). Recurring events are expanded to instances
(`singleEvents=true`); descriptions + attendee lists are dropped before any text reaches an
agent task (data minimization).

Consent for calendar **writes**: `pd fleet consent grant --sink calendar --tier <tier>`.

---

## 4. GitHub — trigger on PR/issue webhooks  ·  **LIVE**

Configure webhook auth (at least one):
- `PD_GITHUB_FORWARD_TOKEN` — bearer the CF forwarder presents, **or**
- `PD_GITHUB_WEBHOOK_SECRET` — GitHub's HMAC secret (origin verification), **or**
- `PD_GITHUB_WEBHOOK_ALLOW_UNAUTH=1` — explicit opt-out (do **not** use in production).

Subscribe in `pd-fleet.yml` with the `global:` prefix for repo-wide listeners, e.g.
`trigger: global:github:webhook:pull_request`, or a bare `github:webhook:*`
trigger for project-scoped repo routing. GitHub remains on the legacy channel
subscription path for compatibility, but the fleet engine now classifies that
legacy message as `github` provenance and runs ADR-0093 before any spawn.

---

## 5. Webhook (generic) — the escape hatch  ·  **LIVE**

`trigger: webhook:my-channel` listens on `/webhooks/fleet/my-channel`. Add
`webhook:my-channel(secret:HMAC_VAR)` to require an `X-PD-Webhook-Signature` HMAC — a spec
that declares a secret whose env var is **unset refuses to start** (fail-closed). Outbound
`webhook:` sinks SSRF-guard the recipient URL and now refuse redirects (a `3xx` is not
chased into the private network).

---

## 6. Push notifications (approval alerts)  ·  **LIVE**

`PD_PUSH_VAPID_SUBJECT` plus the VAPID keys the daemon manages. Held spawn approvals surface
on FleetBar (menu-bar dropdown), the Control Center → Operator surface, and pd-console.

---

## Security caveats — read before arming external triggers

1. **`github:` triggers are approval-gated even on the legacy channel path.** Registry
   triggers (`file`/`webhook`/`email`/`calendar`) pass through `evaluateTrustGate` before
   spawning. `github:*` still subscribes through the engine's legacy channel path to avoid
   double-dispatching existing fleets, but that callback now builds a GitHub provenance
   event and runs the same gate before `requestAgentRun`. If the runner cannot inspect
   GitHub messages in-process, it refuses to arm the trigger instead of falling back to
   `pd watch --exec`.
2. **Transport auth ≠ content trust.** A valid HMAC proves the *relay* holds the secret, not
   that the *author* is trusted. `consent_verified` is only ever raised by content-level
   author verification (email DMARC pass under an author allowlist), never by a webhook
   arriving.
3. **Outbound SSRF is literal-only.** The URL guard blocks private/loopback/metadata hosts
   (incl. decimal/octal/hex/IPv4-mapped-IPv6 forms) and now refuses redirects, but a literal
   guard cannot stop DNS rebinding — the sound mitigation is allowlist-only mode
   (`extras.allowlist`) plus resolve-and-pin at the socket (ADR-0093 residual).
