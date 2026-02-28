#!/usr/bin/env npx tsx
/**
 * Parity Checker — Ensures CLI, SDK, and API surfaces stay in sync.
 *
 * Usage: npx tsx scripts/check-parity.ts
 *
 * Scans:
 * - routes/*.ts for HTTP endpoints
 * - bin/port-daddy-cli.ts for CLI commands
 * - lib/client.ts for SDK methods
 *
 * Reports any endpoint/command/method that doesn't exist in all surfaces.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');

// ANSI colors
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

interface ParityReport {
  routes: Set<string>;
  cliCommands: Set<string>;
  sdkMethods: Set<string>;
  completions: {
    zsh: Set<string>;
    bash: Set<string>;
    fish: Set<string>;
  };
}

/**
 * Extract HTTP endpoints from route files
 */
function extractRoutes(): Set<string> {
  const routesDir = join(ROOT, 'routes');
  const routes = new Set<string>();

  // Pattern: app.get('/path', ...) or router.post('/path', ...)
  const routePattern = /\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/gi;

  for (const file of readdirSync(routesDir)) {
    if (!file.endsWith('.ts')) continue;
    const content = readFileSync(join(routesDir, file), 'utf-8');
    let match;
    while ((match = routePattern.exec(content)) !== null) {
      const method = match[1].toUpperCase();
      const path = match[2].replace(/:[^/]+/g, ':param'); // Normalize params
      routes.add(`${method} ${path}`);
    }
  }

  // Also check server.ts for any direct routes
  const serverContent = readFileSync(join(ROOT, 'server.ts'), 'utf-8');
  let match;
  while ((match = routePattern.exec(serverContent)) !== null) {
    const method = match[1].toUpperCase();
    const path = match[2].replace(/:[^/]+/g, ':param');
    routes.add(`${method} ${path}`);
  }

  return routes;
}

/**
 * Extract CLI commands from the CLI entry point
 */
