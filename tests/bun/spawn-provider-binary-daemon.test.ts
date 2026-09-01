/**
 * Real-runtime (bun:test) regression suite for daemon /spawn provider binaries.
 *
 * The daemon route is the contract under test: it must resolve local CLI
 * provider binaries the same way the child process launcher does, invoke that
 * resolved binary, and persist a transcript for both successful and failed
 * launches. Fake binaries keep the test hermetic while still exercising the
 * real Fastify route, createSpawner(), cli-tube launcher, and transcript store.
 * Codex remains in the matrix as a fail-closed admission case because its CLI
 * cannot enforce Port Daddy's required provider-native dollar ceiling.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import Fastify, { type FastifyInstance } from 'fastify';

import { CORE_SCHEMA_SQL } from '../../lib/db.ts';
import { createTranscripts, type Transcripts } from '../../lib/transcripts.ts';
import { createSpawner } from '../../lib/spawner.ts';
import { spawnPlugin } from '../../routes/spawn.ts';

const LAUNCHD_RESTRICTED_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

const TEST_TELEMETRY_BYPASS = {
  humanConfirmed: true,
  confirmedBy: 'bun-daemon-provider-binary-test',
  reason: 'Hermetic fake CLI provider binaries exercise transcript persistence, not live provider billing.',
};

interface Harness {
  app: FastifyInstance;
  transcripts: Transcripts;
  db: Database;
}

interface ProviderCase {
  backend: 'cli:claude-code' | 'cli:codex';
  binName: 'claude' | 'codex';
  envOverride: 'PD_CLI_CLAUDE_CODE_BIN' | 'PD_CLI_CODEX_BIN';
  markerEnv: 'PD_FAKE_CLAUDE_INVOKED_FILE' | 'PD_FAKE_CODEX_INVOKED_FILE';
  finalText: string;
  expectedRoles: string[];
}

const PROVIDERS: ProviderCase[] = [
  {
    backend: 'cli:claude-code',
    binName: 'claude',
    envOverride: 'PD_CLI_CLAUDE_CODE_BIN',
    markerEnv: 'PD_FAKE_CLAUDE_INVOKED_FILE',
    finalText: 'pd-bun-claude-provider',
    expectedRoles: ['user', 'assistant'],
  },
  {
    backend: 'cli:codex',
    binName: 'codex',
    envOverride: 'PD_CLI_CODEX_BIN',
    markerEnv: 'PD_FAKE_CODEX_INVOKED_FILE',
    finalText: 'pd-bun-codex-provider',
    expectedRoles: ['user', 'assistant'],
  },
];

const LAUNCHABLE_PROVIDERS = PROVIDERS.filter(
  (provider) => provider.backend === 'cli:claude-code',
);

const envKeysToRestore = [
  'PATH',
  'PD_USE_CLI_BACKEND',
  'PD_CLI_BIN_DIRS',
  'PD_CLI_CLAUDE_CODE_BIN',
  'PD_CLI_CODEX_BIN',
  'PD_FAKE_CLAUDE_INVOKED_FILE',
  'PD_FAKE_CODEX_INVOKED_FILE',
  'PD_SPAWN_ISOLATION_OFF',
] as const;

let envSnapshot: Partial<Record<(typeof envKeysToRestore)[number], string | undefined>>;

function snapshotEnv(): void {
  envSnapshot = {};
  for (const key of envKeysToRestore) envSnapshot[key] = process.env[key];
}

function restoreEnv(): void {
  for (const key of envKeysToRestore) {
    const value = envSnapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function setDaemonCliEnv(overrides: Record<string, string | undefined>): void {
  process.env.PATH = LAUNCHD_RESTRICTED_PATH;
  process.env.PD_USE_CLI_BACKEND = 'none';
  process.env.PD_SPAWN_ISOLATION_OFF = '1';
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function startHarness(): Promise<Harness> {
  const db = new Database(':memory:') as unknown as import('better-sqlite3').Database;
  (db as unknown as { exec(sql: string): void }).exec(CORE_SCHEMA_SQL);

  const transcripts = createTranscripts(db);
  const spawner = createSpawner({
    transcripts,
    enforceTranscriptPolicy: true,
    enforceTelemetryPolicy: false,
    telemetryBypassApproval: TEST_TELEMETRY_BYPASS,
  });

  const app = Fastify();
  await app.register(spawnPlugin, {
    deps: {
      spawner,
      costTracker: {
        budgetStatus: () => ({
          project: 'port-daddy',
          budgetUsdPerDay: 5,
          spentUsd: 0,
          remainingUsd: 5,
          percentUsed: 0,
          overBudget: false,
        }),
      },
      metrics: { errors: 0 },
      logger: { info() {}, error() {} },
    },
  } as never);

  return { app, transcripts, db: db as unknown as Database };
}

async function closeHarness(harness: Harness): Promise<void> {
  await harness.app.close();
  harness.db.close();
}

function makeWorkdir(root: string): string {
  const workdir = join(root, 'spawn-workdir');
  mkdirSync(workdir, { recursive: true });
  execFileSync('git', ['init'], { cwd: workdir, stdio: 'ignore' });
  return workdir;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function writeFakeProviderBinary(provider: ProviderCase, binPath: string): void {
  mkdirSync(join(binPath, '..'), { recursive: true });
  const marker = `if [ -n "$${provider.markerEnv}" ]; then printf "binary=%s\\nargs=%s\\n" "$0" "$*" > "$${provider.markerEnv}"; fi`;
  if (provider.backend === 'cli:claude-code') {
    const lines = [
      { type: 'system', subtype: 'init' },
      { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'daemon binary resolved' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: provider.finalText }] } },
      {
        type: 'result',
        subtype: 'success',
        result: provider.finalText,
        usage: {
          input_tokens: 12,
          output_tokens: 4,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      },
    ].map((line) => JSON.stringify(line));
    writeFileSync(binPath, `#!/bin/sh\n${marker}\n${lines.map((line) => `printf '%s\\n' ${shellQuote(line)}`).join('\n')}\n`);
  } else {
    const lines = [
      { type: 'agent_reasoning', text: 'daemon binary resolved' },
      { type: 'agent_message', message: provider.finalText },
      {
        type: 'turn.completed',
        usage: {
          input_tokens: 20,
          output_tokens: 5,
          cached_input_tokens: 0,
        },
      },
    ].map((line) => JSON.stringify(line));
    writeFileSync(
      binPath,
      `#!/bin/sh\n${marker}\nwhile [ "$#" -gt 0 ]; do\n  if [ "$1" = "--output-last-message" ]; then\n    shift\n    printf '%s\\n' ${shellQuote(provider.finalText)} > "$1"\n  fi\n  shift || break\ndone\n${lines.map((line) => `printf '%s\\n' ${shellQuote(line)}`).join('\n')}\n`,
    );
  }
  chmodSync(binPath, 0o755);
}

function writeFailingProviderBinary(provider: ProviderCase, binPath: string): void {
  mkdirSync(join(binPath, '..'), { recursive: true });
  const marker = `if [ -n "$${provider.markerEnv}" ]; then printf "binary=%s\\nargs=%s\\n" "$0" "$*" > "$${provider.markerEnv}"; fi`;
  writeFileSync(
    binPath,
    `#!/bin/sh\n${marker}\nprintf '%s\\n' ${shellQuote(`${provider.binName} fake launch failed before provider turn`)} >&2\nexit 127\n`,
  );
  chmodSync(binPath, 0o755);
}

function spawnBody(provider: ProviderCase, workdir: string) {
  return {
    backend: provider.backend,
    identity: `port-daddy:e2e:${provider.backend.replace(/[^a-z0-9]+/gi, '-')}`,
    task: `Reply with exactly: ${provider.finalText}`,
    budgetUsd: 0.01,
    timeout: 10_000,
    workdir,
  };
}

async function injectProviderSpawn(
  harness: Harness,
  provider: ProviderCase,
  workdir: string,
) {
  const spawnRequest = harness.app.inject({
    method: 'POST',
    url: '/spawn',
    payload: spawnBody(provider, workdir),
  });
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`${provider.backend} provider child/stdio did not settle before the daemon smoke deadline`));
    }, 4_000);
  });
  return Promise.race([spawnRequest, timeout]);
}

function transcriptFor(harness: Harness, backend: ProviderCase['backend'], agentId: string) {
  const row = harness.transcripts
    .listTranscripts({ ship: `spawn:${backend}` })
    .find((candidate) => candidate.spawned_agent_id === agentId);
  expect(row).toBeTruthy();
  return harness.transcripts.getTranscript(row!.id);
}

snapshotEnv();

afterEach(() => {
  restoreEnv();
});

describe('daemon /spawn provider binary launch path', () => {
  test('invokes the daemon-resolved Claude provider binary and persists transcript output', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'pd-provider-binary-ok-'));
    const harness = await startHarness();
    try {
      const workdir = makeWorkdir(tmp);
      const binDir = join(tmp, 'provider-bin');
      const markers: Record<string, string> = {};
      const env: Record<string, string> = { PD_CLI_BIN_DIRS: binDir };

      for (const provider of LAUNCHABLE_PROVIDERS) {
        const fakeBinary = join(binDir, provider.binName);
        const staleOverride = join(tmp, 'stale', provider.binName);
        const marker = join(tmp, `${provider.binName}-invoked.txt`);
        writeFakeProviderBinary(provider, fakeBinary);
        markers[provider.backend] = marker;
        env[provider.envOverride] = staleOverride;
        env[provider.markerEnv] = marker;
      }
      setDaemonCliEnv(env);

      for (const provider of LAUNCHABLE_PROVIDERS) {
        const response = await injectProviderSpawn(harness, provider, workdir);

        expect(response.statusCode, response.body).toBe(200);
        const body = response.json();
        expect(body).toMatchObject({
          success: true,
          backend: provider.backend,
          status: 'completed',
          error: null,
        });
        expect(existsSync(markers[provider.backend])).toBe(true);
        const marker = readFileSync(markers[provider.backend], 'utf8');
        expect(marker).toContain(`binary=${join(binDir, provider.binName)}`);
        expect(marker).not.toContain(join(tmp, 'stale', provider.binName));

        const transcript = transcriptFor(harness, provider.backend, body.agentId);
        expect(transcript.status).toBe('completed');
        expect(transcript.backend).toBe(provider.backend);
        expect(transcript.spawned_agent_id).toBe(body.agentId);
        expect(transcript.messages.map((message) => message.role)).toEqual(expect.arrayContaining(provider.expectedRoles));
        expect(JSON.stringify(transcript.messages)).toContain(provider.finalText);
        expect(transcript.outputs).toHaveLength(1);
        expect(transcript.outputs[0].type).toBe('message');
        expect(transcript.outputs[0].summary).toContain(provider.backend);
      }
    } finally {
      await closeHarness(harness);
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('rejects Codex before invoking its binary when the required dollar ceiling cannot be enforced', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'pd-provider-binary-codex-cap-'));
    const harness = await startHarness();
    try {
      const workdir = makeWorkdir(tmp);
      const provider = PROVIDERS.find((candidate) => candidate.backend === 'cli:codex')!;
      const binDir = join(tmp, 'provider-bin');
      const marker = join(tmp, `${provider.binName}-invoked.txt`);
      const fakeBinary = join(binDir, provider.binName);
      writeFakeProviderBinary(provider, fakeBinary);
      setDaemonCliEnv({
        PD_CLI_BIN_DIRS: binDir,
        [provider.envOverride]: fakeBinary,
        [provider.markerEnv]: marker,
      });

      const response = await injectProviderSpawn(harness, provider, workdir);

      expect(response.statusCode, response.body).toBe(200);
      const body = response.json();
      expect(body).toMatchObject({
        success: false,
        backend: provider.backend,
        status: 'failed',
      });
      expect(body.error).toMatch(/cannot enforce budgetUsd as a provider-native hard ceiling/i);
      expect(existsSync(marker)).toBe(false);
    } finally {
      await closeHarness(harness);
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('a failed Claude provider binary launch is not wrapped as a successful daemon response', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'pd-provider-binary-fail-'));
    const harness = await startHarness();
    try {
      const workdir = makeWorkdir(tmp);
      const binDir = join(tmp, 'provider-bin');
      const env: Record<string, string> = { PD_CLI_BIN_DIRS: binDir };
      const markers: Record<string, string> = {};

      for (const provider of LAUNCHABLE_PROVIDERS) {
        const fakeBinary = join(binDir, provider.binName);
        const marker = join(tmp, `${provider.binName}-failed-invoked.txt`);
        writeFailingProviderBinary(provider, fakeBinary);
        markers[provider.backend] = marker;
        env[provider.envOverride] = fakeBinary;
        env[provider.markerEnv] = marker;
      }
      setDaemonCliEnv(env);

      for (const provider of LAUNCHABLE_PROVIDERS) {
        const response = await injectProviderSpawn(harness, provider, workdir);

        expect(response.statusCode, response.body).toBe(200);
        const body = response.json();
        expect(body).toMatchObject({
          success: false,
          backend: provider.backend,
          status: 'failed',
        });
        expect(body.error).toMatch(/fake launch failed|exited with code 127/i);
        expect(body.error).toContain(provider.binName);
        expect(existsSync(markers[provider.backend])).toBe(true);
        expect(readFileSync(markers[provider.backend], 'utf8')).toContain(`binary=${join(binDir, provider.binName)}`);

        const transcript = transcriptFor(harness, provider.backend, body.agentId);
        expect(transcript.status).toBe('failed');
        expect(transcript.error).toBe(body.error);
        expect(transcript.messages.map((message) => message.role)).toContain('user');
        expect(JSON.stringify(transcript.messages)).toContain('[error]');
        expect(JSON.stringify(transcript.messages)).toContain(provider.binName);
        expect(transcript.outputs).toHaveLength(1);
        expect(transcript.outputs[0].type).toBe('noop');
        expect(transcript.outputs[0].summary).toContain('failed');
      }
    } finally {
      await closeHarness(harness);
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
