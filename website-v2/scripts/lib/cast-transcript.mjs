/**
 * cast-transcript.mjs — turn an asciinema .cast into a *behavioral transcript*.
 *
 * The website's terminal recordings are living integration tests: each .cast is
 * produced by booting the real compiled daemon and running real `pd` commands
 * (see scripts/record-*-terminal-gifs.sh). The bytes a command prints are the
 * thing worth snapshotting — NOT the GIF pixels and NOT the inter-keystroke
 * timing, both of which jitter run to run.
 *
 * This module extracts the deterministic transcript so it can be diffed against
 * a committed golden (scripts/snapshot-recordings.mjs). It drops event timing and
 * the header, strips ANSI, and scrubs the small, enumerated set of *ephemeral*
 * tokens that legitimately change every run. Everything left is behavior: if it
 * differs, a recorded command's output actually changed.
 *
 * IF A REAL RUN SURFACES A NEW EPHEMERAL (a CI "drift" that is just an
 * un-scrubbed id/timestamp), add a rule to EPHEMERAL_RULES below — that is the
 * intended maintenance loop, and it is cheap. Do NOT blanket-normalize bare
 * numbers: PD hashes identity->port deterministically, so most numbers are
 * stable, and masking them would hide genuine output changes.
 */

// ANSI escape sequences (colors, cursor moves, clears). Stripped for a clean,
// readable, diff-able transcript; the raw-cast error scan in
// check-terminal-recordings.mjs still sees the original bytes.
const ANSI = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g

// Ordered ephemeral-scrub rules. Order matters: longer/more-specific shapes
// (home paths, UUIDs) run before shorter ones (clock, port) so they win.
const EPHEMERAL_RULES = [
  // Home directories differ dev (/Users/<me>) vs CI (/home/runner). Must be first.
  [/\/Users\/[^/\s'"]+/g, '~'],
  [/\/home\/[^/\s'"]+/g, '~'],
  // Full UUIDs (session/agent/run identifiers carry these).
  [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<UUID>'],
  // Prefixed short ids: agent-99cfdeb8, spawned-1c9e8118, sortie-… , task-… .
  // (session-<UUID> already had its UUID replaced above, leaving session-<UUID>.)
  [/\b(session|agent|spawned|sortie|task|run|msg|note|tube|sess)-[0-9a-f]{6,}\b/gi, '$1-<ID>'],
  // Process ids.
  [/\bPID:?\s*\d+/g, 'PID <PID>'],
  // host:port for loopback hosts (the daemon + claimed ports).
  [/\b(127\.0\.0\.1|localhost|0\.0\.0\.0|::1):\d+/g, '$1:<PORT>'],
  // "port 51234" / "on port 9876"
  [/\bport\s+\d{2,5}\b/gi, 'port <PORT>'],
  // Relative-age markers from notes/activity: [14h], [3d], [2m], [5s], [1w].
  [/\[\d+(?:s|m|h|d|w|mo|y)\]/g, '[<AGE>]'],
  [/\b\d+(?:s|m|h|d|w)\s+ago\b/g, '<AGE> ago'],
  // Durations: 7ms, 1.2s, 250µs, 13ns.
  [/\b\d+(?:\.\d+)?\s?(?:ms|µs|us|ns)\b/g, '<DUR>'],
  [/\b\d+(?:\.\d+)?s\b/g, '<DUR>'],
  // Epoch seconds (10-digit, this era) and ms (13-digit).
  [/\b1\d{12}\b/g, '<EPOCH>'],
  [/\b1\d{9}\b/g, '<EPOCH>'],
  // ISO date and wall-clock time.
  [/\b20\d\d-\d\d-\d\d\b/g, '<DATE>'],
  [/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, '<TIME>'],
]

/** Apply the ordered ephemeral-scrub rules to a chunk of plain text. */
export function scrubEphemerals(text) {
  let out = text
  for (const [pattern, replacement] of EPHEMERAL_RULES) out = out.replace(pattern, replacement)
  return out
}

/**
 * Parse asciinema cast (v2 or v3) → concatenated terminal output ("o" events).
 * Input echo and program output are both "o" events, so the typed command line
 * is reconstructed naturally. Timing (the leading delay) is intentionally dropped.
 */
function castOutput(castText) {
  const lines = castText.split('\n')
  const chunks = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    // Line 0 is the header object ({version,term,timestamp,...}); skip it.
    if (i === 0 && line.startsWith('{')) continue
    if (!line.startsWith('[')) continue
    let ev
    try {
      ev = JSON.parse(line)
    } catch {
      continue
    }
    if (Array.isArray(ev) && ev.length >= 3 && ev[1] === 'o') chunks.push(ev[2])
  }
  return chunks.join('')
}

/**
 * Full pipeline: cast text → normalized, behavioral transcript string.
 * Deterministic and idempotent: scrubEphemerals(transcript) === transcript.
 */
export function castToTranscript(castText) {
  let text = castOutput(castText)
  text = text.replace(ANSI, '') // strip colors / cursor control
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n') // normalize line endings
  text = scrubEphemerals(text)
  // Tidy: trim trailing whitespace per line, collapse 3+ blank lines, trim ends.
  text = text
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '\n')
  return text
}
