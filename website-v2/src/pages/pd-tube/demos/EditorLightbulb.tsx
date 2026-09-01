import { useCallback, useMemo, useState } from 'react'
import { Lightbulb } from 'lucide-react'
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
 * EditorLightbulb — pd tube playground Demo #3.
 *
 * Concept: a faux editor pane (house style — cream/cobalt, line-number gutter,
 * NOT a black editor) shows a few lines of real TypeScript with one block
 * selected. A cobalt lightbulb glyph sits in the gutter at the selection. Click
 * it (or "Ask the agent") and a REAL POST goes to channel editor:explain with a
 * { file, range, selection } body. The cobalt send-pulse travels to an agent
 * node that glows while working; a teal reply card returns the explanation, and
 * a suggested-change diff if the agent sends one — rendered in the cream palette.
 *
 * The lightbulb *lighting up* is the signature beat: it flares and rings on fire,
 * then holds a lit state while the round-trip is in flight.
 *
 * Reuse: this composes the exported TubeWire parts — usePublish / useReplyWatch
 * drive the real POST + poll, fireTube runs the one round-trip and the phase
 * machine, and Sender / Wire / AgentNode / TubeStatus render the house-style
 * vocabulary. No fetch, poll, or animation primitive is re-implemented here.
 *
 * Honesty: every pulse is a real round-trip or a real timeout. The "Apply this
 * change" control is shown but is a demo affordance only — it does not edit
 * files. Doing this for real is roughly 300 lines of a VS Code extension; this
 * page only fires the message and renders what an agent actually replies.
 */

const EXPLAIN_CHANNEL = 'editor:explain'

/** The Explainer — the named agent that reads a selection and explains it. */
const EXPLAINER_NAME = 'explainer'
const EXPLAINER_ROLE = 'Code explainer'

/** The real prompt the Explainer runs with — the instructions handed to the model. */
const EXPLAINER_PROMPT = `You are Explainer, the code explainer on this project's
editor:explain channel. Each message is a JSON request from an editor:
{ file, range, selection } — a file path, a line range, and the selected source.

For every request:
1. Explain the selected code in plain language: what it does, and one thing
   worth knowing (an edge case, an assumption, a subtle bug). Two or three
   sentences, no restating the code line by line.
2. If — and only if — there is a clear improvement, append a unified diff for
   it. If the code is fine as-is, say so and send no diff.

Reply on the same channel with inReplyTo set to the request's id, sender
"explainer". You explain and suggest; the editor decides whether to apply.`

/** The pd-fleet.yml that declares the Explainer on the editor:explain channel. */
const EXPLAINER_FLEET_YAML = `# pd-fleet.yml — declare the Explainer on the editor:explain channel.
fleet:
  name: editor-crew
  agents:
    explainer:
      trigger: editor:explain       # daemon dispatches on every selection sent
      backend: cli:claude-code
      fallbacks:
        - backend: cli:codex
        - backend: cloudflare
          capability: code
      singleton: true
      allowedTools: "Read,Grep,Glob"
      identity: "{project}:fleet:explainer"
      telos: "Explain a selection plainly; suggest a change only when it earns one."
      prompt: |
        You are Explainer on editor:explain. Each message is JSON from an editor:
        { file, range, selection }. Explain the selected code in plain language —
        what it does plus one thing worth knowing — in two or three sentences.
        Append a unified diff only if there is a clear improvement; otherwise say
        the code is fine and send no diff. Reply on the same channel with
        inReplyTo set, sender "explainer".`

/** The ad-hoc one-liner: a listener that hands the prompt to a model. */
const EXPLAINER_ADHOC = `# Ad-hoc: tail the channel and hand each selection to a model with the prompt above.
pd tube ${EXPLAIN_CHANNEL} --tail --as ${EXPLAINER_NAME} \\
  --prompt "You are Explainer. Read the { file, range, selection } JSON and explain it plainly; add a diff only if it earns one."`

/** The faux editor file + the lines shown, with the selected range marked. */
const FILE_PATH = 'src/daemon/url.ts'

