/**
 * Maritime Interactive Prompting Module
 *
 * Signal-flag-driven prompts using Node.js built-in readline.
 * Zero external dependencies.
 *
 * - Kilo flag (yellow-blue) = "Ready to communicate" — prompting user
 * - Charlie flag (blue-white-red) = "Affirmative" — accepted input
 * - November flag (blue-white checker) = "Negative" — cancelled/empty
 * - All output to stderr (stdout reserved for piped data -q)
 * - Auto-skip when: not TTY, CI env var, PORT_DADDY_NON_INTERACTIVE
 */

import { createInterface } from 'node:readline';
import { ANSI, flag, highlightChannel } from '../../lib/maritime.js';
import { IS_TTY } from './output.js';

/**
 * Check whether interactive prompting is possible and appropriate.
 */
export function canPrompt(): boolean {
  return IS_TTY && !process.env.CI && !process.env.PORT_DADDY_NON_INTERACTIVE;
}

function promptPrefix(): string {
  return `${flag('kilo')} ${ANSI.fgCyan}HAIL${ANSI.reset}`;
}

/**
 * Prompt for freeform text input.
 */
export async function promptText(opts: {
  label: string;
  hint?: string;
  required?: boolean;
  default?: string;
}): Promise<string | null> {
  if (!canPrompt()) return null;

  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const defaultHint = opts.default
    ? `\n  ${ANSI.dim}(default: ${opts.default})${ANSI.reset}`
    : '';
  const hintText = opts.hint
    ? `  ${ANSI.dim}${opts.hint}${ANSI.reset}\n`
    : '';
  const question = `${promptPrefix()} ${ANSI.dim}\u2014${ANSI.reset} ${ANSI.bold}${opts.label}${ANSI.reset}${defaultHint}\n${hintText}  > `;

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      const value = answer.trim() || opts.default || '';
      if (opts.required && !value) resolve(null);
      else resolve(value || null);
    });
  });
}

/**
 * Prompt for a selection from a list of choices.
 */
export async function promptSelect(opts: {
  label: string;
  choices: Array<{ value: string; label: string; hint?: string }>;
  default?: string;
}): Promise<string | null> {
  if (!canPrompt()) return null;

  const rl = createInterface({ input: process.stdin, output: process.stderr });

  process.stderr.write(`${promptPrefix()} ${ANSI.dim}\u2014${ANSI.reset} ${ANSI.bold}${opts.label}${ANSI.reset}\n`);
  for (const c of opts.choices) {
    const marker = c.value === opts.default
      ? `${ANSI.fgGreen}>${ANSI.reset}`
      : ' ';
    const hint = c.hint ? ` ${ANSI.dim}${c.hint}${ANSI.reset}` : '';
    process.stderr.write(
      `  ${marker} ${ANSI.fgYellow}${c.value}${ANSI.reset} \u2014 ${c.label}${hint}\n`
    );
  }

  return new Promise((resolve) => {
    rl.question(`  ${ANSI.dim}Choice:${ANSI.reset} `, (answer) => {
      rl.close();
      const val = answer.trim();
      // Empty input → use default (not first choice via prefix match)
      if (!val) {
        resolve(opts.default || null);
        return;
      }
      // Exact match first, then unambiguous prefix match
      const exact = opts.choices.find(c => c.value === val);
      if (exact) { resolve(exact.value); return; }
      const prefixes = opts.choices.filter(c => c.value.startsWith(val));
      if (prefixes.length === 1) { resolve(prefixes[0].value); return; }
      // Ambiguous or no match → use default
      resolve(opts.default || null);
    });
  });
}

/**
 * Prompt for yes/no confirmation.
 */
export async function promptConfirm(label: string, defaultYes = true): Promise<boolean> {
  if (!canPrompt()) return defaultYes;

  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const hint = defaultYes ? 'Y/n' : 'y/N';

  return new Promise((resolve) => {
    rl.question(
      `${promptPrefix()} ${ANSI.dim}\u2014${ANSI.reset} ${ANSI.bold}${label}${ANSI.reset} ${ANSI.dim}[${hint}]${ANSI.reset} `,
      (answer) => {
        rl.close();
        const val = answer.trim().toLowerCase();
        if (!val) resolve(defaultYes);
        else resolve(val === 'y' || val === 'yes');
      }
    );
  });
}

/**
 * Prompt for a semantic identity (project:stack:context) with channel highlighting.
 */
export async function promptIdentity(opts: {
  label?: string;
  suggested?: string;
}): Promise<string | null> {
  if (!canPrompt()) return null;

  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const label = opts.label || 'Service identity (project:stack:context)?';
  const suggested = opts.suggested
    ? `\n  ${ANSI.dim}auto-detected: ${highlightChannel(opts.suggested)}${ANSI.reset}`
    : '';

  return new Promise((resolve) => {
    rl.question(
      `${promptPrefix()} ${ANSI.dim}\u2014${ANSI.reset} ${ANSI.bold}${label}${ANSI.reset}${suggested}\n  > `,
      (answer) => {
        rl.close();
        resolve(answer.trim() || opts.suggested || null);
      }
    );
  });
}

/**
 * Print a "ROGER" success line (Charlie flag = affirmative).
 */
export function printRoger(message: string): void {
  process.stderr.write(`${flag('charlie')} ${ANSI.fgGreen}ROGER${ANSI.reset} \u2014 ${message}\n`);
}

/**
 * Print a "NEGATIVE" cancel line (November flag).
 */
export function printNegative(message: string): void {
  process.stderr.write(`${flag('november')} ${ANSI.fgRed}NEGATIVE${ANSI.reset} \u2014 ${message}\n`);
}
