import { useCallback, useMemo, useState } from 'react'
import { FlaskConical, Play } from 'lucide-react'
import {
  CopyableCommandBlock,
  PanelBody,
  PanelEyebrow,
  SurfacePanel,
} from '@/components/site/primitives'
import { cn } from '@/lib/utils'
import { HowItsWired } from './HowItsWired'
import {
  AgentNode,
  Sender,
  TubeMotionProvider,
  TubeStatus,
  Wire,
  fireTube,
  usePublish,
  useReducedMotion,
  useReplyWatch,
  type TubeMessage,
  type TubePhase,
} from '@/components/tube/TubeWire'

/**
 * RedToGreen — pd tube playground Demo #2.
 *
 * Concept: a captured test FAILURE is posted to a channel; an agent on that
 * channel replies with a diagnosis and a suggested diff. The status bar starts
 * literally red (the suite is failing) and, on a real reply, wipes left→right to
 * green (the agent has a fix in hand).
 *
 * Reuse: this composes the exported TubeWire parts — usePublish / useReplyWatch
 * drive the real POST + poll, fireTube runs the one round-trip and the phase
 * machine, and Sender / Wire / AgentNode / TubeStatus render the house-style
 * vocabulary. No fetch, poll, or animation is re-implemented here.
 *
 * Honesty: every pulse is a real round-trip or a real timeout. The "Apply this
 * diff" control is shown but is a demo affordance only — it does not edit files.
 * The reply diff is whatever the listening agent actually sends back; the
 * fallback diff below renders only when no agent has replied yet, clearly as a
 * sample of the shape a reply takes.
 */

const FAIL_CHANNEL = 'tests:failed'

/** The Mechanic — the named agent that reads failures and replies with a fix. */
const MECHANIC_NAME = 'mechanic'
const MECHANIC_ROLE = 'Test fixer'

/** The real prompt the Mechanic runs with — the instructions handed to the model. */
const MECHANIC_PROMPT = `You are Mechanic, the test fixer on this project's
tests:failed channel. Each message is a captured failure: a suite name, the
failing assertion, expected vs received, and a short stack snippet.

For every failure:
1. Read the assertion and stack. Find the smallest change that makes the test
   pass for the RIGHT reason — never edit the test to match a wrong result.
2. Reply with a one or two sentence diagnosis of the actual bug, then a unified
   diff for the fix. Keep the diff minimal and scoped to the cited file.
3. If the failure is environmental (flaky, missing fixture, timeout) say so and
   do not invent a code change.

Reply on the same channel with inReplyTo set to the failure's id, sender
"mechanic". You propose the diff; a human applies it.`

/** The pd-fleet.yml that declares the Mechanic on the tests:failed channel. */
const MECHANIC_FLEET_YAML = `# pd-fleet.yml — declare the Mechanic on the tests:failed channel.
fleet:
  name: ci-crew
  agents:
    mechanic:
      trigger: tests:failed         # daemon dispatches on every captured failure
      backend: cli:claude-code
      fallbacks:
        - backend: cli:codex
        - backend: cloudflare
          capability: code
      singleton: true
      allowedTools: "Read,Grep,Glob,Bash(npm test*)"
      identity: "{project}:fleet:mechanic"
      telos: "Turn a red suite green for the right reason, with a minimal diff."
      prompt: |
        You are Mechanic, the test fixer on tests:failed. Each message is a
        captured failure: suite, failing assertion, expected vs received, stack.
        Find the smallest change that makes the test pass for the RIGHT reason —
        never edit the test to match a wrong result. Reply with a one-line
        diagnosis then a minimal unified diff for the cited file. Reply on the
        same channel with inReplyTo set, sender "mechanic". A human applies it.`

/** The ad-hoc one-liner: a listener that hands the prompt to a model. */
const MECHANIC_ADHOC = `# Ad-hoc: tail the channel and hand each failure to a model with the prompt above.
pd tube ${FAIL_CHANNEL} --tail --as ${MECHANIC_NAME} \\
  --prompt "You are Mechanic. Read the failure, diagnose the bug in one line, reply with a minimal unified diff."`

/** A realistic failing-test payload, posted verbatim as the message body. */
const FAILURE_PAYLOAD = {
  suite: 'cart/totals.test.ts',
  test: 'applies a percentage discount before tax',
  assertion: 'expect(total).toBe(89.1)',
  received: 'Received: 99.00',
  expected: 'Expected: 89.10',
  stack: [
    '  at applyDiscount (src/cart/totals.ts:42:18)',
    '  at computeTotal (src/cart/totals.ts:61:10)',
    '  at totals.test.ts:27:21',
  ],
} as const

