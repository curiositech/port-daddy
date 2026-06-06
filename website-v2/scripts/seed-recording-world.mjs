/**
 * seed-recording-world.mjs — start an ISOLATED Port Daddy daemon and seed it
 * with a FIXED, deterministic demo world so every terminal recording is
 * reproducible run-to-run.
 *
 * WHY: `pd status`/`pd notes`/`pd sessions`/`pd services` print live daemon
 * state. On a busy dev box that state differs from CI. To make recordings
 * reproducible we run them against an isolated daemon seeded with a fixed
 * small world: fixed projects, sessions, notes, claimed ports, DNS records,
 * and channels. Random-per-run ids (session-/agent-/UUID) are fine because
 * cast-transcript.mjs scrubs them. Counts and text must be fixed.
 *
 * Usage (called by record-*.sh before recording):
 *
 *   node scripts/seed-recording-world.mjs start   # start + seed; writes env file
 *   node scripts/seed-recording-world.mjs stop    # graceful shutdown + cleanup
 *   node scripts/seed-recording-world.mjs env     # print export statements (eval)
 *
 * The script writes env vars to .recording-daemon/recording.env so the
 * record scripts can `source` them to route all pd commands to the isolated
 * daemon instead of the operator's real daemon.
 *
 * ISOLATION GUARANTEE: the isolated daemon uses a separate DB, socket, and
 * port. It NEVER touches the operator's real daemon (default port 9876 /
 * default socket). Env vars PORT_DADDY_URL and PORT_DADDY_SOCK are unset
 * before recording.env is sourced to prevent accidental fallthrough to the
 * real daemon.
 */

import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync, existsSync, writeFileSync, readFileSync, rmSync, openSync, closeSync } from 'node:fs'
import Database from 'better-sqlite3'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'

// ─── Paths ────────────────────────────────────────────────────────────────────

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url))
const WEBSITE_DIR = join(SCRIPTS_DIR, '..')
const REPO_ROOT = join(WEBSITE_DIR, '..')

// All runtime files for the recording daemon live in .recording-daemon/ under
// website-v2/. This directory is .gitignored; only the seed script is committed.
const DAEMON_DIR = join(WEBSITE_DIR, '.recording-daemon')
const DB_PATH = join(DAEMON_DIR, 'demo.sqlite')
const SOCK_PATH = join(DAEMON_DIR, 'daemon.sock')
const IPC_PATH = join(DAEMON_DIR, 'daemon.ipc')
const PID_FILE = join(DAEMON_DIR, 'daemon.pid')
const PORT_FILE = join(DAEMON_DIR, 'daemon.port')
const HEARTBEAT_FILE = join(DAEMON_DIR, 'heartbeat')
const LOG_FILE = join(DAEMON_DIR, 'daemon.log')
const ENV_FILE = join(DAEMON_DIR, 'recording.env')

// The COMMITTED fixture DB. Recording runs COPY this (never re-seed live), so the
// daemon state is byte-identical on every machine — no seed-time race can drift a
// transcript (the bug that blocked the gate in CI). Regenerate with
// `seed-recording-world.mjs build-fixture` (a HiTL act: commit + re-record goldens).
const FIXTURE_DIR = join(WEBSITE_DIR, 'recordings-fixtures')
// Committed as a reviewable SQL dump (the pre-commit guard blocks binary .sqlite,
// and a text dump diffs cleanly). `start` restores it into a scratch DB.
const FIXTURE_SQL = join(FIXTURE_DIR, 'demo.sql')

// Fixed TCP port for the recording daemon.  Chosen to be far from the
// canonical 9876 so the two never accidentally talk to each other.
const RECORDING_PORT = 9899

const SERVER_TS = join(REPO_ROOT, 'server.ts')
const TSX_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'tsx')
const CLI_JS = join(REPO_ROOT, 'bin', 'port-daddy-cli.js')

