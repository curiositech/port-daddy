/**
 * cli/commands/secret.ts — `pd secret` suite.
 *
 * Manages daemon-held provider credentials in the OS keychain via the
 * /secrets routes. The store is the macOS Keychain (encrypted at rest,
 * fail-closed); see lib/secret-env.ts + lib/keychain.ts.
 *
 *   pd secret set <KEY> [--backend <b>]   hidden-prompt the value, POST it
 *   pd secret list                        names + status table (never values)
 *   pd secret reveal <KEY> [--copy]       fetch a value; --copy → pbcopy
 *   pd secret rm <KEY>                     delete from the keychain
 *
 * ────────────────────────────────────────────────────────────────────────
 *  AUDIT FINDING L1 — value never comes from argv.
 * ────────────────────────────────────────────────────────────────────────
 * `pd secret set` reads the value from a HIDDEN stdin prompt with terminal
 * echo disabled — never from `process.argv`. argv would otherwise leak the
 * secret into shell history (~/.zsh_history), the process table (`ps auxww`),
 * and any parent-process audit log. Reading from stdin keeps the value out of
 * all three. When stdin is not a TTY (pipes/CI) we accept a single line from
 * stdin so automation can still feed `echo "$TOKEN" | pd secret set KEY`
 * without the token ever appearing in argv.
 */

import { spawn } from 'node:child_process';
import { openSync, closeSync, createReadStream } from 'node:fs';
import { platform } from 'node:os';
import * as readline from 'node:readline';

import { isStdinInteractive } from '../utils/tty.js';
import { CLIOptions, isJson, isQuiet } from '../types.js';
import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import * as ui from '../utils/ui.js';

interface SecretListEntry {
  key: string;
  backend: string;
  storage: 'keychain' | 'env' | 'unavailable';
  encryptedAtRest: boolean;
  set: boolean;
}

function readOption(options: CLIOptions, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = (options as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

/**
 * A duplex-ish stdin shape we actually use. `setRawMode` is optional on
 * purpose: under the `bun build --compile` CLI binary it can be absent even on
 * a real terminal (see `promptHiddenValue` doc), so every caller must guard it.
 */
type InputStream = NodeJS.ReadStream & {
  isTTY?: boolean;
  setRawMode?: (mode: boolean) => unknown;
};

/**
 * Read one line from a non-TTY stream without echoing, returning it trimmed.
 * Resolves `null` on EOF-before-any-line (empty pipe). Pulled out as a pure-ish
 * helper so the bun regression test can drive it with a synthetic stream and
 * assert the pipe path persists a value AND that an empty pipe yields null
 * (which the command turns into a loud error — never a silent success).
 */
export function readSecretFromStream(
  input: NodeJS.ReadableStream,
): Promise<string | null> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input, terminal: false });
    let firstLine: string | null = null;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      rl.close();
      resolve(firstLine !== null ? firstLine.trim() : null);
    };
    rl.on('line', (line) => {
      if (firstLine === null) {
        firstLine = line;
        finish();
      }
    });
    // EOF before any line (empty pipe) → resolve null via the same path.
    rl.on('close', finish);
  });
}

/**
 * Raw-mode hidden read over an interactive TTY stream. Accumulates keystrokes
 * with echo disabled. Enter submits; Ctrl-C aborts (null); Ctrl-D submits what
 * was typed so far. Returns `null` if `setRawMode` is unavailable so the caller
 * can fall back — we never block silently on a stream we can't put into raw
 * mode. `write` is injected so the prompt/newline target is testable.
 */
function readSecretFromRawTTY(
  input: InputStream,
  label: string,
  write: (s: string) => void,
): Promise<string | null> | null {
  if (typeof input.setRawMode !== 'function') return null;

  return new Promise((resolve) => {
    write(`${label}: `);
    let rawModeOn = false;
    try {
      input.setRawMode(true);
      rawModeOn = true;
    } catch {
      // Raw mode refused at runtime (some bun-compiled / exotic TTYs). Bail so
      // the caller falls back to a line read instead of hanging unechoed.
      resolve(null);
      return;
    }
    input.resume();
    input.setEncoding('utf8');

    let value = '';
    const cleanup = () => {
      try {
        if (rawModeOn) input.setRawMode!(false);
      } catch {
        /* best effort */
      }
      input.pause();
      input.removeListener('data', onData);
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        const code = ch.charCodeAt(0);
        if (ch === '\r' || ch === '\n') {
          cleanup();
          write('\n');
          resolve(value.trim() || null);
          return;
        }
        if (code === 3) {
          // Ctrl-C
          cleanup();
          write('\n');
          resolve(null);
          return;
        }
        if (code === 4) {
          // Ctrl-D
          cleanup();
          write('\n');
          resolve(value.trim() || null);
          return;
        }
        if (code === 127 || code === 8) {
          // Backspace — drop last char (nothing was echoed, so no redraw).
          value = value.slice(0, -1);
          continue;
        }
        value += ch;
      }
    };

    input.on('data', onData);
  });
}

