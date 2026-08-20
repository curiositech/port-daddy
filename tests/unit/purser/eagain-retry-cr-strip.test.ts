import { test, expect } from 'bun:test';
import { readLineFromControllingTerminal, type ControllingTerminalFsOps } from '../../../cli/utils/tty.ts';

function errno(code: string): NodeJS.ErrnoException {
  const err = new Error(code) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

function opsReturning(chunks: Array<string | NodeJS.ErrnoException>, log: string[] = []): ControllingTerminalFsOps & { log: string[] } {
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
      if (next === undefined) return 0;
      if (next instanceof Error) throw next;
      const bytes = Buffer.from(next, 'utf8');
      const take = Math.min(length, bytes.length);
      bytes.copy(buffer, offset, 0, take);
      return take;
    },
    closeSync(fd: number) {
      log.push(`close:${fd}`);
    },
    sleep(ms: number) {
      log.push(`sleep:${ms}`);
    },
  };
}

test('retrys on EAGAIN/EINTR/EWOULDBLOCK with backoff', () => {
  const log: string[] = [];
  const ops = opsReturning([errno('EAGAIN'), errno('EINTR'), errno('EWOULDBLOCK'), 'ok\n'], log);
  const line = readLineFromControllingTerminal(ops);
  expect(line).toBe('ok');
  const sleepLogs = log.filter((l) => l.startsWith('sleep:'));
  expect(sleepLogs).toEqual(['sleep:10', 'sleep:10', 'sleep:10']);
  const readLogs = log.filter((l) => l.startsWith('read:'));
  for (const r of readLogs) {
    expect(r).toContain('position=null');
  }
});

test('strips CR from terminal input', () => {
  const log: string[] = [];
  const ops = opsReturning(['yes\r\n'], log);
  const line = readLineFromControllingTerminal(ops);
  expect(line).toBe('yes');
});

test('closes fd exactly once', () => {
  const log: string[] = [];
  const ops = opsReturning(['foo\n'], log);
  readLineFromControllingTerminal(ops);
  const closeLogs = log.filter((l) => l.startsWith('close:'));
  expect(closeLogs).toEqual(['close:42']);
});