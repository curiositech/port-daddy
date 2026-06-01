/**
 * Regression test for the `pd tube --send/--reply` HANG under the
 * `bun build --compile` CLI binary.
 *
 * RUNTIME: `bun test` only. Same root cause as the `pd secret set` no-op
 * (#205): under the Homebrew `pd` (a compiled bun binary) `stdin.isTTY` can be
 * undefined/false on a real terminal. `readStdinToEnd` used to gate solely on
 * `stdin.isTTY`, so an interactive `pd tube CH --send` (no pipe) did NOT throw
 * the helpful "pipe a body in" error — it fell through to `for await (chunk of
 * stdin)` and HUNG FOREVER waiting on an EOF that never comes.
 *
 * The fix routes the decision through the kernel-level `isStdinInteractive`
 * (cli/utils/tty.ts). These tests pin both branches with an injected predicate
 * so they're deterministic regardless of the test runner's real fd 0.
 */

import { describe, expect, test } from 'bun:test';
import { Readable } from 'node:stream';
import { readStdinToEnd } from '../../cli/commands/tube.ts';
import { isStdinInteractive } from '../../cli/utils/tty.ts';

describe('pd tube — bun-runtime stdin contract', () => {
  test('pipe path returns the piped body verbatim (the normal --send case)', async () => {
    // readStdinToEnd returns the raw bytes (the caller trims); the contract
    // under test is "a piped body is read", not whitespace handling.
    const body = await readStdinToEnd(Readable.from(['hello over the tube\n']), () => false);
    expect(body).toBe('hello over the tube\n');
  });

  test('multi-chunk pipe is concatenated in order', async () => {
    const body = await readStdinToEnd(Readable.from(['line 1\n', 'line 2\n']), () => false);
    expect(body).toBe('line 1\nline 2\n');
  });

  test('interactive terminal THROWS instead of hanging (the fix)', async () => {
    // A stream that never emits and never ends — exactly what an interactive
    // terminal looks like to `for await`. Pre-fix (isTTY falsy under compiled
    // bun) this hung forever; now an interactive predicate must short-circuit
    // to a thrown error BEFORE we ever await the stream.
    const neverEnds = new Readable({ read() { /* emits nothing, never EOFs */ } });
    await expect(readStdinToEnd(neverEnds, () => true)).rejects.toThrow(/needs a body on stdin/);
    neverEnds.destroy();
  });

  test('interactivity follows tty.isatty(0), NOT the stream flag', () => {
    // The compiled-bun shape: fd 0 IS a tty, stream flag is falsy → interactive
    // (so tube throws the helpful error rather than hanging).
    expect(isStdinInteractive({ isTTY: undefined }, () => true)).toBe(true);
    expect(isStdinInteractive({ isTTY: false }, () => true)).toBe(true);
    // Genuine pipe (the real --send case): not a tty, flag falsy → read it.
    expect(isStdinInteractive({ isTTY: false }, () => false)).toBe(false);
  });
});
