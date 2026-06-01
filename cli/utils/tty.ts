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
import { openSync, closeSync, createReadStream } from 'node:fs';

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
 * Open the controlling terminal (`/dev/tty`) for reading. Use this when fd 0 is
 * a terminal (per `isStdinInteractive`) but the stdin *stream* is unreliable
 * under the compiled binary — reading from `/dev/tty` directly is robust where
 * `process.stdin` may hand back immediate EOF. Returns `null` if `/dev/tty`
 * cannot be opened (e.g. no controlling terminal), so callers fall back rather
 * than hang or no-op silently.
 */
export function openControllingTerminalInput(): { stream: NodeJS.ReadableStream; close: () => void } | null {
  let fd: number;
  try {
    fd = openSync('/dev/tty', 'r');
  } catch {
    return null;
  }
  const stream = createReadStream('', { fd, autoClose: false });
  return {
    stream,
    close: () => {
      try { stream.destroy(); } catch { /* best effort */ }
      try { closeSync(fd); } catch { /* best effort */ }
    },
  };
}
