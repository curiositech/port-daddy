/**
 * Maritime Interactive Prompting Module
 *
 * Now powered by @clack/prompts via the ui module.
 * This file re-exports the prompt functions under their original names
 * for backwards compatibility with existing command modules.
 */

import * as ui from './ui.js';
export { canPrompt } from './ui.js';

/**
 * Prompt for freeform text input.
 */
export async function promptText(opts: {
  label: string;
  hint?: string;
  required?: boolean;
  default?: string;
}): Promise<string | null> {
  return ui.text({
    label: opts.label,
    hint: opts.hint,
    required: opts.required,
    default: opts.default,
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
  return ui.select({
    label: opts.label,
    choices: opts.choices,
    default: opts.default,
  });
}

/**
 * Prompt for yes/no confirmation.
 */
export async function promptConfirm(label: string, defaultYes = true): Promise<boolean> {
  return ui.confirm(label, defaultYes);
}

/**
 * Prompt for a semantic identity (project:stack:context).
 */
export async function promptIdentity(opts: {
  label?: string;
  suggested?: string;
}): Promise<string | null> {
  return ui.identity(opts);
}

/**
 * Print a success line (formerly "ROGER").
 */
export function printRoger(message: string): void {
  ui.success(message);
}

/**
 * Print a cancel/failure line (formerly "NEGATIVE").
 */
export function printNegative(message: string): void {
  ui.error(message);
}
