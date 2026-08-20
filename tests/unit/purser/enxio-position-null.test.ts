// tests/unit/purser/enxio-position-null.test.ts
import { describe, expect, test } from 'bun:test';
import { readLineFromControllingTerminal, ControllingTerminalFsOps } from '../../../cli/utils/tty.ts';

/** Helper to create errno exception objects. */
function errno(code: string): NodeJS.ErrnoException {
  const err = new Error(code) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

/** Builds a fake fs ops that records every read position and simulates a
 * sequence of responses (strings or errors). */
function opsReturning(
  responses: Array<string | Error>,
): ControllingTerminalFsOps & { positions: (number | null)[]; closeCalled: number } {
  const pending = [...responses];
  const ops: ControllingTerminalFsOps & { positions: (number | null)[]; closeCalled: number } = {
    openSync: (_path: string) => 42,
    readSync: (_fd: number, buffer: Buffer, offset: number, length: number, position: number | null) => {
      ops.positions.push(position);
      const next = pending.shift();
      if (next === undefined) return 0; // EOF
      if (next instanceof Error) throw next;
      const bytes = Buffer.from(next, 'utf8');
      const take = Math.min(length, bytes.length);
      if (take < bytes.length) pending.unshift(bytes.subarray(take).toString('utf8'));
      bytes.copy(buffer, offset, 0, take);
      return take;
    },
    closeSync: () => {
      ops.closeCalled++;
    },
    positions: [],
    closeCalled: 0,
  };
  return ops;
}

describe('readLineFromControllingTerminal – ENXIO & position contract', () => {
  test('returns null when /dev/tty read throws ENXIO', () => {
    const ops = opsReturning([errno('ENXIO')]);
    const result = readLineFromControllingTerminal(ops);
    expect(result).toBeNull();
    expect(ops.positions).toEqual([null]); // only one read attempted
    expect(ops.closeCalled).toBe(1);
  });

  test('uses position: null for every read, even across multiple chunks', () => {
    const ops = opsReturning(['foo', 'bar\n']);
    const result = readLineFromControllingTerminal(ops);
    expect(result).toBe('foobar');
    // Two reads (one for 'foo', one for 'bar\n'), each with position null.
    expect(ops.positions).toEqual([null, null]);
    expect(ops.closeCalled).toBe(1);
  });

  test('retries on EAGAIN/EINTR/EWOULDBLOCK, backing off each time', () => {
    const slept: number[] = [];
    const ops = opsReturning([
      errno('EAGAIN'),
      errno('EINTR'),
      errno('EWOULDBLOCK'),
      'ok\n',
    ]);
    const result = readLineFromControllingTerminal(ops, {
      ...ops,
      sleep: (ms: number) => {
        slept.push(ms);
      },
    });
    expect(result).toBe('ok');
    // Four reads: three failures, one success.
    expect(ops.positions).toEqual([null, null, null, null]);
    // Each retry backs off 10ms.
    expect(slept).toEqual([10, 10, 10]);
    expect(ops.closeCalled).toBe(1);
  });

  test('strips carriage return when terminal sends CRLF', () => {
    const ops = opsReturning(['yes\r\n']);
    const result = readLineFromControllingTerminal(ops);
    expect(result).toBe('yes');
    expect(ops.positions).toEqual([null]);
    expect(ops.closeCalled).toBe(1);
  });

  test('returns null when EOF occurs before any input', () => {
    const ops = opsReturning(['']);
    const result = readLineFromControllingTerminal(ops);
    expect(result).toBeNull();
    // Two reads: first returns 0 bytes, second returns EOF.
    expect(ops.positions).toEqual([null, null]);
    expect(ops.closeCalled).toBe(1);
  });
});