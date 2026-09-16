import { afterEach, describe, expect, test } from '@jest/globals';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const SCRATCH_PARENT = join(homedir(), 'coding', 'tmp');
const scratchDirs = [];

afterEach(() => {
  for (const dir of scratchDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function runCommand(command, daemonUrl, pdHome) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(ROOT, 'bin', 'port-daddy-cli.js'), command], {
      cwd: ROOT,
      env: {
        ...process.env,
        CI: '1',
        NO_COLOR: '1',
        PD_HOME: pdHome,
        PORT_DADDY_NON_INTERACTIVE: '1',
        PORT_DADDY_NO_RETRY: '1',
        PORT_DADDY_NO_UPDATE_CHECK: '',
        PORT_DADDY_SOCK: join(pdHome, 'missing-daemon.sock'),
        PORT_DADDY_URL: daemonUrl,
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

describe.each(['learn', 'tutorial'])('pd %s whole-command contract', (command) => {
  test('skips update cache/probes and emits exactly one disclosed usage event', async () => {
    const requests = [];
    const server = createServer((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        requests.push({ method: request.method, url: request.url, body });
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end('{"success":true}');
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('fake daemon did not bind');

    mkdirSync(SCRATCH_PARENT, { recursive: true });
    const pdHome = mkdtempSync(join(SCRATCH_PARENT, `pd-${command}-contract-`));
    scratchDirs.push(pdHome);

    try {
      const result = await runCommand(command, `http://127.0.0.1:${address.port}`, pdHome);
      const output = `${result.stdout}\n${result.stderr}`;

      expect(result.status).toBe(0);
      expect(existsSync(join(pdHome, 'update-check.json'))).toBe(false);
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({ method: 'POST', url: '/usage/trace' });
      expect(JSON.parse(requests[0].body)).toMatchObject({
        surface: 'cli',
        kind: 'command',
        name: `pd ${command}`,
        status: 'ok',
        metadata: { command },
      });
      expect(output).toContain('Headless orientation: live probing is intentionally skipped.');
      expect(output).toContain('CLI envelope now makes one append-only usage-telemetry attempt.');
    } finally {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  }, 15_000);
});
