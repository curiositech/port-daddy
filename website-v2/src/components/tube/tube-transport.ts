/**
 * tube-transport — the single transport boundary for the pd-tube demo suite.
 *
 * WHY THIS EXISTS
 * ---------------
 * The pd-tube demos illustrate a *local* primitive: a browser/hook/webhook POSTs
 * to a Port Daddy daemon listening on `http://127.0.0.1:9876`, and a local agent
 * replies. That round-trip is real and lovely when YOU run the daemon on YOUR
 * machine. But on the public marketing site (portdaddy.dev) there is no daemon
 * on the visitor's loopback — so every demo used to fire a real `fetch()` at
 * `127.0.0.1:9876`, which:
 *   (a) tripped the browser's *Local Network Access* consent prompt ("… wants to
 *       find and connect to devices on your local network"), which is alarming on
 *       a marketing page, and
 *   (b) failed with "Failed to fetch" because nothing was listening.
 *
 * This module resolves a *backend* once and routes both publish and poll through
 * it:
 *   - LIVE: a real daemon, used when the page has an explicit signal that one
 *     exists — an explicit URL, a `?daemon=<url>` query override, the
 *     `VITE_PORT_DADDY_URL` build env, or the embedded `/fleet-ui` console served
 *     by the daemon itself. This keeps the genuine product working for local dev
 *     and screenshots.
 *   - SIM: a deterministic, in-memory replay used everywhere else (the public
 *     site). No network call leaves the page, so no permission prompt and no
 *     transport error. Replies are scripted per channel and clearly labelled in
 *     the UI as a simulation (see `isTubeSimulated` / the `Simulated replay`
 *     badge) — nothing pretends to be a live agent.
 *
 * Honesty: the SIM path is explicitly surfaced to the visitor. We are not faking
 * a live agent; we are replaying a scripted conversation and saying so, with the
 * exact command to make it real on their own machine.
 */

/** The payload `kind` every tube message carries. */
export const TUBE_KIND = 'tube.msg'

/** A Port Daddy tube message as returned by the daemon (or the simulator). */
export interface TubeMessage {
  id: number
  sender?: string
  payload: {
    v?: number
    kind?: string
    body?: string
    inReplyTo?: number
    [key: string]: unknown
  }
}

/** The resolved transport backend for this page load. */
export type TubeBackend = { mode: 'live'; baseUrl: string } | { mode: 'sim' }

const EMBEDDED_CONTROL_PLANE_PREFIX = '/fleet-ui'