/** Each editor row: a line number, its source text, and whether it's selected. */
interface CodeLine {
  n: number
  text: string
  selected?: boolean
}

/**
 * A real-looking snippet: getDaemonUrl, resolving the daemon URL from env with a
 * default. The selected block is the body of the function — the thing we ask the
 * agent to explain / critique.
 */
const CODE_LINES: CodeLine[] = [
  { n: 18, text: 'const DEFAULT_DAEMON_URL = "http://127.0.0.1:9876"' },
  { n: 19, text: '' },
  { n: 20, text: 'export function getDaemonUrl(): string {', selected: true },
  { n: 21, text: '  const fromEnv = process.env.PD_DAEMON_URL', selected: true },
  { n: 22, text: '  if (fromEnv) return fromEnv.replace(/\\/$/, "")', selected: true },
  { n: 23, text: '  return DEFAULT_DAEMON_URL', selected: true },
  { n: 24, text: '}', selected: true },
  { n: 25, text: '' },
  { n: 26, text: 'const url = getDaemonUrl()' },
]

/** The 1-based inclusive line range of the selection, derived from CODE_LINES. */
const SELECTED_LINES = CODE_LINES.filter((l) => l.selected)
const SELECTION_RANGE = {
  startLine: SELECTED_LINES[0]?.n ?? 0,
  endLine: SELECTED_LINES[SELECTED_LINES.length - 1]?.n ?? 0,
}
const SELECTION_TEXT = SELECTED_LINES.map((l) => l.text).join('\n')

/**
 * The exact JSON body posted to the channel — the editor's "explain this
 * selection" request. Pretty-printed so the reader sees precisely what travels.
 */
const REQUEST_BODY = JSON.stringify(
  {
    file: FILE_PATH,
    range: SELECTION_RANGE,
    selection: SELECTION_TEXT,
  },
  null,
  2,
)

/** The real shell snippet: an editor command piping the selection to the channel. */
const EDITOR_SNIPPET = `# What ~300 lines of a VS Code extension boils down to:
# on "Ask the agent", POST the selection to the channel an agent watches.
pd tube ${EXPLAIN_CHANNEL} --as editor \\
  --send '{"file":"${FILE_PATH}","range":{"startLine":${SELECTION_RANGE.startLine},"endLine":${SELECTION_RANGE.endLine}},"selection":"..."}'`

/** A diff line, parsed from a reply or the labelled fallback sample. */
interface DiffLine {
  kind: 'add' | 'del' | 'ctx' | 'meta'
  text: string
}

/** The sample reply shown before any real agent answers. Clearly labelled. */
const SAMPLE_EXPLANATION =
  'getDaemonUrl reads PD_DAEMON_URL from the environment, trims a trailing slash, ' +
  'and otherwise falls back to the loopback default. It is pure and easy to test. ' +
  'One nit: it normalises the trailing slash only on the env path, so the default ' +
  'and the env value can disagree on shape. Normalise both at the return.'

const SAMPLE_DIFF = `--- a/src/daemon/url.ts
+++ b/src/daemon/url.ts
@@ getDaemonUrl @@
-  if (fromEnv) return fromEnv.replace(/\\/$/, "")
-  return DEFAULT_DAEMON_URL
+  const raw = fromEnv ?? DEFAULT_DAEMON_URL
+  return raw.replace(/\\/$/, "")`

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
 * Split a reply body into a leading prose explanation and a trailing diff. The
 * diff starts at the first line that looks like a unified-diff header or a +/−
 * change line; everything before it is the explanation.
 */
function splitReply(body: string): { explanation: string; diff: string | null } {
  const lines = body.split('\n')
  const start = lines.findIndex(
    (l) => l.startsWith('---') || l.startsWith('@@') || l.startsWith('+') || l.startsWith('-'),
  )
  if (start === -1) return { explanation: body.trim(), diff: null }
  return {
    explanation: lines.slice(0, start).join('\n').trim(),
    diff: lines.slice(start).join('\n').trim(),
  }
}

