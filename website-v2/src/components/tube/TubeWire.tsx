import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/utils'

/**
 * TubeWire — the reusable React primitive for the pd-tube demo suite.
 *
 * It owns the real Port Daddy tube protocol (POST to publish, GET ?after= to
 * poll for a reply) plus the house-style animation vocabulary: a cobalt send
 * pulse, an agent node that glows while awaiting a reply, a teal reply pulse,
 * and threaded reply cards that rise in.
 *
 * The protocol (CORS-allowed for the dev origin):
 *   - Publish: POST <daemon>/msg/<channel>
 *       body { sender, payload: { v:1, kind:"tube.msg", body, inReplyTo? } }
 *       -> { id }
 *   - Poll:    GET <daemon>/msg/<channel>?after=<cursor>
 *       -> { messages: [{ id, sender, payload }] }
 *   - A reply has payload.inReplyTo === <parentId>.
 *
 * The hooks (usePublish, useReplyWatch) and the visual parts (Sender, Wire,
 * AgentNode, ReplyThread, fireTube) are exported separately so other demos
 * (Red-to-Green, Fan-Out, War Room, Editor Lightbulb) can compose them without
 * re-implementing fetch / poll / animation. The all-in-one <TubeWire /> wires
 * the common single-sender / single-agent layout for the simplest cases.
 *
 * Honesty: claims are advisory. There is no fake activity — every pulse is
 * driven by a real POST and a real reply (or a real timeout / error).
 *
 * Reduced motion: when the user prefers reduced motion, pulses become instant
 * state markers (no travel animation, no looping), reply cards appear without
 * a rise, and the awaiting-reply state is conveyed by a static badge rather
 * than a glow transition. Nothing animates on its own.
 */

export const DEFAULT_DAEMON_URL = 'http://127.0.0.1:9876'
export const TUBE_KIND = 'tube.msg'

/** A Port Daddy tube message as returned by the daemon. */
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

/** What `fireTube` reports back as it progresses through one round-trip. */
export type TubePhase =
  | 'idle'
  | 'sending'
  | 'awaiting'
  | 'replied'
  | 'timeout'
  | 'error'

// ---------------------------------------------------------------------------
// Reduced-motion
// ---------------------------------------------------------------------------

/**
 * SSR-safe `prefers-reduced-motion` hook. Returns true when the user has asked
 * the OS to minimise motion; callers turn off travel animations and looping.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches)
    // Safari < 14 used addListener; modern browsers use addEventListener.
    if (mq.addEventListener) mq.addEventListener('change', onChange)
    else mq.addListener(onChange)
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange)
      else mq.removeListener(onChange)
    }
  }, [])

  return reduced
}

// ---------------------------------------------------------------------------
// Hooks: usePublish / useReplyWatch
// ---------------------------------------------------------------------------

const msgUrl = (daemonUrl: string, channel: string) =>
  `${daemonUrl.replace(/\/$/, '')}/msg/${encodeURIComponent(channel)}`

/**
 * usePublish — POST a message to a channel. Returns the new message id.
 * The returned function is stable for a given (channel, daemonUrl).
 */
export function usePublish(channel: string, daemonUrl: string = DEFAULT_DAEMON_URL) {
  return useCallback(
    async (body: string, sender: string, inReplyTo?: number): Promise<number> => {
      const payload: TubeMessage['payload'] = { v: 1, kind: TUBE_KIND, body }
      if (typeof inReplyTo === 'number') payload.inReplyTo = inReplyTo
      const res = await fetch(msgUrl(daemonUrl, channel), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender, payload }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as { id: number }
      return json.id
    },
    [channel, daemonUrl],
  )
}

/** Distinguishes a clean timeout from a transport/HTTP error to callers. */
export class TubeTimeoutError extends Error {
  constructor(message = 'timed out') {
    super(message)
    this.name = 'TubeTimeoutError'
  }
}