// ─── Recording daemon env ─────────────────────────────────────────────────────

/** Env vars that route all pd CLI / SDK calls to the recording daemon. */
const daemonEnv = {
  PORT_DADDY_DB: DB_PATH,
  PORT_DADDY_SOCK: SOCK_PATH,
  PORT_DADDY_IPC: IPC_PATH,
  PORT_DADDY_PID_FILE: PID_FILE,
  PORT_DADDY_PORT_FILE: PORT_FILE,
  PORT_DADDY_HEARTBEAT_FILE: HEARTBEAT_FILE,
  PORT_DADDY_PORT: String(RECORDING_PORT),
  PORT_DADDY_URL: `http://127.0.0.1:${RECORDING_PORT}`,
  PORT_DADDY_NO_FLEET: '1',
  PORT_DADDY_NO_FLEETBAR: '1',
  PORT_DADDY_SILENT: '1',
  // Fixed TERM so asciinema / CLI tooling never emits "TERM environment variable
  // not set." in CI (where TERM is unset by default). Must match the value used
  // by the asciinema recording invocation so output is consistent dev-vs-CI.
  TERM: 'xterm-256color',
}

// ─── Utilities ────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function readPid() {
  try {
    const n = parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

function isAlive(pid) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** HTTP request to the recording daemon via TCP. */
function daemonRequest(path, opts = {}) {
  const { method = 'GET', body = null } = opts
  const jsonBody = body ? JSON.stringify(body) : null
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: RECORDING_PORT,
        path,
        method,
        headers: {
          ...(jsonBody
            ? {
                'Content-Type': 'application/json',
                'Content-Length': String(Buffer.byteLength(jsonBody)),
              }
            : {}),
        },
        timeout: 10000,
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString()
          let data
          try { data = JSON.parse(text) } catch { data = text }
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data })
        })
      },
    )
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')) })
    if (jsonBody) req.write(jsonBody)
    req.end()
  })
}

/** Wait until the daemon answers /health or timeout. */
async function waitForHealth(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await daemonRequest('/health')
      if (res.ok) return true
    } catch {
      // not ready yet
    }
    await sleep(250)
  }
  return false
}

// ─── pd CLI helper (runs against the recording daemon) ────────────────────────

function pd(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [CLI_JS, ...args], {
      // PD_SHIM_OFF=1 bypasses the homebrew pd shim so we hit the local build.
      env: { ...process.env, ...daemonEnv, PD_SHIM_OFF: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const out = []
    const err = []
    child.stdout.on('data', (c) => out.push(c))
    child.stderr.on('data', (c) => err.push(c))
    child.on('close', (code) => {
      const stdout = Buffer.concat(out).toString()
      const stderr = Buffer.concat(err).toString()
      if (code !== 0) {
        reject(new Error(`pd ${args.join(' ')} exited ${code}\n${stderr}\n${stdout}`))
      } else {
        resolve(stdout.trim())
      }
    })
    child.on('error', reject)
  })
}

/** Same as pd() but never rejects — swallows non-zero exits (for idempotent ops). */
async function pdQ(...args) {
  try { return await pd(args) } catch { return '' }
}

// ─── Seed world ───────────────────────────────────────────────────────────────

/**
 * Plant a deterministic demo world into the fresh daemon.
 *
 * Design rules:
 *   - All TEXT that appears in recordings must be fixed (not random) so two
 *     independent runs produce identical transcripts after normalisation.
 *   - Random ids (session-/agent-/UUID) are fine — the normalizer scrubs them.
 *   - Port numbers are deterministic because PD hashes identity→port; do NOT
 *     seed ad-hoc port numbers, just claim fixed semantic identities.
 *   - Counts must be fixed: exactly N sessions, M services, K notes.
 */
