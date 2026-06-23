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
 *   - VERSION (plain-text product version stamp, read by no code but a
 *     human-facing authority surface — keep it honest or delete it)
 *   - core/pd-console/Cargo.toml (the GPU-native app's CARGO_PKG_VERSION, which
 *     becomes `pd-console --version` / the in-app build stamp AND is stamped into
 *     pd-console.app's CFBundleShortVersionString by scripts/package-pd-console.sh).
 *     This is the ONE Rust crate that is a user-facing product surface; the kernel
 *     library crates (core/kernel/*, core/Cargo.toml workspace.package) keep their
 *     own independent library semver and are deliberately NOT touched here.
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

// VERSION — plain-text product stamp. No code reads it, but it is a human-facing
// authority surface (and used to lie at 3.7.0). Keep it byte-honest with a trailing
// newline so `cat VERSION` matches `pd --version`.
const versionFilePath = join(ROOT, 'VERSION');
writeFileSync(versionFilePath, `${version}\n`);
console.log(`  ✓ VERSION → ${version}`);

// core/pd-console/Cargo.toml — the GPU-native app's crate version. This is the
// ONLY Rust crate that is a user-facing product surface: env!("CARGO_PKG_VERSION")
// becomes `pd-console`'s in-app build stamp, and package-pd-console.sh stamps the
// same package.json version into the .app's CFBundleShortVersionString. Sync the
// crate version so the embedded `--version` agrees with the bundle and the daemon.
// The kernel library crates (core/kernel/*, core/Cargo.toml [workspace.package])
// keep their own independent semver and are intentionally left alone.
const consoleCargoPath = join(ROOT, 'core', 'pd-console', 'Cargo.toml');
const consoleCargoVersionRe = /^(version\s*=\s*")[\w.\-+]+(")/m;
let consoleCargo = readFileSync(consoleCargoPath, 'utf-8');
if (!consoleCargoVersionRe.test(consoleCargo)) {
  throw new Error(`sync-version.ts: package version literal not found in core/pd-console/Cargo.toml — pd-console's CARGO_PKG_VERSION would silently drift from the product version.`);
}
consoleCargo = consoleCargo.replace(consoleCargoVersionRe, `$1${version}$2`);
writeFileSync(consoleCargoPath, consoleCargo);
console.log(`  ✓ core/pd-console/Cargo.toml version → ${version}`);

console.log(`\nVersion ${version} synced to all surfaces.`);