export function EditorLightbulb() {
  const reduced = useReducedMotion()
  const publish = usePublish(EXPLAIN_CHANNEL)
  const watch = useReplyWatch(EXPLAIN_CHANNEL)

  const [phase, setPhase] = useState<TubePhase>('idle')
  const [pulse, setPulse] = useState<'none' | 'send' | 'reply'>('none')
  const [elapsedMs, setElapsedMs] = useState<number>()
  const [errorMessage, setErrorMessage] = useState<string>()
  const [reply, setReply] = useState<TubeMessage | null>(null)
  /** Bumped each fire so the one-shot lamp flare/ring restart via React key. */
  const [lampNonce, setLampNonce] = useState(0)

  const busy = phase === 'sending' || phase === 'awaiting'
  const lit = busy || phase === 'replied'
  const answered = phase === 'replied'

  const ask = useCallback(() => {
    if (busy) return
    setErrorMessage(undefined)
    setReply(null)
    setElapsedMs(undefined)
    setPulse('send')
    setLampNonce((n) => n + 1)
    void fireTube({
      channel: EXPLAIN_CHANNEL,
      sender: 'editor',
      body: REQUEST_BODY,
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

  // What the answer panel shows: the real reply when present, else the labelled
  // sample. Explanation prose is likewise real-when-present.
  const replyBody = reply?.payload.body ?? ''
  const { explanation, diff } = useMemo(() => {
    if (!reply) return { explanation: SAMPLE_EXPLANATION, diff: SAMPLE_DIFF }
    const parsed = splitReply(replyBody)
    return {
      explanation: parsed.explanation || 'Agent replied. See the suggested change below.',
      diff: parsed.diff ?? null,
    }
  }, [reply, replyBody])
  const diffLines = useMemo(() => (diff ? parseDiff(diff) : []), [diff])
  const usingSample = !reply

  return (
    <TubeMotionProvider>
      <div className="grid min-w-0 gap-[var(--space-5)] lg:grid-cols-[minmax(0,1fr)_minmax(20rem,30rem)]">
        {/* Left column: the editor pane + ask control + wire */}
        <div className="min-w-0 space-y-[var(--space-5)]">
          <PanelEyebrow>The selection · posts to {EXPLAIN_CHANNEL}</PanelEyebrow>

          {/* House-style editor: cream frame, line-number gutter, gutter bulb. */}
          <EditorPane
            file={FILE_PATH}
            lines={CODE_LINES}
            lit={lit}
            lampNonce={lampNonce}
            reduced={reduced}
            busy={busy}
            onAsk={ask}
          />

          {/* Explicit ask button (mirrors the gutter bulb for keyboard/clarity). */}
          <button
            type="button"
            onClick={ask}
            disabled={busy}
            className={cn(
              'inline-flex items-center justify-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] px-[var(--space-4)] py-[var(--space-3)] font-sans text-[length:var(--text-base)] font-semibold uppercase tracking-[var(--tracking-meta)] transition-colors',
              'bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]',
              'hover:bg-[var(--brand-primary-on-tint)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--interactive-focus)]',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            <Lightbulb size={16} />
            {busy ? 'Asked — agent reading the selection…' : 'Ask the agent'}
          </button>

          {/* Wire: editor → agent. */}
          <div className="grid min-w-0 grid-cols-1 items-center gap-[var(--space-2)] sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
            <Sender role="Editor" name="selection" active={lit} />
            <Wire pulse={pulse} />
            <AgentNode name={EXPLAINER_NAME} channel={EXPLAIN_CHANNEL} phase={phase} />
          </div>

          <TubeStatus
            phase={phase}
            channel={EXPLAIN_CHANNEL}
            elapsedMs={elapsedMs}
            errorMessage={errorMessage}
          />
        </div>

        {/* Right column: the agent's explanation + suggested change */}
        <SurfacePanel className="flex min-w-0 flex-col gap-[var(--space-4)] self-start">
          <div className="flex items-center justify-between gap-[var(--space-3)]">
            <PanelEyebrow className={answered ? 'text-[var(--brand-accent)]' : undefined}>
              {answered ? 'Agent reply · explanation' : 'What the agent sends back'}
            </PanelEyebrow>
            {usingSample ? (
              <span className="shrink-0 border border-[var(--border-default)] px-[var(--space-2)] py-[2px] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                Sample shape
              </span>
            ) : null}
          </div>

          <PanelBody size="compact" className="max-w-none">
            {usingSample
              ? 'No reply yet. This is the shape a reply takes — a plain-language explanation, plus an optional suggested change as a unified diff. Ask with an agent listening to replace it with the real one.'
              : explanation}
          </PanelBody>

          {diffLines.length > 0 ? (
            <ChangeCard lines={diffLines} reduced={reduced} live={answered} />
          ) : null}

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
              Apply this change
            </button>
            <PanelBody size="compact" className="max-w-none text-[length:var(--type-meta-size)]">
              Shown for shape only — writing the edit back is an editor concern (~300 lines of a VS
              Code extension), not this demo's.
            </PanelBody>
          </div>
        </SurfacePanel>

        {/* Full-width: the real editor-command snippet */}
        <div className="min-w-0 lg:col-span-2">
          <SurfacePanel elevation="quiet" padding="compact">
            <CopyableCommandBlock
              label="Wire your editor's “Ask the agent” to the channel"
              command={EDITOR_SNIPPET}
            />
          </SurfacePanel>
        </div>

        {/* Full-width: how this demo is wired. */}
        <div className="lg:col-span-2">
          <HowItsWired
            channel={EXPLAIN_CHANNEL}
            agents={[{ name: EXPLAINER_NAME, role: EXPLAINER_ROLE, prompt: EXPLAINER_PROMPT }]}
            trigger={
              <>
                Your editor's “Ask the agent” command POSTs a{' '}
                <code className="font-mono">{'{ file, range, selection }'}</code> request to{' '}
                <code className="font-mono">{EXPLAIN_CHANNEL}</code>. In a fleet the channel is the
                trigger: the daemon watches <code className="font-mono">editor:explain</code> and
                dispatches the Explainer on each selection. The editor side is roughly 300 lines of a
                VS Code extension; the agent side is the prompt below.
              </>
            }
            fleetYaml={EXPLAINER_FLEET_YAML}
            adHocCommand={EXPLAINER_ADHOC}
          />
        </div>
      </div>
    </TubeMotionProvider>
  )
}

/**
 * EditorPane — the house-style faux editor: a cream/raised framed panel with a
 * line-number gutter, selected lines tinted cobalt, and a clickable cobalt
 * lightbulb glyph parked in the gutter at the selection. Deliberately NOT a
 * black editor. The bulb is the signature beat: it flares + rings on fire and
 * holds a lit state while the round-trip is in flight.
 */
function EditorPane({
  file,
  lines,
  lit,
  lampNonce,
  reduced,
  busy,
  onAsk,
}: {
  file: string
  lines: CodeLine[]
  lit: boolean
  lampNonce: number
  reduced: boolean
  busy: boolean
  onAsk: () => void
}) {
  // The bulb sits at the first selected line so it reads as "fix-it here".
  const bulbLineIndex = lines.findIndex((l) => l.selected)

  return (
    <div className="min-w-0 overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-[var(--space-2)] border-b-2 border-[var(--border-strong)] px-[var(--space-3)] py-[var(--space-2)]">
        <PanelEyebrow className="text-[var(--brand-primary)]">editor · {file}</PanelEyebrow>
        <span className="font-mono text-[length:var(--type-meta-size)] text-[var(--text-muted)]">
          lines {SELECTION_RANGE.startLine}–{SELECTION_RANGE.endLine} selected
        </span>
      </div>

      <div className="min-w-0 font-mono text-[14px] leading-[1.7]">
        {lines.map((line, i) => {
          const showBulb = i === bulbLineIndex
          return (
            <div
              key={line.n}
              className={cn(
                'flex min-w-0 items-stretch',
                line.selected &&
                  'bg-[color-mix(in_srgb,var(--brand-primary)_10%,transparent)]',
              )}
            >
              {/* Gutter: line number + (on the first selected line) the bulb. */}
              <div
                className={cn(
                  'relative flex w-[var(--space-8)] shrink-0 select-none items-center justify-end gap-[var(--space-1)] border-r-2 px-[var(--space-2)] text-[var(--text-muted)]',
                  line.selected
                    ? 'border-[var(--brand-primary)]'
                    : 'border-[var(--border-default)]',
                )}
              >
                {showBulb ? (
                  <GutterLamp
                    lit={lit}
                    nonce={lampNonce}
                    reduced={reduced}
                    busy={busy}
                    onAsk={onAsk}
                  />
                ) : null}
                <span aria-hidden={false}>{line.n}</span>
              </div>

              {/* Source text. Selected lines carry a cobalt left edge cue. */}
              <pre
                className={cn(
                  'min-w-0 flex-1 overflow-x-auto whitespace-pre px-[var(--space-3)] py-[1px] text-[var(--text-primary)]',
                  line.selected && 'border-l-2 border-[var(--brand-primary)] pl-[calc(var(--space-3)-2px)]',
                )}
              >
                {line.text || ' '}
              </pre>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * GutterLamp — the clickable lightbulb. Unlit: a quiet cobalt outline glyph.
 * Lit (busy/answered): filled cobalt with a soft glow. On each fire it flares
 * (a one-shot brighten/settle) and emits a single expanding ring. Under reduced
 * motion it switches to its lit state with no flare and no ring.
 */
function GutterLamp({
  lit,
  nonce,
  reduced,
  busy,
  onAsk,
}: {
  lit: boolean
  nonce: number
  reduced: boolean
  busy: boolean
  onAsk: () => void
}) {
  return (
    <button
      type="button"
      onClick={onAsk}
      disabled={busy}
      aria-label="Ask the agent to explain this selection"
      title="Ask the agent to explain this selection"
      className={cn(
        'relative -ml-[2px] inline-flex h-[18px] w-[18px] items-center justify-center border transition-colors',
        lit
          ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]'
          : 'border-[var(--brand-primary)] bg-transparent text-[var(--brand-primary)] hover:bg-[color-mix(in_srgb,var(--brand-primary)_14%,transparent)]',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--interactive-focus)]',
        'disabled:cursor-not-allowed',
        lit && !reduced && 'shadow-[0_0_0_3px_rgba(0,63,184,0.20)]',
      )}
    >
      {/* One-shot expanding ring on each fire (suppressed under reduced motion). */}
      {!reduced && nonce > 0 ? (
        <span
          key={`ring-${nonce}`}
          aria-hidden="true"
          className="tube-lamp-ring pointer-events-none absolute inset-0 border-2 border-[var(--brand-primary)]"
        />
      ) : null}
      {/* The bulb glyph flares on each fire (key restarts the one-shot anim). */}
      <Lightbulb
        key={`bulb-${nonce}-${reduced ? 'static' : 'anim'}`}
        size={12}
        strokeWidth={2.5}
        className={cn('relative', !reduced && nonce > 0 && 'tube-lamp-flare')}
      />
    </button>
  )
}

/**
 * ChangeCard — renders the agent's suggested change as a unified diff in the
 * cream palette: teal for added lines, red for removed lines, indigo-muted for
 * context and headers. Rises in on a real reply (suppressed under reduced
 * motion via the shared tube-card-rise convention).
 */
function ChangeCard({
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
        return {
          color: 'var(--brand-accent)',
          bg: 'color-mix(in srgb, var(--brand-accent) 9%, transparent)',
        }
      case 'del':
        return {
          color: 'var(--status-error)',
          bg: 'color-mix(in srgb, var(--status-error) 8%, transparent)',
        }
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
        <PanelEyebrow>suggested change · unified diff</PanelEyebrow>
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