function isValidHttpUrl(candidate: string): boolean {
  try {
    const parsed = new URL(candidate)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

type LocationLike = Pick<Location, 'origin' | 'pathname' | 'search'>

/**
 * resolveTubeBackend — decide live-vs-sim for this page load.
 *
 * An explicit `daemonUrl` (passed by a caller that knows a daemon exists), a
 * `?daemon=<url>` query override, the `VITE_PORT_DADDY_URL` build env, or being
 * served under `/fleet-ui` (the daemon's own embedded console) all force LIVE.
 * Otherwise we simulate — which is the right default for a public marketing page
 * where the visitor has no daemon on their loopback.
 */
export function resolveTubeBackend(
  daemonUrl?: string | null,
  location?: LocationLike | null,
): TubeBackend {
  // 1. An explicit, valid URL from the caller forces live.
  if (daemonUrl && isValidHttpUrl(daemonUrl)) {
    return { mode: 'live', baseUrl: normalizeBaseUrl(daemonUrl) }
  }

  const loc = location ?? (typeof window !== 'undefined' ? window.location : null)

  // 2. `?daemon=<url>` query override (handy for local testing of the live path).
  if (loc?.search) {
    const q = new URLSearchParams(loc.search).get('daemon')?.trim()
    if (q && isValidHttpUrl(q)) return { mode: 'live', baseUrl: normalizeBaseUrl(q) }
  }

  // 3. Build-time env (set when a deployment is wired to a known daemon).
  const env =
    typeof import.meta !== 'undefined' ? import.meta.env?.VITE_PORT_DADDY_URL?.trim() : undefined
  if (env && isValidHttpUrl(env)) return { mode: 'live', baseUrl: normalizeBaseUrl(env) }

  // 4. The embedded control plane is served by the daemon itself: route with
  // a relative request, never an absolute guess at the daemon's own origin.
  if (loc?.origin && loc.pathname?.startsWith(EMBEDDED_CONTROL_PLANE_PREFIX)) {
    return { mode: 'live', baseUrl: '' }
  }

  // 5. Public marketing site → deterministic simulation, no network call.
  return { mode: 'sim' }
}

/** True when this page load will replay scripted (not live) tube replies. */
export function isTubeSimulated(daemonUrl?: string | null, location?: LocationLike | null): boolean {
  return resolveTubeBackend(daemonUrl, location).mode === 'sim'
}

const msgUrl = (baseUrl: string, channel: string) =>
  `${baseUrl ? baseUrl.replace(/\/$/, '') : ''}/msg/${encodeURIComponent(channel)}`

// ---------------------------------------------------------------------------
// Simulated daemon — deterministic in-memory replay of the tube protocol.
// ---------------------------------------------------------------------------

/**
 * One scripted reply the simulator posts back after a delay.
 * `repliesTo`:
 *   - undefined / 'seed' → reply to the seed message,
 *   - a number → reply to the Nth scripted reply (0-based), so agent↔agent
 *     threads can cite each other (drives WarRoom's provenance arrows).
 */
interface ScriptedReply {
  delayMs: number
  sender: string
  body: string
  repliesTo?: 'seed' | number
}

/** A channel's script: given the seed message, produce the replies to post. */
type ChannelScript = (seed: { id: number; sender: string; body: string }) => ScriptedReply[]

// --- The diff/diagnosis bodies mirror the demos' own "sample shape" so the
//     simulated reply renders identically to a real agent reply. ---

const MECHANIC_BODY = [
  'applyDiscount subtracts the rate as a flat amount instead of scaling by it. ' +
    'For a 10% discount on 99.00 you want price × (1 − 0.10) = 89.10, not price − 0.10.',
  '--- a/src/cart/totals.ts',
  '+++ b/src/cart/totals.ts',
  '@@ applyDiscount @@',
  '-  return price - rate',
  '+  return price * (1 - rate)',
].join('\n')

const EXPLAINER_BODY = [
  'getDaemonUrl reads PD_DAEMON_URL from the environment, trims a trailing slash, ' +
    'and otherwise falls back to the loopback default. It is pure and easy to test. ' +
    'One nit: it normalises the trailing slash only on the env path, so the default ' +
    'and the env value can disagree on shape. Normalise both at the return.',
  '--- a/src/daemon/url.ts',
  '+++ b/src/daemon/url.ts',
  '@@ getDaemonUrl @@',
  '-  if (fromEnv) return fromEnv.replace(/\\/$/, "")',
  '-  return DEFAULT_DAEMON_URL',
  '+  const raw = fromEnv ?? DEFAULT_DAEMON_URL',
  '+  return raw.replace(/\\/$/, "")',
].join('\n')

/** One-line Concierge replies, keyed on the trigger's sender. */
const CONCIERGE_REPLIES: Record<string, string> = {
  'web-button':
    'On it — pulled the latest CI status and the open PRs; posting a one-line summary back to the page.',
  'git-post-commit':
    'Saw the commit. Kicked off the linter and a docs sync; I’ll flag anything that needs your eyes.',
  'test-runner': '142 passed, 0 failed — green. Nothing for you to do; I logged the run.',
  'slack-bot': 'Replied in #deploys: staging is green, prod is mid-rollout (~3 min left).',
  webhook: 'Received and routed to the deploy handler; watching for the completion event.',
  'jupyter-cell':
    'Notebook run complete — results are in range. I saved the output and noted the cell.',
  'qr-scan':
    'SKU-00428 → “Wide-brim sun hat”, 14 in stock at the downtown shelf. Routed to inventory.',
}

const SCRIPTS: Record<string, ChannelScript> = {
  // Landing-page fan-out: three named listeners each reply with their own copy.
  'standup:demo': () => [
    { delayMs: 1100, sender: 'alice', body: 'No blockers — finishing the auth-refactor PR this morning.' },
    {
      delayMs: 1900,
      sender: 'bob',
      body: 'Blocked: the staging migration needs a review on #482 before I can deploy.',
    },
    { delayMs: 3000, sender: 'carol', body: 'Reviewing bob’s migration now; otherwise clear.' },
  ],

  // Red-to-green: the Mechanic returns a diagnosis + minimal diff.
  'tests:failed': () => [{ delayMs: 1600, sender: 'mechanic', body: MECHANIC_BODY }],

  // Editor lightbulb: the Explainer returns an explanation + a small diff.
  'editor:explain': () => [{ delayMs: 1500, sender: 'explainer', body: EXPLAINER_BODY }],

  // Playground switchboard: the Concierge routes by sender.
  'desk:requests': (seed) => [
    {
      delayMs: 1300,
      sender: 'concierge',
      body:
        CONCIERGE_REPLIES[seed.sender] ??
        'Routed to the right handler; I’ll post back here when it’s done.',
    },
  ],

  // War room: agent↔agent investigation with provenance links + a root cause.
  'incident:checkout': () => [
    {
      delayMs: 1200,
      sender: 'charlie',
      repliesTo: 'seed',
      body: 'Timeline: error rate began climbing 14:01:30 — ~30s before the p99 spike. First 5xx burst is from the checkout pods, not the edge.',
    },
    {
      delayMs: 2400,
      sender: 'bravo',
      repliesTo: 'seed',
      body: 'DB: connection pool hit 100/100 at 14:01:10 — saturated. Checkout queries then queued; wait time tracks the latency curve.',
    },
    {
      delayMs: 3600,
      sender: 'bravo',
      repliesTo: 0,
      body: 'Matches charlie — the 14:01:30 5xx burst is `pool timeout`, not application logic.',
    },
    {
      delayMs: 5000,
      sender: 'alpha',
      repliesTo: 1,
      body: 'So pool saturation precedes the spike and the 5xx are timeouts. What changed at 14:01?',
    },
    {
      delayMs: 6400,
      sender: 'charlie',
      repliesTo: 3,
      body: 'Deploy at 14:00:58 — release 3.20.0 cut the DB pool max from 200 to 100 in config.',
    },
    {
      delayMs: 7800,
      sender: 'alpha',
      repliesTo: 4,
      body: 'ROOT CAUSE: release 3.20.0 halved the DB connection pool (200→100); checkout saturated it at peak, queries queued, and p99 spiked 8x. Fix: restore pool max to 200 and add a saturation alert.',
    },
  ],
}

class SimulatedDaemon {
  // Start high so simulated ids never collide with a developer's real daemon ids
  // in the unlikely event both are observed in one session.
  private counter = 100_000
  private readonly logs = new Map<string, TubeMessage[]>()
  private readonly timers = new Set<ReturnType<typeof setTimeout>>()

  private append(channel: string, message: TubeMessage) {
    const log = this.logs.get(channel) ?? []
    log.push(message)
    // Cap retained history per channel so a long session can't grow unbounded.
    if (log.length > 300) log.splice(0, log.length - 300)
    this.logs.set(channel, log)
  }

  publish(channel: string, sender: string, payload: TubeMessage['payload']): number {
    const id = ++this.counter
    this.append(channel, { id, sender, payload })

    // Only seed messages (not replies) trigger scripted responses.
    if (typeof payload.inReplyTo !== 'number') {
      const script = SCRIPTS[channel]
      if (script) {
        const replies = script({ id, sender, body: payload.body ?? '' })
        // Reserve ids up front so a reply can cite an earlier reply by index.
        const replyIds = replies.map(() => ++this.counter)
        replies.forEach((reply, i) => {
          const inReplyTo =
            typeof reply.repliesTo === 'number' ? replyIds[reply.repliesTo] ?? id : id
          const timer = setTimeout(() => {
            this.timers.delete(timer)
            this.append(channel, {
              id: replyIds[i],
              sender: reply.sender,
              payload: { v: 1, kind: TUBE_KIND, body: reply.body, inReplyTo },
            })
          }, Math.max(0, reply.delayMs))
          this.timers.add(timer)
        })
      }
    }

    return id
  }

  poll(channel: string, after: number): TubeMessage[] {
    const log = this.logs.get(channel) ?? []
    return log.filter((m) => m.id > after)
  }
}

const simulator = new SimulatedDaemon()

// ---------------------------------------------------------------------------
// Public transport API — used by usePublish / waitForReply / WarRoom.
// ---------------------------------------------------------------------------

/** Publish one message to `channel`. Returns the new message id. */
export async function tubePublish(
  channel: string,
  sender: string,
  payload: TubeMessage['payload'],
  daemonUrl?: string | null,
): Promise<number> {
  const backend = resolveTubeBackend(daemonUrl)
  if (backend.mode === 'sim') return simulator.publish(channel, sender, payload)

  const res = await fetch(msgUrl(backend.baseUrl, channel), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sender, payload }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = (await res.json()) as { id: number }
  return json.id
}

export interface TubePollOptions {
  signal?: AbortSignal
  daemonUrl?: string | null
}

/** Fetch messages on `channel` with id greater than `after`. */
export async function tubePoll(
  channel: string,
  after: number,
  opts: TubePollOptions = {},
): Promise<TubeMessage[]> {
  const backend = resolveTubeBackend(opts.daemonUrl)
  if (backend.mode === 'sim') return simulator.poll(channel, after)

  const res = await fetch(`${msgUrl(backend.baseUrl, channel)}?after=${after}`, {
    signal: opts.signal,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = (await res.json()) as { messages?: TubeMessage[] }
  return json.messages ?? []
}
