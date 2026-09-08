import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const entitlementName = 'com.apple.security.cs.allow-dyld-environment-variables';

test('release signing input and workflow keep the DYLD injection entitlement absent', () => {
  const entitlements = readFileSync(
    resolve(repoRoot, 'scripts', 'entitlements', 'port-daddy.plist'),
    'utf8',
  );
  const signingScript = readFileSync(resolve(repoRoot, 'scripts', 'sign-and-notarize.mjs'), 'utf8');
  const releaseWorkflow = readFileSync(resolve(repoRoot, '.github', 'workflows', 'release.yml'), 'utf8');

  expect(entitlements).not.toContain(entitlementName);
  expect(signingScript).toContain("scripts', 'entitlements', 'port-daddy.plist");
  expect(releaseWorkflow).toContain('Smoke exact release semantic runtime (post-sign on macOS)');
  expect(releaseWorkflow).toContain('dist/pd __semantic-runtime-check');
});

const artifactPath = resolve(repoRoot, 'dist', 'port-daddy');
const signedArtifactTest = process.platform === 'darwin' && existsSync(artifactPath)
  ? test
  : test.skip;

signedArtifactTest('a locally built signed artifact omits the DYLD injection entitlement', () => {
  const result = spawnSync('codesign', ['-d', '--entitlements', ':-', artifactPath], {
    encoding: 'utf8',
  });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(`${result.stdout}${result.stderr}`).not.toContain(entitlementName);
});
