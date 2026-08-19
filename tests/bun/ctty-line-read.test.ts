/**
 * Regression test for the `pd learn` CRASH at the first "Press Enter to
 * continue..." prompt.
 *
 * RUNTIME: `bun test` — the failure only reproduces under the runtime the
 * Homebrew `pd` actually ships (`bun build --compile`).
 *
 * WHAT BROKE. `pressEnter()` (cli/commands/tutorial.ts) read the controlling
 * terminal through `fs.createReadStream('', { fd })` on a `/dev/tty` fd. Bun
 * services that stream with positional reads, and a positional read of a
 * character device fails on Darwin:
 *
 *     ENXIO: no such device or address, read
 *       fd: 12, syscall: "read", errno: -6, code: "ENXIO"
 *
 * Node tolerated the stream but hit a second defect: the helper's `close()`
 * called `stream.destroy()` AND `closeSync(fd)`, so the fd was closed twice and
 * the ReadStream emitted an unhandled `EBADF` error event one tick later,
 * killing the tutorial at the NEXT prompt.
 *
 * THE FIX. `readLineFromControllingTerminal()` (cli/utils/tty.ts) does a
 * blocking, NON-positional `fs.readSync` loop against `/dev/tty` and closes the
 * fd exactly once. Both properties are pinned below with injected fs ops, and
 * the whole path is exercised end-to-end against a real pty.
 */

import { describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { readLineFromControllingTerminal, sleepSync, type ControllingTerminalFsOps } from '../../cli/utils/tty.ts';

/**
 * Injectable fs ops that hand back `chunks` one readSync at a time.
 *
 * Modelled on a real fd: a chunk larger than the caller's buffer is served in
 * buffer-sized bites with the remainder held for the next read, never
 * truncated. A fake that dropped the tail would hide exactly the long-line bug
 * it is meant to rule out.
 */
function opsReturning(chunks: Array<string | Error>, log: string[] = []): ControllingTerminalFsOps & { log: string[] } {
  const pending: Array<string | Error> = [...chunks];
  return {
    log,
    openSync(path: string) {
      log.push(`open:${path}`);
      return 42;
    },
    readSync(fd: number, buffer: Buffer, offset: number, length: number, position: number | null) {
      log.push(`read:fd=${fd}:position=${position === null ? 'null' : String(position)}`);
      const next = pending.shift();
      if (next === undefined) return 0; // EOF once the script is exhausted
      if (next instanceof Error) throw next;
      const bytes = Buffer.from(next, 'utf8');
      const take = Math.min(length, bytes.length);
      if (take < bytes.length) pending.unshift(bytes.subarray(take).toString('utf8'));
      bytes.copy(buffer, offset, 0, take);
      return take;
    },
    closeSync(fd: number) {
      log.push(`close:${fd}`);
    },
  };
}

function errno(code: string): NodeJS.ErrnoException {
  const err = new Error(code) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

describe('readLineFromControllingTerminal — bun-runtime /dev/tty contract', () => {
  test('reads a line without a positional read (the ENXIO fix)', () => {
    // The whole bug: a positional read of a tty is ENXIO under bun. Every read
    // must pass position === null so the kernel does a plain sequential read.
    const ops = opsReturning(['aye\n']);
    expect(readLineFromControllingTerminal(ops)).toBe('aye');
    const reads = ops.log.filter((l) => l.startsWith('read:'));
    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) expect(read).toContain('position=null');
  });

  test('closes the fd exactly once (the EBADF fix)', () => {
    const ops = opsReturning(['aye\n']);
    readLineFromControllingTerminal(ops);
    expect(ops.log.filter((l) => l.startsWith('close:'))).toEqual(['close:42']);
  });

  test('a bare Enter reads as an empty line, not as "no answer"', () => {
    // `pressEnter()` and the doctor's [Y/n] both depend on this distinction:
    // '' means the operator hit Enter, null means we never got an answer.
    expect(readLineFromControllingTerminal(opsReturning(['\n']))).toBe('');
  });

  test('assembles a line split across several reads', () => {
    expect(readLineFromControllingTerminal(opsReturning(['mig', 'rate', ' now\n']))).toBe('migrate now');
  });

  test('assembles a line far longer than the 256-byte read buffer', () => {
    // The buffer is per-READ, not per-line: the loop keeps reading until it
    // sees a newline. A 1 KiB answer must survive intact across ~4 reads.
    const long = 'x'.repeat(1024);
    const ops = opsReturning([`${long}\n`]);
    expect(readLineFromControllingTerminal(ops)).toBe(long);
    // And it really did take several reads to get there.
    expect(ops.log.filter((l) => l.startsWith('read:')).length).toBeGreaterThan(1);
  });

  test('stops at the first newline and ignores trailing input', () => {
    expect(readLineFromControllingTerminal(opsReturning(['yes\nno\n']))).toBe('yes');
  });

  test('strips the CR a raw-mode terminal sends with Enter', () => {
    expect(readLineFromControllingTerminal(opsReturning(['yes\r\n']))).toBe('yes');
  });

  test('retries on EAGAIN instead of giving up, backing off each time', () => {
    // The backoff is not decorative: without it the retry is a hot loop that
    // pins a core for as long as the operator takes to answer.
    const slept: number[] = [];
    const ops = opsReturning([errno('EAGAIN'), errno('EINTR'), errno('EWOULDBLOCK'), 'ok\n']);
    ops.sleep = (ms) => { slept.push(ms); };
    expect(readLineFromControllingTerminal(ops)).toBe('ok');
    expect(slept).toEqual([10, 10, 10]);
  });

  test('sleepSync actually waits, with or without SharedArrayBuffer', () => {
    // pd-code-reviewer flagged the Atomics.wait/SharedArrayBuffer dependency.
    // Whichever branch this runtime takes, the contract is the same: it blocks
    // for roughly the requested interval and never throws.
    const started = Date.now();
    expect(() => sleepSync(25)).not.toThrow();
    expect(Date.now() - started).toBeGreaterThanOrEqual(20);
  });

  test('returns null when /dev/tty cannot be opened (no controlling terminal)', () => {
    const ops = opsReturning([]);
    ops.openSync = () => { throw errno('ENXIO'); };
    // null — NOT '' — so callers fall back to stdin rather than treating a
    // missing terminal as a silent "yes".
    expect(readLineFromControllingTerminal(ops)).toBeNull();
  });

  test('returns null on immediate EOF so a dead terminal is not read as consent', () => {
    // The #207 auto-skip shape: an EOF must never look like "the operator
    // pressed Enter", or `pd doctor` would apply fixes nobody approved.
    expect(readLineFromControllingTerminal(opsReturning([]))).toBeNull();
  });

  test('returns null on a hard read error', () => {
    expect(readLineFromControllingTerminal(opsReturning([errno('EIO')]))).toBeNull();
  });
});

/**
 * End-to-end proof against a REAL terminal. `script` allocates a pty, so the
 * probe's `/dev/tty` is a genuine character device — the exact condition that
 * produced ENXIO under bun and EBADF under node.
 */
describe('readLineFromControllingTerminal — real pty', () => {
  test('reads a line typed at a real /dev/tty under bun', async () => {
    const probe = join(import.meta.dir, 'fixtures', 'ctty-read-probe.ts');
    const bun = process.execPath;
    // util-linux `script` needs -c; BSD/macOS `script` takes the argv directly.
    // Both are driven from a shell pipeline: `script` calls tcgetattr on its own
    // stdin and refuses a socketpair, which is what child_process hands it.
    const run = process.platform === 'darwin'
      ? `script -q /dev/null ${bun} ${probe}`
      : `script -qec '${bun} ${probe}' /dev/null`;
    // Re-send while the probe boots: the pty EOFs as soon as the writer closes,
    // and an EOF before the probe opens /dev/tty reads as "no answer".
    const feed = `for i in 1 2 3 4 5 6 7 8; do printf 'steady as she goes\\r'; sleep 0.4; done`;

    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn('sh', ['-c', `(${feed}) | ${run}`], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`timed out; saw: ${out}`)); }, 30_000);
      child.stdout.on('data', (d) => { out += String(d); });
      child.stderr.on('data', (d) => { out += String(d); });
      child.on('error', (err) => { clearTimeout(timer); reject(err); });
      child.on('close', () => { clearTimeout(timer); resolve(out); });
    });

    expect(output).toContain('PROBE_RESULT:"steady as she goes"');
    expect(output).not.toContain('ENXIO');
    expect(output).not.toContain('EBADF');
  }, 40_000);
});
