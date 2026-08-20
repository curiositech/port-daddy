// tests/unit/purser/eof-null.test.ts
import { describe, expect, test } from 'bun:test';
import { readLineFromControllingTerminal, type ControllingTerminalFsOps } from '../../../cli/utils/tty.ts';

/**
 * Helper that creates fake fs ops that return the given chunks (or errors) on each
 * readSync call. The chunks are served in order, with partial reads preserved
 * across subsequent calls. The ops also record a log of actions for assertions.
 */
function opsReturning(
  chunks: Array<string | Error>,
  log: string[] = [],
): ControllingTerminalFsOps & { log: string[] } {
  const pending = [...chunks];
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

describe('readLineFromControllingTerminal EOF handling', () => {
  test('returns null when /dev/tty cannot be opened', () => {
    const ops: ControllingTerminalFsOps & { log: string[] } = {
      log: [],
      openSync(path: string) {
        throw errno('ENOENT');
      },
      readSync: () => 0,
      closeSync: () => {},
    };
    const line = readLineFromControllingTerminal(ops);
    expect(line).toBeNull();
    expect(ops.log).toContain('open:/dev/tty');
  });

  test('returns null on EOF after an empty read', () => {
    const ops = opsReturning([]);
    const line = readLineFromControllingTerminal(ops);
    expect(line).toBeNull();
    expect(ops.log).toContain('close:42');
  });

  test('returns empty string on bare Enter (no characters before newline)', () => {
    const ops = opsReturning(['\n']);
    const line = readLineFromControllingTerminal(ops);
    expect(line).toBe('');
    // The read must have passed position null, ensuring the ENXIO fix
    expect(ops.log.some((l) => l.startsWith('read:') && l.includes('position=null'))).toBeTruthy();
  });

  test('returns null when readSync throws a fatal error before any input', () => {
    const ops = opsReturning([errno('ENXIO')]);
    const line = readLineFromControllingTerminal(ops);
    expect(line).toBeNull();
    // Even though we threw, the fd should be closed exactly once
    expect(ops.log).toContain('close:42');
  });

  test('returns null only when no data was read before EOF', () => {
    // Simulate a partial line followed by EOF (no newline). The function
    // should return the partial line, not null.
    const ops = opsReturning(['partial']);
    const line = readLineFromControllingTerminal(ops);
    expect(line).toBe('partial');
  });
});