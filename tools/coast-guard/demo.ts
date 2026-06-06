/**
 * tools/coast-guard/demo.ts — prove the Coast Guard works, live, on this box.
 *
 * Run: npx tsx tools/coast-guard/demo.ts
 *
 * Demonstrates the three ADR-0050 protections against the REAL modules the
 * spawner uses (lib/coast-guard.ts + lib/coast-guard/egress-meter.ts):
 *   (a) a confined process CANNOT read ~/.ssh or a project .env.local;
 *   (b) the broker scrub leaves NO raw key in the child env;
 *   (c) the egress meter HARD-REFUSES the request past the cap.
 *
 * Honest, like the receipt: this is the cooperative-case defense. A malicious
 * same-UID agent can bypass the proxy / read the daemon cache — ADR-0050 ph4.
 */

import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import {
  defaultCrownJewels,
  scrubRawSecretsFromEnv,
  seatbeltAvailable,
  wrapWithSandbox,
} from '../../lib/coast-guard.js';
import { EgressMeter } from '../../lib/coast-guard/egress-meter.js';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
const PASS = (m: string): void => console.log(`${GREEN}  PASS${RESET} ${m}`);
const FAIL = (m: string): void => {
  console.log(`${RED}  FAIL${RESET} ${m}`);
  process.exitCode = 1;
};

async function main(): Promise<void> {
  console.log(`${BOLD}== Coast Guard live demo (ADR-0050) ==${RESET}\n`);

  // ── (a) CONFINE — sandbox blocks secrets, allows work ─────────────────────
  console.log(`${BOLD}(a) Confinement: a sandboxed process cannot read the crown jewels${RESET}`);
  if (process.platform === 'darwin' && seatbeltAvailable()) {
    const work = mkdtempSync(join(tmpdir(), 'cg-demo-'));
    const proj = join(work, 'proj');
    mkdirSync(proj, { recursive: true });
    const envFile = join(proj, '.env.local');
    writeFileSync(envFile, 'ANTHROPIC_API_KEY=sk-ant-SUPER-SECRET\n');
    const codeFile = join(proj, 'index.js');
    writeFileSync(codeFile, 'console.log("normal work");\n');

    // Use the REAL spawner code path: wrapWithSandbox builds the profile,
    // registers the workdir's dotenv (resolving the macOS /var→/private symlink),
    // and returns the sandbox-exec command. This is exactly what the spawner runs.
    const jewels = defaultCrownJewels(homedir());
    const runUnderSandbox = (cmd: string, cmdArgs: string[]): { ok: boolean; out: string } => {
      const w = wrapWithSandbox(cmd, cmdArgs, jewels, proj);
      const r = spawnSync(w.cmd, w.args, { encoding: 'utf-8' });
      for (const c of w.cleanup) rmSync(c, { recursive: true, force: true });
      return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || '') };
    };

    const envRead = runUnderSandbox('cat', [envFile]);
    if (!envRead.ok && /not permitted/i.test(envRead.out)) PASS(`.env.local read BLOCKED: ${envRead.out.trim()}`);
    else FAIL(`.env.local should be blocked, got: ok=${envRead.ok} ${envRead.out.trim()}`);

    const sshTarget = join(homedir(), '.ssh');
    const sshRead = runUnderSandbox('sh', ['-c', `ls ${sshTarget} 2>&1`]);
    if (/not permitted/i.test(sshRead.out)) PASS('~/.ssh listing BLOCKED');
    else FAIL(`~/.ssh should be blocked, got: ${sshRead.out.trim()}`);

    const codeRead = runUnderSandbox('cat', [codeFile]);
    if (codeRead.ok && codeRead.out.includes('normal work')) PASS('normal project file ALLOWED (work unaffected)');
    else FAIL(`normal file should be allowed, got: ok=${codeRead.ok} ${codeRead.out.trim()}`);

    rmSync(work, { recursive: true, force: true });
  } else {
    console.log('  (skipped: Seatbelt not available on this platform — see Linux Landlock/bwrap path)');
  }

  // ── (b) BROKER — no raw key in the child env ──────────────────────────────
  console.log(`\n${BOLD}(b) Broker: the spawned agent's env carries NO raw API key${RESET}`);
  const dirtyEnv: Record<string, string | undefined> = {
    PATH: '/usr/bin',
    ANTHROPIC_API_KEY: 'sk-ant-LEAK',
    OPENAI_API_KEY: 'sk-LEAK',
    GEMINI_API_KEY: 'g-LEAK',
  };
  const { env: clean, scrubbed } = scrubRawSecretsFromEnv(dirtyEnv);
  const dump = Object.entries(clean).map(([k, v]) => `${k}=${v}`).join('\n');
  if (!/LEAK/.test(dump)) PASS(`env dump after scrub has no raw key (removed: ${scrubbed.join(', ')})`);
  else FAIL(`env dump still leaks a key:\n${dump}`);
  if (clean.PATH === '/usr/bin') PASS('non-secret env preserved (PATH intact)');
  else FAIL('PATH should be preserved');

  // ── (c) CAP — the over-cap request is hard-refused ────────────────────────
  console.log(`\n${BOLD}(c) Hard egress cap: a runaway agent's over-cap request is REFUSED${RESET}`);
  const upstream = http.createServer((_req, res) => { res.writeHead(200); res.end('ok'); });
  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', () => r()));
  const upPort = (upstream.address() as { port: number }).port;

  const meter = new EgressMeter({ maxRequests: 2 });
  const meterPort = await meter.listen(0);

  const call = (): Promise<number> =>
    new Promise((resolve) => {
      const req = http.request(
        { host: '127.0.0.1', port: meterPort, method: 'GET',
          path: `http://127.0.0.1:${upPort}/v1/messages`,
          headers: { Host: `127.0.0.1:${upPort}`, Connection: 'close' }, agent: false },
        (res) => { res.resume(); res.on('end', () => resolve(res.statusCode || 0)); },
      );
      req.on('error', () => resolve(0));
      req.end();
    });

  const s1 = await call();
  const s2 = await call();
  const s3 = await call();
  console.log(`  cap=2 → request statuses: [${s1}, ${s2}, ${s3}]`);
  if (s1 === 200 && s2 === 200) PASS('requests under the cap forwarded (200)');
  else FAIL(`under-cap requests should be 200, got [${s1}, ${s2}]`);
  if (s3 === 402) PASS('over-cap request HARD-REFUSED (402 Spend Cap Exceeded) — "bankrupt me" denied');
  else FAIL(`over-cap request should be refused, got ${s3}`);
  console.log(`  meter receipt: ${JSON.stringify({ requests: meter.state.requests, blocked: meter.state.blocked })}`);

  meter.dispose();
  await new Promise<void>((r) => upstream.close(() => r()));

  console.log(`\n${BOLD}Honest limit:${RESET} this is the cooperative-case defense. A truly-malicious`);
  console.log('same-UID agent can `unset HTTPS_PROXY` or read the daemon cache — that needs a');
  console.log('separate UID/VM + forced egress (ADR-0050 phase 4). We never claim more.\n');

  if (process.exitCode) console.log(`${RED}${BOLD}DEMO FAILED${RESET}`);
  else console.log(`${GREEN}${BOLD}All Coast Guard protections demonstrated live.${RESET}`);
}

void main();