async function seedWorld() {
  console.error('[seed] Seeding demo world...')

  // ── 1. Claim deterministic ports ──────────────────────────────────────────
  // PD hashes identity→port so the same identity always claims the same port.
  // Seeding these identities makes `pd services` output deterministic.
  await pdQ('claim', 'port-daddy:api:main')
  await pdQ('claim', 'port-daddy:website:dev')
  await pdQ('claim', 'port-daddy:worker:main')

  // ── 2. Begin sessions (fixed purpose text = fixed recording content) ───────
  // Session/agent IDs are random but scrubbed by the normalizer.
  await pdQ(
    'begin',
    '--identity', 'port-daddy:api:main',
    '--purpose', 'Implement OAuth token refresh',
    '--allow-main-worktree',
  )
  await pdQ(
    'begin',
    '--identity', 'port-daddy:worker:main',
    '--purpose', 'Backfill search index',
    '--allow-main-worktree',
  )

  // ── 3. Notes (fixed body text) ────────────────────────────────────────────
  // Three notes so `pd notes --limit 5` always shows the same text block.
  await pdQ('note', 'Switched auth library to jose for JWKS support')
  await pdQ('note', 'DB migration 0042 applied — added refresh_tokens table')
  await pdQ('note', 'Search indexer resumed from checkpoint page 412')

  // ── 4. DNS records ────────────────────────────────────────────────────────
  await pdQ('dns', 'register', '--hostname', 'api.demo.local', '--port', '3100', '--service', 'port-daddy:api:main')
  await pdQ('dns', 'register', '--hostname', 'web.demo.local', '--port', '3101', '--service', 'port-daddy:website:dev')

  // ── 5. Channels (for pd channels / pd channels describe recordings) ────────
  await pdQ('channels', 'ensure', 'git:committed', '--scope', 'repo', '--description', 'commit trigger event')
  await pdQ('channels', 'ensure', 'git:pr-opened', '--scope', 'repo', '--description', 'PR opened trigger')

  // ── 6. Inbox — clear then seed one fixed unread message ───────────────────
  // Recordings send+read the inbox; clear ensures no accidental leftover.
  await pdQ('inbox', 'clear', '--agent', 'QA-REVIEWER')

  console.error('[seed] Demo world ready.')
  console.error('[seed]   Services: port-daddy:api:main, port-daddy:website:dev, port-daddy:worker:main')
  console.error('[seed]   Sessions: 2 active (OAuth, Search indexer)')
  console.error('[seed]   Notes: 3')
  console.error('[seed]   DNS: api.demo.local, web.demo.local')
  console.error('[seed]   Channels: git:committed, git:pr-opened')
}

// ─── Start ────────────────────────────────────────────────────────────────────