/**
 * Read a secret value from the terminal without echoing it.
 *
 * ────────────────────────────────────────────────────────────────────────
 *  BUG L2 — bun-compiled binary fell through to the non-TTY branch on a
 *           real terminal, producing a silent (prompt-less) abort.
 * ────────────────────────────────────────────────────────────────────────
 * Under the Homebrew `pd` (a `bun build --compile` binary) `process.stdin.isTTY`
 * can be `undefined`/`false` even in an interactive shell — bun doesn't always
 * initialise stdin as a TTY stream the way node does (same class as
 * nodejs/node#2160). The old code keyed solely off `process.stdin.isTTY`, so it
 * took the pipe branch, hit immediate EOF, resolved `null`, and exited 1 with no
 * prompt ever drawn. The operator saw "instant return, nothing stored."
 *
 * Fix: ask the *kernel* whether fd 0 is a terminal via `tty.isatty(0)` instead
 * of trusting the stream flag, and guard `setRawMode` (absent/throwing under
 * some bun builds). Resolution order:
 *
 *   1. fd 0 is NOT a tty (pipe/CI)  → read one line from stdin. Lets
 *      `printf %s "$TOKEN" | pd secret set KEY` work with no argv exposure.
 *   2. fd 0 IS a tty + raw mode OK  → hidden raw-mode keystroke read on stdin.
 *   3. fd 0 IS a tty, raw mode NOT  → open /dev/tty and do a (visible-echo)
 *      line read there, so an interactive user is still PROMPTED and can enter
 *      a value rather than getting a silent no-op.
 *
 * In every branch an empty/aborted entry resolves `null`; the caller turns that
 * into a loud non-zero error. The value is never sourced from argv and is never
 * echoed on the raw-mode path.
 */
function promptHiddenValue(label: string): Promise<string | null> {
  const input = process.stdin as InputStream;

  // Kernel truth, not the (sometimes-wrong under bun-compiled) stream flag.
  const stdinIsTTY = isStdinInteractive(input);

  if (!stdinIsTTY) {
    return readSecretFromStream(input);
  }

  const raw = readSecretFromRawTTY(input, label, (s) => process.stdout.write(s));
  if (raw) return raw;

  // Interactive terminal but raw mode unavailable. Don't silently bail — open
  // the controlling terminal directly and prompt with a readline question.
  // Echo is on here (no raw mode), an accepted tradeoff vs. a silent no-op.
  return promptViaControllingTerminal(label);
}

// `isStdinInteractive` is the canonical TTY predicate, now shared across every
// command that reads stdin (secret/tube/feedback/tutorial). Re-exported here so
// the bun regression test that imports it from this module keeps working.
export { isStdinInteractive };

/**
 * Last-resort interactive read: open the controlling terminal (/dev/tty) and
 * prompt there. Used only when fd 0 is a TTY but raw mode is unavailable.
 * Resolves `null` if /dev/tty cannot be opened (→ caller errors loudly).
 */
function promptViaControllingTerminal(label: string): Promise<string | null> {
  let fd: number;
  try {
    fd = openSync('/dev/tty', 'r');
  } catch {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const ttyIn = createReadStream('', { fd, autoClose: false });
    const rl = readline.createInterface({ input: ttyIn, output: process.stdout });
    rl.question(`${label}: `, (answer) => {
      rl.close();
      ttyIn.destroy();
      try {
        closeSync(fd);
      } catch {
        /* best effort */
      }
      resolve(answer.trim() || null);
    });
  });
}

