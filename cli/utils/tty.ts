/**
 * Canonical terminal detection for the CLI.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHY THIS EXISTS — the bun-compiled-binary TTY trap.
 * ─────────────────────────────────────────────────────────────────────────
 * The Homebrew `pd` ships as a `bun build --compile` binary. In that runtime
 * `process.stdin.isTTY` / `process.stdout.isTTY` can be `undefined`/`false`
 * even on a real interactive terminal (bun doesn't always initialise the std
 * streams as TTY streams the way node does — same class as nodejs/node#2160).
 *
 * Keying interactivity off the stream `.isTTY` flag therefore mis-fires under
 * the binary every operator actually runs: `pd secret set` silently no-op'd
 * (#205), `pd tube --send` hung waiting on stdin EOF, `pd feedback` mis-routed
 * to the pipe path, and `pd tutorial` auto-skipped every prompt.
 *
 * The fix is to ask the *kernel* whether a file descriptor is a terminal via
 * `tty.isatty(fd)` instead of trusting the stream flag. `isatty` is injectable
 * on the predicates so tests can pin precedence without a real tty.
 *
 * Anything in `cli/` that needs to know "is this interactive?" MUST come
 * through here — never read `process.stdin.isTTY` directly. A lint test
 * (`tests/unit/no-raw-stdin-istty.test.js`) enforces that.
 */
import * as tty from 'node:tty';
import { openSync, closeSync, readSync } from 'node:fs';

/** Kernel-level "is this fd a terminal", robust under the bun-compiled binary. */
export function fdIsTTY(fd: number, isatty: (fd: number) => boolean = tty.isatty): boolean {
  try {
    return isatty(fd);
  } catch {
    // isatty can throw on exotic / closed fds — treat as "not a terminal".
    return false;
  }
}

/**
 * True when stdin (fd 0) is an interactive terminal.
 *
 * Prefers the kernel `tty.isatty(0)` (correct under the compiled binary, where
 * `stream.isTTY` is often falsy on a real terminal) and falls back to the
 * stream flag. Returns `false` for pipes/redirects/CI — so a piped value still
 * takes the non-interactive path and never blocks on a human.
 */
export function isStdinInteractive(
  stream: { isTTY?: boolean } = process.stdin,
  isatty: (fd: number) => boolean = tty.isatty,
): boolean {
  if (fdIsTTY(0, isatty)) return true;
  return stream.isTTY === true;
}

/**
 * True when output (stdout or stderr) is an interactive terminal. Used to gate
 * colour and prompts. Prefers kernel `isatty(1)/isatty(2)`, falls back to the
 * stream flags.
 */
export function isStdoutInteractive(isatty: (fd: number) => boolean = tty.isatty): boolean {
  if (fdIsTTY(1, isatty) || fdIsTTY(2, isatty)) return true;
  return (process.stdout.isTTY ?? false) || (process.stderr.isTTY ?? false);
}

/**
 * The `fs` primitives `readLineFromControllingTerminal` needs, injectable so
 * tests can pin the read contract without a real terminal.
 */
export interface ControllingTerminalFsOps {
  openSync(path: string, flags: string): number;
  readSync(fd: number, buffer: Buffer, offset: number, length: number, position: number | null): number;
  closeSync(fd: number): void;
}

const NODE_CTTY_FS: ControllingTerminalFsOps = { openSync, readSync, closeSync };

/** Block the thread for `ms` without an event-loop turn (we are waiting on a human). */
function sleepSync(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    // SharedArrayBuffer unavailable — spin briefly rather than fail the read.
  }
}

/**
 * Read one line from the controlling terminal (`/dev/tty`), blocking until the
 * operator hits Enter.
 *
 * Use this — never a stream over a `/dev/tty` fd — whenever a CLI command must
 * wait on a human. Reading the terminal as a *stream* is what crashed
 * `pd learn`: `fs.createReadStream('', { fd })` issues positional reads, and a
 * positional read of a character device is `ENXIO` under the bun-compiled
 * binary the operator actually runs. The stream also had to be torn down, and
 * destroying it alongside `closeSync(fd)` double-closed the fd, which surfaced
 * under node as an unhandled `EBADF` error event at the *next* prompt.
 *
 * A blocking `readSync` loop with `position: null` avoids both: no positional
 * read, and exactly one `close`. Blocking the event loop is correct here — the
 * whole point is that nothing should proceed until the operator answers.
 *
 * @returns the line without its trailing newline (`''` for a bare Enter), or
 *   `null` when no answer could be read at all — `/dev/tty` unopenable (no
 *   controlling terminal), a hard read error, or EOF before any input. Callers
 *   MUST treat `null` as "nobody answered" and fall back rather than as
 *   consent; an EOF read as an empty line is how #207's auto-skip happened.
 */
export function readLineFromControllingTerminal(
  fs: ControllingTerminalFsOps = NODE_CTTY_FS,
): string | null {
  let fd: number;
  try {
    fd = fs.openSync('/dev/tty', 'r');
  } catch {
    return null;
  }

  const buf = Buffer.alloc(256);
  let line = '';
  let sawNewline = false;

  try {
    for (;;) {
      let read: number;
      try {
        // position MUST be null: a positional read of a tty is ENXIO on Darwin.
        read = fs.readSync(fd, buf, 0, buf.length, null);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        // A non-blocking or signal-interrupted tty — keep waiting on the human.
        if (code === 'EAGAIN' || code === 'EINTR' || code === 'EWOULDBLOCK') {
          sleepSync(10);
          continue;
        }
        return null;
      }
      if (read === 0) break; // EOF — terminal went away
      line += buf.toString('utf8', 0, read);
      const nl = line.indexOf('\n');
      if (nl !== -1) {
        line = line.slice(0, nl);
        sawNewline = true;
        break;
      }
    }
  } finally {
    try { fs.closeSync(fd); } catch { /* best effort */ }
  }

  if (!sawNewline && line === '') return null;
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}
