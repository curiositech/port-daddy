# MERCY on-call — wiring a page from the hospital ship to a human

MERCY (`src/mercy.ts`) is the relay's hospital ship: a `*/5 * * * *` Cron
Trigger probes D1, KV, the Durable Object channel path, the queue binding, the
fleet executor's liveness signal and the 24h error rate, writes one
`mercy_health` snapshot per sweep, and — on a subsystem's **first red sweep** —
opens a `mercy_incidents` row and POSTs **exactly one** page to
`MERCY_PAGE_WEBHOOK`. The open-incident row is the dedupe: no second page is
sent until the incident resolves and a new red episode begins. (A failed POST
is retried on later sweeps until one delivery succeeds; `paged_at` records the
delivery.)

Read the status anywhere:

- `GET /mercy` — public JSON, no secrets (statuses + latencies only).
- `GET /account/mercy` — logged-in HTML report card (details + incidents).

## 1. The webhook (the part MERCY does for you)

```
echo "<your webhook url>" | wrangler secret put MERCY_PAGE_WEBHOOK -c wrangler.deploy.toml
```

Payload, one POST per new incident:

```json
{
  "source": "port-daddy-relay/mercy",
  "severity": "red",
  "incident_id": "mi_…",
  "subsystem": "do_channel",
  "detail": "probe failed: …",
  "overall": "red",
  "at": 1754300000
}
```

Treat the URL as a secret — PagerDuty and Grafana OnCall ingest URLs embed
routing keys.

Apply the migration once before the first sweep:

```
wrangler d1 execute port-daddy-relay -c wrangler.deploy.toml --remote \
  --file=./migrations/2026-08-04-mercy-health.sql
```

## 2. Honest limits: Cloudflare has NO native on-call rotation

Cloudflare Notifications can email you, hit a webhook, or post to
PagerDuty — but Cloudflare has **no concept of a rotation, escalation policy,
or ack/resolve lifecycle**. If "on-call" means more than "everyone gets the
same email at 3am," you need an external on-call product. Recommended bridges
for `MERCY_PAGE_WEBHOOK`:

- **PagerDuty** (rotations, escalations, ack): create a service with the
  *Events API v2* integration. The Events API wants its routing key in the JSON
  body, so either point MERCY at a tiny transformer (a 10-line Worker that
  wraps MERCY's payload into an `event_action: "trigger"` envelope with your
  routing key and `dedup_key: incident_id`), or use PagerDuty's *Custom Event
  Transformer* app integration, which gives you a URL that accepts arbitrary
  JSON and lets you map it server-side. `incident_id` as `dedup_key` makes
  PagerDuty's dedupe agree with MERCY's.
- **Grafana OnCall** (free tier includes rotations): create an integration of
  type *Webhook*, paste the generated URL into `MERCY_PAGE_WEBHOOK`. Route on
  `subsystem`/`severity` in the integration's templates.

## 3. What to click in the Cloudflare dashboard (defense in depth)

MERCY probes from **inside** the Worker; it cannot notice "the Worker is not
running at all." Two Cloudflare-side alarms cover that blind spot. These are
dashboard actions the operator must perform — nothing in this repo can do them:

**Health Checks** (dash → your account → *Traffic* → *Health Checks* → *Create*):

1. Address: `relay.portdaddy.dev`, protocol HTTPS, path `/mercy`.
2. Expected codes `200`; optionally add a response-body substring check for
   `"overall":"green"` if you want yellow/red (still HTTP 200 by design) to
   trip the health check too — MERCY deliberately keeps /mercy at 200 so the
   page itself stays reachable during degradation.
3. Pick 2–3 check regions, interval 60s.
4. Note: standalone Health Checks are availability-plan dependent; if the
   *Health Checks* item is missing from your plan, a free-tier alternative is
   any external uptime monitor pointed at `GET /mercy`.

**Notifications** (dash → account home → *Notifications* → *Add*):

1. Type: *Health Checks status notification* — select the health check above.
2. Add a second policy of type *Workers* → cron/invocation error alerts if
   available on your plan, so a crashing `scheduled()` handler is surfaced.
3. Destinations: email is built in; *webhook* and *PagerDuty* destinations are
   configured under *Notifications → Destinations* first, then attached to the
   policy. Point these at the SAME PagerDuty/Grafana service as
   `MERCY_PAGE_WEBHOOK` so both alert paths converge on one rotation.

Note the asymmetry, honestly: Cloudflare Notification destinations receive
**Cloudflare-originated** alerts only (health checks, Workers alerts). They do
not receive MERCY's own POSTs — MERCY pages through `MERCY_PAGE_WEBHOOK`
directly. You want both: MERCY sees inside-the-Worker sickness; Health Checks
see the Worker being dead.

## 4. Runbook when a page fires

1. Open `GET /mercy` — is `overall` red, and is `remoteHarborsPossible` false?
   If `/mercy` itself is unreachable, the Worker or zone is down: check
   Cloudflare status + Workers dashboard first.
2. Open `/account/mercy` for the failing subsystem's `detail` and the incident
   history.
3. `d1` / `kv` / `do_channel` red → usually a Cloudflare-side incident; check
   status.cloudflare.com, then the D1/KV dashboards.
4. `queue` yellow → the FLEET_RUNS binding is missing: re-deploy with the
   producer binding or `wrangler queues create fleet-runs`.
5. `fleet_executor` yellow → event-driven ambiguity (idle vs dead). Check the
   fleet-executor Worker's logs and recent GitHub deliveries before assuming
   failure.
6. The incident resolves itself on the first non-red sweep; the next red
   episode pages again.
