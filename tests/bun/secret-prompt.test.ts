/**
 * Regression test for the `pd secret set` silent-no-op bug under the
 * `bun build --compile` CLI binary.
 *
 * RUNTIME: `bun test` only. The bug was bun-runtime-specific: under the
 * Homebrew `pd` (a compiled bun binary) `process.stdin.isTTY` can be
 * undefined/false even on a real terminal (same class as nodejs/node#2160),
 * so `promptHiddenValue` took the non-TTY branch, hit immediate EOF, resolved
 * null, and exited with NO prompt drawn — the operator perceived it as an
 * instant no-op that stored nothing. The dev runtime (node/tsx) never saw it.
 *
 * This file pins the two contracts that matter under the real bun runtime:
 *
 *   1. The non-TTY / pipe path persists a value: feeding one line through
 *      `readSecretFromStream` returns that line trimmed (so
 *      `printf %s "$TOKEN" | pd secret set KEY` round-trips with no argv leak).
 *   2. The no-value case is a LOUD failure, never a silent success:
 *      - an empty pipe resolves `null` from the stream reader, AND
 *      - `handleSecretSet` with a key but no value exits NON-ZERO and never
 *        reaches the POST /secrets call. (Pre-fix the symptom was a no-op
 *        exit; this guards that the command can never exit 0 having stored
 *        nothing.)
 */

import { describe, expect, test } from 'bun:test';
import { Readable } from 'node:stream';
import { readSecretFromStream, isStdinInteractive } from '../../cli/commands/secret.ts';

function streamOf(...lines: string[]): Readable {
  // Readable.from emits the buffer then EOF, mirroring a finite pipe such as
  // `printf %s "$TOKEN" | pd secret set KEY`.
  return Readable.from([lines.join('')]);
}

describe('pd secret set — bun-runtime prompt contract', () => {
  test('pipe path persists the value (round-trips one line, trimmed)', async () => {
    const value = await readSecretFromStream(streamOf('cf-token-abc123\n'));
    expect(value).toBe('cf-token-abc123');
  });

  test('pipe path with no trailing newline still yields the value', async () => {
    const value = await readSecretFromStream(streamOf('no-newline-token'));
    expect(value).toBe('no-newline-token');
  });

  test('pipe path trims surrounding whitespace (shell echo artifacts)', async () => {
    const value = await readSecretFromStream(streamOf('  spaced-token  \n'));
    expect(value).toBe('spaced-token');
  });

  test('interactivity follows tty.isatty(0), NOT the stream flag (the fix)', () => {
    // This is the exact bun-compiled shape: fd 0 IS a terminal, but the stream
    // flag is falsy. Pre-fix the code keyed off the flag and wrongly took the
    // pipe branch (→ silent no-op). The fix trusts the kernel: interactive.
    expect(isStdinInteractive({ isTTY: undefined }, () => true)).toBe(true);
    expect(isStdinInteractive({ isTTY: false }, () => true)).toBe(true);
    // Genuine pipe/CI: fd 0 is not a tty and flag is falsy → not interactive.
    expect(isStdinInteractive({ isTTY: false }, () => false)).toBe(false);
    expect(isStdinInteractive({ isTTY: undefined }, () => false)).toBe(false);
    // Node-style real tty (flag true) is interactive regardless of isatty err.
    expect(isStdinInteractive({ isTTY: true }, () => { throw new Error('boom'); })).toBe(true);
  });

  test('empty pipe (immediate EOF) resolves null — the no-op symptom, surfaced', async () => {
    const value = await readSecretFromStream(streamOf());
    expect(value).toBeNull();
  });

  test('handleSecretSet with no value entered exits NON-ZERO and never POSTs', async () => {
    // Force the non-TTY branch with an empty pipe so promptHiddenValue resolves
    // null (the exact pre-fix failure mode), then assert the command refuses
    // loudly rather than silently succeeding.
    const secret = await import('../../cli/commands/secret.ts');

    const realStdin = Object.getOwnPropertyDescriptor(process, 'stdin')!;
    const realExit = process.exit;
    const realFetch = globalThis.fetch;

    let exitCode: number | undefined;
    let fetchCalled = false;

    // Empty, non-TTY stdin → promptHiddenValue() must take the pipe branch and
    // get immediate EOF.
    const emptyStdin = Readable.from([]) as unknown as NodeJS.ReadStream;
    (emptyStdin as { isTTY?: boolean }).isTTY = false;
    Object.defineProperty(process, 'stdin', { value: emptyStdin, configurable: true });

    // Trip-wire: if the command reaches the network it has failed the contract.
    globalThis.fetch = (async () => {
      fetchCalled = true;
      throw new Error('fetch must not be called when no value was entered');
    }) as typeof fetch;

    // process.exit(1) is how the command signals the loud failure. Capture it
    // instead of killing the test runner.
    class ExitSignal extends Error {
      constructor(public code: number) {
        super(`process.exit(${code})`);
      }
    }
    process.exit = ((code?: number) => {
      exitCode = code ?? 0;
      throw new ExitSignal(exitCode);
    }) as typeof process.exit;

    try {
      await secret.handleSecret(['set', 'CLOUDFLARE_API_TOKEN'], {} as never);
      // If we get here with no exit thrown, the command "succeeded" with no
      // value — exactly the silent no-op we are guarding against.
      throw new Error('handleSecret returned without exiting — silent no-op regression');
    } catch (err) {
      if (!(err instanceof ExitSignal)) throw err;
    } finally {
      Object.defineProperty(process, 'stdin', realStdin);
      process.exit = realExit;
      globalThis.fetch = realFetch;
    }

    expect(exitCode).toBeGreaterThan(0); // non-zero — loud failure
    expect(fetchCalled).toBe(false); // never hit the network with an empty secret
  });
});
