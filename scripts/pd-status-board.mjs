#!/usr/bin/env node
/**
 * pd-status-board — the pinned GitHub issue "Port Daddy: status" as a distress
 * channel (ADR "The Distress Register", Area A3 rung 15, Phase 2).
 *
 *   node scripts/pd-status-board.mjs init                       # find-or-create + pin (idempotent)
 *   node scripts/pd-status-board.mjs post SECURITE HALT reason=spend-runaway -- see incident doc
 *   node scripts/pd-status-board.mjs post MAYDAY SPLIT-BRAIN pids=812,9944 port=9886
 *   node scripts/pd-status-board.mjs post TAKING-FLOOR target=daemon:prod   # control lines take no class
 *   node scripts/pd-status-board.mjs read [--json]              # current state per target
 *   node scripts/pd-status-board.mjs floor daemon:prod          # take the floor, or exit 2 + print holder
 *   node scripts/pd-status-board.mjs floor daemon:prod --release
 *   node scripts/pd-status-board.mjs observe --http 200 --body-file health.json   # CI observer
 *   node scripts/pd-status-board.mjs observe --relay-url https://relay.portdaddy.dev/health
 *
 * Every command takes --dry-run (no mutation of any kind — no comment, no issue,
 * no label, no pin, no local file), --repo owner/name, --as kind:id.
 *
 * WHY this exists: during the 2026-09-05 halt the only way to say "stop" or
 * "I am fixing X" was Port Daddy itself — the thing being stopped. This board is
 * the AWS-status-page-on-Twitter move: readable and writable with plain `gh`,
 * independent of the relay, the daemon, `pd`, the merge queue and CI. Nothing
 * here imports from lib/ — a module that touches the daemon would make the
 * fallback depend on the thing it is a fallback for.
 *
 * The wire format is the registry's, one line, append-only:
 *
 *   <iso8601-utc> <kind>:<id> <CLASS> <CODE> [k=v ...] [-- free text]
 *
 * Control codes (TAKING-FLOOR, STANDING-DOWN, SEEN, COMPLIED) carry no class
 * word, exactly as the ADR's examples show. Lines live in issue comments inside
 * a ```text fence so GitHub never re-renders `<kind>` as HTML. Append order in
 * the issue is the tie-breaker for the floor — the same rule the distress file
 * uses at A0.
 *
 * Decisions are pure functions (exported, tested by
 * scripts/pd-status-board.test.mjs which the observer workflow runs BEFORE it
 * trusts a single mutation); all I/O goes through the `gh` CLI so the script
 * behaves identically in Actions and on a laptop.
 */
import { execFileSync } from 'node:child_process';
import { createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir, hostname, userInfo } from 'node:os';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ISSUE_TITLE = 'Port Daddy: status';
export const LABEL = 'distress-register';
export const LABEL_COLOR = 'B60205';
export const OBSERVER_IDENTITY = 'ci:distress-observer';
export const RELAY_TARGET = 'relay:prod';
/** The relay's own health route (apps/relay/src/index.ts → handleHealth). */
export const DEFAULT_RELAY_HEALTH_URL = 'https://relay.portdaddy.dev/health';

/** Distress classes. `control` is written explicitly, like every other class (shared interface contract; phases 0 and 3 do the same). */
export const CLASSES = ['MAYDAY', 'PAN PAN', 'SECURITE', 'ROUTINE', 'control'];

/**
 * The registry — code → class. Extend ONLY through the ADR's table; a code that
 * is not here cannot be formatted (fail closed), though it can still be parsed
 * (`registered: false`) so a newer ADR revision never blinds an older reader.
 */
export const CODES = Object.freeze({
  HALT: 'SECURITE',
  'ALL-CLEAR': 'SECURITE',
  DRILL: 'SECURITE',
  'SPLIT-BRAIN': 'MAYDAY',
  'SPEND-RUNAWAY': 'MAYDAY',
  CORRUPT: 'MAYDAY',
  'CANNOT-STOP': 'MAYDAY',
  UNREACHABLE: 'PAN PAN',
  'HALF-ALIVE': 'PAN PAN',
  UNVERIFIED: 'PAN PAN',
  'TAKING-FLOOR': 'control',
  'STANDING-DOWN': 'control',
  SEEN: 'control',
  COMPLIED: 'control',
  LISTENING: 'ROUTINE',
});

const CONTROL_CODES = new Set(Object.keys(CODES).filter((c) => CODES[c] === 'control'));
const STATUS_CLASSES = new Set(['MAYDAY', 'PAN PAN', 'ROUTINE']);
const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const TOKEN_RE = /^[A-Z][A-Z-]*$/;
const KEY_RE = /^[A-Za-z0-9_.-]+$/;

// ── Wire format ───────────────────────────────────────────────────────────────

/** Seconds-precision UTC timestamp, the ADR's example form. */
/** JSON.parse that answers null instead of throwing: relay and gh output is untrusted input. */
export function safeJson(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  try { return JSON.parse(text); } catch { return null; }
}

