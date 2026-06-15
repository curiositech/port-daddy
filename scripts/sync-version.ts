#!/usr/bin/env npx tsx
/**
 * Version Sync — Updates version strings across all distribution surfaces.
 *
 * Usage: npx tsx scripts/sync-version.ts
 *
 * Called automatically by `npm version` via the postversion hook.
 * Updates version in:
 *   - .claude-plugin/plugin.json
 *   - .gemini/extensions/port-daddy/gemini-extension.json
 *   - mcp-server.json
 *   - mcp/server.ts
 *   - server.ts (EMBEDDED_PACKAGE_VERSION — fallback used inside the bun bundle
 *     when __dirname-relative package.json read fails)
 *   - website-v2/src/data/referenceCatalog.ts
 *   - public/samples/manifest.json
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

// .gemini/extensions/port-daddy/gemini-extension.json
const geminiExtensionPath = join(ROOT, '.gemini', 'extensions', 'port-daddy', 'gemini-extension.json');
const geminiExtension = JSON.parse(readFileSync(geminiExtensionPath, 'utf-8'));
geminiExtension.version = version;
writeFileSync(geminiExtensionPath, JSON.stringify(geminiExtension, null, 2) + '\n');
console.log(`  ✓ .gemini/extensions/port-daddy/gemini-extension.json → ${version}`);

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

// website-v2/src/data/referenceCatalog.ts PORT_DADDY_VERSION
const referenceCatalogPath = join(ROOT, 'website-v2', 'src', 'data', 'referenceCatalog.ts');
const referenceVersionRe = /(export const PORT_DADDY_VERSION = ['"])[\w.\-+]+(['"])/;
let referenceCatalogContent = readFileSync(referenceCatalogPath, 'utf-8');
if (!referenceVersionRe.test(referenceCatalogContent)) {
  throw new Error(`sync-version.ts: PORT_DADDY_VERSION literal not found in website-v2/src/data/referenceCatalog.ts.`);
}
referenceCatalogContent = referenceCatalogContent.replace(referenceVersionRe, `$1${version}$2`);
writeFileSync(referenceCatalogPath, referenceCatalogContent);
console.log(`  ✓ website-v2/src/data/referenceCatalog.ts PORT_DADDY_VERSION → ${version}`);

// public/samples/manifest.json packageVersion
const samplesManifestPath = join(ROOT, 'public', 'samples', 'manifest.json');
const samplesManifest = JSON.parse(readFileSync(samplesManifestPath, 'utf-8'));
samplesManifest.packageVersion = version;
writeFileSync(samplesManifestPath, JSON.stringify(samplesManifest, null, 2) + '\n');
console.log(`  ✓ public/samples/manifest.json packageVersion → ${version}`);

console.log(`\nVersion ${version} synced to all surfaces.`);
