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
import * as readline from 'node:readline';
import { platform } from 'node:os';

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
 * Read a secret value from stdin without echoing it to the terminal.
 *
 * TTY path: put the terminal into raw mode, render a static prompt, and
 * accumulate keystrokes manually — nothing is echoed, so shoulder-surfers and
 * terminal scrollback see nothing. Enter submits; Ctrl-C / Ctrl-D abort.
 *
 * Non-TTY path (pipe/CI): read a single line from stdin so
 * `echo "$TOKEN" | pd secret set KEY` works without argv exposure.
 */
function promptHiddenValue(label: string): Promise<string | null> {
  const input = process.stdin;

  // Non-interactive: consume exactly one line from the pipe. Close the
  // interface as soon as the first line arrives so a long-running producer
  // (e.g. `yes "$TOKEN" | pd secret set KEY`) doesn't hang waiting for EOF.
  if (!input.isTTY) {
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

  return new Promise((resolve) => {
    process.stdout.write(`${label}: `);
    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');

    let value = '';
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        const code = ch.charCodeAt(0);
        if (ch === '\r' || ch === '\n') {
          cleanup();
          process.stdout.write('\n');
          resolve(value.trim() || null);
          return;
        }
        if (code === 3) {
          // Ctrl-C
          cleanup();
          process.stdout.write('\n');
          resolve(null);
          return;
        }
        if (code === 4) {
          // Ctrl-D
          cleanup();
          process.stdout.write('\n');
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

    const cleanup = () => {
      input.setRawMode(false);
      input.pause();
      input.removeListener('data', onData);
    };

    input.on('data', onData);
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
