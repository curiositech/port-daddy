import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { AlertTriangle, Database, ScrollText, Siren } from 'lucide-react'
import {
  CopyableCommandBlock,
  PanelBody,
  PanelEyebrow,
  SurfacePanel,
} from '@/components/site/primitives'
import { cn } from '@/lib/utils'
import {
  TUBE_KIND,
  TubeMotionProvider,
  TubeSimBadge,
  useReducedMotion,
  usePublish,
  type TubeMessage,
} from '@/components/tube/TubeWire'
import { tubePoll } from '@/components/tube/tube-transport'
import { HowItsWired } from './HowItsWired'

/**
 * WarRoom — pd tube playground Demo #4.
 *
 * The point of THIS demo (vs the others): it is not human→agent, it is
 * agent↔agent. Several named agents investigate a shared "incident" on ONE
 * channel (`incident:checkout`) and react to each other. A visitor seeds the
 * incident with a single real POST; real listeners (run as
 * `pd tube incident:checkout --as alpha|bravo|charlie`) post findings and reply to
 * one another via `inReplyTo`. We render the conversation as threaded cards in
 * three colored lanes and draw teal provenance arrows whenever one agent's
 * message replies-to another's — so the argument's lineage is literally visible.
 * A final ROOT CAUSE card lands in a cobalt-bordered banner if an agent posts
 * one.
 *
 * Reuse: this composes the TubeWire primitive. `usePublish` drives the one real
 * seed POST; the channel poll reuses the same `?after=<cursor>` protocol that
 * `waitForReply` uses (here we keep every message rather than matching a single
 * reply, so we poll inline). `TUBE_KIND`, `TubeMessage`, and `useReducedMotion`
 * come straight from the primitive — no transport is re-implemented. The
 * lane/fork rendering follows the FanOutWall pattern from
 * TubeMultiplexSection (one channel, several named listeners, honest "waiting"
 * states for lanes that never speak).
 *
 * Honesty: this is the hardest demo to run live (it needs three listeners). We
 * NEVER fabricate agent chatter. We show whatever real messages arrive; lanes
 * with no message are labelled "waiting for `pd tube … --as <name>`" with the
 * exact command to start them. Every card on screen is a real message the daemon
 * returned.
 *
 * Reduced motion: provenance arrows are drawn statically (no stroke draw), cards
 * appear without a rise, and the ROOT CAUSE banner does not flare.
 */

const WAR_CHANNEL = 'incident:checkout'
const SEEDER = 'incident-bot'

/** The shared prompt the three incident agents run with — same channel, distinct
 *  roles. Each gets the same base instructions plus its own role line so the
 *  page can show exactly what each model was told. */
function incidentPrompt(name: AgentName, role: string, focus: string): string {
  return `You are ${name}, the ${role.toLowerCase()} on this project's
incident:checkout channel. An incident has been seeded here; you and the other
agents investigate it together on this one channel.

Your beat: ${focus}

For every turn:
1. Read what the other agents have already posted (the channel is shared).
2. Post one finding from your beat. When it builds on or contradicts another
   agent, reply to that message so the lineage is explicit.
3. When the evidence points to a single cause, post a line that begins
   "ROOT CAUSE:" — exactly one root-cause declaration for the incident.

Reply on the same channel, sender "${name}", with --reply-to <id> when you cite
another agent. Report only what the evidence supports; never fabricate a metric.`
}

