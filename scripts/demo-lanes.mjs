#!/usr/bin/env node
/**
 * Capture visual proof of multi-backend streaming and cross-backend failover.
 *
 * WHY A SCRIPT RATHER THAN A HAND-TAKEN SCREENSHOT. A screenshot proves a
 * picture existed, not that a system worked. This boots a REAL daemon on its own
 * port and database, drives real spawns through it, and photographs what that
 * daemon actually served — so the artifact is bound to a run, and the manifest
 * it writes says which run, at which commit, against which port. An artifact
 * that cannot name those things is decoration, and the repo's own evidence rules
 * treat it as such.
 *
 * TWO MODES, AND THE HONESTY LINE BETWEEN THEM:
 *
 *   --fixture  Hermetic. Fake CLI binaries and a fake OpenAI server stand in for
 *              the providers; the DAEMON, the transcript store, the SSE feed and
 *              the lane view are all real. Runs anywhere, including CI, with no
 *              credentials and no spend. Every artifact is labeled `fixture`.
 *
 *   --live     Real providers, real tokens, real money. Only the backends whose
 *              credentials are actually present are included, and each is
 *              labeled `real`. A backend without credentials is SKIPPED and said
 *              so — never quietly replaced by a fixture wearing a real label.
 *
 * The mixed manifest is deliberate. Labeling a fixture lane `real` because the
 * rest of the capture was real is exactly the failure the manifest audit exists
 * to catch, and it is far easier to do by accident than on purpose.
 *
 * Usage:
 *   node scripts/demo-lanes.mjs --fixture [--out docs/artifacts/...]
 *   node scripts/demo-lanes.mjs --live    [--out ...] [--budget 0.50]
 */

import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cliAliasFor } from './lib/model-source.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const LIVE = args.has('--live');
const outArg = process.argv.indexOf('--out');
const budgetArg = process.argv.indexOf('--budget');
const PER_ROW_BUDGET_USD = budgetArg > -1 ? Number(process.argv[budgetArg + 1]) : 0.05;

const today = new Date().toISOString().slice(0, 10);
const OUT_DIR =
  outArg > -1
    ? process.argv[outArg + 1]
    : join(ROOT, 'docs', 'artifacts', 'multi-backend-resilience', today);

/**
 * Resolve the globally-installed Playwright.
 *
 * Playwright is deliberately NOT a repo devDependency — adding it would pull a
 * browser download into every contributor's install for a script most of them
 * never run. It is resolved explicitly, and its absence is reported as "capture
 * unavailable here" rather than crashing, because a missing capture tool must
 * not read like a broken feature.
 *
 * @returns The playwright module, or null when it is not installed.
 */
