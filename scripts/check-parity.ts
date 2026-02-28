#!/usr/bin/env npx tsx
/**
 * Parity Checker — Ensures all surfaces are implemented for every feature.
 *
 * Usage: npx tsx scripts/check-parity.ts
 *
 * Reads features.manifest.json and validates that each feature has:
 * - CLI commands implemented
 * - SDK methods implemented
 * - HTTP routes implemented
 * - Shell completions (bash, zsh, fish)
 * - Documentation (README, SDK docs)
 *
 * Exits with code 1 if any feature is missing surfaces.
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');

// ANSI colors
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

interface FeatureDefinition {
  description: string;
  cli: string[];
  sdk: string[];
  routes: string[];
  completions: string[];
  docs: { readme: boolean; sdk: boolean };
  _note?: string;
}

interface Manifest {
  features: Record<string, FeatureDefinition>;
}

interface ExtractedSurfaces {
  cliCommands: Set<string>;
  sdkMethods: Set<string>;
  routes: Set<string>;
  completions: {
    bash: Set<string>;
    zsh: Set<string>;
    fish: Set<string>;
  };
  readme: {
    cliCommands: Set<string>;
    apiEndpoints: Set<string>;
  };
  sdkDocs: {
    methods: Set<string>;
  };
}

interface FeatureReport {
  feature: string;
  description: string;
  issues: string[];
  warnings: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Extraction Functions
// ═══════════════════════════════════════════════════════════════════════════

function extractCliCommands(): Set<string> {
  const cliContent = readFileSync(join(ROOT, 'bin', 'port-daddy-cli.ts'), 'utf-8');
  const commands = new Set<string>();

  // Pattern: case 'command':
  const casePattern = /case\s+['"`]([^'"`]+)['"`]\s*:/g;
  let match;
  while ((match = casePattern.exec(cliContent)) !== null) {
    const cmd = match[1];
    // Skip options
    if (!cmd.startsWith('-')) {
      commands.add(cmd);
    }
  }

  return commands;
}

function extractSdkMethods(): Set<string> {
  const clientContent = readFileSync(join(ROOT, 'lib', 'client.ts'), 'utf-8');
  const methods = new Set<string>();

  // Find the PortDaddy class and extract its methods
  const methodPattern = /^\s+(?:async\s+)?(\w+)\s*(?:<[^>]+>)?\s*\(/gm;
  const classMatch = clientContent.match(/class\s+PortDaddy\s*\{([\s\S]*?)^\}/m);
  if (classMatch) {
    const classBody = classMatch[1];
    let match;
    while ((match = methodPattern.exec(classBody)) !== null) {
      const method = match[1];
      if (!method.startsWith('_') && method !== 'constructor') {
        methods.add(method);
      }
    }
  }

  return methods;
}

function extractRoutes(): Set<string> {
  const routesDir = join(ROOT, 'routes');
  const routes = new Set<string>();

  const routePattern = /\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/gi;

  for (const file of readdirSync(routesDir)) {
    if (!file.endsWith('.ts')) continue;
    const content = readFileSync(join(routesDir, file), 'utf-8');
    let match;
    while ((match = routePattern.exec(content)) !== null) {
      const method = match[1].toUpperCase();
      const path = match[2].replace(/:[^/]+/g, ':param');
      routes.add(`${method} ${path}`);
    }
  }

  // Also check server.ts
  const serverContent = readFileSync(join(ROOT, 'server.ts'), 'utf-8');
  let match;
  while ((match = routePattern.exec(serverContent)) !== null) {
    const method = match[1].toUpperCase();
    const path = match[2].replace(/:[^/]+/g, ':param');
    routes.add(`${method} ${path}`);
  }

  return routes;
}

function extractCompletions(shell: 'bash' | 'zsh' | 'fish'): Set<string> {
  const filePath = join(ROOT, 'completions', `port-daddy.${shell}`);
  if (!existsSync(filePath)) return new Set();

  const content = readFileSync(filePath, 'utf-8');
  const commands = new Set<string>();

  if (shell === 'zsh') {
    const pattern = /'([\w-]+):/g;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      commands.add(match[1]);
    }
  } else if (shell === 'bash') {
    // Array syntax
    const arrayMatch = content.match(/local\s+commands=\(([\s\S]*?)^\s*\)/m);
    if (arrayMatch) {
      const words = arrayMatch[1]
        .split('\n')
        .map(line => line.replace(/#.*$/, '').trim())
        .join(' ')
        .split(/\s+/)
        .filter(w => w && !w.startsWith('#'));
      for (const cmd of words) {
        commands.add(cmd);
      }
    }
    // String syntax
    const stringMatch = content.match(/local\s+commands=['"]([^'"]+)['"]/);
    if (stringMatch) {
      for (const cmd of stringMatch[1].split(/\s+/)) {
        if (cmd) commands.add(cmd);
      }
    }
  } else if (shell === 'fish') {
    const pattern = /complete\s+-c\s+\$?prog\s+.*?-a\s+['"]?([\w-]+)/g;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      commands.add(match[1]);
    }
    const usingPattern = /__pd_using_command\s+([\w-]+)/g;
    while ((match = usingPattern.exec(content)) !== null) {
      commands.add(match[1]);
    }
  }

  return commands;
}

function extractReadmeCliCommands(): Set<string> {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf-8');
  const commands = new Set<string>();

  // Look for commands in CLI Reference tables: | `pd command` |
  const pattern = /\|\s*`pd\s+([\w-]+)/g;
  let match;
  while ((match = pattern.exec(readme)) !== null) {
    commands.add(match[1]);
  }

  return commands;
}

function extractReadmeApiEndpoints(): Set<string> {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf-8');
  const endpoints = new Set<string>();

  // Look for endpoints in API Reference: GET /path, POST /path, etc.
  const pattern = /(GET|POST|PUT|DELETE|PATCH)\s+\/([\w/:]+)/g;
  let match;
  while ((match = pattern.exec(readme)) !== null) {
    const method = match[1];
    const path = '/' + match[2].replace(/:[^/]+/g, ':param');
    endpoints.add(`${method} ${path}`);
  }

  return endpoints;
}

function extractSdkDocsMethods(): Set<string> {
  const sdkDocsPath = join(ROOT, 'docs', 'sdk.md');
  if (!existsSync(sdkDocsPath)) return new Set();

  const content = readFileSync(sdkDocsPath, 'utf-8');
  const methods = new Set<string>();

  // Look for pd.methodName( in code blocks
  const pattern = /pd\.(\w+)\s*\(/g;
  let match;
  while ((match = pattern.exec(content)) !== null) {
    methods.add(match[1]);
  }

  return methods;
}

// ═══════════════════════════════════════════════════════════════════════════
// Validation
// ═══════════════════════════════════════════════════════════════════════════

function validateFeature(
  feature: string,
  def: FeatureDefinition,
  surfaces: ExtractedSurfaces
): FeatureReport {
  const issues: string[] = [];
  const warnings: string[] = [];

  // Check CLI commands
  for (const cmd of def.cli) {
    if (!surfaces.cliCommands.has(cmd)) {
      issues.push(`CLI command '${cmd}' not found in bin/port-daddy-cli.ts`);
    }
  }

  // Check SDK methods
  for (const method of def.sdk) {
    if (!surfaces.sdkMethods.has(method)) {
      issues.push(`SDK method '${method}' not found in lib/client.ts`);
    }
  }

  // Check routes
  for (const route of def.routes) {
    if (!surfaces.routes.has(route)) {
      issues.push(`Route '${route}' not found in routes/*.ts`);
    }
  }

  // Check completions
  for (const cmd of def.completions) {
    if (!surfaces.completions.bash.has(cmd)) {
      issues.push(`Completion '${cmd}' missing in bash`);
    }
    if (!surfaces.completions.zsh.has(cmd)) {
      issues.push(`Completion '${cmd}' missing in zsh`);
    }
    if (!surfaces.completions.fish.has(cmd)) {
      issues.push(`Completion '${cmd}' missing in fish`);
    }
  }

  // Check docs
  if (def.docs.readme) {
    const cliInReadme = def.cli.some(cmd => surfaces.readme.cliCommands.has(cmd));
    if (!cliInReadme && def.cli.length > 0) {
      warnings.push(`CLI command not documented in README.md`);
    }
  }

  if (def.docs.sdk) {
    const sdkInDocs = def.sdk.some(method => surfaces.sdkDocs.methods.has(method));
    if (!sdkInDocs && def.sdk.length > 0) {
      warnings.push(`SDK methods not documented in docs/sdk.md`);
    }
  }

  return { feature, description: def.description, issues, warnings };
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

function main() {
  console.log(`\n${BOLD}${CYAN}═══ Port Daddy Parity Checker ═══${RESET}\n`);

  // Load manifest
  const manifestPath = join(ROOT, 'features.manifest.json');
  if (!existsSync(manifestPath)) {
    console.error(`${RED}✗${RESET} features.manifest.json not found!`);
    console.error(`  Create it to define all features and their expected surfaces.`);
    process.exit(1);
  }

  const manifest: Manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const featureCount = Object.keys(manifest.features).length;

  console.log(`${DIM}Loading manifest: ${featureCount} features defined${RESET}\n`);

  // Extract all surfaces
  console.log(`${DIM}Extracting surfaces...${RESET}`);
  const surfaces: ExtractedSurfaces = {
    cliCommands: extractCliCommands(),
    sdkMethods: extractSdkMethods(),
    routes: extractRoutes(),
    completions: {
      bash: extractCompletions('bash'),
      zsh: extractCompletions('zsh'),
      fish: extractCompletions('fish'),
    },
    readme: {
      cliCommands: extractReadmeCliCommands(),
      apiEndpoints: extractReadmeApiEndpoints(),
    },
    sdkDocs: {
      methods: extractSdkDocsMethods(),
    },
  };

  console.log(`  CLI commands:     ${surfaces.cliCommands.size}`);
  console.log(`  SDK methods:      ${surfaces.sdkMethods.size}`);
  console.log(`  HTTP routes:      ${surfaces.routes.size}`);
  console.log(`  Bash completions: ${surfaces.completions.bash.size}`);
  console.log(`  Zsh completions:  ${surfaces.completions.zsh.size}`);
  console.log(`  Fish completions: ${surfaces.completions.fish.size}`);
  console.log();

  // Validate each feature
  const reports: FeatureReport[] = [];
  for (const [name, def] of Object.entries(manifest.features)) {
    reports.push(validateFeature(name, def, surfaces));
  }

  // Print results
  let totalIssues = 0;
  let totalWarnings = 0;

  console.log(`${BOLD}Feature Parity Status:${RESET}\n`);

  for (const report of reports) {
    const hasIssues = report.issues.length > 0;
    const hasWarnings = report.warnings.length > 0;

    if (hasIssues) {
      console.log(`${RED}✗${RESET} ${BOLD}${report.feature}${RESET} ${DIM}(${report.description})${RESET}`);
      for (const issue of report.issues) {
        console.log(`  ${RED}•${RESET} ${issue}`);
        totalIssues++;
      }
    } else if (hasWarnings) {
      console.log(`${YELLOW}⚠${RESET} ${BOLD}${report.feature}${RESET} ${DIM}(${report.description})${RESET}`);
    } else {
      console.log(`${GREEN}✓${RESET} ${report.feature}`);
    }

    if (hasWarnings) {
      for (const warning of report.warnings) {
        console.log(`  ${YELLOW}⚠${RESET} ${warning}`);
        totalWarnings++;
      }
    }
  }

  console.log();

  // Summary
  if (totalIssues === 0) {
    console.log(`${GREEN}${BOLD}✓ All ${featureCount} features have complete parity!${RESET}`);
    if (totalWarnings > 0) {
      console.log(`${YELLOW}  ${totalWarnings} documentation warning(s) to address${RESET}`);
    }
    console.log();
  } else {
    console.log(`${RED}${BOLD}✗ ${totalIssues} parity issue(s) found across features${RESET}`);
    console.log(`${DIM}  Fix these before merging to main.${RESET}`);
    console.log();
    process.exitCode = 1;
  }
}

main();
