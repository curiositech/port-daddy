#!/usr/bin/env npx tsx
/**
 * Version Sync — Updates version strings across all distribution surfaces.
 *
 * Usage: npx tsx scripts/sync-version.ts
 *
 * Called automatically by `npm version` via the postversion hook.
 * Updates version in:
 *   - .claude-plugin/plugin.json
 *   - mcp-server.json
 *   - mcp/server.ts
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
const version = pkg.version;

console.log(`Syncing version ${version} across distribution surfaces...`);

// .claude-plugin/plugin.json
const pluginPath = join(ROOT, '.claude-plugin', 'plugin.json');
const plugin = JSON.parse(readFileSync(pluginPath, 'utf-8'));
plugin.version = version;
writeFileSync(pluginPath, JSON.stringify(plugin, null, 2) + '\n');
console.log(`  ✓ .claude-plugin/plugin.json → ${version}`);

// mcp-server.json
const mcpJsonPath = join(ROOT, 'mcp-server.json');
const mcpJson = JSON.parse(readFileSync(mcpJsonPath, 'utf-8'));
mcpJson.version = version;
writeFileSync(mcpJsonPath, JSON.stringify(mcpJson, null, 2) + '\n');
console.log(`  ✓ mcp-server.json → ${version}`);

// mcp/server.ts
const mcpServerPath = join(ROOT, 'mcp', 'server.ts');
let mcpContent = readFileSync(mcpServerPath, 'utf-8');
mcpContent = mcpContent.replace(
  /(version:\s*['"])[\d.]+(['"])/,
  `$1${version}$2`
);
writeFileSync(mcpServerPath, mcpContent);
console.log(`  ✓ mcp/server.ts → ${version}`);

console.log(`\nVersion ${version} synced to all surfaces.`);