async function loadPlaywright() {
  const candidates = [
    'playwright',
    '/opt/node22/lib/node_modules/playwright/index.js',
    '/usr/lib/node_modules/playwright/index.js',
    '/usr/local/lib/node_modules/playwright/index.js',
  ];
  for (const spec of candidates) {
    try {
      const mod = await import(spec);
      // Playwright is CommonJS, so an ESM import lands it under `default` on
      // some paths and spreads it on others. Normalizing here rather than at the
      // call site keeps the failure mode "not installed" instead of the far more
      // confusing "installed but has no chromium".
      const pw = mod?.chromium ? mod : mod?.default;
      if (pw?.chromium) return pw;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/**
 * ffmpeg, for turning the recording into a PR-renderable GIF.
 *
 * Playwright ships one, which is why this looks in its browser directory before
 * the PATH: a capture host that has Playwright has ffmpeg, and depending on a
 * separate system install would make the GIF step fail on exactly the machines
 * best equipped to do it.
 */
const FFMPEG = (() => {
  const bundled = '/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux';
  return existsSync(bundled) ? bundled : 'ffmpeg';
})();

/** The commit this capture is bound to. An artifact that cannot name one is unauditable. */
function headCommit() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
}

/** Sleep, used only to let the daemon settle and the lanes render. */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Carve a throwaway git worktree for the demo spawns to run in.
 *
 * NOT optional and not ceremony: the spawner refuses to run a body in a
 * repository's main checkout, and it is right to — parallel agents sharing one
 * checkout overwrote each other and deleted 403 files on 2026-06-03. A capture
 * that worked around that guard would be demonstrating a configuration nobody
 * should run.
 *
 * @returns The worktree path and a cleanup function.
 */
function makeDemoWorktree() {
  const dir = mkdtempSync(join(tmpdir(), 'pd-lanes-wt-'));
  const path = join(dir, 'work');
  const branch = `lanes-demo-${Date.now().toString(36)}`;
  execFileSync('git', ['worktree', 'add', '--quiet', '--detach', path, 'HEAD'], {
    cwd: ROOT,
    stdio: 'pipe',
  });
  return {
    path,
    branch,
    cleanup: () => {
      try {
        execFileSync('git', ['worktree', 'remove', '--force', path], { cwd: ROOT, stdio: 'pipe' });
      } catch {
        // Best effort; the temp dir goes either way.
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * A fake agent CLI that streams a few lines and exits.
 *
 * Real enough to exercise the whole path — the spawner parses its output, the
 * transcript store records it, the SSE feed carries it, the lane renders it —
 * while costing nothing. What it is NOT is a real model, which is precisely why
 * every artifact from fixture mode is labeled `fixture`.
 *
 * @param dir Directory to write the script into.
 * @param name Binary name.
 * @param lines Lines the fake CLI prints, one per beat.
 * @returns The absolute path to the fake binary.
 */
function writeFakeCli(dir, name, lines) {
  const path = join(dir, name);
  // Paced deliberately: a fixture that finishes in 300ms leaves no live window
  // to photograph, and the capture would show three settled lanes while claiming
  // to show concurrent streaming.
  const body = lines.map((l) => `printf '%s\\n' ${JSON.stringify(l)}; sleep 5`).join('\n');
  writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  chmodSync(path, 0o755);
  return path;
}

/**
 * A fake OpenAI-compatible server that STREAMS, so the streaming path is the
 * one under the camera.
 *
 * A fixture that returns one blob would photograph the batch path while the
 * caption claimed streaming — the artifact would be true and the claim false.
 *
 * @param text The completion to stream, split into fragments.
 * @returns The server and its base URL.
 */
async function startFakeStreamingOpenAI(text) {
  const server = createServer((req, res) => {
    const fragments = text.match(/.{1,18}/gs) ?? [text];
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    let i = 0;
    const tick = setInterval(() => {
      if (i < fragments.length) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: fragments[i++] } }] })}\n\n`);
        return;
      }
      clearInterval(tick);
      res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 40, completion_tokens: 60 } })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }, 700);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}/v1` };
}

/**
 * Boot a real daemon on its own port and database.
 *
 * Launched directly rather than through tests/helpers/ephemeral-daemon.js
 * because that helper forces `PORT_DADDY_NO_TCP=1` — correct for a unit test,
 * fatal for a capture, since a browser needs a port to point at.
 *
 * @param env Extra environment for the daemon process.
 * @returns The child, the chosen port, and a cleanup function.
 */
async function startDaemon(env) {
  const tmp = mkdtempSync(join(tmpdir(), 'pd-lanes-'));
  const port = 9500 + Math.floor(Math.random() * 400);
  const child = spawn('npx', ['tsx', 'server.ts'], {
    cwd: ROOT,
    env: {
      ...process.env,
      ...env,
      PORT_DADDY_PORT: String(port),
      PORT_DADDY_DB: join(tmp, 'pd.db'),
      PORT_DADDY_SOCK: join(tmp, 'pd.sock'),
      PD_DISPATCH_POLL_MS: '500',
      // A capture daemon must run ONLY the lanes the capture asked for. Left on,
      // the project fleet auto-discovers pd-fleet.yml and arms every ship, which
      // both floods the log and spends money the capture never budgeted.
      PORT_DADDY_NO_FLEET: '1',
      NODE_ENV: 'development',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d.toString(); });
  child.stderr.on('data', (d) => { log += d.toString(); });

  const deadline = Date.now() + 60_000;
  for (;;) {
    if (Date.now() > deadline) {
      child.kill('SIGKILL');
      throw new Error(`daemon did not come up in 60s. Log tail:\n${log.slice(-2000)}`);
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        headers: { Host: '127.0.0.1' },
      });
      if (res.ok) break;
    } catch {
      // not up yet
    }
    await wait(500);
  }
  return {
    port,
    child,
    logTail: () => log.slice(-4000),
    cleanup: () => {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      rmSync(tmp, { recursive: true, force: true });
    },
  };
}

/**
 * Fire a spawn WITHOUT waiting for it to finish.
 *
 * `POST /spawn` is synchronous — it returns only when the body is done. Awaiting
 * it would mean every run had already completed before a browser ever opened,
 * and the "live lanes" capture would be a photograph of finished transcripts
 * replayed from a snapshot. Which is a real thing the lane can render, and is
 * NOT what this capture claims. So the requests are launched in parallel and the
 * page opens while they are still in flight.
 *
 * @param port The daemon port.
 * @param body The spawn request.
 * @returns A promise resolving to the completed spawn, for the summary table.
 */
function fireSpawn(port, body) {
  return fetch(`http://127.0.0.1:${port}/spawn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Host: '127.0.0.1' },
    body: JSON.stringify(body),
  })
    .then(async (res) => {
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`);
      // A 200 can still carry a refusal: the spawner reports a blocked spawn as
      // a completed request with status 'failed'. Surfacing it here means a
      // capture that cannot run says why, instead of producing empty lanes.
      if (payload.status === 'failed' && payload.agentId === 'blocked') {
        throw new Error(payload.error || 'spawn blocked');
      }
      return payload;
    });
}

