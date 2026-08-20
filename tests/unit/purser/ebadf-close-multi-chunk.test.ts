// the complete contents of tests/unit/purser/ebadf-close-multi-chunk.test.ts
import { describe, expect, test } from 'bun:test';
import { readLineFromControllingTerminal, type ControllingTerminalFsOps } from '../../../cli/utils/tty.ts';

/** Helper to create a fake FS operation set that returns the supplied chunks
 *  (or Errors) one readSync at a time.  It records the order of calls in `log`. */
function opsReturning(
  chunks: Array<string | Error>,
  log: string[] = [],
): ControllingTerminalFsOps & { log: string[] } {
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
      if (next === undefined) return 0; // EOF
      if (next instanceof Error) throw next;
      const bytes = Buffer.from(next, 'utf8');
      const take = Math.min(length, bytes.length);
      if (take < bytes.length) {
        // keep the remainder for the next read
        pending.unshift(bytes.subarray(take).toString('utf8'));
      }
      bytes.copy(buffer, offset, 0, take);
      return take;
    },
    closeSync(fd: number) {
      log.push(`close:${fd}`);
    },
  };
}

/** Helper to create an ErrnoException with the given code. */
function errno(code: string): NodeJS.ErrnoException {
  const err = new Error(code) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

describe('readLineFromControllingTerminal – EBADF handling and multi‑chunk assembly', () => {
  test('EBADF on close does not affect returned line', () => {
    const ops = opsReturning(['hello\n']);
    ops.closeSync = () => {
      throw errno('EBADF');
    };
    const line = readLineFromControllingTerminal(ops);
    expect(line).toBe('hello');
    // Ensure the close was attempted once
    expect(ops.log.filter((l) => l.startsWith('close:'))).toEqual(['close:42']);
  });

  test('multi‑chunk line assembly works', () => {
    const ops = opsReturning(['h', 'el', 'lo', '\n']);
    const line = readLineFromControllingTerminal(ops);
    expect(line).toBe('hello');
    // Multiple reads should have occurred
    const reads = ops.log.filter((l) => l.startsWith('read:'));
    expect(reads.length).toBeGreaterThan(1);
    // All reads should use a null position to avoid ENXIO
    reads.forEach((r) => expect(r).toContain('position=null'));
  });

  test('EBADF close with multi‑chunk does not corrupt the line', () => {
    const ops = opsReturning(['h', 'el', 'lo', '\n']);
    ops.closeSync = () => {
      throw errno('EBADF');
    };
    const line = readLineFromControllingTerminal(ops);
    expect(line).toBe('hello');
    // Verify close was attempted once
    expect(ops.log.filter((l) => l.startsWith('close:'))).toEqual(['close:42']);
  });

  test('partial reads across multiple chunks assemble correctly even with large buffer', () => {
    const long = 'x'.repeat(1024);
    const ops = opsReturning([`${long}\n`]);
    const line = readLineFromControllingTerminal(ops);
    expect(line).toBe(long);
    // Several reads should have been performed
    const reads = ops.log.filter((l) => l.startsWith('read:'));
    expect(reads.length).toBeGreaterThan(1);
  });
});