export function isoNow(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Format one registry line. Throws on anything the registry does not allow:
 * unknown code, class/code mismatch, whitespace inside an identity/key/value,
 * a newline anywhere (the format is one physical line, no exceptions).
 *
 * @param {{ts?: string, kind: string, id: string, cls?: string, code: string,
 *          fields?: Record<string, string|number>, text?: string}} rec
 * @returns {string}
 */
export function formatLine(rec) {
  const ts = rec.ts ?? isoNow();
  if (!TS_RE.test(ts)) throw new Error(`bad timestamp: ${ts}`);
  if (!rec.kind || /\s|:/.test(rec.kind)) throw new Error(`bad kind: ${JSON.stringify(rec.kind)}`);
  if (!rec.id || /\s/.test(rec.id)) throw new Error(`bad id: ${JSON.stringify(rec.id)}`);
  const code = rec.code;
  const registered = CODES[code];
  if (!registered) throw new Error(`unregistered code: ${code} (extend the ADR registry, never ad hoc)`);
  const cls = rec.cls ?? registered;
  if (cls !== registered) throw new Error(`code ${code} belongs to class ${registered}, not ${cls}`);
  // One spelling on the wire: the class is always present, `control` included,
  // so grep-level readers of the A0 file never meet two forms of one record.
  const parts = [ts, `${rec.kind}:${rec.id}`, cls, code];
  for (const [k, v] of Object.entries(rec.fields ?? {})) {
    const val = String(v);
    if (!KEY_RE.test(k)) throw new Error(`bad field key: ${k}`);
    if (val === '' || /\s/.test(val)) throw new Error(`bad field value for ${k}: ${JSON.stringify(val)}`);
    parts.push(`${k}=${val}`);
  }
  if (rec.text != null && rec.text !== '') {
    if (/[\r\n]/.test(rec.text)) throw new Error('free text must be a single line');
    parts.push('--', rec.text.trim());
  }
  return parts.join(' ');
}

/**
 * Parse one registry line. Returns null for anything that is not a registry
 * line (prose, blank, fence markers) so callers can feed whole comment bodies.
 * Unknown codes parse with `registered: false`; a known code under the wrong
 * class parses with `registered: false` too — the reader stays lenient, the
 * writer stays strict.
 *
 * @param {string} raw
 * @returns {null | {ts: string, kind: string, id: string, entity: string,
 *   cls: string, code: string, fields: Record<string,string>, text: string,
 *   registered: boolean, raw: string}}
 */
export function parseLine(raw) {
  if (typeof raw !== 'string') return null;
  const line = raw.replace(/^>\s?/, '').trim();
  const m = /^(\S+)\s+(\S+)\s+(.*)$/.exec(line);
  if (!m || !TS_RE.test(m[1])) return null;
  const [, ts, ident, rest] = m;
  const colon = ident.indexOf(':');
  if (colon <= 0 || colon === ident.length - 1) return null;
  const kind = ident.slice(0, colon);
  const id = ident.slice(colon + 1);

  let tokens = rest.split(/\s+/).filter(Boolean);
  let cls;
  if (tokens[0] === 'PAN' && tokens[1] === 'PAN') {
    cls = 'PAN PAN';
    tokens = tokens.slice(2);
  } else if (tokens[0] === 'MAYDAY' || tokens[0] === 'SECURITE' || tokens[0] === 'ROUTINE' || tokens[0] === 'control') {
    cls = tokens[0];
    tokens = tokens.slice(1);
  } else if (CONTROL_CODES.has(tokens[0])) {
    cls = 'control';
  } else {
    return null;
  }
  const code = tokens.shift();
  if (!code || !TOKEN_RE.test(code)) return null;

  const fields = {};
  let text = '';
  while (tokens.length) {
    const t = tokens.shift();
    if (t === '--') {
      text = tokens.join(' ');
      break;
    }
    const eq = t.indexOf('=');
    if (eq <= 0 || !KEY_RE.test(t.slice(0, eq))) return null;
    fields[t.slice(0, eq)] = t.slice(eq + 1);
  }
  const registered = CODES[code] === cls;
  return { ts, kind, id, entity: `${kind}:${id}`, cls, code, fields, text, registered, raw: line };
}

/** Every registry line found in a blob of Markdown (issue body or comment). */
export function extractLines(text) {
  if (!text) return [];
  return text.split(/\r?\n/).map(parseLine).filter(Boolean);
}

// ── Board state ───────────────────────────────────────────────────────────────

/**
 * Fold an ordered list of parsed lines into "what is true right now".
 *
 * - halt: the latest SECURITE HALT / DRILL / ALL-CLEAR decides. ALL-CLEAR counts
 *   ONLY from `operator:*` (ADR §4: operator-only; signature verification is
 *   Phase 4 — until then the kind check is the whole gate, and an ALL-CLEAR from
 *   any other kind is recorded as a violation and ignored).
 * - entities: each entity's latest MAYDAY / PAN PAN / ROUTINE line is its state.
 *   A MAYDAY is live until that same entity posts a non-MAYDAY status line.
 * - floors: per target, live TAKING-FLOOR claims not yet released by the same
 *   entity's STANDING-DOWN. First live claimant holds; later ones are contenders.
 *
 * @param {ReturnType<typeof parseLine>[]} lines in append order
 */
/** The exact bytes phase 4 signs: `ALL-CLEAR|<halt-ts>|<ts>` (lib/distress-allclear.ts allClearMessage). */
export function allClearMessage(haltTs, ts) {
  return Buffer.from(`ALL-CLEAR|${haltTs}|${ts}`, 'utf8');
}

/**
 * Verify one parsed ALL-CLEAR record against the operator keys this reader
 * trusts. Mirrors phase 4's verifyAllClear() with node:crypto only, so the
 * board stays free of lib/ imports. Returns null when the lift is genuine,
 * otherwise the reason it is not.
 */
export function rejectAllClear(rec, trustedKeys, expectedHaltTs) {
  if (rec.kind !== 'operator') return 'ALL-CLEAR from a non-operator is ignored (ADR-0132 §4)';
  const ref = rec.fields.ref;
  if (!ref || !TS_RE.test(ref)) return 'ALL-CLEAR without a ref to the halt it lifts is ignored (ADR-0132 §4)';
  if (expectedHaltTs && ref !== expectedHaltTs) return `ALL-CLEAR names halt ${ref}, not the active halt ${expectedHaltTs} (ADR-0132 §4)`;
  const sigB64 = rec.fields.sig;
  if (!sigB64) return 'unsigned ALL-CLEAR is ignored: only a signed operator lift ends a halt (ADR-0132 §4)';
  let sig;
  try { sig = Buffer.from(sigB64, 'base64'); } catch { return 'ALL-CLEAR carries a malformed sig (ADR-0132 §4)'; }
  if (sig.length !== 64 || sig.toString('base64') !== sigB64) return 'ALL-CLEAR carries a malformed sig (ADR-0132 §4)';
  if (!trustedKeys.length) return 'ALL-CLEAR cannot be verified: no operator key is pinned for this reader (ADR-0132 §4)';
  const msg = allClearMessage(ref, rec.ts);
  for (const key of trustedKeys) {
    try {
      if (cryptoVerify(null, msg, key, sig)) return null;
    } catch {
      // A key that cannot verify is just a key that did not verify.
    }
  }
  return 'ALL-CLEAR signature does not verify against any pinned operator key: forged or mis-signed (ADR-0132 §4)';
}

/** Accept SPKI PEM strings or KeyObjects; drop anything that is not an Ed25519 public key. */
export function normalizeTrustedKeys(keys = []) {
  const out = [];
  for (const k of keys) {
    try {
      const key = typeof k === 'string' ? createPublicKey(k.replace(/\\n/g, '\n')) : k;
      if (key && key.asymmetricKeyType === 'ed25519') out.push(key);
    } catch {
      // Not a usable public key; never trust by accident.
    }
  }
  return out;
}

/**
 * The trust root is the committed pin list (lib/distress-allclear-pins.ts,
 * #10066), not a same-user-writable file under ~/.port-daddy. The board reads
 * that TypeScript file as text and lifts out every SPKI PEM block, which keeps
 * this script free of lib/ imports. A pin without an embedded PEM cannot be
 * verified here and is treated as absent (correct failure direction: the
 * halt stands). No repo, no file, or no PEM ⇒ zero trusted keys.
 */
export function loadPinnedKeys({ repoRoot = null, pinsFile = null } = {}) {
  const file = pinsFile ?? (repoRoot ? join(repoRoot, 'lib', 'distress-allclear-pins.ts') : null);
  if (!file || !existsSync(file)) return [];
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { return []; }
  const pems = text.match(/-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----/g) ?? [];
  return normalizeTrustedKeys(pems);
}

export function computeState(lines, { trustedKeys = [] } = {}) {
  const keys = normalizeTrustedKeys(trustedKeys);
  const state = {
    halt: { status: 'none', line: null },
    entities: new Map(),
    floors: new Map(),
    violations: [],
    lastObserver: null,
    count: lines.length,
  };
  for (const l of lines) {
    if (!l) continue;
    if (l.cls === 'SECURITE') {
      if (l.code === 'HALT') state.halt = { status: 'active', line: l };
      else if (l.code === 'DRILL') state.halt = { status: 'drill', line: l };
      else if (l.code === 'ALL-CLEAR') {
        const active = state.halt.status === 'active' ? state.halt.line?.ts : undefined;
        const reason = rejectAllClear(l, keys, active);
        if (reason) state.violations.push({ line: l, reason });
        else state.halt = { status: 'none', line: l };
      }
    } else if (STATUS_CLASSES.has(l.cls)) {
      state.entities.set(l.entity, l);
    } else if (l.cls === 'control') {
      const target = l.fields.target;
      if (l.code === 'TAKING-FLOOR' && target) {
        const claims = state.floors.get(target) ?? [];
        if (!claims.some((c) => c.entity === l.entity)) claims.push(l);
        state.floors.set(target, claims);
      } else if (l.code === 'STANDING-DOWN' && target) {
        const claims = (state.floors.get(target) ?? []).filter((c) => c.entity !== l.entity);
        if (claims.length) state.floors.set(target, claims);
        else state.floors.delete(target);
      }
    }
    if (l.entity === OBSERVER_IDENTITY) state.lastObserver = l;
  }
  return state;
}

/** Entities whose current state is MAYDAY, sorted for stable keys. */
export function liveMaydays(state) {
  return [...state.entities.values()].filter((l) => l.cls === 'MAYDAY').map((l) => l.entity).sort();
}

/** `{holder, contenders}` for a target, or null when the floor is free. */
export function floorHolder(state, target) {
  const claims = state.floors.get(target);
  if (!claims || !claims.length) return null;
  return { holder: claims[0], contenders: claims.slice(1) };
}

/**
 * Decide `floor <target>` for `me`. Pure; the CLI executes `post`.
 * @returns {{action: 'take'|'held'|'already', holder?: object, line?: object}}
 */
export function decideFloor(state, target, me) {
  const f = floorHolder(state, target);
  if (!f) return { action: 'take' };
  if (f.holder.entity === me) return { action: 'already', holder: f.holder };
  return { action: 'held', holder: f.holder };
}

/** Plain JSON view of a state (Maps are not JSON). */
export function stateToJson(state) {
  return {
    halt: { status: state.halt.status, line: state.halt.line?.raw ?? null },
    maydays: liveMaydays(state),
    entities: Object.fromEntries([...state.entities].map(([k, v]) => [k, v.raw])),
    floors: Object.fromEntries(
      [...state.floors].map(([t, claims]) => [t, { holder: claims[0].raw, contenders: claims.slice(1).map((c) => c.raw) }]),
    ),
    violations: state.violations.map((v) => ({ line: v.line.raw, reason: v.reason })),
    lastObserver: state.lastObserver?.raw ?? null,
    count: state.count,
  };
}

/** Human rendering of a state for `read`. */
export function renderState(state, { header = '', localHalt = null } = {}) {
  const out = [];
  if (header) out.push(header);
  if (localHalt != null) {
    out.push(`A0 sentinel (~/.port-daddy/HALT): ${localHalt ? 'HOISTED — halt in effect on this machine' : 'absent — no halt hoisted here (absence is not all-clear)'}`);
  }
  const h = state.halt;
  out.push(
    h.status === 'active' ? `Halt: ACTIVE — ${h.line.raw}`
      : h.status === 'drill' ? `Halt: DRILL — ${h.line.raw}`
        : h.line ? `Halt: none (lifted) — ${h.line.raw}` : 'Halt: none',
  );
  const maydays = [...state.entities.values()].filter((l) => l.cls === 'MAYDAY');
  const panpans = [...state.entities.values()].filter((l) => l.cls === 'PAN PAN');
  out.push(maydays.length ? `MAYDAY (${maydays.length}):` : 'MAYDAY: none');
  for (const l of maydays) out.push(`  ${l.raw}`);
  if (panpans.length) {
    out.push(`PAN PAN (${panpans.length}):`);
    for (const l of panpans) out.push(`  ${l.raw}`);
  }
  if (state.floors.size) {
    out.push('Floor:');
    for (const [t, claims] of state.floors) {
      out.push(`  ${t} ← ${claims[0].entity} since ${claims[0].ts}`);
      for (const c of claims.slice(1)) out.push(`    contender (must stand down): ${c.entity} at ${c.ts}`);
    }
  } else out.push('Floor: free');
  out.push(state.lastObserver ? `Observer: ${state.lastObserver.raw}` : 'Observer: no line yet');
  for (const v of state.violations) out.push(`VIOLATION: ${v.reason} — ${v.line.raw}`);
  out.push(`Lines: ${state.count}`);
  return out.join('\n');
}

// ── Observer ──────────────────────────────────────────────────────────────────

/**
 * Turn a health probe into one of three relay states.
 *   ok          200 + JSON {status:"ok"}       → ROUTINE LISTENING
 *   degraded    answered, but not that         → PAN PAN HALF-ALIVE
 *   unreachable no HTTP answer (curl 000 / 0)  → PAN PAN UNREACHABLE
 *
 * @param {{http: number|string|null, body?: string|null}} probe
 */
export function classifyProbe(probe) {
  const http = Number(probe?.http ?? 0) || 0;
  if (http === 0) return { state: 'unreachable', http: 0, version: null };
  let version = null;
  let status = null;
  try {
    const j = safeJson(probe.body);
    if (j === null) throw new Error('relay body is not JSON');
    status = j?.status ?? null;
    version = typeof j?.version === 'string' && /^[\w.+-]+$/.test(j.version) ? j.version : null;
  } catch { /* not JSON: degraded */ }
  if (http === 200 && status === 'ok') return { state: 'ok', http, version };
  return { state: 'degraded', http, version };
}

/**
 * The observer's line for a probe + board state. `version` is carried as
 * evidence but is NOT part of the change key (a relay deploy is not distress).
 */
export function observerRecord(relay, state, ts) {
  const maydays = liveMaydays(state);
  const fields = {
    target: RELAY_TARGET,
    relay: relay.state,
    http: relay.http,
    halt: state.halt.status,
    mayday: maydays.length ? maydays.join(',') : 'none',
  };
  if (relay.version) fields.version = relay.version;
  const code = relay.state === 'ok' ? 'LISTENING' : relay.state === 'degraded' ? 'HALF-ALIVE' : 'UNREACHABLE';
  const text = relay.state === 'ok'
    ? 'relay answered /health; daemon is not probed from CI by design'
    : relay.state === 'degraded'
      ? `relay answered /health with ${relay.http} but not {status:"ok"}`
      : 'relay did not answer /health within the timeout';
  return { ts, kind: 'ci', id: 'distress-observer', code, fields, text };
}

/** The part of an observer line that constitutes "state" for delta purposes. */
export function observerKey(fields) {
  return `relay=${fields.relay ?? '?'} halt=${fields.halt ?? '?'} mayday=${fields.mayday ?? '?'}`;
}

/**
 * Post only on delta. No previous observer line → post (first sighting).
 * @returns {{post: boolean, reason: string, record: object, line: string}}
 */
export function decideObserverPost(state, relay, ts = isoNow()) {
  const record = observerRecord(relay, state, ts);
  const line = formatLine(record);
  const prev = state.lastObserver;
  if (!prev) return { post: true, reason: 'no observer line on the board yet', record, line };
  const before = observerKey(prev.fields);
  const after = observerKey(record.fields);
  if (before === after) return { post: false, reason: `unchanged (${after})`, record, line };
  return { post: true, reason: `changed: ${before} → ${after}`, record, line };
}

// ── gh plumbing ───────────────────────────────────────────────────────────────

/** The real `gh` runner: `gh(args, {input})` → stdout. Tests inject their own. */
export function makeGh() {
  return function gh(args, { input } = {}) {
    return execFileSync('gh', args, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'] });
  };
}

/**
 * The one seam where --dry-run is enforced: every call flagged `mutation: true`
 * is echoed and skipped, whatever runner sits underneath (real or fake), so a
 * dry run can never mutate through a code path that forgot to check the flag.
 */
export function withDryRun(gh, dryRun, log = console.error) {
  if (!dryRun) return gh;
  return function guarded(args, opts = {}) {
    if (opts.mutation) {
      const input = opts.input ? opts.input.trimEnd() : '';
      const shown = input.length > 240 ? ` (stdin: ${input.length} chars)` : input ? `\n${input}` : '';
      log(`[dry-run] gh ${args.join(' ')}${shown}`);
      return '';
    }
    return gh(args, opts);
  };
}

export function issueBody() {
  return [
    '# Port Daddy: status',
    '',
    'The **Distress Register status board** (ADR "The Distress Register", Area A3). Readable and writable with plain `gh`,',
    'independent of the relay, the daemon, `pd`, the merge queue and CI. If Port Daddy is broken, this is where you say so',
    'and where you say **who is fixing it**.',
    '',
    '- Post: `node scripts/pd-status-board.mjs post <CLASS> <CODE> [k=v ...] [-- text]`',
    '- Take the floor: `node scripts/pd-status-board.mjs floor <target>` (exit 2 = someone already holds it: stand down)',
    '- Read: `node scripts/pd-status-board.mjs read`',
    '- No Node handy? Comment a line by hand in the exact format below — the parser reads any comment.',
    '',
    'Wire format, one line per record, append-only:',
    '',
    '```text',
    '<iso8601-utc> <kind>:<id> <CLASS> <CODE> [k=v ...] [-- free text]',
    '```',
    '',
    'Classes: `MAYDAY` (grave, needs another actor now) · `PAN PAN` (degraded) · `SECURITE` (safety notice: `HALT`, `DRILL`, `ALL-CLEAR`) · `ROUTINE`.',
    'Control codes carry no class word: `TAKING-FLOOR target=<x>` · `STANDING-DOWN target=<x>` · `SEEN ref=<ts>` · `COMPLIED ref=<ts>`.',
    'Codes are a closed registry — extend them through the ADR, never ad hoc. `ALL-CLEAR` counts only from `operator:*`.',
    '',
    'The scheduled `distress-observer` workflow probes the relay every 15 minutes and comments **only when state changes**.',
    'The daemon is never probed from CI: unreachable-from-the-cloud is expected, not distress.',
    '',
    '_This issue is machine-managed by `scripts/pd-status-board.mjs`. Keep it open; keep it pinned._',
  ].join('\n');
}

function ghJson(gh, args, opts) {
  const out = gh(args, opts);
  return safeJson(out);
}

/** Locate the status issue: open first, else newest closed (to be reopened). */
export function findIssue(gh, repo) {
  const rows = ghJson(gh, [
    'issue', 'list', '-R', repo, '--state', 'all', '--limit', '50',
    '--search', `"${ISSUE_TITLE}" in:title`, '--json', 'number,title,state,url,labels,isPinned',
  ]) ?? [];
  const exact = rows.filter((r) => r.title === ISSUE_TITLE);
  const open = exact.find((r) => r.state === 'OPEN');
  if (open) return open;
  return exact.sort((a, b) => b.number - a.number)[0] ?? null;
}

export function ensureLabel(gh, repo) {
  const rows = ghJson(gh, ['label', 'list', '-R', repo, '--search', LABEL, '--json', 'name']) ?? [];
  if (rows.some((r) => r.name === LABEL)) return false;
  gh(['label', 'create', LABEL, '-R', repo, '--color', LABEL_COLOR,
    '--description', 'Distress Register (ADR-0132): status board + observer lines'], { mutation: true });
  return true;
}

/**
 * Find-or-create the pinned status issue. Idempotent: a second run finds the
 * first run's issue, re-labels/re-pins only if needed, and creates nothing —
 * on an already labelled + pinned board it performs no write at all.
 * @returns {{number: number|null, url: string|null, created: boolean, reopened: boolean}}
 */
export function initBoard(gh, repo, { log = console.error } = {}) {
  ensureLabel(gh, repo);
  let issue = findIssue(gh, repo);
  let created = false;
  let reopened = false;
  if (issue && issue.state !== 'OPEN') {
    gh(['issue', 'reopen', String(issue.number), '-R', repo], { mutation: true });
    reopened = true;
  }
  if (!issue) {
    const out = gh(['issue', 'create', '-R', repo, '--title', ISSUE_TITLE, '--label', LABEL, '--body-file', '-'],
      { input: issueBody(), mutation: true });
    const m = /\/issues\/(\d+)/.exec(out ?? '');
    issue = m ? { number: Number(m[1]), url: out.trim(), state: 'OPEN' } : { number: null, url: null, state: 'OPEN' };
    created = true;
  } else if (!(issue.labels ?? []).some((l) => l.name === LABEL)) {
    // A human may have created the issue by hand; label it so it is findable.
    gh(['issue', 'edit', String(issue.number), '-R', repo, '--add-label', LABEL], { mutation: true });
  }
  // Steady state (labelled + pinned) must cost zero writes: `read` calls this.
  if (issue.number != null && !issue.isPinned) {
    try {
      gh(['issue', 'pin', String(issue.number), '-R', repo], { mutation: true });
    } catch (e) {
      // Three pins max per repo, or already pinned — neither is fatal for a status board.
      log(`pd-status-board: could not pin #${issue.number}: ${String(e.stderr ?? e.message).trim()}`);
    }
  }
  return { number: issue.number, url: issue.url ?? null, created, reopened };
}

/** All registry lines on the board, body first then comments in append order. */
export function readBoard(gh, repo, number) {
  const view = ghJson(gh, ['issue', 'view', String(number), '-R', repo, '--json', 'body']) ?? {};
  const raw = gh(['api', `repos/${repo}/issues/${number}/comments`, '--paginate', '--jq', '.[]']) ?? '';
  const comments = raw.split(/\r?\n/).filter((s) => s.trim()).map(safeJson).filter((c) => c && typeof c === 'object');
  comments.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
  const lines = [...extractLines(view.body)];
  for (const c of comments) lines.push(...extractLines(c.body));
  return lines;
}

export function postLine(gh, repo, number, line) {
  gh(['issue', 'comment', String(number), '-R', repo, '--body-file', '-'],
    { input: `\`\`\`text\n${line}\n\`\`\`\n`, mutation: true });
}

// ── A0 mirror (inline on purpose) ─────────────────────────────────────────────
// TODO(adr-0132 phase 0): switch to lib/distress.ts appendDistress()/haltActive()
// once it merges. Until then the board keeps its own three-line copy so this
// script stays free of lib/ imports (the fallback must not depend on the thing
// it is a fallback for).

/** The Port Daddy home: `PD_HOME` when set (as lib/distress.ts, bin/pd-distress and the hook tentacles honour it), else `<home>/.port-daddy`. */
export function pdHomeDir({ home = homedir(), env = process.env } = {}) {
  const override = env && typeof env.PD_HOME === 'string' ? env.PD_HOME.trim() : '';
  return override || join(home, '.port-daddy');
}

export function haltActiveLocal(home = homedir(), env = process.env) {
  return existsSync(join(pdHomeDir({ home, env }), 'HALT'));
}

export function appendLocalDistress(line, { home = homedir(), repoRoot = null, env = process.env } = {}) {
  const targets = [join(pdHomeDir({ home, env }), 'DISTRESS')];
  if (repoRoot) targets.push(join(repoRoot, '.portdaddy', 'DISTRESS'));
  for (const p of targets) {
    mkdirSync(dirname(p), { recursive: true });
    appendFileSync(p, `${line}\n`, { flag: 'a' });
  }
  return targets;
}

/**
 * Repo root by walking up for `.git` (a directory, or the file a worktree
 * carries), exactly as bin/pd-distress does. The floor must not depend on a
 * git binary being on PATH, and must not spawn anything to find itself.
 */
export function findRepoRoot(start = process.cwd()) {
  let dir = resolvePath(start);
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const USAGE = `usage: pd-status-board <command> [flags]

  init                                  find-or-create the pinned "${ISSUE_TITLE}" issue (idempotent)
  post <CLASS> <CODE> [k=v ...] [-- text]
                                        append one registry line (control codes need no CLASS)
  read [--json]                         print current state (halt, MAYDAYs, floor, last observer line)
  floor <target> [--release]            take the floor for <target>; exit 2 if another entity holds it
  observe (--http N [--body-file F] | --relay-url URL) [--timeout-ms N]
                                        CI observer: post ONE line only when relay/halt/MAYDAY state changed

flags: --dry-run  --repo owner/name  --as kind:id  --no-local  --json`;

/** Split argv into {flags, positional}; flags may appear anywhere. */
export function parseArgs(argv) {
  const flags = {};
  const positional = [];
  const valued = new Set(['--repo', '--as', '--relay-url', '--http', '--body-file', '--timeout-ms']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { positional.push(...argv.slice(i)); break; }
    if (valued.has(a)) { flags[a.slice(2)] = argv[++i]; continue; }
    if (a.startsWith('--')) { flags[a.slice(2)] = true; continue; }
    positional.push(a);
  }
  return { flags, positional };
}

/** `post` argv → record fields (class inference for control codes, PAN PAN join). */
export function parsePostArgs(args) {
  const a = [...args];
  let cls;
  let code;
  if (a[0] === 'PAN' && a[1] === 'PAN') { cls = 'PAN PAN'; a.splice(0, 2); }
  else if (['MAYDAY', 'SECURITE', 'ROUTINE', 'control'].includes(a[0])) { cls = a.shift(); }
  code = a.shift();
  if (!code) throw new Error('post: missing CODE');
  if (!CODES[code]) throw new Error(`post: unregistered code ${code}`);
  if (cls === 'control') cls = undefined;
  const fields = {};
  let text;
  while (a.length) {
    const t = a.shift();
    if (t === '--') { text = a.join(' '); break; }
    const eq = t.indexOf('=');
    if (eq <= 0) throw new Error(`post: expected k=v, got ${JSON.stringify(t)}`);
    fields[t.slice(0, eq)] = t.slice(eq + 1);
  }
  return { cls, code, fields, text };
}

function splitIdentity(ident) {
  const colon = ident.indexOf(':');
  if (colon <= 0 || colon === ident.length - 1) throw new Error(`identity must be kind:id, got ${JSON.stringify(ident)}`);
  return { kind: ident.slice(0, colon), id: ident.slice(colon + 1) };
}

function defaultIdentity(env) {
  if (env.PD_DISTRESS_IDENTITY) return env.PD_DISTRESS_IDENTITY;
  let user = 'unknown';
  try { user = userInfo().username; } catch { /* keep */ }
  return `agent:${user}@${hostname()}`;
}

function resolveRepo(flags, env, gh) {
  if (flags.repo) return flags.repo;
  if (env.GITHUB_REPOSITORY) return env.GITHUB_REPOSITORY;
  const j = ghJson(gh, ['repo', 'view', '--json', 'nameWithOwner']);
  if (!j?.nameWithOwner) throw new Error('cannot determine repo: pass --repo owner/name');
  return j.nameWithOwner;
}

async function probeRelay(url, timeoutMs, fetchImpl) {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' });
    return { http: res.status, body: await res.text() };
  } catch {
    return { http: 0, body: null };
  }
}

/**
 * Run the CLI. Returns the process exit code; never calls process.exit itself
 * so tests can drive it with a fake `gh`, a fake clock and a scratch home.
 */
export async function main(argv, deps = {}) {
  const { flags, positional } = parseArgs(argv);
  const stdout = deps.stdout ?? ((s) => process.stdout.write(`${s}\n`));
  const stderr = deps.stderr ?? ((s) => process.stderr.write(`${s}\n`));
  const env = deps.env ?? process.env;
  const dryRun = Boolean(flags['dry-run']);
  const gh = withDryRun(deps.gh ?? makeGh(), dryRun, stderr);
  const now = deps.now ?? (() => isoNow());
  const home = deps.home ?? homedir();
  const repoRoot = deps.repoRoot === undefined ? findRepoRoot() : deps.repoRoot;
  const trustedKeys = deps.trustedKeys ?? [
    ...loadPinnedKeys({ repoRoot }),
    ...(flags['trusted-key'] && existsSync(flags['trusted-key']) ? [readFileSync(flags['trusted-key'], 'utf8')] : []),
  ];
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const [cmd, ...rest] = positional;

  if (!cmd || flags.help || cmd === 'help') { stdout(USAGE); return flags.help || cmd === 'help' ? 0 : 1; }
  const repo = resolveRepo(flags, env, gh);
  const me = flags.as ?? defaultIdentity(env);

  const mirror = (line) => {
    if (dryRun || flags['no-local']) return;
    for (const p of appendLocalDistress(line, { home, repoRoot, env })) stderr(`mirrored to ${p}`);
  };
  const boardOrDie = () => {
    const board = initBoard(gh, repo, { log: stderr });
    if (board.number == null) {
      stderr(`[dry-run] no status issue exists yet in ${repo}; would create it and post to it`);
    }
    return board;
  };

  switch (cmd) {
    case 'init': {
      const board = boardOrDie();
      stdout(board.number == null
        ? `[dry-run] would create "${ISSUE_TITLE}" in ${repo}`
        : `${board.created ? 'created' : board.reopened ? 'reopened' : 'found'} ${ISSUE_TITLE} → ${repo}#${board.number}${board.url ? ` ${board.url}` : ''}`);
      return 0;
    }
    case 'post': {
      const rec = parsePostArgs(rest);
      const { kind, id } = splitIdentity(me);
      const line = formatLine({ ts: now(), kind, id, ...rec });
      const board = boardOrDie();
      if (board.number != null) postLine(gh, repo, board.number, line);
      else stderr(`[dry-run] would post: ${line}`);
      mirror(line);
      stdout(line);
      return 0;
    }
    case 'read': {
      const board = boardOrDie();
      const lines = board.number == null ? [] : readBoard(gh, repo, board.number);
      const state = computeState(lines, { trustedKeys });
      if (flags.json) stdout(JSON.stringify({ repo, issue: board.number, localHalt: haltActiveLocal(home, env), trustedKeys: normalizeTrustedKeys(trustedKeys).length, ...stateToJson(state) }, null, 2));
      else stdout(renderState(state, { header: `${ISSUE_TITLE} — ${repo}#${board.number ?? '(none yet)'}`, localHalt: haltActiveLocal(home, env) }));
      return 0;
    }
    case 'floor': {
      const target = rest[0];
      if (!target) { stderr('floor: missing <target>'); return 1; }
      const { kind, id } = splitIdentity(me);
      const board = boardOrDie();
      const lines = board.number == null ? [] : readBoard(gh, repo, board.number);
      const state = computeState(lines, { trustedKeys });
      if (flags.release) {
        const line = formatLine({ ts: now(), kind, id, code: 'STANDING-DOWN', fields: { target } });
        if (board.number != null) postLine(gh, repo, board.number, line);
        mirror(line);
        stdout(line);
        return 0;
      }
      const d = decideFloor(state, target, me);
      if (d.action === 'held') {
        stdout(`floor for ${target} is held by ${d.holder.entity} since ${d.holder.ts} — stand down`);
        stdout(`  ${d.holder.raw}`);
        return 2;
      }
      if (d.action === 'already') {
        stdout(`you already hold the floor for ${target} (since ${d.holder.ts})`);
        return 0;
      }
      const line = formatLine({ ts: now(), kind, id, code: 'TAKING-FLOOR', fields: { target } });
      if (board.number != null) postLine(gh, repo, board.number, line);
      else stderr(`[dry-run] would post: ${line}`);
      mirror(line);
      stdout(line);
      return 0;
    }
    case 'observe': {
      let probe;
      if (flags.http != null) {
        probe = { http: flags.http, body: flags['body-file'] && existsSync(flags['body-file']) ? readFileSync(flags['body-file'], 'utf8') : null };
      } else {
        const url = flags['relay-url'] ?? env.RELAY_HEALTH_URL ?? DEFAULT_RELAY_HEALTH_URL;
        probe = await probeRelay(url, Number(flags['timeout-ms'] ?? 8000), fetchImpl);
      }
      const relay = classifyProbe(probe);
      const board = boardOrDie();
      const lines = board.number == null ? [] : readBoard(gh, repo, board.number);
      const state = computeState(lines, { trustedKeys });
      const d = decideObserverPost(state, relay, now());
      if (d.post) {
        if (board.number != null) postLine(gh, repo, board.number, d.line);
        stdout(`${dryRun ? '[dry-run] would post' : 'posted'} (${d.reason}): ${d.line}`);
      } else {
        stdout(`no post (${d.reason})`);
      }
      if (env.GITHUB_STEP_SUMMARY) {
        appendFileSync(env.GITHUB_STEP_SUMMARY, `### Distress observer\n\n- issue: ${repo}#${board.number ?? 'none'}\n- ${d.post ? 'posted' : 'no post'}: ${d.reason}\n\n\`\`\`text\n${d.line}\n\`\`\`\n`);
      }
      return 0;
    }
    default:
      stderr(`unknown command: ${cmd}\n${USAGE}`);
      return 1;
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      process.stderr.write(`pd-status-board: ${e.stderr ? String(e.stderr).trim() : e.message}\n`);
      process.exit(1);
    },
  );
}