/**
 * Discover the agent id a just-fired spawn is running as.
 *
 * Necessary because the synchronous spawn route only reports the id at the END,
 * and the lane view needs it at the START. The roster is the daemon's own view
 * of who is running, which is the honest place to ask.
 *
 * @param port The daemon port.
 * @param identity The spawn's identity string.
 * @param timeoutMs How long to keep looking.
 * @returns The agent id, or null when the run never appeared.
 */
async function discoverAgentId(port, identity, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/transcripts?limit=50`, {
        headers: { Host: '127.0.0.1' },
      });
      if (res.ok) {
        const body = await res.json();
        const rows = body.transcripts || body.entries || body.items || [];
        const hit = rows.find((r) => (r.identity ?? '') === identity);
        if (hit?.spawned_agent_id) return hit.spawned_agent_id;
      }
    } catch {
      // keep looking
    }
    await wait(300);
  }
  return null;
}

async function main() {
  const commit = headCommit();
  const playwright = await loadPlaywright();
  if (!playwright) {
    console.error(
      'demo-lanes: playwright is not installed here. Install it globally (npm i -g playwright)\n' +
        '            or run with a PLAYWRIGHT-capable environment. Capture skipped, not faked.',
    );
    process.exit(2);
  }

  mkdirSync(OUT_DIR, { recursive: true });

  const fakeDir = mkdtempSync(join(tmpdir(), 'pd-fake-cli-'));
  const lanes = [];
  const skipped = [];
  let fakeOpenAI = null;
  let daemon = null;
  let worktree = null;

  try {
    const env = {};

    if (!LIVE) {
      // Hermetic: fake binaries for the CLI lanes, a fake streaming server for
      // the API lane. The daemon, transcripts, SSE, and lane view stay real.
      const claudeBin = writeFakeCli(fakeDir, 'claude', [
        '{"type":"assistant","message":{"content":[{"type":"text","text":"Salvage preserves the worktree."}]}}',
        '{"type":"assistant","message":{"content":[{"type":"text","text":" Reap destroys the transcript a successor is briefed from."}]}}',
        '{"type":"assistant","message":{"content":[{"type":"text","text":" So a dispatch that will be continued settles to salvage, not failed."}]}}',
      ]);
      const agyBin = writeFakeCli(fakeDir, 'agy', [
        'Antigravity lane: batch output — agy documents no streaming format,',
        'so this lane is honestly batch rather than a parser invented for one.',
      ]);
      fakeOpenAI = await startFakeStreamingOpenAI(
        'A dispatch that fails on one backend should CONTINUE on the next, not restart: '
          + 'the claim, the worktree, and the budget already spent are all real work that a '
          + 'restart throws away.',
      );
      Object.assign(env, {
        // NOTE THE EXACT NAME. It is `PD_CLI_CLAUDE_CODE_BIN`, not
        // `PD_CLI_CLAUDE_BIN` — and the difference is not cosmetic. With the
        // wrong name the override is silently ignored, the REAL `claude` binary
        // runs, and a capture labeled `fixture` quietly contains live model
        // output. That happened on the first run of this script. A fixture that
        // is secretly real is the same class of lie as a mock labeled real; the
        // direction of the error does not redeem it.
        PD_CLI_CLAUDE_CODE_BIN: claudeBin,
        PD_CLI_AGY_BIN: agyBin,
        PD_CLI_BIN_DIRS: fakeDir,
        OPENAI_API_KEY: 'sk-fake-lanes-demo',
        OPENAI_BASE_URL: fakeOpenAI.baseUrl,
      });
    }

    worktree = makeDemoWorktree();
    daemon = await startDaemon(env);

    // Every spawn must run against a project with a daily budget: without one
    // the kill-switch has no number to enforce and the spawner refuses. Setting
    // a small explicit ceiling for the demo project is the honest way through
    // that gate — the alternative would be an env bypass, which would mean the
    // capture demonstrates a configuration nobody should run.
    const DEMO_PROJECT = 'lanes-demo';
    const DEMO_DAILY_BUDGET_USD = Math.max(0.5, PER_ROW_BUDGET_USD * 10);
    await fetch(`http://127.0.0.1:${daemon.port}/wallets/${DEMO_PROJECT}/budget`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Host: '127.0.0.1' },
      body: JSON.stringify({ usdPerDay: DEMO_DAILY_BUDGET_USD }),
    }).catch(() => {});
    // And a wallet balance, because every running agent must hold a bond — the
    // "no unbonded agent" invariant. A demo that bypassed the bond would be
    // demonstrating a system with its safety rail removed.
    await fetch(`http://127.0.0.1:${daemon.port}/wallets/${DEMO_PROJECT}/top-up`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Host: '127.0.0.1' },
      body: JSON.stringify({ usd: DEMO_DAILY_BUDGET_USD * 4 }),
    }).catch(() => {});
    console.log(
      `demo-lanes: project ${DEMO_PROJECT} capped at $${DEMO_DAILY_BUDGET_USD}/day, `
        + `$${PER_ROW_BUDGET_USD}/lane`,
    );
    console.log(`demo-lanes: daemon up on 127.0.0.1:${daemon.port} (commit ${commit.slice(0, 12)})`);

    // Which lanes to run. In live mode a backend without credentials is SKIPPED
    // and reported — never silently replaced by a fixture wearing a real label.
    // Resolved, not written down: the `claude` CLI takes a family nickname on
    // --model, and the mapping lives in config/models.yaml like every other
    // model decision in the repo. A capture script that hardcoded one would be
    // the first place the canonical registry stopped being canonical.
    const CLAUDE_CLI_MODEL = cliAliasFor('claude-cli', 'balanced');

    const requested = LIVE
      ? [
          { label: 'claude-code', backend: 'cli:claude-code', model: CLAUDE_CLI_MODEL, need: null },
          { label: 'openai', backend: 'openai', need: 'OPENAI_API_KEY' },
          { label: 'gemini', backend: 'gemini', need: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'] },
          { label: 'cloudflare', backend: 'cloudflare', need: ['CLOUDFLARE_API_TOKEN', 'CF_API_TOKEN'] },
        ]
      : [
          { label: 'claude-code', backend: 'cli:claude-code', model: CLAUDE_CLI_MODEL, need: null },
          { label: 'openai', backend: 'openai', need: null },
          { label: 'agy', backend: 'cli:agy', need: null },
        ];

    const TASK =
      'In 3-4 sentences, explain why a failed dispatch should settle to salvage rather '
      + 'than failed when a successor will continue it.';

    // Fire every spawn AT ONCE, then find their agent ids while they run. This
    // ordering is what makes the capture a picture of concurrent live work
    // rather than of finished transcripts replayed after the fact.
    const inFlight = [];
    for (const row of requested) {
      const needs = row.need ? (Array.isArray(row.need) ? row.need : [row.need]) : [];
      if (needs.length && !needs.some((k) => process.env[k])) {
        skipped.push({ label: row.label, reason: `no ${needs.join(' / ')}` });
        console.log(`demo-lanes: SKIP ${row.label} — ${needs.join(' / ')} not set`);
        continue;
      }
      const identity = `lanes-demo:${row.label}`;
      const promise = fireSpawn(daemon.port, {
        backend: row.backend,
        ...(row.model ? { model: row.model } : {}),
        task: TASK,
        budgetUsd: PER_ROW_BUDGET_USD,
        identity,
        workdir: worktree.path,
      }).catch((err) => {
        skipped.push({ label: row.label, reason: String(err.message ?? err) });
        console.log(`demo-lanes: FAILED ${row.label} — ${err.message ?? err}`);
        return null;
      });
      inFlight.push({ row, identity, promise });
    }

    for (const { row, identity } of inFlight) {
      const agentId = await discoverAgentId(daemon.port, identity);
      if (!agentId) {
        if (!skipped.some((s) => s.label === row.label)) {
          skipped.push({ label: row.label, reason: 'no transcript appeared' });
        }
        continue;
      }
      lanes.push({
        label: row.label,
        agentId,
        backend: row.backend,
        sourceLabel: LIVE ? 'real' : 'fixture',
      });
      console.log(`demo-lanes: lane ${row.label} → ${agentId}`);
    }

    if (lanes.length === 0) {
      await Promise.allSettled(inFlight.map((f) => f.promise));
      throw new Error(`no lane started. Daemon log tail:\n${daemon.logTail()}`);
    }

    const query = lanes
      .map((l) => `lane=${encodeURIComponent(`${l.label}|${l.agentId}|${l.backend}|${l.sourceLabel}`)}`)
      .join('&');
    const url = `http://127.0.0.1:${daemon.port}/lanes.html?${query}&commit=${commit.slice(0, 12)}`;

    const browser = await playwright.chromium.launch({
      executablePath: existsSync('/opt/pw-browsers/chromium/chrome-linux/chrome')
        ? '/opt/pw-browsers/chromium/chrome-linux/chrome'
        : undefined,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });

    const shots = [];
    let recording = null;
    for (const scheme of ['light', 'dark']) {
      // The LIGHT pass also records video. A still frame cannot show streaming —
      // it shows text that might have arrived all at once — so a recording is
      // the only artifact that actually evidences the claim this PR makes.
      const context = await browser.newContext({
        viewport: { width: 1280, height: 820 },
        colorScheme: scheme,
        deviceScaleFactor: 2,
        ...(scheme === 'light'
          ? { recordVideo: { dir: OUT_DIR, size: { width: 1280, height: 820 } } }
          : {}),
      });
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      // Long enough for every lane to have streamed something. A capture taken
      // before the first token photographs an empty lane and proves nothing.
      await wait(14_000);
      const file = join(OUT_DIR, `lanes-${scheme}.png`);
      await page.screenshot({ path: file, fullPage: true });
      shots.push(file);
      console.log(`demo-lanes: captured ${file}`);
      const video = scheme === 'light' ? page.video() : null;
      await context.close(); // Video is only finalized on context close.
      if (video) {
        recording = join(OUT_DIR, 'lanes-stream.webm');
        try {
          await video.saveAs(recording);
          console.log(`demo-lanes: recorded ${recording}`);
          shots.push(recording);
        } catch (err) {
          console.log(`demo-lanes: video not saved — ${err.message ?? err}`);
          recording = null;
        }
      }
    }
    await browser.close();

    // A GIF alongside the webm, because GitHub renders a GIF inline in a PR body
    // and will not play a webm — an artifact a reviewer has to download is an
    // artifact most reviewers will not watch.
    if (recording) {
      const gif = join(OUT_DIR, 'lanes-stream.gif');
      try {
        execFileSync(
          FFMPEG,
          ['-y', '-i', recording, '-vf', 'fps=6,scale=980:-1:flags=lanczos', '-loop', '0', gif],
          { stdio: 'pipe' },
        );
        console.log(`demo-lanes: rendered ${gif}`);
        shots.push(gif);
      } catch (err) {
        // No ffmpeg is a missing convenience, not a failed capture. The webm
        // still exists and still proves the same thing.
        console.log(`demo-lanes: gif not rendered (${String(err.message ?? err).slice(0, 80)})`);
      }
    }

    // The manifest is the artifact's passport. Every field is mandatory, and
    // `sourceLabel` is the one that makes the whole set auditable: an artifact
    // that will not say whether its data is real is not evidence.
    const manifest = {
      branchCommit: commit,
      isControlPanelPr: false,
      statesCovered: ['active'],
      capturedAt: new Date().toISOString(),
      mode: LIVE ? 'live' : 'fixture',
      perRowBudgetUsd: PER_ROW_BUDGET_USD,
      skipped,
      artifacts: shots.map((file) => ({
        file: file.replace(`${ROOT}/`, ''),
        manifest: {
          daemonPort: daemon.port,
          runId: lanes.map((l) => l.agentId).join(','),
          transcriptHeadHash: null,
          agentNodeId: lanes[0].agentId,
          commit,
          sourceLabel: LIVE ? 'real' : 'fixture',
          lanes,
        },
      })),
    };
    const manifestPath = join(OUT_DIR, 'proof-manifest.json');
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`demo-lanes: wrote ${manifestPath}`);

    console.table(
      lanes.map((l) => ({
        lane: l.label,
        backend: l.backend,
        source: l.sourceLabel,
        agentId: l.agentId.slice(0, 18),
      })),
    );
    if (skipped.length) console.table(skipped);

    // Let the in-flight spawns settle before tearing the daemon down, so the
    // process exits on a finished run rather than on a killed one — but BOUND
    // that wait. The capture is already on disk by this point, and a provider
    // that never returns must not hold a finished capture hostage; a harness
    // that hangs after succeeding is indistinguishable from one that failed.
    await Promise.race([
      Promise.allSettled(inFlight.map((f) => f.promise)),
      wait(20_000),
    ]);
  } finally {
    daemon?.cleanup();
    worktree?.cleanup();
    if (fakeOpenAI) await new Promise((r) => fakeOpenAI.server.close(r));
    rmSync(fakeDir, { recursive: true, force: true });
  }
}

main()
  .then(() => {
    // Explicit exit: the daemon child and the fake server are torn down in
    // `finally`, but a lingering socket handle would otherwise keep the event
    // loop alive after the work is done.
    process.exit(0);
  })
  .catch((err) => {
    console.error(`demo-lanes: ${err.message ?? err}`);
    process.exit(1);
  });
