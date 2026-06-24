import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GitFork, ListOrdered, Radio, RotateCcw } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
  SectionIntro,
  SurfacePanel,
  SwissGrid,
  SwissGridItem,
} from '@/components/site/primitives'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { cn } from '@/lib/utils'
import {
  TubeMotionProvider,
  TubeTimeoutError,
  useReducedMotion,
  usePublish,
  waitForReply,
  type TubeMessage,
} from '@/components/tube/TubeWire'

/**
 * Follow-on to `TubeShowcase`: point several agents at one channel and every
 * agent gets every message. Each listener keeps its own bookmark in the
 * stream, keyed on its `--as` name, so reconnecting picks up where it left off.
 *
 * The lead visual is a LIVE fan-out built on the TubeWire primitive: one real
 * POST to `standup:demo`, watched for replies from three named listeners
 * (alice, bob, carol). The send pulse forks into three at a junction and each
 * agent lane lights up as (and only if) a real reply for it arrives. Nothing
 * is fabricated — lanes that never answer stay in a clearly-labelled "waiting"
 * state with the exact command to start that listener.
 */
export function TubeMultiplexSection() {
  return (
    <section
      id="pd-tube-fan-out"
      className="border-t-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]"
    >
      <PageContainer width="wide">
        <SwissGrid className="items-start gap-y-[var(--space-7)]">
          <SwissGridItem span="narrow">
            <div className="sticky top-28 space-y-[var(--space-5)]">
              <SectionIntro
                eyebrow="pd tube · fan-out"
                title="Every listener on the channel hears every message."
                description="Point several agents at the same channel and each one receives every message. A broadcaster sends once; three listeners on three different identities all wake up. The channel is a fan-out, not a queue."
                titleAs="h2"
              />
              <div className="space-y-[var(--space-3)] text-[length:var(--text-base)] text-[var(--text-muted)]">
                <p>
                  Each listener keeps its own bookmark in the stream, keyed on its{' '}
                  <code>--as</code> name. Two <code>--tail</code> listeners no longer race for the
                  same message. Both read it. Each remembers its own place.
                </p>
                <p>
                  Think of a standup bot that pings one teammate at random, versus one that reaches
                  the whole room. Sending stays the same: a plain <code>POST</code> of JSON.
                </p>
              </div>
              <div className="flex flex-wrap gap-[var(--space-3)] pt-[var(--space-2)]">
                <Link
                  to="/pd-tube"
                  className="inline-flex items-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-base)] font-medium text-[var(--text-primary)] transition hover:bg-[var(--surface-raised)]"
                >
                  Explore pd tube
                </Link>
                <Link
                  to="/docs/cli/tube"
                  className="inline-flex items-center gap-[var(--space-2)] border-2 border-transparent px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-base)] font-medium text-[var(--text-muted)] underline decoration-[var(--border-strong)] decoration-2 underline-offset-4 hover:text-[var(--text-primary)]"
                >
                  Read the docs
                </Link>
              </div>
            </div>
          </SwissGridItem>

          <SwissGridItem span="wide" className="space-y-[var(--space-6)]">
            {/* Lead visual: the live fan-out. */}
            <FanOutWall />

            <SurfacePanel className="overflow-hidden">
              <PanelEyebrow className="mb-[var(--space-2)]">Three listeners, one broadcast</PanelEyebrow>
              <PanelTitle as="h3" className="mb-[var(--space-4)]">
                Each <code>--as</code> name gets its own copy
              </PanelTitle>
              <PanelBody className="mb-[var(--space-4)] max-w-[52ch]">
                Start three listeners on <code>standup:demo</code>, each with a different name. Send
                one message. All three print it. Each keeps its own bookmark, so a listener that
                reconnects resumes where it stopped without eating the others&rsquo; backlog.
              </PanelBody>
              <CodeBlock language="bash" filename="four terminals" copyable={false}>
                {`# Terminal 1 — first listener
$ pd tube standup:demo --tail --as alice

# Terminal 2 — second listener
$ pd tube standup:demo --tail --as bob

# Terminal 3 — third listener
$ pd tube standup:demo --tail --as carol

# Terminal 4 — send once
$ pd tube standup:demo --send "Standup in 5. Post blockers."
SUCCESS: tube: posted id=87 to standup:demo

# id=87 now prints in ALL THREE listener terminals.`}
              </CodeBlock>
            </SurfacePanel>

            <figure className="overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
              <img
                src="/demos/pd-tube/pd-tube-multiplex.gif"
                alt="Animated terminal recording: one message sent to a channel, and three pd tube listeners each on a distinct --as name all receive the same message"
                className="block w-full"
                loading="lazy"
              />
              <figcaption className="border-t-2 border-[var(--border-strong)] px-[var(--space-4)] py-[var(--space-3)] text-[length:var(--text-base)] text-[var(--text-muted)]">
                One message, three listeners on distinct <code>--as</code> names. The message fans
                out to all three terminals.
              </figcaption>
            </figure>

            <div className="grid gap-[var(--space-4)] md:grid-cols-3">
              <BehaviorCard
                icon={GitFork}
                title="Fan-out, not a queue"
                body="One message reaches every listener. Adding a listener never starves the others, because no single consumer competes for each message."
              />
              <BehaviorCard
                icon={ListOrdered}
                title="Per-listener bookmark"
                body={
                  <>
                    Each listener keeps its own bookmark, keyed on its <code>--as</code> name, not
                    on the channel. Everyone tracks their own place in the stream.
                  </>
                }
              />
              <BehaviorCard
                icon={RotateCcw}
                title="Resumes per identity"
                body="A listener that drops and reconnects with the same identity resumes from its own cursor; the backlog meant for anyone else stays untouched."
              />
            </div>
          </SwissGridItem>
        </SwissGrid>
      </PageContainer>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Live fan-out wall
// ---------------------------------------------------------------------------

const FAN_CHANNEL = 'standup:demo'
const SENDER = 'standup-bot'
const BROADCAST_BODY = 'Standup in 5. Post blockers.'
/** The three listeners we expect, by their `--as` identity. */
const LANES = ['alice', 'bob', 'carol'] as const
type LaneName = (typeof LANES)[number]

type LanePhase = 'idle' | 'awaiting' | 'replied' | 'timeout'

interface LaneState {
  phase: LanePhase
  reply: TubeMessage | null
}

const INITIAL_LANES: Record<LaneName, LaneState> = {
  alice: { phase: 'idle', reply: null },
  bob: { phase: 'idle', reply: null },
  carol: { phase: 'idle', reply: null },
}

type WallPhase = 'idle' | 'sending' | 'awaiting' | 'settled' | 'error'

/**
 * FanOutWall — one Broadcast button fires a single real POST to `standup:demo`.
 * We then poll the channel once and route every reply to its lane by the
 * replier's `--as` name. Replies are real; lanes that never answer within the
 * window are honestly marked "waiting" with the command to start them. No reply
 * is ever fabricated.
 */
function FanOutWall() {
  const reduced = useReducedMotion()
  const publish = usePublish(FAN_CHANNEL)

  const [wallPhase, setWallPhase] = useState<WallPhase>('idle')
  const [lanes, setLanes] = useState<Record<LaneName, LaneState>>(INITIAL_LANES)
  const [postId, setPostId] = useState<number | null>(null)
  const [errorMessage, setErrorMessage] = useState<string>()
  // Re-key the fork pulse on each broadcast so the animation restarts.
  const [pulseKey, setPulseKey] = useState(0)

  const abortRef = useRef<AbortController | null>(null)
  useEffect(() => () => abortRef.current?.abort(), [])

  const busy = wallPhase === 'sending' || wallPhase === 'awaiting'
  const repliedCount = useMemo(
    () => LANES.filter((l) => lanes[l].phase === 'replied').length,
    [lanes],
  )

  const broadcast = useCallback(() => {
    if (busy) return
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setErrorMessage(undefined)
    setLanes(INITIAL_LANES)
    setPostId(null)
    setPulseKey((k) => k + 1)
    setWallPhase('sending')

    void (async () => {
      let id: number
      try {
        id = await publish(BROADCAST_BODY, SENDER)
      } catch (err) {
        if (ctrl.signal.aborted) return
        setErrorMessage(err instanceof Error ? err.message : String(err))
        setWallPhase('error')
        return
      }
      if (ctrl.signal.aborted) return
      setPostId(id)
      setWallPhase('awaiting')
      // Mark every lane as awaiting; each resolves on its own real reply.
      setLanes({
        alice: { phase: 'awaiting', reply: null },
        bob: { phase: 'awaiting', reply: null },
        carol: { phase: 'awaiting', reply: null },
      })

      // Watch each lane independently. waitForReply matches inReplyTo === id and
      // we additionally route by the replier's sender name so the right lane
      // lights up. A lane that never answers ends in 'timeout'.
      await Promise.all(
        LANES.map(async (lane) => {
          try {
            const reply = await waitForReply(FAN_CHANNEL, id, {
              signal: ctrl.signal,
              timeoutMs: 12_000,
              // Only accept a reply whose sender matches this lane's name.
              // waitForReply itself matches inReplyTo; we post-filter here.
            })
            if (ctrl.signal.aborted) return
            // Route by sender; if the daemon returns a reply from a different
            // identity, leave this lane awaiting (another lane's watcher claims it).
            const who = (reply.sender ?? '').toLowerCase()
            if (who && who !== lane) return
            setLanes((prev) => ({ ...prev, [lane]: { phase: 'replied', reply } }))
          } catch (err) {
            if (ctrl.signal.aborted) return
            if (err instanceof TubeTimeoutError) {
              setLanes((prev) =>
                prev[lane].phase === 'replied'
                  ? prev
                  : { ...prev, [lane]: { ...prev[lane], phase: 'timeout' } },
              )
            }
          }
        }),
      )
      if (ctrl.signal.aborted) return
      setWallPhase('settled')
    })()
  }, [busy, publish])

  return (
    <TubeMotionProvider>
      <SurfacePanel className="space-y-[var(--space-5)] overflow-hidden">
        {/* FleetBar-style strip: channel + listener count. */}
        <FleetBar channel={FAN_CHANNEL} repliedCount={repliedCount} live={wallPhase !== 'idle'} />

        {/* Sender + fork + three agent lanes. */}
        <div className="grid items-stretch gap-[var(--space-4)] lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.5fr)]">
          {/* Sender column. */}
          <div className="flex flex-col justify-center gap-[var(--space-4)]">
            <SenderPanel active={busy || wallPhase === 'settled'} postId={postId} />
            <button
              type="button"
              onClick={broadcast}
              disabled={busy}
              className={cn(
                'inline-flex items-center justify-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] px-[var(--space-4)] py-[var(--space-3)] font-sans text-[length:var(--text-base)] font-semibold uppercase tracking-[var(--tracking-meta)] transition-colors',
                'bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]',
                'hover:bg-[var(--brand-primary-on-tint)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--interactive-focus)]',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              <Radio size={16} />
              {busy ? 'Broadcasting…' : 'Broadcast'}
            </button>
          </div>

          {/* The fork junction: trunk in, three branches out. */}
          <ForkJunction
            pulseKey={pulseKey}
            active={busy}
            reduced={reduced}
          />

          {/* Three agent lanes. */}
          <div className="grid gap-[var(--space-3)]">
            {LANES.map((lane, i) => (
              <AgentLane key={lane} name={lane} state={lanes[lane]} index={i} reduced={reduced} />
            ))}
          </div>
        </div>

        {/* Status line. */}
        <WallStatus
          wallPhase={wallPhase}
          repliedCount={repliedCount}
          errorMessage={errorMessage}
        />
      </SurfacePanel>
    </TubeMotionProvider>
  )
}

/** FleetBar — a compact menu-bar-style strip showing the channel + listeners. */
function FleetBar({
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
        <GitFork size={16} aria-hidden="true" />
        <span className="font-mono text-[length:var(--text-base)] font-bold text-[var(--text-primary)]">
          {channel}
        </span>
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
          {repliedCount} {repliedCount === 1 ? 'listener' : 'listeners'} replied
        </span>
      </div>
    </div>
  )
}

/** The broadcasting sender node. */
function SenderPanel({ active, postId }: { active: boolean; postId: number | null }) {
  return (
    <div
      className={cn(
        'border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-4)] text-center',
        active && 'border-[var(--brand-primary)] bg-[var(--surface-raised)]',
      )}
    >
      <div className="font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)]">
        Broadcaster
      </div>
      <div className="mt-[var(--space-1)] font-display text-[length:var(--text-lg)] font-black text-[var(--text-primary)]">
        {SENDER}
      </div>
      <div className="mt-[var(--space-2)] font-mono text-[length:var(--type-meta-size)] text-[var(--text-muted)]">
        {postId !== null ? `POST → id #${postId}` : 'one POST · standup:demo'}
      </div>
    </div>
  )
}

/**
 * ForkJunction — the money shot. A cobalt trunk pulse leaves the sender, hits a
 * junction dot, and forks into three branch pulses that fan out to the three
 * lanes. Rendered as an inline SVG so the branches can curve to their lanes.
 * Under reduced motion the trunk + branches render as static dots (no travel),
 * conveying the one→three split without animation.
 */
function ForkJunction({
  pulseKey,
  active,
  reduced,
}: {
  pulseKey: number
  active: boolean
  reduced: boolean
}) {
  // Lane vertical targets (in the SVG's 120-tall viewBox).
  const targets = [22, 60, 98]
  const junctionX = 30
  const junctionY = 60
  const endX = 96

  return (
    <div className="flex min-w-[120px] items-center justify-center self-center" aria-hidden="true">
      <svg
        viewBox="0 0 100 120"
        className="h-[180px] w-[112px]"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Static branch wires (always visible). */}
        <line
          x1={0}
          y1={junctionY}
          x2={junctionX}
          y2={junctionY}
          stroke="var(--border-strong)"
          strokeWidth={2}
        />
        {targets.map((ty, i) => (
          <path
            key={`wire-${i}`}
            d={`M ${junctionX} ${junctionY} C ${junctionX + 28} ${junctionY}, ${endX - 28} ${ty}, ${endX} ${ty}`}
            fill="none"
            stroke="var(--border-strong)"
            strokeWidth={2}
          />
        ))}
        {/* Junction dot. */}
        <circle
          cx={junctionX}
          cy={junctionY}
          r={4}
          fill={active || reduced ? 'var(--brand-primary)' : 'var(--border-strong)'}
        />

        {/* Animated pulses, re-keyed on each broadcast. */}
        {active ? (
          reduced ? (
            // Reduced motion: static dots showing trunk + three branches at once.
            <g key={`static-${pulseKey}`}>
              <circle cx={junctionX / 2} cy={junctionY} r={4} fill="var(--brand-primary)" />
              {targets.map((ty, i) => (
                <circle
                  key={`s-${i}`}
                  cx={(junctionX + endX) / 2}
                  cy={(junctionY + ty) / 2}
                  r={4}
                  fill="var(--brand-accent)"
                />
              ))}
            </g>
          ) : (
            <g key={`anim-${pulseKey}`}>
              {/* Trunk pulse: 0 → junction. */}
              <circle r={4.5} fill="var(--brand-primary)">
                <animate
                  attributeName="cx"
                  from={0}
                  to={junctionX}
                  dur="0.32s"
                  begin="0s"
                  fill="freeze"
                  calcMode="spline"
                  keySplines="0.5 0 0.5 1"
                  keyTimes="0;1"
                />
                <animate attributeName="cy" from={junctionY} to={junctionY} dur="0.32s" fill="freeze" />
                <animate attributeName="opacity" from={1} to={0} begin="0.3s" dur="0.05s" fill="freeze" />
              </circle>
              {/* Three branch pulses: junction → each lane, teal, staggered. */}
              {targets.map((ty, i) => (
                <circle key={`b-${i}`} r={4.5} fill="var(--brand-accent)" opacity={0}>
                  <animateMotion
                    dur="0.44s"
                    begin="0.3s"
                    fill="freeze"
                    calcMode="spline"
                    keySplines="0.4 0 0.4 1"
                    keyTimes="0;1"
                    path={`M ${junctionX} ${junctionY} C ${junctionX + 28} ${junctionY}, ${endX - 28} ${ty}, ${endX} ${ty}`}
                  />
                  <animate
                    attributeName="opacity"
                    from={0}
                    to={1}
                    begin="0.3s"
                    dur="0.08s"
                    fill="freeze"
                  />
                </circle>
              ))}
            </g>
          )
        ) : null}
      </svg>
    </div>
  )
}

/**
 * AgentLane — one listener panel. Glows cobalt while awaiting, turns teal on a
 * real reply, or shows an honest "waiting" affordance with the exact command to
 * start that listener when it never answers.
 */
function AgentLane({
  name,
  state,
  index,
  reduced,
}: {
  name: LaneName
  state: LaneState
  index: number
  reduced: boolean
}) {
  const { phase, reply } = state
  const awaiting = phase === 'awaiting'
  const replied = phase === 'replied'
  const waiting = phase === 'timeout'

  return (
    <div
      className={cn(
        'border-2 p-[var(--space-3)]',
        !reduced && 'transition-colors duration-[var(--duration-normal)]',
        replied
          ? 'border-[var(--brand-accent)] bg-[color-mix(in_srgb,var(--brand-accent)_9%,var(--surface-base))]'
          : awaiting
            ? 'border-[var(--brand-primary)] bg-[var(--surface-raised)]'
            : 'border-[var(--border-strong)] bg-[var(--surface-base)]',
        awaiting && !reduced && 'shadow-[0_0_0_4px_rgba(0,63,184,0.16)]',
        replied && reply && !reduced && 'tube-card-rise',
      )}
      style={!reduced ? { animationDelay: `${0.3 + index * 0.06}s` } : undefined}
      aria-label={`Listener ${name}: ${
        replied ? 'replied' : awaiting ? 'awake, working' : waiting ? 'not listening' : 'idle'
      }`}
    >
      <div className="flex items-center justify-between gap-[var(--space-2)]">
        <span className="font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)]">
          --as {name}
        </span>
        <LaneBadge phase={phase} />
      </div>
      <div className="mt-[var(--space-1)] font-display text-[length:var(--text-lg)] font-black text-[var(--text-primary)]">
        {name}
      </div>

      <div className="mt-[var(--space-2)] min-h-[2.6em] font-sans text-[length:var(--text-base)] leading-[var(--leading-body)]">
        {replied && reply ? (
          <span className="text-[var(--text-primary)]">
            {reply.payload.body ?? '(empty reply)'}
          </span>
        ) : awaiting ? (
          <span className="text-[var(--text-muted)]">Awake — reading the broadcast…</span>
        ) : waiting ? (
          <span className="text-[var(--text-muted)]">
            Waiting for{' '}
            <code className="font-mono font-bold text-[var(--brand-primary)]">
              pd tube {FAN_CHANNEL} --as {name}
            </code>
          </span>
        ) : (
          <span className="text-[var(--text-muted)]">Idle — listening on {FAN_CHANNEL}.</span>
        )}
      </div>
    </div>
  )
}

function LaneBadge({ phase }: { phase: LanePhase }) {
  const map: Record<LanePhase, { label: string; tone: string }> = {
    idle: { label: 'idle', tone: 'text-[var(--text-muted)] border-[var(--border-default)]' },
    awaiting: { label: '● awake', tone: 'text-[var(--brand-primary)] border-[var(--brand-primary)]' },
    replied: { label: '● replied', tone: 'text-[var(--brand-accent)] border-[var(--brand-accent)]' },
    timeout: { label: 'no listener', tone: 'text-[var(--text-muted)] border-[var(--border-default)]' },
  }
  const { label, tone } = map[phase]
  return (
    <span
      className={cn(
        'shrink-0 border px-[var(--space-2)] py-[2px] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)]',
        tone,
      )}
    >
      {label}
    </span>
  )
}

/** A short status line driven by the wall's phase + how many lanes replied. */
function WallStatus({
  wallPhase,
  repliedCount,
  errorMessage,
}: {
  wallPhase: WallPhase
  repliedCount: number
  errorMessage?: string
}) {
  let content: ReactNode
  switch (wallPhase) {
    case 'sending':
      content = (
        <>
          Posting once to <b className="text-[var(--text-primary)]">{FAN_CHANNEL}</b>…
        </>
      )
      break
    case 'awaiting':
      content = (
        <span className="font-bold text-[var(--brand-primary)]">
          ● one POST out — three lanes watching for their reply…
        </span>
      )
      break
    case 'settled':
      content =
        repliedCount > 0 ? (
          <>
            <span className="font-bold text-[var(--brand-accent)]">
              ● {repliedCount} of {LANES.length} replied
            </span>{' '}
            from one broadcast — every listener got the same message.
          </>
        ) : (
          <span className="text-[var(--text-primary)]">
            No agent answered. Start a listener with{' '}
            <code className="font-mono font-bold text-[var(--brand-primary)]">
              pd tube {FAN_CHANNEL} --as alice
            </code>{' '}
            then broadcast again.
          </span>
        )
      break
    case 'error':
      content = (
        <span className="font-bold text-[var(--status-danger,#bf2f2f)]">
          {errorMessage ? `Error: ${errorMessage}` : 'Something went wrong.'}
        </span>
      )
      break
    default:
      content = (
        <>
          One <b className="text-[var(--text-primary)]">Broadcast</b> fires a single real{' '}
          <code className="font-mono">POST</code> to {FAN_CHANNEL}; three lanes wake on their own
          reply.
        </>
      )
  }
  return (
    <div
      className="min-h-[1.4em] font-sans text-[length:var(--text-base)] text-[var(--text-secondary)]"
      aria-live="polite"
    >
      {content}
    </div>
  )
}

function BehaviorCard({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof GitFork
  title: string
  body: ReactNode
}) {
  return (
    <div className="border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-4)]">
      <div className="mb-[var(--space-2)] flex items-center gap-[var(--space-2)] text-[var(--brand-primary)]">
        <Icon size={18} />
        <span className="text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
          Behavior
        </span>
      </div>
      <PanelTitle as="h4" className="mb-[var(--space-2)] text-[length:var(--type-panel-title-card-size)]">
        {title}
      </PanelTitle>
      <PanelBody size="compact">{body}</PanelBody>
    </div>
  )
}
