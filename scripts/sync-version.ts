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
 *   - server.ts (EMBEDDED_PACKAGE_VERSION — fallback used inside the bun bundle
 *     when __dirname-relative package.json read fails)
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

// mcp/server.ts — same semver-friendly pattern so RC promotions sync cleanly.
const mcpServerPath = join(ROOT, 'mcp', 'server.ts');
let mcpContent = readFileSync(mcpServerPath, 'utf-8');
mcpContent = mcpContent.replace(
  /(version:\s*['"])[\w.\-+]+(['"])/,
  `$1${version}$2`
);
writeFileSync(mcpServerPath, mcpContent);
console.log(`  ✓ mcp/server.ts → ${version}`);

// server.ts EMBEDDED_PACKAGE_VERSION
// Regex covers full semver (including pre-release and build metadata) so the
// sync still works for RC cycles like 3.15.0-rc.1 → 3.15.0.
const serverPath = join(ROOT, 'server.ts');
const embeddedVersionRe = /(const EMBEDDED_PACKAGE_VERSION: string = ['"])[\w.\-+]+(['"])/;
let serverContent = readFileSync(serverPath, 'utf-8');
if (!embeddedVersionRe.test(serverContent)) {
  throw new Error(`sync-version.ts: EMBEDDED_PACKAGE_VERSION literal not found in server.ts — bun-bundle version fallback would silently rot. Restore the const before releasing.`);
}
serverContent = serverContent.replace(embeddedVersionRe, `$1${version}$2`);
writeFileSync(serverPath, serverContent);
console.log(`  ✓ server.ts EMBEDDED_PACKAGE_VERSION → ${version}`);

console.log(`\nVersion ${version} synced to all surfaces.`);
