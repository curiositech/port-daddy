// tests/unit/purser/test_hook_prompt_injection_attacks.test.ts
import { execFileSync } from 'node:child_process';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

/**
 * Resolve the absolute path to the `pd-hook-prompt` script.
 * This works in ESM (`type: "module"`) environments.
 */
function getHookScriptPath(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  // ../../.. goes from tests/unit/purser to the repository root, then bin/pd-hook-prompt
  return resolve(__dirname, '../../../bin/pd-hook-prompt');
}

/**
 * Execute the hook script with a custom environment.
 * Returns the trimmed stdout string.
 */
function runHook(env: NodeJS.ProcessEnv): string {
  const script = getHookScriptPath();
  const out = execFileSync('bash', [script], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return out.trim();
}

/**
 * Starts a tiny HTTP server that always returns the supplied JSON payload.
 * Returns the listening port and a close function.
 */
async function startMockDaemon(jsonPayload: unknown): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  const server = createServer((_req: IncomingMessage, res: ServerResponse) => {
    const body = JSON.stringify(jsonPayload);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Unable to obtain server address');
  }
  const port = address.port;

  return {
    port,
    close: () =>
      new Promise((resolveClose) => {
        server.close(() => resolveClose());
      }),
  };
}

/**
 * Utility to repeat a character N times.
 */
function repeatChar(ch: string, length: number): string {
  return ch.repeat(length);
}

/* -------------------------------------------------------------------------- */
/*                               TEST SUITE                                   */
/* -------------------------------------------------------------------------- */

describe('bin/pd-hook-prompt – injection‑hardening and sanitisation', () => {
  test('injects a well‑formed claim‑tree trouble payload', async () => {
    const daemon = await startMockDaemon({
      suggestions: [
        {
          kind: 'claim-tree-trouble',
          payload: {
            state: 'VERIFY',
            filePath: 'src/main.ts',
            action: 'run test',
            mermaid: 'graph TD; A-->B',
          },
        },
      ],
    });

    const out = runHook({
      SELF: 'agent123',
      DAEMON_URL: `http://127.0.0.1:${daemon.port}`,
      ENTRIES: '',
    });

    await daemon.close();

    expect(out).toContain('[PORT DADDY — CLAIM-TREE TROUBLE]');
    expect(out).toContain('State: VERIFY');
    expect(out).toContain('Surface: src/main.ts');
    expect(out).toContain('Action: run test');
    expect(out).toContain('graph TD; A-->B');
  });

  test('rejects SELF containing unsafe characters (no claim‑tree output)', async () => {
    const daemon = await startMockDaemon({
      suggestions: [
        {
          kind: 'claim-tree-trouble',
          payload: {
            state: 'VERIFY',
            filePath: 'src/main.ts',
            action: 'run test',
            mermaid: 'graph TD; A-->B',
          },
        },
      ],
    });

    const out = runHook({
      SELF: 'bad; rm -rf /',
      DAEMON_URL: `http://127.0.0.1:${daemon.port}`,
      ENTRIES: '',
    });

    await daemon.close();

    // Unsafe SELF should suppress any claim‑tree block.
    expect(out).not.toContain('[PORT DADDY — CLAIM-TREE TROUBLE]');
    // The script should still exit cleanly with empty output.
    expect(out).toBe('');
  });

  test('truncates overly long filePath to ≤96 printable chars with leading ellipsis', async () => {
    const longPath = repeatChar('a', 150);
    const daemon = await startMockDaemon({
      suggestions: [
        {
          kind: 'claim-tree-trouble',
          payload: {
            state: 'RESCUE',
            filePath: longPath,
            action: 'fix',
            mermaid: 'graph TD; A-->B',
          },
        },
      ],
    });

    const out = runHook({
      SELF: 'agent123',
      DAEMON_URL: `http://127.0.0.1:${daemon.port}`,
      ENTRIES: '',
    });

    await daemon.close();

    const surfaceLine = out
      .split('\n')
      .find((l) => l.startsWith('Surface:')) ?? '';
    const displayedPath = surfaceLine.replace(/^Surface: /, '');

    // Must contain an ellipsis and be ≤96 chars.
    expect(displayedPath).toContain('…');
    expect(displayedPath.length).toBeLessThanOrEqual(96);

    // Tail should be the last 93 chars of the original path.
    const expectedTail = longPath.slice(-93);
    expect(displayedPath.endsWith(expectedTail)).toBe(true);
  });

  test('enforces action length limit of 140 printable characters', async () => {
    const longAction = repeatChar('b', 200);
    const daemon = await startMockDaemon({
      suggestions: [
        {
          kind: 'claim-tree-trouble',
          payload: {
            state: 'COORDINATE',
            filePath: 'src/file.ts',
            action: longAction,
            mermaid: 'graph TD; A-->B',
          },
        },
      ],
    });

    const out = runHook({
      SELF: 'agent123',
      DAEMON_URL: `http://127.0.0.1:${daemon.port}`,
      ENTRIES: '',
    });

    await daemon.close();

    const actionLine = out
      .split('\n')
      .find((l) => l.startsWith('Action:')) ?? '';
    const displayedAction = actionLine.replace(/^Action: /, '');

    // Should be truncated to 140 characters.
    expect(displayedAction.length).toBeLessThanOrEqual(140);
    expect(displayedAction).toBe(longAction.slice(0, 140));
  });

  test('omits oversized mermaid graph and inserts placeholder message', async () => {
    const hugeMermaid = repeatChar('c', 300);
    const daemon = await startMockDaemon({
      suggestions: [
        {
          kind: 'claim-tree-trouble',
          payload: {
            state: 'WATCH',
            filePath: 'src/file.ts',
            action: 'observe',
            mermaid: hugeMermaid,
          },
        },
      ],
    });

    const out = runHook({
      SELF: 'agent123',
      DAEMON_URL: `http://127.0.0.1:${daemon.port}`,
      ENTRIES: '',
    });

    await daemon.close();

    // Placeholder defined by the script.
    expect(out).toContain(
      '(Mermaid omitted from this bounded turn, inspect the durable claim-tree suggestion.)',
    );
    // Original huge mermaid must not appear.
    expect(out).not.toContain(hugeMermaid);
  });

  test('silently skips payloads missing a state field', async () => {
    const daemon = await startMockDaemon({
      suggestions: [
        {
          kind: 'claim-tree-trouble',
          payload: {
            // state omitted on purpose
            filePath: 'src/file.ts',
            action: 'do nothing',
            mermaid: 'graph TD; A-->B',
          },
        },
      ],
    });

    const out = runHook({
      SELF: 'agent123',
      DAEMON_URL: `http://127.0.0.1:${daemon.port}`,
      ENTRIES: '',
    });

    await daemon.close();

    // No claim‑tree block should be emitted.
    expect(out).not.toContain('[PORT DADDY — CLAIM-TREE TROUBLE]');
    expect(out).toBe('');
  });
});