/** The exact body string posted to the channel — a compact failure report. */
const FAILURE_BODY = [
  `FAIL ${FAILURE_PAYLOAD.suite}`,
  `  ✕ ${FAILURE_PAYLOAD.test}`,
  '',
  `  ${FAILURE_PAYLOAD.assertion}`,
  `    ${FAILURE_PAYLOAD.expected}`,
  `    ${FAILURE_PAYLOAD.received}`,
  '',
  ...FAILURE_PAYLOAD.stack,
].join('\n')

/** The real shell snippet: a test reporter piping its failure into the channel. */
const REPORTER_SNIPPET = `# Pipe a failing run straight to the channel an agent watches:
pnpm test --reporter=json 2>&1 \\
  | pd tube ${FAIL_CHANNEL} --as test-runner --send-stdin`

/** A diff line, parsed from a reply or from the fallback sample. */
interface DiffLine {
  kind: 'add' | 'del' | 'ctx' | 'meta'
  text: string
}

/** The sample reply shape shown before any real agent answers. Clearly labelled. */
const SAMPLE_DIFF = `--- a/src/cart/totals.ts
+++ b/src/cart/totals.ts
@@ applyDiscount @@
-  return price - rate
+  return price * (1 - rate)`

const SAMPLE_DIAGNOSIS =
  'applyDiscount subtracts the rate as a flat amount instead of scaling by it. ' +
  'For a 10% discount on 99.00 you want price × (1 − 0.10) = 89.10, not price − 0.10.'

/** Classify each line of a unified diff for cream-palette colouring. */
function parseDiff(text: string): DiffLine[] {
  return text.split('\n').map((line) => {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) {
      return { kind: 'meta', text: line }
    }
    if (line.startsWith('+')) return { kind: 'add', text: line }
    if (line.startsWith('-')) return { kind: 'del', text: line }
    return { kind: 'ctx', text: line }
  })
}

/**
 * Split a reply body into a leading prose diagnosis and a trailing diff. The
 * diff starts at the first line that looks like a unified-diff header or a +/−
 * change line; everything before it is the diagnosis.
 */
function splitReply(body: string): { diagnosis: string; diff: string | null } {
  const lines = body.split('\n')
  const start = lines.findIndex(
    (l) => l.startsWith('---') || l.startsWith('@@') || l.startsWith('+') || l.startsWith('-'),
  )
  if (start === -1) return { diagnosis: body.trim(), diff: null }
  return {
    diagnosis: lines.slice(0, start).join('\n').trim(),
    diff: lines.slice(start).join('\n').trim(),
  }
}

