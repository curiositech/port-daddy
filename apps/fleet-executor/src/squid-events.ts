/**
 * Cloud squid — fire-and-forget fleet coordination events.
 *
 * The executor announces its run lifecycle onto the relay's 'fleet-cloud'
 * channel so other agents (and the operator surfaces) can see cloud fleet
 * activity as it happens: run-started, one ship-verdict per ship, pr-stacked
 * whenever a ship (purser or ideation) stacks a PR, and run-concluded.
 *
 * TRANSPORT: one POST per event to `env.RELAY_PUBLISH_URL` with
 * `Authorization: Bearer <env.RELAY_PUBLISH_TOKEN>`. The body mirrors the
 * relay publish envelope (`{ event: { channel, ... } }` — see
 * apps/relay/src/handlers.ts handlePublish and apps/relay/tests/publish.test.ts):
 * the event travels under an `event` key carrying its `channel`. The executor
 * is NOT a daemon: it holds no harbor card and no Ed25519 identity, so it
 * cannot speak the full zero-trust hash-chain dialect of /v1/publish. Point
 * RELAY_PUBLISH_URL at a token-authenticated ingest (or a relay route that
 * accepts bearer-token publishes) — the payload shape is stable either way.
 *
 * CONTRACT (hard):
 *   - BOTH env vars unset/empty ⇒ feature silently disabled, zero fetches.
 *   - TENANT CONSENT (tenancy finding, 2026-08): the tenant repo must ALSO opt
 *     in via a top-level `squidEvents: true` under `fleet:` in its pd-fleet.yml
 *     (read from the trusted default branch — parseFleetSquidEvents in
 *     src/fleet.ts; default false). Events carry the tenant's repo name, PR
 *     numbers, verdicts, and stacked-PR urls onto a shared channel; the
 *     operator's env wiring alone is not the tenant's consent. `tenantOptIn`
 *     is a required parameter so no call site can forget the gate.
 *   - NEVER throws. NEVER awaited by callers. NEVER blocks or changes a run,
 *     a verdict, or the merge gate. A lost event is a lost event.
 */

export const SQUID_CHANNEL = 'fleet-cloud';

export type SquidEventType = 'run-started' | 'ship-verdict' | 'pr-stacked' | 'run-concluded';

export interface SquidEventPayload {
  /** `owner/repo` of the PR under review. */
  repo: string;
  /** The reviewed PR number. */
  pr: number;
  /** Deterministic run id (`run:<deliveryId>`). */
  runId: string;
  /** Ship name (ship-verdict / pr-stacked). */
  ship?: string;
  /** Ship verdict or run conclusion (ship-verdict / run-concluded). */
  verdict?: string;
  /** Stacked PR html url (pr-stacked). */
  url?: string;
}

/** The minimal env surface the squid needs (both fields optional ⇒ disabled). */
export interface SquidEnv {
  RELAY_PUBLISH_URL?: string;
  RELAY_PUBLISH_TOKEN?: string;
}

/**
 * Fire one squid event. Fire-and-forget by design: the fetch is started but
 * never awaited, every rejection is swallowed, and any synchronous failure
 * (bad URL, serialization) is caught. Returns nothing.
 *
 * `tenantOptIn` is the tenant repo's `squidEvents: true` consent from its
 * trusted-branch pd-fleet.yml (parseFleetSquidEvents). It is REQUIRED and
 * strictly `=== true` gated: anything else ⇒ zero fetches, regardless of the
 * operator's RELAY_PUBLISH_* wiring.
 */
export function emitSquidEvent(
  env: SquidEnv,
  type: SquidEventType,
  payload: SquidEventPayload,
  tenantOptIn: boolean,
): void {
  if (tenantOptIn !== true) return; // tenant has not consented — silently, no fetch
  const url = env.RELAY_PUBLISH_URL;
  const token = env.RELAY_PUBLISH_TOKEN;
  if (!url || !token) return; // feature disabled — silently, no fetch

  try {
    const body = JSON.stringify({
      event: {
        channel: SQUID_CHANNEL,
        type,
        sender: 'fleet-executor',
        iat: Math.floor(Date.now() / 1000),
        payload,
      },
    });
    void fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body,
    }).catch(() => undefined);
  } catch {
    // Never let a squid event disturb the run.
  }
}