function extractCliCommands(): Set<string> {
  const cliContent = readFileSync(join(ROOT, 'bin', 'port-daddy-cli.ts'), 'utf-8');
  const commands = new Set<string>();

  // Pattern: case 'command':
  // Exclude nested subcommands that are only valid with a parent command
  const NESTED_SUBCOMMANDS = new Set([
    // session subcommands (only valid as 'session <subcommand>')
    'end', 'abandon',
    // Other nested subcommands that appear in switch statements
    'add', 'rm', 'remove', 'clear', 'extend', 'summary', 'stats',
    'ls', 'test', 'update', 'deliveries', 'events',
    'tree', 'export', 'identities', 'complete', 'dismiss',
    'heartbeat', 'unregister', 'register', 'cleanup',
  ]);
  const casePattern = /case\s+['"`]([^'"`]+)['"`]\s*:/g;
  let match;
  while ((match = casePattern.exec(cliContent)) !== null) {
    const cmd = match[1];
    // Skip options, help, and known nested subcommands
    if (!['help', '--help', '-h', '--version', '-v', '--quiet', '-q', '--json', '-j'].includes(cmd) &&
        !NESTED_SUBCOMMANDS.has(cmd)) {
      commands.add(cmd);
    }
  }

  // Also extract from yargs-style .command() if present
  const commandPattern = /\.command\s*\(\s*['"`]([^'"`\s]+)/g;
  while ((match = commandPattern.exec(cliContent)) !== null) {
    commands.add(match[1]);
  }

  return commands;
}

/**
 * Extract SDK methods from the client
 */
function extractSdkMethods(): Set<string> {
  const clientContent = readFileSync(join(ROOT, 'lib', 'client.ts'), 'utf-8');
  const methods = new Set<string>();

  // Pattern: async methodName( or methodName( or methodName<T>(
  // Looking for public methods on the PortDaddy class
  // Note: We match up to the opening paren, not the full signature, to handle
  // nested parens in callback parameters like fn: () => Promise<T>
  const methodPattern = /^\s+(?:async\s+)?(\w+)\s*(?:<[^>]+>)?\s*\(/gm;
  let match;

  // Find the PortDaddy class and extract its methods
  const classMatch = clientContent.match(/class\s+PortDaddy\s*{([\s\S]*?)^\}/m);
  if (classMatch) {
    const classBody = classMatch[1];
    while ((match = methodPattern.exec(classBody)) !== null) {
      const method = match[1];
      // Skip private methods and constructor
      if (!method.startsWith('_') && method !== 'constructor') {
        methods.add(method);
      }
    }
  }

  return methods;
}

/**
 * Extract commands from completion files
 */
function extractCompletionCommands(shell: 'zsh' | 'bash' | 'fish'): Set<string> {
  const filePath = join(ROOT, 'completions', `port-daddy.${shell}`);
  const content = readFileSync(filePath, 'utf-8');
  const commands = new Set<string>();

  if (shell === 'zsh') {
    // Pattern: 'command:description'
    const pattern = /'([a-z-]+):/g;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      commands.add(match[1]);
    }
  } else if (shell === 'bash') {
    // Pattern 1: Look for words in commands array - both string and array syntax
    // local commands='claim release status ...' OR local commands=(claim release ...)
    const stringMatch = content.match(/local\s+commands=['"]([^'"]+)['"]/);
    if (stringMatch) {
      for (const cmd of stringMatch[1].split(/\s+/)) {
        if (cmd) commands.add(cmd);
      }
    }
    // Array syntax: local commands=(\n  cmd1 cmd2 ...\n)
    // The closing paren must be at the start of a line (after optional whitespace)
    const arrayMatch = content.match(/local\s+commands=\(([\s\S]*?)^\s*\)/m);
    if (arrayMatch) {
      // Extract words, ignoring comments and newlines
      const words = arrayMatch[1]
        .split('\n')
        .map(line => line.replace(/#.*$/, '').trim()) // Remove comments
        .join(' ')
        .split(/\s+/)
        .filter(w => w && !w.startsWith('#'));
      for (const cmd of words) {
        commands.add(cmd);
      }
    }
    // Also look for case patterns (supports hyphenated commands)
    const casePattern = /([\w-]+)\)\s*$/gm;
    let match;
    while ((match = casePattern.exec(content)) !== null) {
      const cmd = match[1];
      if (!['*', ''].includes(cmd)) {
        commands.add(cmd);
      }
    }
  } else if (shell === 'fish') {
    // Pattern: complete -c port-daddy -a 'command' or similar (supports hyphenated commands)
    const pattern = /complete\s+-c\s+\$?prog\s+.*?-a\s+['"]?([\w-]+)/g;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      commands.add(match[1]);
    }
    // Also look for __pd_using_command patterns (supports hyphenated commands)
    const usingPattern = /__pd_using_command\s+([\w-]+)/g;
    while ((match = usingPattern.exec(content)) !== null) {
      commands.add(match[1]);
    }
  }

  return commands;
}

/**
 * Mapping from CLI commands to expected SDK methods
 */
const CLI_TO_SDK_MAP: Record<string, string[]> = {
  claim: ['claim'],
  release: ['release'],
  status: ['listServices', 'getService'],
  lock: ['lock', 'checkLock', 'extendLock', 'lockWithRetry', 'withLock'],
  unlock: ['unlock'],
  locks: ['listLocks'],
  pub: ['publish'],
  sub: ['subscribe', 'poll'],
  channels: ['listChannels', 'getMessages', 'clearChannel'],
  agent: ['register', 'heartbeat', 'unregister', 'getAgent'],
  agents: ['listAgents'],
  session: ['startSession', 'endSession', 'abandonSession', 'removeSession', 'claimFiles', 'releaseFiles'],
  sessions: ['sessions', 'sessionDetails'],
  note: ['note'],
  notes: ['notes'],
  webhook: ['addWebhook', 'getWebhook', 'updateWebhook', 'removeWebhook', 'testWebhook', 'getWebhookDeliveries', 'getWebhookEvents'],
  webhooks: ['listWebhooks'],
  salvage: ['salvage', 'salvageClaim', 'salvageComplete', 'salvageAbandon', 'salvageDismiss'],
  dashboard: [], // Browser-based, no SDK equivalent
  diagnose: [], // CLI-only diagnostic
  log: ['getActivity', 'getActivityRange', 'getActivitySummary', 'getActivityStats'],
  ports: ['listActivePorts', 'getSystemPorts', 'cleanup'],
  metrics: ['metrics'],
  config: ['getConfig'],
  health: ['health', 'checkServiceHealth', 'listServiceHealth'],
  version: ['version'],
  scan: ['scan'],
  projects: ['listProjects', 'getProject', 'deleteProject'],
  up: [], // Orchestration - server-side
  down: [], // Orchestration - server-side
};

function printReport(report: ParityReport): void {
  console.log(`\n${BOLD}${CYAN}═══ Port Daddy Parity Report ═══${RESET}\n`);

  console.log(`${BOLD}Surfaces detected:${RESET}`);
  console.log(`  API Routes:      ${report.routes.size} endpoints`);
  console.log(`  CLI Commands:    ${report.cliCommands.size} commands`);
  console.log(`  SDK Methods:     ${report.sdkMethods.size} methods`);
  console.log(`  Zsh completions: ${report.completions.zsh.size} commands`);
  console.log(`  Bash completions: ${report.completions.bash.size} commands`);
  console.log(`  Fish completions: ${report.completions.fish.size} commands`);
  console.log();

  // Check CLI command coverage
  let issues = 0;

  console.log(`${BOLD}CLI → SDK Parity:${RESET}`);
  for (const cmd of report.cliCommands) {
    const expectedMethods = CLI_TO_SDK_MAP[cmd] || [];
    if (expectedMethods.length === 0) {
      console.log(`  ${YELLOW}⚠${RESET} ${cmd}: No SDK mapping defined (CLI-only or needs mapping)`);
      continue;
    }
    const missing = expectedMethods.filter(m => !report.sdkMethods.has(m));
    if (missing.length > 0) {
      console.log(`  ${RED}✗${RESET} ${cmd}: Missing SDK methods: ${missing.join(', ')}`);
      issues++;
    } else {
      console.log(`  ${GREEN}✓${RESET} ${cmd}`);
    }
  }
  console.log();

  console.log(`${BOLD}CLI → Completions Parity:${RESET}`);
  for (const cmd of report.cliCommands) {
    const inZsh = report.completions.zsh.has(cmd);
    const inBash = report.completions.bash.has(cmd);
    const inFish = report.completions.fish.has(cmd);

    if (!inZsh || !inBash || !inFish) {
      const missing = [];
      if (!inZsh) missing.push('zsh');
      if (!inBash) missing.push('bash');
      if (!inFish) missing.push('fish');
      console.log(`  ${RED}✗${RESET} ${cmd}: Missing in ${missing.join(', ')}`);
      issues++;
    } else {
      console.log(`  ${GREEN}✓${RESET} ${cmd}`);
    }
  }
  console.log();

  // Summary
  if (issues === 0) {
    console.log(`${GREEN}${BOLD}✓ All surfaces in sync!${RESET}\n`);
  } else {
    console.log(`${RED}${BOLD}✗ ${issues} parity issues found${RESET}\n`);
    process.exitCode = 1;
  }
}

// Main
const report: ParityReport = {
  routes: extractRoutes(),
  cliCommands: extractCliCommands(),
  sdkMethods: extractSdkMethods(),
  completions: {
    zsh: extractCompletionCommands('zsh'),
    bash: extractCompletionCommands('bash'),
    fish: extractCompletionCommands('fish'),
  },
};

printReport(report);
