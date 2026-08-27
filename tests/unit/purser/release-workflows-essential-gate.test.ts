// tests/unit/purser/release-workflows-essential-gate.test.ts
import { execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';

describe('Release workflow essential gate – credential validation (fail‑closed)', () => {
  const credentialCheckScript = `
set -euo pipefail
: "\${APPLE_CERT_P12_BASE64:?FleetBar release requires APPLE_CERT_P12_BASE64}"
: "\${APPLE_CERT_PASSWORD:?FleetBar release requires APPLE_CERT_PASSWORD}"
: "\${APPLE_NOTARY_KEY_P8_BASE64:?FleetBar release requires APPLE_NOTARY_KEY_P8_BASE64}"
: "\${APPLE_NOTARY_KEY_ID:?FleetBar release requires APPLE_NOTARY_KEY_ID}"
: "\${APPLE_NOTARY_KEY_ISSUER:?FleetBar release requires APPLE_NOTARY_KEY_ISSUER}"
echo "All credentials present"
`.trim();

  const makeScript = (dir: string) => {
    const scriptPath = join(dir, 'cred-check.sh');
    writeFileSync(scriptPath, credentialCheckScript, { mode: 0o755 });
    return scriptPath;
  };

  test('fails when any required credential env var is missing', () => {
    const workDir = mkdtempSync(join(tmpdir(), 'cred-check-'));
    const scriptPath = makeScript(workDir);

    // Run without any env vars – should exit with non‑zero status
    const result = spawnSync('bash', [scriptPath], { env: {} });
    expect(result.status).not.toBe(0);
    expect(result.stderr.toString()).toMatch(/FleetBar release requires APPLE_CERT_P12_BASE64/);

    // Provide all vars – should succeed
    const env = {
      ...process.env,
      APPLE_CERT_P12_BASE64: 'dummy',
      APPLE_CERT_PASSWORD: 'dummy',
      APPLE_NOTARY_KEY_P8_BASE64: 'dummy',
      APPLE_NOTARY_KEY_ID: 'dummy',
      APPLE_NOTARY_KEY_ISSUER: 'dummy',
    };
    const okResult = spawnSync('bash', [scriptPath], { env });
    expect(okResult.status).toBe(0);
    expect(okResult.stdout.toString()).toMatch(/All credentials present/);

    rmSync(workDir, { recursive: true, force: true });
  });
});

describe('build-latest-json.mjs – FleetBar manifest enforcement', () => {
  const distRoot = mkdtempSync(join(tmpdir(), 'build-latest-json-'));
  const distDir = join(distRoot, 'dist');
  const fleetbarDir = join(distDir, 'fleetbar');
  const outputPath = join(distDir, 'latest.json');

  const makeZip = (name: string) => {
    const zipPath = join(distDir, name);
    writeFileSync(zipPath, 'dummy zip content');
    return zipPath;
  };

  const sha256 = (filePath: string) => {
    // Simple SHA‑256 using openssl for deterministic output in tests
    return execSync(`openssl sha256 -r "${filePath}"`).toString().split(' ')[0];
  };

  const writeManifest = (manifest: Record<string, unknown>) => {
    const manifestPath = join(fleetbarDir, 'fleetbar-preview-manifest.json');
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    return manifestPath;
  };

  const runBuild = (args: string[]) => {
    const cmd = ['node', 'scripts/build-latest-json.mjs', ...args];
    return spawnSync(cmd[0], cmd.slice(1), {
      cwd: process.cwd(),
      env: { ...process.env },
      encoding: 'utf-8',
    });
  };

  beforeAll(() => {
    // create directory layout expected by the script
    writeFileSync(distDir, '', { flag: 'a' });
    writeFileSync(fleetbarDir, '', { flag: 'a' });
  });

  afterAll(() => {
    rmSync(distRoot, { recursive: true, force: true });
  });

  test('exits with error when FleetBar manifest is missing', () => {
    const zip = makeZip('PortDaddy-FleetBar-macOS-1.0.zip');
    const args = [
      '--tag', 'v0.0.0-test',
      '--dist', distDir,
      '--out', outputPath,
      '--repo', 'test/repo',
      '--signed',
    ];
    const result = runBuild(args);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/FleetBar release manifest is required/);
  });

  test('exits with error when manifest is malformed JSON', () => {
    const zip = makeZip('PortDaddy-FleetBar-macOS-1.0.zip');
    const manifestPath = writeManifest({}); // placeholder
    // corrupt the file
    writeFileSync(manifestPath, '{ not json');
    const args = [
      '--tag', 'v0.0.0-test',
      '--dist', distDir,
      '--out', outputPath,
      '--repo', 'test/repo',
      '--signed',
    ];
    const result = runBuild(args);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/malformed JSON/);
  });

  test('exits with error when manifest indicates unsigned or not notarized', () => {
    const zip = makeZip('PortDaddy-FleetBar-macOS-1.0.zip');
    const manifest = {
      unsigned: true,
      notarized: false,
      artifact: basename(zip),
      sha256: sha256(zip),
    };
    writeManifest(manifest);
    const args = [
      '--tag', 'v0.0.0-test',
      '--dist', distDir,
      '--out', outputPath,
      '--repo', 'test/repo',
      '--signed',
    ];
    const result = runBuild(args);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/not shippable/);
  });

  test('exits with error when artifact name mismatches manifest', () => {
    const zip = makeZip('PortDaddy-FleetBar-macOS-1.0.zip');
    const manifest = {
      unsigned: false,
      notarized: true,
      artifact: 'different-name.zip',
      sha256: sha256(zip),
    };
    writeManifest(manifest);
    const args = [
      '--tag', 'v0.0.0-test',
      '--dist', distDir,
      '--out', outputPath,
      '--repo', 'test/repo',
      '--signed',
    ];
    const result = runBuild(args);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/artifact mismatch/);
  });

  test('exits with error when SHA‑256 does not match manifest', () => {
    const zip = makeZip('PortDaddy-FleetBar-macOS-1.0.zip');
    const manifest = {
      unsigned: false,
      notarized: true,
      artifact: basename(zip),
      sha256: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    };
    writeManifest(manifest);
    const args = [
      '--tag', 'v0.0.0-test',
      '--dist', distDir,
      '--out', outputPath,
      '--repo', 'test/repo',
      '--signed',
    ];
    const result = runBuild(args);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/sha256 does not match/);
  });

  test('succeeds and marks FleetBar as signed when manifest is valid', () => {
    const zip = makeZip('PortDaddy-FleetBar-macOS-1.0.zip');
    const manifest = {
      unsigned: false,
      notarized: true,
      artifact: basename(zip),
      sha256: sha256(zip),
    };
    writeManifest(manifest);
    const args = [
      '--tag', 'v0.0.0-test',
      '--dist', distDir,
      '--out', outputPath,
      '--repo', 'test/repo',
      '--signed',
    ];
    const result = runBuild(args);
    expect(result.status).toBe(0);
    const latest = JSON.parse(readFileSync(outputPath, 'utf8'));
    const fleetbarEntry = latest.artifacts.find((a: any) => a.surface === 'fleetbar');
    expect(fleetbarEntry).toBeDefined();
    expect(fleetbarEntry.signed).toBe(true);
  });
});