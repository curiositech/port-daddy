/**
 * CLI Types
 *
 * Shared type definitions for CLI command handlers.
 */

/**
 * CLI option flags passed to command handlers
 */
export interface CLIOptions {
  // Output formatting
  quiet?: boolean;
  q?: boolean;
  json?: boolean;
  j?: boolean;

  // Common flags
  force?: boolean;
  all?: boolean;
  status?: string;
  agent?: string;
  files?: string | string[];

  // Session flags
  type?: string;

  // Lock flags
  owner?: string;
  ttl?: string | number;
  wait?: boolean;
  timeout?: string | number;
  name?: string;

  // Agent flags
  agentType?: string;
  maxServices?: string | number;
  maxLocks?: string | number;
  active?: boolean;
  target?: string;

  // Service flags
  port?: string | number;
  expires?: string | number;
  range?: string;
  expired?: boolean;
  pair?: string;
  cmd?: string;
  export?: boolean;
  env?: string;
  open?: boolean;
  file?: string;
  system?: boolean;

  // Messaging flags
  sender?: string;

  // Filter/query flags
  limit?: string | number;
  since?: string | number;
  from?: string | number;
  to?: string | number;
  level?: string;
  service?: string;

  // Webhook flags
  url?: string;
  events?: string;

  // Project flags
  dir?: string;
  branch?: boolean;
  'dry-run'?: boolean;

  // Orchestration flags
  'no-health'?: boolean;

  // Generic extensibility
  [key: string]: unknown;
}

/**
 * Check if quiet mode is enabled
 */
export function isQuiet(options: CLIOptions): boolean {
  return !!(options.quiet || options.q);
}

/**
 * Check if JSON mode is enabled
 */
export function isJson(options: CLIOptions): boolean {
  return !!(options.json || options.j);
}
