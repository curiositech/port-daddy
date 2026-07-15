/**
 * Local-only egress assertion (ADR-0101 Appendix — Critical 1, Phase 1 gate #1)
 *
 * Claim under test: the Port Daddy daemon, running in local-only mode (cloud /
 * relay features unconfigured), makes ZERO non-loopback network connections.
 *
 * How: a stdlib-only recorder (tests/helpers/egress-guard.mjs) is preloaded
 * into the daemon subprocess via NODE_OPTIONS=--import BEFORE any app code
 * runs. It records every `net.Socket.prototype.connect` target — the single
 * chokepoint through which http/https/tls/fetch/undici/ws all flow — to a
 * JSONL log. We boot the daemon with every known cloud credential/URL blanked,
 * drive a representative session lifecycle over the loopback unix socket
 * (health → begin session → add note → claim file → end session), then assert
 * that the set of NON-loopback destinations the daemon opened is empty.
 *
 * This is RECORD-and-assert, not block: if a future feature phones home in
 * local-only mode, this test fails and names the destination. Do NOT weaken it
 * to pass — a leak here is a real finding for operator triage.
 */

import { startEphemeralDaemon } from '../helpers/ephemeral-daemon.js';
import { mkdtempSync, readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

const GUARD_PATH = join(import.meta.dirname, '../helpers/egress-guard.mjs');

// Hard repo rule: never write scratch under /tmp. Use ~/coding/tmp.
const SCRATCH_ROOT = join(homedir(), 'coding', 'tmp');

// Cloud / relay / telemetry credentials + endpoints. Blanked at daemon spawn so
// an inherited value on a dev machine can never make "local-only" a lie.
const CLOUD_ENV_KEYS = [
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_API_KEY',
  'CF_API_TOKEN',
  'CF_ACCOUNT_ID',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'PD_RELAY_URL',
  'RELAY_URL',
  'PORT_DADDY_RELAY_URL',
  'PD_TELEMETRY_URL',
  'PORT_DADDY_TELEMETRY_URL',
];

// A target is loopback (allowed) if it is a unix socket path, or its host is a
// recognised loopback / unspecified address. Everything else is a leak.
const LOOPBACK_HOSTS = new Set([
  '127.0.0.1',
  '::1',
  '::ffff:127.0.0.1',
  'localhost',
  '0.0.0.0',
  '::',
  '',
]);

function isLoopbackTarget(entry) {
  if (entry.path) return true; // unix domain socket
  const host = entry.host;
  if (host === undefined || host === null) return true; // defaults to localhost
  return LOOPBACK_HOSTS.has(String(host));
}

function readConnects(logPath) {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function makeScratchDir() {
  mkdirSync(SCRATCH_ROOT, { recursive: true });
  return mkdtempSync(join(SCRATCH_ROOT, 'egress-'));
}

describe('daemon local-only egress assertion (ADR-0101 Critical 1)', () => {
  test('positive control: the recorder actually catches a non-loopback connect', () => {
    // If this fails, the whole gate is untrustworthy — a green real-test could
    // just mean the recorder is broken. Drive a deliberate off-box connect
    // (RFC 5737 TEST-NET-1, guaranteed unroutable) through the guard and prove
    // it is recorded and classified as a leak.
    const dir = makeScratchDir();
    const logPath = join(dir, 'egress.jsonl');
    try {
      const res = spawnSync(
        process.execPath,
        ['-e', "const net=require('node:net');const s=net.connect({host:'192.0.2.1',port:9});s.on('error',()=>{});s.destroy();"],
        {
          env: { ...process.env, NODE_OPTIONS: `--import ${GUARD_PATH}`, PD_EGRESS_LOG: logPath },
          timeout: 10000,
        },
      );
      expect(res.error).toBeUndefined();

      const connects = readConnects(logPath);
      expect(connects.some((e) => e.kind === 'guard-init')).toBe(true);

      const leaks = connects.filter((e) => e.kind === 'socket.connect' && !isLoopbackTarget(e));
      expect(leaks.map((l) => l.host)).toContain('192.0.2.1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('daemon in local-only mode makes ZERO non-loopback connections', async () => {
    const dir = makeScratchDir();
    const logPath = join(dir, 'egress.jsonl');

    const cloudBlank = Object.fromEntries(CLOUD_ENV_KEYS.map((k) => [k, '']));
    const nodeOptions = `${process.env.NODE_OPTIONS || ''} --import ${GUARD_PATH}`.trim();

    // A clean HOME so no real ~/.port-daddy-env / dotfile secret can silently
    // configure a cloud feature and make "local-only" a lie.
    const cleanHome = join(dir, 'home');
    mkdirSync(cleanHome, { recursive: true });

    let daemon;
    try {
      daemon = await startEphemeralDaemon({
        startupTimeout: 40000,
        env: {
          ...cloudBlank,
          HOME: cleanHome,
          NODE_OPTIONS: nodeOptions,
          PD_EGRESS_LOG: logPath,
        },
      });

      const agentId = 'egress-test-agent';

      // --- representative session lifecycle over the loopback unix socket ---
      const health = await daemon.request('/health');
      expect(health.status).toBeGreaterThanOrEqual(200);
      expect(health.status).toBeLessThan(500);

      const begun = await daemon.request('/sessions', {
        method: 'POST',
        body: { purpose: 'egress-assertion lifecycle', agentId },
      });
      expect(begun.ok).toBe(true);
      const sessionId = begun.data?.session?.id ?? begun.data?.sessionId ?? begun.data?.id;
      expect(sessionId).toBeTruthy();

      const noted = await daemon.request(`/sessions/${sessionId}/notes`, {
        method: 'POST',
        body: { content: 'egress-assertion note', agentId },
      });
      expect(noted.ok).toBe(true);

      const claimed = await daemon.request(`/sessions/${sessionId}/files`, {
        method: 'POST',
        body: { files: ['tests/integration/egress-local-only.integration.test.js'], agentId },
      });
      expect(claimed.ok).toBe(true);

      const ended = await daemon.request(`/sessions/${sessionId}`, {
        method: 'PUT',
        body: { status: 'completed', note: 'egress-assertion done' },
      });
      expect(ended.ok).toBe(true);

      // Let any deferred / background egress attempt flush.
      await new Promise((r) => setTimeout(r, 1500));
    } finally {
      // Shutdown may itself attempt egress — record that too before we read.
      if (daemon) await daemon.cleanup();
    }

    await new Promise((r) => setTimeout(r, 500));

    const connects = readConnects(logPath);

    // Prove the guard was actually loaded — otherwise "zero leaks" is vacuous.
    expect(connects.some((e) => e.kind === 'guard-init')).toBe(true);

    const leaks = connects.filter((e) => e.kind === 'socket.connect' && !isLoopbackTarget(e));

    if (leaks.length > 0) {
      const destinations = [...new Set(
        leaks.map((l) => (l.path ? `unix:${l.path}` : `${l.host}:${l.port}`)),
      )];
      throw new Error(
        'EGRESS LEAK: daemon in local-only mode opened non-loopback connection(s): ' +
        destinations.join(', ') +
        ' — this violates ADR-0101 Critical 1. Do not weaken this test; gate the ' +
        'phoning-home behaviour behind explicit configuration.',
      );
    }

    rmSync(dir, { recursive: true, force: true });
    expect(leaks).toEqual([]);
  });
});