export function RedToGreen() {
  const reduced = useReducedMotion()
  const publish = usePublish(FAIL_CHANNEL)
  const watch = useReplyWatch(FAIL_CHANNEL)

  const [phase, setPhase] = useState<TubePhase>('idle')
  const [pulse, setPulse] = useState<'none' | 'send' | 'reply'>('none')
  const [elapsedMs, setElapsedMs] = useState<number>()
  const [errorMessage, setErrorMessage] = useState<string>()
  const [reply, setReply] = useState<TubeMessage | null>(null)

  const busy = phase === 'sending' || phase === 'awaiting'
  const passed = phase === 'replied'

  const run = useCallback(() => {
    if (busy) return
    setErrorMessage(undefined)
    setReply(null)
    setElapsedMs(undefined)
    setPulse('send')
    void fireTube({
      channel: FAIL_CHANNEL,
      sender: 'test-runner',
      body: FAILURE_BODY,
      publish,
      watch,
      onPhase: setPhase,
      onReply: (r, ms) => {
        setReply(r)
        setElapsedMs(ms)
        setPulse('reply')
      },
      onError: (e) => setErrorMessage(e.message),
    })
  }, [busy, publish, watch])

  // What the diff panel shows: the real reply's diff when present, else the
  // labelled sample. Diagnosis prose is likewise real-when-present.
  const replyBody = reply?.payload.body ?? ''
  const { diagnosis, diff } = useMemo(() => {
    if (!reply) return { diagnosis: SAMPLE_DIAGNOSIS, diff: SAMPLE_DIFF }
    const parsed = splitReply(replyBody)
    return {
      diagnosis: parsed.diagnosis || 'Agent replied. See the diff below.',
      diff: parsed.diff ?? SAMPLE_DIFF,
    }
  }, [reply, replyBody])
  const diffLines = useMemo(() => (diff ? parseDiff(diff) : []), [diff])
  const usingSample = !reply

  return (
    <TubeMotionProvider>
      <div className="grid gap-[var(--space-5)] lg:grid-cols-[1fr_minmax(20rem,30rem)]">
        {/* Left column: the failing console + run button + wire */}
        <div className="space-y-[var(--space-5)]">
          <PanelEyebrow>The failing run · posts to {FAIL_CHANNEL}</PanelEyebrow>

          {/* The status bar — literally red while failing, green on reply. */}
          <StatusBar passed={passed} reduced={reduced} />

          {/* Cream/cobalt console (house style — not a black terminal). */}
          <ConsolePanel payload={FAILURE_PAYLOAD} />

          {/* Run button fires the real POST. */}
          <button
            type="button"
            onClick={run}
            disabled={busy}
            className={cn(
              'inline-flex items-center justify-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] px-[var(--space-4)] py-[var(--space-3)] font-sans text-[length:var(--text-base)] font-semibold uppercase tracking-[var(--tracking-meta)] transition-colors',
              'bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]',
              'hover:bg-[var(--brand-primary-on-tint)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--interactive-focus)]',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            {busy ? <FlaskConical size={16} /> : <Play size={16} />}
            {busy ? 'Sent — awaiting fix…' : 'Run tests'}
          </button>

          {/* Wire: test-runner → agent. */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-[var(--space-2)]">
            <Sender role="Reporter" name="test-runner" active={busy || passed} />
            <Wire pulse={pulse} />
            <AgentNode name={MECHANIC_NAME} channel={FAIL_CHANNEL} phase={phase} />
          </div>

          <TubeStatus
            phase={phase}
            channel={FAIL_CHANNEL}
            elapsedMs={elapsedMs}
            errorMessage={errorMessage}
          />
        </div>

        {/* Right column: the agent's diagnosis + suggested diff */}
        <SurfacePanel className="flex flex-col gap-[var(--space-4)] self-start">
          <div className="flex items-center justify-between gap-[var(--space-3)]">
            <PanelEyebrow className={passed ? 'text-[var(--brand-accent)]' : undefined}>
              {passed ? 'Agent reply · suggested fix' : 'Suggested fix'}
            </PanelEyebrow>
            {usingSample ? (
              <span className="shrink-0 border border-[var(--border-default)] px-[var(--space-2)] py-[2px] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                Sample shape
              </span>
            ) : null}
          </div>

          <PanelBody size="compact" className="max-w-none">
            {usingSample
              ? 'No reply yet. This is the shape a reply takes — diagnosis plus a unified diff. Run the tests with an agent listening to replace it with the real one.'
              : diagnosis}
          </PanelBody>

          <DiffCard lines={diffLines} reduced={reduced} live={passed} />

          {/* Demo-only apply affordance — honest: it does not write files. */}
          <div className="flex flex-wrap items-center gap-[var(--space-3)] border-t-2 border-[var(--border-strong)]/12 pt-[var(--space-4)]">
            <button
              type="button"
              disabled
              aria-disabled="true"
              title="Demo only — this does not edit files"
              className={cn(
                'inline-flex cursor-not-allowed items-center gap-[var(--space-2)] border-2 border-[var(--border-default)] px-[var(--space-3)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)] opacity-70',
              )}
            >
              Apply this diff
            </button>
            <PanelBody size="compact" className="max-w-none text-[length:var(--type-meta-size)]">
              Shown for shape only — applying a diff is an editor concern, not this demo's.
            </PanelBody>
          </div>
        </SurfacePanel>

        {/* Full-width: the real reporter snippet */}
        <div className="lg:col-span-2">
          <SurfacePanel elevation="quiet" padding="compact">
            <CopyableCommandBlock
              label="Wire your test reporter to the channel"
              command={REPORTER_SNIPPET}
            />
          </SurfacePanel>
        </div>

        {/* Full-width: how this demo is wired. */}
        <div className="lg:col-span-2">
          <HowItsWired
            channel={FAIL_CHANNEL}
            agents={[{ name: MECHANIC_NAME, role: MECHANIC_ROLE, prompt: MECHANIC_PROMPT }]}
            trigger={
              <>
                Your test reporter POSTs the captured failure to{' '}
                <code className="font-mono">{FAIL_CHANNEL}</code>. In a fleet the channel is the
                trigger: the daemon watches <code className="font-mono">tests:failed</code> and
                dispatches the Mechanic on each failure. The same message can also arrive from a CI
                step or a watch-mode runner — the Mechanic does not care who posted it.
              </>
            }
            fleetYaml={MECHANIC_FLEET_YAML}
            adHocCommand={MECHANIC_ADHOC}
          />
        </div>
      </div>
    </TubeMotionProvider>
  )
}

/**
 * StatusBar — the literal red/green bar. The green layer sits over the red and
 * is revealed by an expanding inset clip on reply. Under reduced motion the
 * green state is applied instantly (no wipe). aria-live announces the change.
 */
function StatusBar({ passed, reduced }: { passed: boolean; reduced: boolean }) {
  return (
    <div
      className="relative h-[var(--space-7)] overflow-hidden border-2 border-[var(--border-strong)]"
      role="status"
      aria-live="polite"
    >
      {/* Red base layer: the failing state. */}
      <BarFill
        tone="fail"
        label="1 failing · suite red"
      />
      {/* Green layer revealed on pass. */}
      {passed ? (
        <div
          className={cn('absolute inset-0', reduced ? '' : 'tube-rg-wipe')}
          style={reduced ? { clipPath: 'inset(0 0 0 0)' } : undefined}
        >
          <BarFill tone="pass" label="0 failing · suite green" />
        </div>
      ) : null}
    </div>
  )
}

function BarFill({ tone, label }: { tone: 'fail' | 'pass'; label: string }) {
  const isFail = tone === 'fail'
  return (
    <div
      className="flex h-full w-full items-center gap-[var(--space-3)] px-[var(--space-4)]"
      style={{
        background: isFail ? 'var(--status-error)' : 'var(--brand-accent)',
        color: isFail ? 'var(--status-error-foreground, #fbf7ef)' : 'var(--brand-accent-foreground)',
      }}
    >
      <span
        aria-hidden="true"
        className="inline-block h-[10px] w-[10px] rounded-full"
        style={{ background: 'currentColor' }}
      />
      <span className="font-sans text-[length:var(--text-base)] font-bold uppercase tracking-[var(--tracking-meta)]">
        {label}
      </span>
    </div>
  )
}

/**
 * ConsolePanel — the house-style "console": a cream/raised framed panel with a
 * cobalt prompt glyph and a mono failing-assertion readout. Deliberately NOT a
 * black terminal.
 */
function ConsolePanel({ payload }: { payload: typeof FAILURE_PAYLOAD }) {
  const Prompt = ({ children }: { children: React.ReactNode }) => (
    <div className="flex gap-[var(--space-2)]">
      <span aria-hidden="true" className="select-none font-mono text-[var(--brand-primary)]">
        $
      </span>
      <span className="min-w-0">{children}</span>
    </div>
  )

  return (
    <div className="border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
      <div className="flex items-center justify-between border-b-2 border-[var(--border-strong)] px-[var(--space-3)] py-[var(--space-2)]">
        <PanelEyebrow className="text-[var(--brand-primary)]">console · vitest</PanelEyebrow>
        <span className="font-mono text-[length:var(--type-meta-size)] text-[var(--text-muted)]">
          {payload.suite}
        </span>
      </div>
      <div className="space-y-[var(--space-2)] px-[var(--space-4)] py-[var(--space-4)] font-mono text-[14px] leading-[1.6] text-[var(--text-primary)]">
        <Prompt>
          <span className="text-[var(--text-secondary)]">pnpm test</span>
        </Prompt>
        <div className="pl-[var(--space-4)]">
          <div className="font-bold text-[var(--status-error)]">
            FAIL {payload.suite}
          </div>
          <div className="text-[var(--status-error)]">  ✕ {payload.test}</div>
          <div className="mt-[var(--space-2)] text-[var(--text-primary)]">
            {payload.assertion}
          </div>
          <div className="text-[var(--brand-accent)]">    {payload.expected}</div>
          <div className="text-[var(--status-error)]">    {payload.received}</div>
          <div className="mt-[var(--space-2)] space-y-[2px] text-[var(--text-muted)]">
            {payload.stack.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * DiffCard — renders a unified diff in the cream palette: green for added lines,
 * red for removed lines, indigo-muted for context and headers. The card rises in
 * (suppressed under reduced motion via the shared tube-card-rise convention).
 */
function DiffCard({
  lines,
  reduced,
  live,
}: {
  lines: DiffLine[]
  reduced: boolean
  live: boolean
}) {
  const toneFor = (kind: DiffLine['kind']) => {
    switch (kind) {
      case 'add':
        return { color: 'var(--brand-accent)', bg: 'color-mix(in srgb, var(--brand-accent) 9%, transparent)' }
      case 'del':
        return { color: 'var(--status-error)', bg: 'color-mix(in srgb, var(--status-error) 8%, transparent)' }
      case 'meta':
        return { color: 'var(--text-muted)', bg: 'transparent' }
      default:
        return { color: 'var(--text-secondary)', bg: 'transparent' }
    }
  }

  return (
    <div
      className={cn(
        'border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]',
        live && !reduced && 'tube-card-rise',
      )}
    >
      <div className="border-b-2 border-[var(--border-strong)] px-[var(--space-3)] py-[var(--space-2)]">
        <PanelEyebrow>unified diff</PanelEyebrow>
      </div>
      <div className="overflow-x-auto px-[var(--space-3)] py-[var(--space-3)] font-mono text-[14px] leading-[1.65]">
        {lines.map((line, i) => {
          const tone = toneFor(line.kind)
          return (
            <div
              key={`${i}-${line.text}`}
              className="whitespace-pre"
              style={{ color: tone.color, background: tone.bg }}
            >
              {line.text || ' '}
            </div>
          )
        })}
      </div>
    </div>
  )
}