/** The pd-fleet.yml that declares all three incident agents on one channel. */
const INCIDENT_FLEET_YAML = `# pd-fleet.yml — three agents, one incident channel, distinct beats.
fleet:
  name: incident-room
  agents:
    alpha:
      trigger: incident:checkout    # all three watch the same channel
      backend: cli:claude-code
      singleton: true
      identity: "{project}:fleet:alpha"
      telos: "Lead the incident: synthesize findings into one root cause."
      prompt: |
        You are alpha, the incident lead on incident:checkout. Read what bravo
        and charlie post, synthesize, and when the evidence converges post one
        line beginning "ROOT CAUSE:". Reply with --reply-to <id> when you cite
        another agent. Never fabricate a metric.
    bravo:
      trigger: incident:checkout
      backend: cli:claude-code
      singleton: true
      allowedTools: "Read,Grep,Glob,Bash(psql*)"
      identity: "{project}:fleet:bravo"
      telos: "Investigate the database angle of the incident."
      prompt: |
        You are bravo, database, on incident:checkout. Post findings about
        connections, locks, slow queries, and pool saturation. Reply with
        --reply-to <id> when you build on another agent. Never fabricate a metric.
    charlie:
      trigger: incident:checkout
      backend: cli:claude-code
      singleton: true
      allowedTools: "Read,Grep,Glob,Bash(grep*)"
      identity: "{project}:fleet:charlie"
      telos: "Investigate the logs/timeline angle of the incident."
      prompt: |
        You are charlie, logs, on incident:checkout. Post findings from log lines
        and the timeline: what changed, when, and what error rates did. Reply
        with --reply-to <id> when you corroborate another agent. Never fabricate.`
/** The incident the visitor seeds. Phrased so agents have something to react to. */
const SEED_BODY =
  'INCIDENT: checkout p99 latency jumped 8x at 14:02 UTC. Error rate climbing. ' +
  'alpha lead — bravo (db) and charlie (logs), report findings.'

/** The three investigating agents, by their `--as` identity + role + accent. */
interface AgentDef {
  name: AgentName
  role: string
  icon: typeof Siren
  /** Logo-palette accent for this lane (coral / sky / amber). */
  accent: string
  /** A readable foreground on the accent when used as a fill. */
  accentInk: string
}

type AgentName = 'alpha' | 'bravo' | 'charlie'

const AGENTS: AgentDef[] = [
  { name: 'alpha', role: 'Incident lead', icon: Siren, accent: '#f07060', accentInk: '#3a1410' },
  { name: 'bravo', role: 'Database', icon: Database, accent: '#4a9dd8', accentInk: '#0c2233' },
  { name: 'charlie', role: 'Logs', icon: ScrollText, accent: '#f0a830', accentInk: '#3a2606' },
]

/** Each agent's beat — the one-line focus woven into its prompt. */
const AGENT_FOCUS: Record<AgentName, string> = {
  alpha: 'lead the room, weigh the others’ findings, and call the single root cause.',
  bravo: 'the database — connections, locks, slow queries, pool saturation.',
  charlie: 'the logs and timeline — what changed, when, and what error rates did.',
}

const AGENT_NAMES = AGENTS.map((a) => a.name)
const AGENT_BY_NAME = Object.fromEntries(AGENTS.map((a) => [a.name, a])) as Record<
  AgentName,
  AgentDef
>

/** A message we've resolved into the war-room view. */
interface WarMessage {
  id: number
  sender: string
  /** The lane this message belongs to, or null if from an unknown sender. */
  lane: AgentName | null
  body: string
  inReplyTo?: number
  /** True when the body is an explicit ROOT CAUSE declaration. */
  isRootCause: boolean
}

/** Detect a root-cause declaration. Structured prefix on a field we instruct
 *  agents to use — not free-text keyword NLP. Agents post `ROOT CAUSE: …`. */
function isRootCauseBody(body: string): boolean {
  return /^\s*root[\s-]?cause\b/i.test(body)
}

function laneForSender(sender: string | undefined): AgentName | null {
  const s = (sender ?? '').toLowerCase().trim()
  return (AGENT_NAMES as string[]).includes(s) ? (s as AgentName) : null
}

type RoomPhase = 'idle' | 'seeding' | 'watching' | 'error'