function copyToClipboard(value: string): Promise<boolean> {
  if (platform() !== 'darwin') return Promise.resolve(false);
  return new Promise((resolve) => {
    const child = spawn('pbcopy', [], { stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
    child.stdin.write(value);
    child.stdin.end();
  });
}

/**
 * Spawn a fully-detached process that clears the clipboard after `seconds`.
 * Detached + unref'd so the CLI can exit immediately without leaving the
 * secret on the pasteboard indefinitely.
 */
function scheduleClipboardClear(seconds: number): void {
  if (platform() !== 'darwin') return;
  const child = spawn(
    '/bin/sh',
    ['-c', `sleep ${seconds}; printf '' | pbcopy`],
    { detached: true, stdio: 'ignore' },
  );
  child.unref();
}

async function handleSecretSet(key: string | undefined, options: CLIOptions): Promise<void> {
  if (!key) {
    ui.error('Usage: pd secret set <KEY> [--backend <b>]');
    process.exit(1);
  }
  const backend = readOption(options, 'backend');

  const value = await promptHiddenValue(`Enter value for ${key}`);
  if (!value) {
    ui.error('No value entered — aborted. Nothing was stored.');
    process.exit(1);
  }

  const body: Record<string, unknown> = { key, value };
  if (backend) body.backend = backend;

  const res = await pdFetch(`${PORT_DADDY_URL}/secrets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({})) as {
    success?: boolean;
    key?: string;
    storage?: string;
    encryptedAtRest?: boolean;
    error?: string;
    allowedKeys?: string[];
  };

  if (!res.ok || !data.success) {
    ui.error(data.error || `Failed to store secret (HTTP ${res.status})`);
    if (data.allowedKeys) {
      console.error(`  Allowed keys: ${data.allowedKeys.join(', ')}`);
    }
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  // Status only — never the value.
  ui.success(`Stored ${data.key}`);
  console.log(`  storage:   ${data.storage}`);
  console.log(`  encrypted: ${data.encryptedAtRest ? 'yes (at rest)' : 'no'}`);
  if (backend) console.log(`  backend:   ${backend}`);
}

async function handleSecretList(options: CLIOptions): Promise<void> {
  const res = await pdFetch(`${PORT_DADDY_URL}/secrets`);
  const data = await res.json().catch(() => ({})) as {
    success?: boolean;
    secrets?: SecretListEntry[];
    error?: string;
  };
  if (!res.ok || !data.success) {
    ui.error(data.error || `Failed to list secrets (HTTP ${res.status})`);
    process.exit(1);
  }
  const secrets = data.secrets ?? [];

  if (isJson(options)) {
    console.log(JSON.stringify(secrets, null, 2));
    return;
  }
  if (isQuiet(options)) {
    for (const s of secrets) console.log(`${s.key}\t${s.set ? 'set' : 'unset'}`);
    return;
  }

  ui.table(
    ['KEY', 'BACKEND', 'STORAGE', 'ENCRYPTED', 'SET?'],
    secrets.map((s) => [
      s.key,
      s.backend,
      s.storage,
      s.encryptedAtRest ? 'yes' : 'no',
      s.set ? 'yes' : 'no',
    ]),
    { title: 'Managed Secrets' },
  );
  console.log(ui.dim('  Values are never shown here. Use: pd secret reveal <KEY> --copy'));
}

async function handleSecretReveal(key: string | undefined, options: CLIOptions): Promise<void> {
  if (!key) {
    ui.error('Usage: pd secret reveal <KEY> [--copy]');
    process.exit(1);
  }
  const res = await pdFetch(`${PORT_DADDY_URL}/secrets/${encodeURIComponent(key)}/reveal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const data = await res.json().catch(() => ({})) as {
    success?: boolean;
    key?: string;
    value?: string;
    error?: string;
  };

  if (res.status === 404) {
    ui.error(`${key} is not set. Store it first: pd secret set ${key}`);
    process.exit(1);
  }
  if (!res.ok || !data.success || typeof data.value !== 'string') {
    ui.error(data.error || `Failed to reveal secret (HTTP ${res.status})`);
    process.exit(1);
  }

  const copy = Boolean((options as Record<string, unknown>).copy);
  if (copy) {
    const ok = await copyToClipboard(data.value);
    if (!ok) {
      ui.error('Could not copy to clipboard (pbcopy unavailable on this platform).');
      process.exit(1);
    }
    scheduleClipboardClear(45);
    // Deliberately DO NOT print the value.
    ui.success(`${key} copied to clipboard (clears in 45s)`);
    return;
  }

  if (isJson(options)) {
    console.log(JSON.stringify({ key: data.key, value: data.value }, null, 2));
    return;
  }
  // Plaintext to stdout with a one-line warning to stderr (so piping the
  // value somewhere doesn't capture the warning).
  ui.warn('This is a secret — it is now on your terminal/scrollback.');
  console.log(data.value);
}

async function handleSecretRm(key: string | undefined, options: CLIOptions): Promise<void> {
  if (!key) {
    ui.error('Usage: pd secret rm <KEY>');
    process.exit(1);
  }
  const res = await pdFetch(`${PORT_DADDY_URL}/secrets/${encodeURIComponent(key)}`, {
    method: 'DELETE',
  });
  const data = await res.json().catch(() => ({})) as {
    success?: boolean;
    key?: string;
    removed?: boolean;
    error?: string;
  };
  if (!res.ok || !data.success) {
    ui.error(data.error || `Failed to remove secret (HTTP ${res.status})`);
    process.exit(1);
  }
  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (data.removed) {
    ui.success(`Removed ${key} from the keychain`);
  } else {
    ui.info(`${key} was not set — nothing to remove`);
  }
}

export async function handleSecret(args: string[], options: CLIOptions): Promise<void> {
  const sub = args[0];
  const rest = args.slice(1);
  switch (sub) {
    case 'set':
      await handleSecretSet(rest[0], options);
      return;
    case 'list':
    case 'ls':
      await handleSecretList(options);
      return;
    case 'reveal':
    case 'show':
      await handleSecretReveal(rest[0], options);
      return;
    case 'rm':
    case 'remove':
    case 'delete':
      await handleSecretRm(rest[0], options);
      return;
    default:
      ui.error('Usage: pd secret <set|list|reveal|rm> [KEY] [--backend <b>] [--copy]');
      process.exit(1);
  }
}