async function start({ seed = false } = {}) {
  mkdirSync(DAEMON_DIR, { recursive: true, mode: 0o700 })

  // Kill any stale daemon from a previous run.
  const stalePid = readPid()
  if (stalePid && isAlive(stalePid)) {
    console.error(`[seed] Stopping stale recording daemon (PID ${stalePid})...`)
    try { process.kill(stalePid, 'SIGTERM') } catch {}
    for (let i = 0; i < 50 && isAlive(stalePid); i++) await sleep(100)
    if (isAlive(stalePid)) {
      try { process.kill(stalePid, 'SIGKILL') } catch {}
    }
    await sleep(200)
  }

  // Always start from a clean DB so the seed is deterministic regardless of
  // any previous run. Socket/IPC files are also stale after a kill.
  for (const p of [SOCK_PATH, IPC_PATH, DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
    try { rmSync(p, { force: true }) } catch {}
  }

  // Default path: boot from the COMMITTED fixture so the state is byte-identical
  // everywhere (no live seed → no seed-time race). `build-fixture` (seed:true)
  // skips this and seeds live, to regenerate the committed fixture.
  if (!seed) {
    if (!existsSync(FIXTURE_SQL)) {
      console.error(`[seed] Missing fixture ${FIXTURE_SQL}. Build it once: node scripts/seed-recording-world.mjs build-fixture`)
      process.exit(1)
    }
    const fx = new Database(DB_PATH)
    fx.exec(readFileSync(FIXTURE_SQL, 'utf8'))
    fx.close()
  }

  console.error(`[seed] Starting recording daemon (port ${RECORDING_PORT})${seed ? ' [seed mode]' : ' from committed fixture'}...`)

  // Open log file for daemon output.
  const logFd = openSync(LOG_FILE, 'a')
  const child = spawn(TSX_BIN, [SERVER_TS], {
    env: { ...process.env, ...daemonEnv, NODE_ENV: 'development' },
    stdio: ['ignore', logFd, logFd],
    detached: true,
  })
  closeSync(logFd)
  child.unref()

  // Wait for the daemon to become healthy.
  const healthy = await waitForHealth(30000)
  if (!healthy) {
    let log = ''
    try { log = readFileSync(LOG_FILE, 'utf8').slice(-3000) } catch {}
    console.error(`[seed] Recording daemon failed to start within 30s. Log tail:\n${log}`)
    process.exit(1)
  }

  console.error(`[seed] Recording daemon healthy (PID ${child.pid ?? readPid()}, port ${RECORDING_PORT})`)

  // Write env file for record scripts to source.
  const envLines = Object.entries(daemonEnv)
    .map(([k, v]) => `export ${k}=${JSON.stringify(v)}`)
    .join('\n')
  writeFileSync(ENV_FILE, envLines + '\n', { mode: 0o600 })

  // In fixture-build mode, seed the live daemon; otherwise the copied fixture IS
  // the state, so there is nothing to seed (and no race to drift it).
  if (seed) await seedWorld()
}

// ─── Stop ─────────────────────────────────────────────────────────────────────

async function stop() {
  const pid = readPid()
  if (!pid || !isAlive(pid)) {
    console.error('[seed] Recording daemon already stopped.')
    return
  }
  console.error(`[seed] Stopping recording daemon (PID ${pid})...`)
  try { process.kill(pid, 'SIGTERM') } catch {}
  for (let i = 0; i < 50 && isAlive(pid); i++) await sleep(100)
  if (isAlive(pid)) {
    try { process.kill(pid, 'SIGKILL') } catch {}
  }
  console.error('[seed] Recording daemon stopped.')
}

// ─── Env ──────────────────────────────────────────────────────────────────────

function printEnv() {
  for (const [k, v] of Object.entries(daemonEnv)) {
    process.stdout.write(`export ${k}=${JSON.stringify(v)}\n`)
  }
}

// ─── Entrypoint ───────────────────────────────────────────────────────────────

// Regenerate the committed fixture from a fresh live seed (a HiTL act — commit the
// result + re-record goldens). Seeds, then a graceful stop checkpoints the WAL, then
// copies the clean single-file DB into recordings-fixtures/.
async function buildFixture() {
  mkdirSync(FIXTURE_DIR, { recursive: true })
  await start({ seed: true })
  await stop()
  await sleep(300)
  for (const p of [`${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
    try { rmSync(p, { force: true }) } catch {}
  }
  // Dump to a reviewable SQL fixture (committed). sqlite3 CLI is fine here — this
  // is a dev/HiTL regeneration step; CI only ever RESTORES (better-sqlite3, above).
  const dump = execFileSync('sqlite3', [DB_PATH, '.dump'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  writeFileSync(FIXTURE_SQL, dump)
  console.error(`[seed] Built committed SQL fixture → ${FIXTURE_SQL}`)
}

const cmd = process.argv[2] || 'start'
if (cmd === 'start') {
  await start()
} else if (cmd === 'build-fixture') {
  await buildFixture()
} else if (cmd === 'stop') {
  await stop()
} else if (cmd === 'env') {
  printEnv()
} else {
  console.error('Usage: seed-recording-world.mjs <start|build-fixture|stop|env>')
  process.exit(1)
}