export function WarRoom() {
  const reduced = useReducedMotion()
  const publish = usePublish(WAR_CHANNEL)

  const [phase, setPhase] = useState<RoomPhase>('idle')
  const [messages, setMessages] = useState<WarMessage[]>([])
  const [seedId, setSeedId] = useState<number | null>(null)
  const [errorMessage, setErrorMessage] = useState<string>()

  // Poll lifecycle: one AbortController per "Open the incident" run.
  const abortRef = useRef<AbortController | null>(null)
  useEffect(() => () => abortRef.current?.abort(), [])

  const busy = phase === 'seeding'
  const watching = phase === 'watching'

  /** Continuously poll the channel from `cursor`, appending new messages. */
  const pollFrom = useCallback(async (cursor: number, signal: AbortSignal) => {
    let after = cursor
    const seen = new Set<number>()
    while (!signal.aborted) {
      let incoming: TubeMessage[]
      try {
        incoming = await tubePoll(WAR_CHANNEL, after, { signal })
      } catch (err) {
        if (signal.aborted) return
        // Transient transport error — surface it but keep the room open so a
        // recovered daemon resumes the stream on the next tick.
        setErrorMessage(err instanceof Error ? err.message : String(err))
        await sleep(1200, signal)
        continue
      }
      if (signal.aborted) return
      const fresh: WarMessage[] = []
      for (const m of incoming) {
        after = Math.max(after, m.id)
        if (seen.has(m.id)) continue
        seen.add(m.id)
        const p = m.payload
        if (!p || p.kind !== TUBE_KIND) continue
        const body = p.body ?? ''
        fresh.push({
          id: m.id,
          sender: m.sender ?? 'unknown',
          lane: laneForSender(m.sender),
          body,
          inReplyTo: typeof p.inReplyTo === 'number' ? p.inReplyTo : undefined,
          isRootCause: isRootCauseBody(body),
        })
      }
      if (fresh.length) {
        setErrorMessage(undefined)
        setMessages((prev) => {
          const known = new Set(prev.map((x) => x.id))
          const merged = [...prev, ...fresh.filter((x) => !known.has(x.id))]
          merged.sort((a, b) => a.id - b.id)
          return merged
        })
      }
      await sleep(800, signal)
    }
  }, [])

  const openIncident = useCallback(() => {
    if (busy) return
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setErrorMessage(undefined)
    setMessages([])
    setSeedId(null)
    setPhase('seeding')

    void (async () => {
      let id: number
      try {
        id = await publish(SEED_BODY, SEEDER)
      } catch (err) {
        if (ctrl.signal.aborted) return
        setErrorMessage(err instanceof Error ? err.message : String(err))
        setPhase('error')
        return
      }
      if (ctrl.signal.aborted) return
      setSeedId(id)
      // The seed itself shows in a neutral banner; agents reply to it / each
      // other from here. Poll starting just before the seed so we also capture
      // any message that races in.
      setPhase('watching')
      await pollFrom(id - 1, ctrl.signal)
    })()
  }, [busy, publish, pollFrom])

  const stop = useCallback(() => {
    abortRef.current?.abort()
    setPhase(messages.length ? 'watching' : 'idle')
  }, [messages.length])

  // Group resolved agent messages by lane (the seed is rendered separately).
  const lanes = useMemo(() => {
    const out: Record<AgentName, WarMessage[]> = { alpha: [], bravo: [], charlie: [] }
    for (const m of messages) {
      if (m.lane) out[m.lane].push(m)
    }
    return out
  }, [messages])

  // Provenance links: agent message → the agent message it replies to. We only
  // draw links where BOTH ends are rendered agent cards (lane !== null) so an
  // arrow always connects two visible cards.
  const links = useMemo(() => {
    const byId = new Map(messages.map((m) => [m.id, m]))
    const out: Array<{ from: number; to: number }> = []
    for (const m of messages) {
      if (m.lane == null || m.inReplyTo == null) continue
      const parent = byId.get(m.inReplyTo)
      if (parent && parent.lane != null) out.push({ from: m.id, to: m.inReplyTo })
    }
    return out
  }, [messages])

  const rootCause = useMemo(
    () => messages.find((m) => m.lane != null && m.isRootCause) ?? null,
    [messages],
  )

  const repliedLanes = useMemo(
    () => AGENT_NAMES.filter((n) => lanes[n].length > 0),
    [lanes],
  )

  return (
    <TubeMotionProvider>
      <div className="space-y-[var(--space-5)]">
        {/* Channel strip + controls. */}
        <SurfacePanel className="space-y-[var(--space-4)] overflow-hidden">
          <ChannelStrip
            channel={WAR_CHANNEL}
            repliedCount={repliedLanes.length}
            live={watching || busy}
          />

          <div className="flex flex-wrap items-center gap-[var(--space-3)]">
            <button
              type="button"
              onClick={openIncident}
              disabled={busy}
              className={cn(
                'inline-flex items-center justify-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] px-[var(--space-4)] py-[var(--space-3)] font-sans text-[length:var(--text-base)] font-semibold uppercase tracking-[var(--tracking-meta)] transition-colors',
                'bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]',
                'hover:bg-[var(--brand-primary-on-tint)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--interactive-focus)]',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              <Siren size={16} />
              {busy ? 'Seeding the incident…' : 'Open the incident'}
            </button>
            {watching ? (
              <button
                type="button"
                onClick={stop}
                className="inline-flex items-center justify-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] px-[var(--space-4)] py-[var(--space-3)] font-sans text-[length:var(--text-base)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-raised)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--interactive-focus)]"
              >
                Stop watching
              </button>
            ) : null}
            <RoomStatus
              phase={phase}
              repliedCount={repliedLanes.length}
              messageCount={messages.length}
              errorMessage={errorMessage}
            />
          </div>

          {/* The seed message banner (neutral) — the thing agents react to. */}
          {seedId != null ? (
            <SeedBanner id={seedId} body={SEED_BODY} sender={SEEDER} reduced={reduced} />
          ) : null}
        </SurfacePanel>

        {/* ROOT CAUSE banner — cobalt, lands only on a real root-cause message. */}
        {rootCause ? <RootCauseBanner msg={rootCause} reduced={reduced} /> : null}

        {/* The three lanes with the provenance-arrow overlay. */}
        <LaneBoard
          lanes={lanes}
          links={links}
          reduced={reduced}
          live={watching || busy}
        />

        {/* How to run the three listeners. */}
        <SurfacePanel elevation="quiet" padding="compact" className="space-y-[var(--space-4)]">
          <div className="space-y-[var(--space-2)]">
            <PanelEyebrow>Run the three agents</PanelEyebrow>
            <PanelBody size="compact" className="max-w-[64ch]">
              This demo is agent↔agent, so it needs three listeners on{' '}
              <code className="font-mono">{WAR_CHANNEL}</code>, one per role. Start each in its own
              terminal, then press <b className="text-[var(--text-primary)]">Open the incident</b>.
              Each agent reads the channel and replies to the others with{' '}
              <code className="font-mono">--reply-to &lt;id&gt;</code>; the page draws an arrow for
              every reply. Nothing here is staged — only messages the daemon actually returns appear.
            </PanelBody>
          </div>
          <div className="grid gap-[var(--space-3)] md:grid-cols-3">
            {AGENTS.map((a) => (
              <CopyableCommandBlock
                key={a.name}
                label={`${a.name} · ${a.role}`}
                command={`pd tube ${WAR_CHANNEL} --tail --as ${a.name}`}
              />
            ))}
          </div>
          <CopyableCommandBlock
            label="A reply that cites another agent (draws a provenance arrow)"
            command={`pd tube ${WAR_CHANNEL} --as bravo --reply-to <id> \\
  --send "db: connection pool saturated at 14:01 — preceded the latency spike."`}
          />
        </SurfacePanel>

        {/* How this demo is wired — all three agents, one channel. */}
        <HowItsWired
          channel={WAR_CHANNEL}
          agents={AGENTS.map((a) => ({
            name: a.name,
            role: a.role,
            prompt: incidentPrompt(a.name, a.role, AGENT_FOCUS[a.name]),
          }))}
          trigger={
            <>
              A single seed POST opens the incident on{' '}
              <code className="font-mono">{WAR_CHANNEL}</code>. In a fleet all three agents declare
              that same channel as their trigger, so the daemon dispatches every one of them on each
              new message — including each other's. That is what makes the conversation agent↔agent:
              one shared mailbox, three listeners, every reply a real dispatch.
            </>
          }
          fleetYaml={INCIDENT_FLEET_YAML}
          adHocCommand={`# Ad-hoc: start three listeners on the same channel, one per role, each with its own prompt.
pd tube ${WAR_CHANNEL} --tail --as alpha   --prompt "You are alpha, incident lead. Synthesize; call ROOT CAUSE."
pd tube ${WAR_CHANNEL} --tail --as bravo   --prompt "You are bravo, database. Post DB findings; reply-to to cite."
pd tube ${WAR_CHANNEL} --tail --as charlie --prompt "You are charlie, logs. Post timeline findings; reply-to to cite."`}
          fleetBarNote={
            <>
              FleetBar lists all three agents and shows which are listening on{' '}
              <code className="font-mono">{WAR_CHANNEL}</code>. With a fleet declared, the room runs
              itself — the daemon dispatches alpha, bravo, and charlie and you watch the findings and
              the root-cause call land in the app.
            </>
          }
        />
      </div>
    </TubeMotionProvider>
  )
}

// ---------------------------------------------------------------------------
// Channel strip
// ---------------------------------------------------------------------------

function ChannelStrip({
  channel,
  repliedCount,
  live,
}: {
  channel: string
  repliedCount: number
  live: boolean
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-[var(--space-3)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] px-[var(--space-3)] py-[var(--space-2)]">
      <div className="flex items-center gap-[var(--space-2)] text-[var(--brand-primary)]">
        <Siren size={16} aria-hidden="true" />
        <span className="font-mono text-[length:var(--text-base)] font-bold text-[var(--text-primary)]">
          {channel}
        </span>
        <TubeSimBadge channel={channel} />
      </div>
      <div className="flex items-center gap-[var(--space-2)]">
        <span
          aria-hidden="true"
          className={cn(
            'inline-block h-[10px] w-[10px] rounded-full',
            repliedCount > 0
              ? 'bg-[var(--brand-accent)]'
              : live
                ? 'bg-[var(--brand-primary)]'
                : 'bg-[var(--text-muted)]',
          )}
        />
        <span className="font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
          {repliedCount} of {AGENT_NAMES.length} agents speaking
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Seed banner — the visitor-seeded incident (neutral, not an agent lane).
// ---------------------------------------------------------------------------

function SeedBanner({
  id,
  body,
  sender,
  reduced,
}: {
  id: number
  body: string
  sender: string
  reduced: boolean
}) {
  return (
    <div
      data-warroom-card={id}
      className={cn(
        'border-2 border-[var(--border-strong)] bg-[var(--surface-base)]',
        !reduced && 'tube-card-rise',
      )}
    >
      <div className="flex items-center justify-between gap-[var(--space-3)] border-b-2 border-[var(--border-strong)] px-[var(--space-3)] py-[var(--space-2)]">
        <span className="flex items-center gap-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-bold uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)]">
          <AlertTriangle size={14} aria-hidden="true" /> Incident seeded · {sender}
        </span>
        <span className="font-mono text-[length:var(--type-meta-size)] text-[var(--text-muted)]">
          #{id}
        </span>
      </div>
      <div className="px-[var(--space-3)] py-[var(--space-3)] font-sans text-[length:var(--text-base)] leading-[var(--leading-body)] text-[var(--text-primary)]">
        {body}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ROOT CAUSE banner — cobalt, lands on a real root-cause message.
// ---------------------------------------------------------------------------

function RootCauseBanner({ msg, reduced }: { msg: WarMessage; reduced: boolean }) {
  const agent = msg.lane ? AGENT_BY_NAME[msg.lane] : null
  // Strip the leading "ROOT CAUSE:" label for the body line; keep it in the header.
  const body = msg.body.replace(/^\s*root[\s-]?cause\s*:?\s*/i, '').trim() || msg.body
  return (
    <div
      data-warroom-card={msg.id}
      className={cn(
        'border-2 border-[var(--brand-primary)] bg-[color-mix(in_srgb,var(--brand-primary)_8%,var(--surface-base))]',
        !reduced && 'tube-rootcause-flare',
      )}
    >
      <div className="flex items-center justify-between gap-[var(--space-3)] border-b-2 border-[var(--brand-primary)] px-[var(--space-4)] py-[var(--space-2)]">
        <span className="flex items-center gap-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-bold uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
          <AlertTriangle size={14} aria-hidden="true" /> Root cause
          {agent ? ` · ${agent.name} (${agent.role})` : null}
        </span>
        <span className="font-mono text-[length:var(--type-meta-size)] text-[var(--brand-primary)]">
          #{msg.id}
          {msg.inReplyTo != null ? ` ← #${msg.inReplyTo}` : ''}
        </span>
      </div>
      <div className="px-[var(--space-4)] py-[var(--space-3)] font-sans text-[length:var(--text-lg)] font-semibold leading-[var(--leading-body)] text-[var(--text-primary)]">
        {body}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// LaneBoard — the three lanes + provenance-arrow overlay.
// ---------------------------------------------------------------------------

interface ArrowGeom {
  key: string
  /** Path d for an SVG cubic curve from the replying card to its parent. */
  d: string
  /** Path length, used to seed the stroke-dash draw. */
  len: number
}

function LaneBoard({
  lanes,
  links,
  reduced,
  live,
}: {
  lanes: Record<AgentName, WarMessage[]>
  links: Array<{ from: number; to: number }>
  reduced: boolean
  live: boolean
}) {
  const boardRef = useRef<HTMLDivElement | null>(null)
  const [arrows, setArrows] = useState<ArrowGeom[]>([])
  const [box, setBox] = useState({ w: 0, h: 0 })

  // Measure card centers and compute arrow paths in the board's coordinate
  // space. Re-runs on layout change (new cards) and on resize.
  const measure = useCallback(() => {
    const board = boardRef.current
    if (!board) return
    const brect = board.getBoundingClientRect()
    setBox({ w: brect.width, h: brect.height })
    const center = (id: number): { x: number; y: number; left: number; right: number } | null => {
      const el = board.querySelector<HTMLElement>(`[data-warroom-card="${id}"]`)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return {
        x: r.left - brect.left + r.width / 2,
        y: r.top - brect.top + r.height / 2,
        left: r.left - brect.left,
        right: r.right - brect.left,
      }
    }
    const next: ArrowGeom[] = []
    for (const { from, to } of links) {
      const a = center(from) // replying card
      const b = center(to) // cited (parent) card
      if (!a || !b) continue
      // Anchor on the inner edges so the arrow runs card-to-card, not center-to-
      // center over the text. Horizontal control points give a gentle S-curve.
      const goingRight = b.x >= a.x
      const x1 = goingRight ? a.right : a.left
      const x2 = goingRight ? b.left : b.right
      const y1 = a.y
      const y2 = b.y
      const dx = Math.max(28, Math.abs(x2 - x1) * 0.5)
      const c1x = goingRight ? x1 + dx : x1 - dx
      const c2x = goingRight ? x2 - dx : x2 + dx
      const d = `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${c1x.toFixed(1)} ${y1.toFixed(1)}, ${c2x.toFixed(1)} ${y2.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`
      const len = Math.round(Math.hypot(x2 - x1, y2 - y1) + Math.abs(y2 - y1) + 40)
      next.push({ key: `${from}-${to}`, d, len })
    }
    setArrows(next)
  }, [links])

  // Measure synchronously after DOM updates so arrows track the cards.
  useLayoutEffect(() => {
    measure()
  }, [measure])

  useEffect(() => {
    const board = boardRef.current
    if (!board || typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const ro = new ResizeObserver(() => measure())
    ro.observe(board)
    for (const el of board.querySelectorAll('[data-warroom-card]')) ro.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [measure, links])

  return (
    <div ref={boardRef} className="relative">
      {/* Provenance arrows overlay. Pointer-events off so cards stay clickable. */}
      {box.w > 0 && arrows.length > 0 ? (
        <svg
          className="pointer-events-none absolute inset-0 z-10 h-full w-full overflow-visible"
          width={box.w}
          height={box.h}
          aria-hidden="true"
        >
          <defs>
            <marker
              id="warroom-arrowhead"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--brand-accent)" />
            </marker>
          </defs>
          {arrows.map((arrow) => (
            <path
              key={arrow.key}
              d={arrow.d}
              fill="none"
              stroke="var(--brand-accent)"
              strokeWidth={2}
              markerEnd="url(#warroom-arrowhead)"
              className={!reduced ? 'tube-arrow-draw' : undefined}
              style={
                !reduced
                  ? ({
                      strokeDasharray: arrow.len,
                      strokeDashoffset: 0,
                      ['--arrow-len' as string]: String(arrow.len),
                    } as React.CSSProperties)
                  : undefined
              }
            />
          ))}
        </svg>
      ) : null}

      <div className="grid min-w-0 gap-[var(--space-4)] md:grid-cols-3">
        {AGENTS.map((agent) => (
          <Lane
            key={agent.name}
            agent={agent}
            messages={lanes[agent.name]}
            reduced={reduced}
            live={live}
          />
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Lane — one agent's column of threaded cards (or an honest waiting state).
// ---------------------------------------------------------------------------

function Lane({
  agent,
  messages,
  reduced,
  live,
}: {
  agent: AgentDef
  messages: WarMessage[]
  reduced: boolean
  live: boolean
}) {
  const Icon = agent.icon
  const spoke = messages.length > 0
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col border-2 bg-[var(--surface-base)]',
        !reduced && 'transition-colors duration-[var(--duration-normal)]',
      )}
      style={{ borderColor: agent.accent }}
      aria-label={`Lane ${agent.name} (${agent.role}): ${
        spoke ? `${messages.length} message${messages.length === 1 ? '' : 's'}` : 'no listener yet'
      }`}
    >
      {/* Lane header in the agent's accent. */}
      <div
        className="flex min-w-0 flex-wrap items-center justify-between gap-[var(--space-2)] border-b-2 px-[var(--space-3)] py-[var(--space-2)]"
        style={{ borderColor: agent.accent }}
      >
        <span className="flex items-center gap-[var(--space-2)]">
          <span
            className="inline-flex h-[22px] w-[22px] items-center justify-center"
            style={{ background: agent.accent, color: agent.accentInk }}
          >
            <Icon size={14} aria-hidden="true" />
          </span>
          <span className="font-display text-[length:var(--text-lg)] font-black text-[var(--text-primary)]">
            {agent.name}
          </span>
        </span>
        <span className="font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)]">
          {agent.role}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-[var(--space-3)] p-[var(--space-3)]">
        {spoke ? (
          messages.map((m) => (
            <AgentCard key={m.id} msg={m} accent={agent.accent} reduced={reduced} />
          ))
        ) : (
          <WaitingState agent={agent} live={live} />
        )}
      </div>
    </div>
  )
}

function AgentCard({
  msg,
  accent,
  reduced,
}: {
  msg: WarMessage
  accent: string
  reduced: boolean
}) {
  const repliesToAgent = msg.inReplyTo != null
  return (
    <div
      data-warroom-card={msg.id}
      className={cn(
        'border-2 bg-[var(--surface-raised)]',
        !reduced && 'tube-card-rise',
        msg.isRootCause && 'shadow-[inset_0_0_0_1px_var(--brand-primary)]',
      )}
      style={{ borderColor: accent }}
    >
      <div className="flex items-center justify-between gap-[var(--space-2)] border-b border-[var(--border-default)] px-[var(--space-3)] py-[var(--space-2)]">
        <span
          className="font-sans text-[length:var(--type-meta-size)] font-bold uppercase tracking-[var(--tracking-meta)]"
          style={{ color: accent }}
        >
          {msg.sender}
          {msg.isRootCause ? ' · root cause' : ''}
        </span>
        <span className="font-mono text-[length:var(--type-meta-size)] text-[var(--text-muted)]">
          {repliesToAgent ? (
            <span className="text-[var(--brand-accent)]">↳ #{msg.inReplyTo} · </span>
          ) : null}
          #{msg.id}
        </span>
      </div>
      <div className="px-[var(--space-3)] py-[var(--space-3)] font-sans text-[length:var(--text-base)] leading-[var(--leading-body)] text-[var(--text-primary)]">
        {msg.body || '(empty message)'}
      </div>
    </div>
  )
}

function WaitingState({ agent, live }: { agent: AgentDef; live: boolean }) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-[var(--space-2)] border-2 border-dashed border-[var(--border-default)] px-[var(--space-3)] py-[var(--space-4)] text-center">
      <span className="font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
        {live ? 'Listening for' : 'No listener yet'}
      </span>
      <code className="break-words font-mono text-[length:var(--text-base)] font-bold text-[var(--text-primary)]">
        pd tube {WAR_CHANNEL} --as {agent.name}
      </code>
      <span className="font-sans text-[length:var(--type-meta-size)] text-[var(--text-muted)]">
        Start this listener, then open the incident. We never fabricate {agent.name}&rsquo;s
        messages.
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Status line
// ---------------------------------------------------------------------------

function RoomStatus({
  phase,
  repliedCount,
  messageCount,
  errorMessage,
}: {
  phase: RoomPhase
  repliedCount: number
  messageCount: number
  errorMessage?: string
}) {
  let content: ReactNode
  switch (phase) {
    case 'seeding':
      content = (
        <>
          Posting the incident to <b className="text-[var(--text-primary)]">{WAR_CHANNEL}</b>…
        </>
      )
      break
    case 'watching':
      content =
        repliedCount > 0 ? (
          <>
            <span className="font-bold text-[var(--brand-accent)]">
              ● {repliedCount} of {AGENT_NAMES.length} agents speaking
            </span>{' '}
            — {messageCount} real {messageCount === 1 ? 'message' : 'messages'} on one channel.
          </>
        ) : (
          <span className="text-[var(--text-primary)]">
            Watching <code className="font-mono">{WAR_CHANNEL}</code> — no agent has spoken yet.
            Start the three listeners below.
          </span>
        )
      break
    case 'error':
      content = (
        <span className="font-bold text-[var(--status-error)]">
          {errorMessage ? `Error: ${errorMessage}` : 'Something went wrong.'}
        </span>
      )
      break
    default:
      content = (
        <>
          <b className="text-[var(--text-primary)]">Open the incident</b> to seed one real{' '}
          <code className="font-mono">POST</code>; three agents investigate and reply to each other.
        </>
      )
  }
  return (
    <div
      className="min-h-[1.4em] grow basis-full font-sans text-[length:var(--text-base)] text-[var(--text-secondary)] lg:basis-auto"
      aria-live="polite"
    >
      {content}
      {phase === 'watching' && errorMessage ? (
        <span className="ml-[var(--space-2)] text-[var(--status-warning)]">
          (reconnecting: {errorMessage})
        </span>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Abortable sleep used between polls. Resolves early (silently) on abort. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
