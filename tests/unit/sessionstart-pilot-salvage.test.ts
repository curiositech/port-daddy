import { afterEach, describe, expect, test } from '@jest/globals';
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';

const root = join(homedir(), 'coding', 'tmp', `pilot-salvage-${process.pid}`);
const project = join(root, 'salvage-fixture');
const script = join(process.cwd(), 'hooks', 'sessionstart-pilot.mjs');

function runHook(payload: object, env: NodeJS.ProcessEnv): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [script], { env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('close', (status) => resolveRun({ status, stdout, stderr }));
    child.stdin.end(JSON.stringify(payload));
  });
}

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('SessionStart Pilot salvage nudge', () => {
  test('appends a project-scoped salvage count while preserving base steering', async () => {
    mkdirSync(join(project, '.portdaddy'), { recursive: true });
    const server = createServer((req, res) => {
      expect(req.url).toBe('/salvage?project=salvage-fixture&limit=20');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ success: true, count: 2, agents: [{ id: 1 }, { id: 2 }] }));
    });
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const address = server.address() as { port: number };
    try {
      const r = await runHook({ cwd: project }, {
        ...process.env,
        PORT_DADDY_URL: `http://127.0.0.1:${address.port}`,
      });
      expect(r.status).toBe(0);
      const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext as string;
      expect(ctx).toContain('Port Daddy Pilot');
      expect(ctx).toContain('SALVAGE: 2 interrupted agent run(s)');
      expect(ctx).toContain('pd salvage --project salvage-fixture');
    } finally {
      server.close();
    }
  });

  test('daemon failure degrades to base steering instead of failing SessionStart', async () => {
    mkdirSync(join(project, '.portdaddy'), { recursive: true });
    const r = await runHook({ cwd: project }, {
      ...process.env,
      PORT_DADDY_URL: 'http://127.0.0.1:1',
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext as string;
    expect(ctx).toContain('Port Daddy Pilot');
    expect(ctx).not.toContain('SALVAGE:');
  });

  test('caps a full salvage page at 20+', async () => {
    mkdirSync(join(project, '.portdaddy'), { recursive: true });
    const server = createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ success: true, agents: Array.from({ length: 20 }, (_, id) => ({ id })) }));
    });
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const address = server.address() as { port: number };
    try {
      const r = await runHook({ cwd: project }, {
        ...process.env,
        PORT_DADDY_URL: `http://127.0.0.1:${address.port}`,
      });
      expect(JSON.parse(r.stdout).hookSpecificOutput.additionalContext).toContain('SALVAGE: 20+');
    } finally {
      server.close();
    }
  });
});
