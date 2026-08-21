// tests/unit/purser/cleanup-sigint.test.ts
import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('pd learn cleanup on SIGINT', () => {
  const scriptPath = resolve(__dirname, 'tmp-sigint-test.ts');
  const tutorialImport = `import { handleLearn } from '${resolve(__dirname, '..', '..', 'cli', 'commands', 'tutorial.ts')}';\nawait handleLearn();\n`;

  beforeAll(() => {
    writeFileSync(scriptPath, tutorialImport, 'utf8');
  });

  afterAll(() => {
    try {
      unlinkSync(scriptPath);
    } catch {}
  });

  test('cleanup runs when SIGINT is sent and process exits cleanly', async () => {
    // Spawn a child process that runs the tutorial command
    const child = spawn('bun', [scriptPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Capture stderr for later inspection
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    // Give the child a moment to start and register the SIGINT handler
    await new Promise((r) => setTimeout(r, 200));

    // Send SIGINT
    child.kill('SIGINT');

    // Wait for the child to exit
    const exitCode = await new Promise<number>((resolve, reject) => {
      child.on('close', resolve);
      child.on('error', reject);
    });

    // Expect the child to exit with code 0 (handled SIGINT)
    expect(exitCode).toBe(0);

    // The stderr should contain the interruption message produced by the SIGINT handler
    expect(stderr).toMatch(/Tutorial interrupted/);

    // No fatal errors should have been logged during cleanup
    expect(stderr).not.toMatch(/Could not reach daemon/);
    expect(stderr).not.toMatch(/error/i);
  });
});