export interface ReplyWatchOptions {
  daemonUrl?: string
  /** Total time to wait for a matching reply before giving up. Default ~25s. */
  timeoutMs?: number
  /** Delay between polls. Default 700ms. */
  intervalMs?: number
  signal?: AbortSignal
}

/**
 * waitForReply — poll a channel with ?after=<cursor> until a message whose
 * payload.inReplyTo === parentId arrives, or the timeout elapses.
 *
 * Standalone (not a hook) so it can be called imperatively from a handler.
 * Throws TubeTimeoutError on timeout; rethrows transport errors as Error.
 */
export async function waitForReply(
  channel: string,
  parentId: number,
  opts: ReplyWatchOptions = {},
): Promise<TubeMessage> {
  const daemonUrl = opts.daemonUrl ?? DEFAULT_DAEMON_URL
  const timeoutMs = opts.timeoutMs ?? 25_000
  const intervalMs = opts.intervalMs ?? 700
  const url = msgUrl(daemonUrl, channel)
  const deadline = Date.now() + timeoutMs
  let cursor = parentId

  while (Date.now() < deadline) {
    if (opts.signal?.aborted) throw new DOMException('aborted', 'AbortError')
    const res = await fetch(`${url}?after=${cursor}`, { signal: opts.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = (await res.json()) as { messages?: TubeMessage[] }
    for (const m of json.messages ?? []) {
      cursor = Math.max(cursor, m.id)
      const p = m.payload
      if (p && p.kind === TUBE_KIND && p.inReplyTo === parentId) return m
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new TubeTimeoutError()
}

/**
 * useReplyWatch — hook wrapper around waitForReply. Returns a function that,
 * given a parentId, resolves with the matching reply message (or rejects with
 * TubeTimeoutError / Error). Aborts any in-flight poll on unmount.
 */
export function useReplyWatch(
  channel: string,
  daemonUrl: string = DEFAULT_DAEMON_URL,
  defaults: Omit<ReplyWatchOptions, 'daemonUrl' | 'signal'> = {},
) {
  const abortRef = useRef<AbortController | null>(null)
  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  const { timeoutMs, intervalMs } = defaults
  return useCallback(
    (parentId: number, overrides: Omit<ReplyWatchOptions, 'signal'> = {}) => {
      abortRef.current?.abort()
      const ctrl = new AbortController()
      abortRef.current = ctrl
      return waitForReply(channel, parentId, {
        daemonUrl,
        timeoutMs,
        intervalMs,
        ...overrides,
        signal: ctrl.signal,
      })
    },
    [channel, daemonUrl, timeoutMs, intervalMs],
  )
}

// ---------------------------------------------------------------------------
// fireTube — the one-shot round-trip orchestrator
// ---------------------------------------------------------------------------

export interface FireTubeArgs {
  channel: string
  daemonUrl?: string
  sender: string
  /** The message body posted to the channel. */
  body: string
  publish: ReturnType<typeof usePublish>
  watch: ReturnType<typeof useReplyWatch>
  /** Phase + side-effect callbacks. All optional. */
  onPhase?: (phase: TubePhase) => void
  onSent?: (id: number) => void
  onReply?: (reply: TubeMessage, elapsedMs: number) => void
  onTimeout?: () => void
  onError?: (err: Error) => void
}

export interface FireTubeResult {
  id: number
  reply: TubeMessage | null
  phase: TubePhase
  elapsedMs: number
}

/**
 * fireTube — publish one message, then await its reply. Drives the phase
 * machine that the visual parts render against. Never throws: failures surface
 * as phase 'timeout' or 'error' plus the matching callback.
 */
export async function fireTube(args: FireTubeArgs): Promise<FireTubeResult> {
  const { channel, sender, body, publish, watch, daemonUrl } = args
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now()
  args.onPhase?.('sending')
  let id = -1
  try {
    id = await publish(body, sender)
    args.onSent?.(id)
    args.onPhase?.('awaiting')
    const reply = await watch(id, { daemonUrl, channel } as ReplyWatchOptions)
    const elapsedMs = Math.round(
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0,
    )
    args.onPhase?.('replied')
    args.onReply?.(reply, elapsedMs)
    return { id, reply, phase: 'replied', elapsedMs }
  } catch (err) {
    const elapsedMs = Math.round(
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0,
    )
    if (err instanceof TubeTimeoutError) {
      args.onPhase?.('timeout')
      args.onTimeout?.()
      return { id, reply: null, phase: 'timeout', elapsedMs }
    }
    if (err instanceof DOMException && err.name === 'AbortError') {
      // Unmounted / superseded — quietly return to idle, no error surfaced.
      args.onPhase?.('idle')
      return { id, reply: null, phase: 'idle', elapsedMs }
    }
    const e = err instanceof Error ? err : new Error(String(err))
    args.onPhase?.('error')
    args.onError?.(e)
    return { id, reply: null, phase: 'error', elapsedMs }
  }
}

// ---------------------------------------------------------------------------
// Visual parts
// ---------------------------------------------------------------------------

const ReducedMotionContext = createContext<boolean | null>(null)

/** Lets the visual parts share one reduced-motion read without re-querying. */
export function TubeMotionProvider({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion()
  return (
    <ReducedMotionContext.Provider value={reduced}>{children}</ReducedMotionContext.Provider>
  )
}

function useTubeReducedMotion(): boolean {
  const ctx = useContext(ReducedMotionContext)
  const local = useReducedMotion()
  return ctx ?? local
}

/** A labelled trigger node (the thing that fires the message). */
export function Sender({
  role = 'Sender',
  name,
  active = false,
  className,
}: {
  role?: ReactNode
  name: ReactNode
  /** Highlight while this sender is the active one in a multi-trigger layout. */
  active?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        'border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-4)] text-center',
        active && 'border-[var(--brand-primary)] bg-[var(--surface-raised)]',
        className,
      )}
    >
      <div className="font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)]">
        {role}
      </div>
      <div className="mt-[var(--space-1)] font-display text-[length:var(--text-lg)] font-black text-[var(--text-primary)]">
        {name}
      </div>
    </div>
  )
}

/**
 * AgentNode — the shared listener. Glows cobalt while awaiting a reply. Under
 * reduced motion the glow is a static badge change rather than a transition.
 */
export function AgentNode({
  name = 'agent',
  channel,
  phase,
  className,
}: {
  name?: ReactNode
  channel: string
  phase: TubePhase
  className?: string
}) {
  const awake = phase === 'awaiting'
  const reduced = useTubeReducedMotion()
  return (
    <div
      className={cn(
        'border-2 border-[var(--brand-primary)] bg-[var(--surface-base)] p-[var(--space-4)] text-center',
        awake && 'bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]',
        awake && !reduced && 'shadow-[0_0_0_4px_rgba(0,63,184,0.18)]',
        !reduced && 'transition-colors duration-[var(--duration-normal)]',
        className,
      )}
      aria-label={`Agent node, listening on ${channel}${awake ? ', working' : ''}`}
    >
      <div
        className={cn(
          'font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)]',
          awake ? 'text-[var(--brand-primary-foreground-muted)]' : 'text-[var(--text-secondary)]',
        )}
      >
        Listening on {channel}
      </div>
      <div className="mt-[var(--space-1)] font-display text-[length:var(--text-lg)] font-black">
        {name}
      </div>
      {reduced && awake ? (
        <div className="mt-[var(--space-1)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary-foreground)]">
          working
        </div>
      ) : null}
    </div>
  )
}

/**
 * Wire — a horizontal connector between a sender and the agent node, carrying
 * a directional pulse. `pulse` of 'send' travels cobalt left→right; 'reply'
 * travels teal right→left. Under reduced motion the pulse is a static dot
 * coloured for the active direction (no travel keyframes).
 */
export function Wire({
  pulse,
  className,
}: {
  pulse: 'none' | 'send' | 'reply'
  className?: string
}) {
  const reduced = useTubeReducedMotion()
  const active = pulse !== 'none'
  const color = pulse === 'reply' ? 'var(--brand-accent)' : 'var(--brand-primary)'

  return (
    <div
      className={cn('relative h-[2px] min-w-[28px] self-center bg-[var(--border-strong)]', className)}
      aria-hidden="true"
    >
      {active ? (
        <span
          // Key forces a fresh element each pulse so the animation restarts.
          key={`${pulse}-${reduced ? 'static' : 'anim'}`}
          className={cn(
            'absolute top-[-4px] block h-[10px] w-[10px]',
            reduced
              ? pulse === 'reply'
                ? 'left-0'
                : 'right-0'
              : pulse === 'reply'
                ? 'tube-pulse-back'
                : 'tube-pulse-go',
          )}
          style={{ background: color }}
        />
      ) : null}
    </div>
  )
}

/** A single threaded card: a sent click (cobalt) or an agent reply (teal). */
export function TubeCard({
  kind,
  who,
  id,
  children,
  className,
}: {
  kind: 'click' | 'reply'
  who: ReactNode
  id: number | string
  children: ReactNode
  className?: string
}) {
  const reduced = useTubeReducedMotion()
  return (
    <div
      className={cn(
        'border-2 border-[var(--border-strong)] bg-[var(--surface-base)]',
        !reduced && 'tube-card-rise',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-[var(--space-3)] border-b border-[var(--border-default)] px-[var(--space-3)] py-[var(--space-2)]">
        <span
          className={cn(
            'font-sans text-[length:var(--type-meta-size)] font-bold uppercase tracking-[var(--tracking-meta)]',
            kind === 'reply' ? 'text-[var(--brand-accent)]' : 'text-[var(--brand-primary)]',
          )}
        >
          {who}
        </span>
        <span className="font-mono text-[length:var(--type-meta-size)] text-[var(--text-muted)]">
          #{id}
        </span>
      </div>
      <div
        className={cn(
          'px-[var(--space-3)] py-[var(--space-3)] font-sans text-[length:var(--text-base)] leading-[var(--leading-body)] text-[var(--text-primary)]',
          kind === 'reply' && 'bg-[color-mix(in_srgb,var(--brand-accent)_7%,transparent)]',
        )}
      >
        {children}
      </div>
    </div>
  )
}

/** An entry in the live thread, newest first. */
export interface ThreadEntry {
  key: string
  kind: 'click' | 'reply'
  who: ReactNode
  id: number | string
  body: ReactNode
}

/** ReplyThread — the aria-live log of clicks + replies, newest on top. */
export function ReplyThread({
  entries,
  className,
}: {
  entries: ThreadEntry[]
  className?: string
}) {
  return (
    <div
      className={cn('flex flex-col gap-[var(--space-3)]', className)}
      role="log"
      aria-live="polite"
      aria-label="Agent conversation"
    >
      {entries.map((e) => (
        <TubeCard key={e.key} kind={e.kind} who={e.who} id={e.id}>
          {e.body}
        </TubeCard>
      ))}
    </div>
  )
}

/** A short, human-readable status line driven by the current phase. */
export function TubeStatus({
  phase,
  channel,
  elapsedMs,
  errorMessage,
  className,
}: {
  phase: TubePhase
  channel: string
  elapsedMs?: number
  errorMessage?: string
  className?: string
}) {
  let content: ReactNode
  switch (phase) {
    case 'sending':
      content = (
        <>
          Posting to <b className="text-[var(--text-primary)]">{channel}</b>…
        </>
      )
      break
    case 'awaiting':
      content = (
        <span className="font-bold text-[var(--brand-accent)]">● agent awake — working…</span>
      )
      break
    case 'replied':
      content = (
        <>
          <span className="font-bold text-[var(--brand-accent)]">● replied</span>
          {typeof elapsedMs === 'number' ? <> in {elapsedMs} ms — </> : ' — '}
          <b className="text-[var(--text-primary)]">round-trip over one channel.</b>
        </>
      )
      break
    case 'timeout':
      content = (
        <span className="text-[var(--text-primary)]">
          No agent is listening. Run{' '}
          <code className="font-mono font-bold text-[var(--brand-primary)]">
            pd tube {channel}
          </code>{' '}
          in a terminal, then try again.
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
      content = `Agent idle — waiting on ${channel}.`
  }

  return (
    <div
      className={cn(
        'min-h-[1.4em] font-sans text-[length:var(--text-base)] text-[var(--text-secondary)]',
        className,
      )}
      aria-live="polite"
    >
      {content}
    </div>
  )
}

// ---------------------------------------------------------------------------
// TubeWire — the all-in-one single-sender / single-agent composition
// ---------------------------------------------------------------------------

export interface TubeWireRenderState {
  phase: TubePhase
  pulse: 'none' | 'send' | 'reply'
  /** Imperatively fire a message. Disabled while a round-trip is in flight. */
  fire: (body: string, sender?: string) => void
  busy: boolean
}

export interface TubeWireProps {
  channel: string
  daemonUrl?: string
  /** Default sender for fires that don't pass one. */
  sender?: string
  senderName?: ReactNode
  agentName?: ReactNode
  /** Render-prop for the trigger area; gets the live state. */
  controls?: (state: TubeWireRenderState) => ReactNode
  timeoutMs?: number
  className?: string
}

/**
 * TubeWire — the simplest composition: one Sender, one Wire, one AgentNode, and
 * a live ReplyThread. Pass `controls` to render your own trigger(s); it
 * receives `fire`. Other demos can instead compose the exported parts directly.
 */
export function TubeWire({
  channel,
  daemonUrl = DEFAULT_DAEMON_URL,
  sender = 'web-page',
  senderName = 'web page',
  agentName = 'agent',
  controls,
  timeoutMs,
  className,
}: TubeWireProps) {
  const publish = usePublish(channel, daemonUrl)
  const watch = useReplyWatch(channel, daemonUrl, { timeoutMs })
  const [phase, setPhase] = useState<TubePhase>('idle')
  const [pulse, setPulse] = useState<'none' | 'send' | 'reply'>('none')
  const [elapsedMs, setElapsedMs] = useState<number>()
  const [errorMessage, setErrorMessage] = useState<string>()
  const [entries, setEntries] = useState<ThreadEntry[]>([])
  const busy = phase === 'sending' || phase === 'awaiting'

  const fire = useCallback(
    (body: string, fireSender?: string) => {
      if (busy) return
      setErrorMessage(undefined)
      setPulse('send')
      void fireTube({
        channel,
        daemonUrl,
        sender: fireSender ?? sender,
        body,
        publish,
        watch,
        onPhase: setPhase,
        onSent: (id) =>
          setEntries((prev) => [
            { key: `c${id}`, kind: 'click', who: fireSender ?? sender, id, body },
            ...prev,
          ]),
        onReply: (reply, ms) => {
          setElapsedMs(ms)
          setPulse('reply')
          setEntries((prev) => [
            {
              key: `r${reply.id}`,
              kind: 'reply',
              who: reply.sender ?? 'agent',
              id: reply.id,
              body: reply.payload.body ?? '',
            },
            ...prev,
          ])
        },
        onError: (e) => setErrorMessage(e.message),
      })
    },
    [busy, channel, daemonUrl, sender, publish, watch],
  )

  return (
    <TubeMotionProvider>
      <div className={cn('space-y-[var(--space-5)]', className)}>
        {controls ? controls({ phase, pulse, fire, busy }) : null}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-[var(--space-2)]">
          <Sender name={senderName} />
          <Wire pulse={pulse} />
          <AgentNode name={agentName} channel={channel} phase={phase} />
        </div>
        <TubeStatus
          phase={phase}
          channel={channel}
          elapsedMs={elapsedMs}
          errorMessage={errorMessage}
        />
        <ReplyThread entries={entries} />
      </div>
    </TubeMotionProvider>
  )
}
