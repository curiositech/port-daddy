// tests/unit/purser/egress-error-handling.test.ts
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GUARD_PATH = join(__dirname, '..', '..', 'helpers', 'egress-guard.mjs');

// Helper to read a JSONL log, skipping malformed lines
function readConnects(logPath: string) {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// Test 1: PD_EGRESS_LOG points to an invalid path (non‑existent directory)
describe('egress-guard error handling', () => {
  test('does not crash when PD_EGRESS_LOG is an invalid path', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'egress-test-'));
    const invalidLogPath = join(tempDir, 'nonexistent', 'log.jsonl'); // directory doesn't exist
    const child = spawnSync(process.execPath, ['-e', `
      const net = require('node:net');
      const s = net.connect({host:'127.0.0.1',port:9});
      s.on('error',()=>{});
      s.destroy();
    `], {
      env: { ...process.env, NODE_OPTIONS: \`--import ${GUARD_PATH}\`, PD_EGRESS_LOG: invalidLogPath },
      timeout: 5000,
    });

    // Guard should be loaded without throwing, and child should exit cleanly
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(0);

    // No log file should have been created
    expect(existsSync(invalidLogPath)).toBe(false);

    rmSync(tempDir, { recursive: true, force: true });
  });

  // Test 2: Missing guard file specified via NODE_OPTIONS
  test('fails with a clear error when guard file is missing', () => {
    const missingPath = join(tmpdir(), 'nonexistent-guard.mjs');
    const child = spawnSync(process.execPath, ['-e', 'process.exit(0);'], {
      env: { ...process.env, NODE_OPTIONS: \`--import ${missingPath}\` },
      timeout: 5000,
    });

    // Node should exit with a non‑zero code and emit a module resolution error
    expect(child.status).not.toBe(0);
    expect(child.stderr.toString()).toMatch(/Cannot find module|Cannot find file/i);
  });

  // Test 3: Corrupted JSONL log – guard writes a corrupt line
  test('reads log entries while skipping corrupt lines', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'egress-test-'));
    const logPath = join(tempDir, 'egress.jsonl');

    // Pre‑populate log with a valid and a corrupt line
    writeFileSync(logPath, JSON.stringify({ kind: 'guard-init', pid: 1234 }) + '\\n' + 'corrupt-line\\n');

    // Launch child that imports guard and performs a connection
    const child = spawnSync(process.execPath, ['-e', `
      const net = require('node:net');
      const s = net.connect({host:'127.0.0.1',port:9});
      s.on('error',()=>{});
      s.destroy();
    `], {
      env: { ...process.env, NODE_OPTIONS: \`--import ${GUARD_PATH}\`, PD_EGRESS_LOG: logPath },
      timeout: 5000,
    });

    expect(child.error).toBeUndefined();
    expect(child.status).toBe(0);

    const entries = readConnects(logPath);
    // One valid guard-init and one socket.connect record should be present
    const kinds = entries.map((e) => e.kind);
    expect(kinds).toContain('guard-init');
    expect(kinds).toContain('socket.connect');

    // The corrupt line should have been ignored
    expect(entries.length).toBe(2);

    rmSync(tempDir, { recursive: true, force: true });
  });
});