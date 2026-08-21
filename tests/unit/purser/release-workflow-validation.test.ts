// tests/unit/purser/release-workflow-validation.test.ts
import { test } from 'node:test';
import { strict as assert } from 'assert';
import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { spawnSync } from 'child_process';

// Helper to read JSON files
function readJson(path: string) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// List of files that must contain the version literal "3.30.0"
const versionFiles = [
  // Node package
  { path: 'package.json', key: 'version' },
  // Cargo
  { path: 'core/pd-console/Cargo.toml', key: 'version' },
  // Claude plugin
  { path: '.claude-plugin/plugin.json', key: 'version' },
  // Gemini extension
  { path: '.gemini/extensions/port-daddy/gemini-extension.json', key: 'version' },
  // OpenAPI
  { path: 'docs/openapi.yaml', key: 'info.version' },
  // MCP server
  { path: 'mcp-server.json', key: 'version' },
  // MCP server TS
  { path: 'mcp/server.ts', key: 'server.version' }, // will be checked via regex
  // Server TS
  { path: 'server.ts', key: 'EMBEDDED_PACKAGE_VERSION' },
  // CLI diagnostics
  { path: 'cli/commands/diagnostics.ts', key: 'EMBEDDED_PACKAGE_VERSION' },
  // Public samples
  { path: 'public/samples/manifest.json', key: 'packageVersion' },
  // Website reference catalog
  { path: 'website-v2/src/data/referenceCatalog.ts', key: 'PORT_DADDY_VERSION' },
  // Version file
  { path: 'VERSION', key: null },
];

// Expected version string
const expectedVersion = '3.30.0';

// Test 1: All version literals match the expected version
test('All version literals are 3.30.0', () => {
  for (const item of versionFiles) {
    const absPath = resolve(__dirname, '..', '..', '..', item.path);
    assert.ok(existsSync(absPath), `File not found: ${absPath}`);
    const content = readFileSync(absPath, 'utf8');

    if (item.path.endsWith('.json')) {
      const json = JSON.parse(content);
      const keys = item.key?.split('.') ?? [];
      let value = json;
      for (const k of keys) {
        value = value?.[k];
      }
      assert.strictEqual(
        value,
        expectedVersion,
        `Expected ${item.key ?? 'root'} to be ${expectedVersion} in ${item.path}`
      );
    } else if (item.path.endsWith('.ts')) {
      // Regex to capture the constant
      const regex = new RegExp(`const\\s+${item.key}\\s*=\\s*['"]${expectedVersion}['"]`);
      assert.ok(regex.test(content), `Expected ${item.key} to be ${expectedVersion} in ${item.path}`);
    } else if (item.path === 'VERSION') {
      const trimmed = content.trim();
      assert.strictEqual(trimmed, expectedVersion, `Expected VERSION to be ${expectedVersion}`);
    } else {
      // For YAML and other formats
      const regex = new RegExp(`${item.key}\\s*:\\s*${expectedVersion}`);
      assert.ok(regex.test(content), `Expected ${item.key} to be ${expectedVersion} in ${item.path}`);
    }
  }
});

// Helper to run a script with optional args and env
function runScript(script: string, args: string[] = [], env: NodeJS.ProcessEnv = {}) {
  const scriptPath = resolve(__dirname, '..', '..', '..', script);
  assert.ok(existsSync(scriptPath), `Script not found: ${scriptPath}`);
  const result = spawnSync('node', [scriptPath, ...args], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return result;
}

// Test 2: Release workflow script runs successfully in dry-run mode
test('scripts/release-workflow.mjs runs with dry-run', () => {
  const result = runScript('scripts/release-workflow.mjs', ['--dry-run']);
  assert.strictEqual(result.status, 0, `Release workflow failed: ${result.stderr}`);
  // Expect the script to output the target version
  assert.ok(
    result.stdout.includes(expectedVersion),
    `Dry-run output does not contain expected version ${expectedVersion}`
  );
});

// Test 3: Version drift script reports no drift
test('scripts/check-version-drift.mjs reports no drift', () => {
  const result = runScript('scripts/check-version-drift.mjs');
  assert.strictEqual(result.status, 0, `check-version-drift failed: ${result.stderr}`);
  // The script prints a summary line; ensure it indicates no drift
  assert.ok(
    result.stdout.includes('All versions match'),
    `Expected no drift message, got: ${result.stdout}`
  );
});

// Test 4: Formula compatibility script passes for 3.30.0
test('scripts/check-formula-compat.mjs passes for 3.30.0', () => {
  const result = runScript('scripts/check-formula-compat.mjs', ['--version', expectedVersion], {
    // Provide minimal environment if needed
    PD_RELEASE_CREDENTIAL: 'dummy',
  });
  assert.strictEqual(result.status, 0, `check-formula-compat failed: ${result.stderr}`);
  assert.ok(
    result.stdout.includes('Formula compatibility verified'),
    `Expected success message, got: ${result.stdout}`
  );
});

// Test 5: Security constraint – release workflow does not accept a bypass flag
test('scripts/release-workflow.mjs does not expose a credential bypass flag', () => {
  const scriptPath = resolve(__dirname, '..', '..', '..', 'scripts/release-workflow.mjs');
  const content = readFileSync(scriptPath, 'utf8');
  // Common bypass patterns
  const bypassPatterns = [
    '--skip-credential-check',
    '--bypass-credential',
    '--no-credential-check',
    '--allow-unauthenticated',
    '--force-release',
  ];
  for (const pattern of bypassPatterns) {
    assert.ok(
      !content.includes(pattern),
      `Release workflow script contains disallowed bypass flag: ${pattern}`
    );
  }
});

// Test 6: Security constraint – release workflow requires a credential env var
test('scripts/release-workflow.mjs requires PD_RELEASE_CREDENTIAL env var', () => {
  const result = runScript('scripts/release-workflow.mjs', ['--dry-run'], {
    // No credential provided
  });
  // Expect failure due to missing credential
  assert.notStrictEqual(
    result.status,
    0,
    'Release workflow should fail without credential'
  );
  assert.ok(
    result.stderr.includes('PD_RELEASE_CREDENTIAL'),
    `Expected error about missing PD_RELEASE_CREDENTIAL, got: ${result.stderr}`
  );
});