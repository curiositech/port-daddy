// tests/unit/purser/swiftpm-build.test.ts
import { spawnSync, execSync } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// Resolve the directory of this test file in a module‑friendly way
const testDir = new URL('.', import.meta.url).pathname;

// tests/unit/purser -> tests/unit -> tests -> repo root. Three levels, not two:
// two lands on <repo>/tests/apps/pd-ios, which does not exist, so every path
// below resolved to nothing and the suite failed for a reason unrelated to the
// package it is meant to be checking.
const REPO_ROOT = path.join(testDir, '..', '..', '..');
const PD_IOS = path.join(REPO_ROOT, 'apps', 'pd-ios');

// The three build cases below shell out to xcodebuild, which exists only on
// macOS. This repo's own ci.yml runs the pd-ios job on macos-latest for that
// reason. On a Linux runner spawnSync cannot start the binary, so it returns
// `error` set and stdout/stderr UNDEFINED — which is why asserting on
// result.stderr reported "received value must be a string" rather than
// anything about the package. Skip honestly instead of failing dishonestly.
const hasXcodebuild = spawnSync('xcodebuild', ['-version'], { stdio: 'ignore' }).status === 0;
const testIfXcode = hasXcodebuild ? test : test.skip;

// Helper to run xcodebuild inside the apps/pd-ios directory
function runXcodebuild(args: string[], env: Record<string, string> = {}): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync('xcodebuild', args, {
    cwd: PD_IOS,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { stdout: result.stdout, stderr: result.stderr, status: result.status };
}

describe('SwiftPM build harness for apps/pd-ios', () => {
  test('Package.swift exists and is a SwiftPM package', async () => {
    const pkgPath = path.join(PD_IOS, 'Package.swift');
    const pkgExists = await fs.access(pkgPath).then(() => true).catch(() => false);
    expect(pkgExists).toBe(true);

    const pkgContent = await fs.readFile(pkgPath, 'utf8');
    // Must contain swift-tools-version and a library target
    expect(pkgContent).toMatch(/swift-tools-version:/);
    expect(pkgContent).toMatch(/\.library\(/);
    // Must specify iOS platform
    expect(pkgContent).toMatch(/platforms:\s*\[\s*\.iOS\(.+?\)/);
  });

  test('No .xcodeproj present in the pd-ios directory', async () => {
    const dir = PD_IOS;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    // An .xcodeproj is a DIRECTORY, not a file: filtering on isFile() made this
    // assertion vacuous — it passed with an .xcodeproj sitting right there.
    const projFiles = entries.filter((e) => e.name.endsWith('.xcodeproj'));
    expect(projFiles.length).toBe(0);
  });

  testIfXcode('xcodebuild can build the library target for iOS Simulator', () => {
    // Build the library scheme
    const { status, stdout, stderr } = runXcodebuild(
      [
        'build',
        '-scheme',
        'PortDaddyKit',
        '-destination',
        'generic/platform=iOS Simulator',
        '-skipMacroValidation',
        'CODE_SIGNING_ALLOWED=NO',
      ],
      { CODE_SIGNING_ALLOWED: 'NO' }
    );
    expect(status).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toMatch(/Build succeeded/);
  });

  testIfXcode('Build fails when the target is changed to an executable', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pd-ios-test-'));
    // Copy the original Package.swift
    const srcPkg = path.join(PD_IOS, 'Package.swift');
    const dstPkg = path.join(tmpDir, 'Package.swift');
    let content = await fs.readFile(srcPkg, 'utf8');
    // Replace library target with executableTarget
    content = content.replace(/\.library\(/, '.executableTarget(');
    await fs.writeFile(dstPkg, content, 'utf8');

    // Run xcodebuild in the temp directory
    const result = spawnSync('xcodebuild', ['build', '-scheme', 'PortDaddyKit', '-destination', 'generic/platform=iOS Simulator', '-skipMacroValidation', 'CODE_SIGNING_ALLOWED=NO'], {
      cwd: tmpDir,
      env: { ...process.env, CODE_SIGNING_ALLOWED: 'NO' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/error: unable to find target/);
    // Clean up
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  testIfXcode('Build fails with malformed Package.swift', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pd-ios-test-'));
    // Create a malformed Package.swift (missing package declaration)
    const malformed = `import PackageDescription\nlet package = Package(name: "Bad")`;
    await fs.writeFile(path.join(tmpDir, 'Package.swift'), malformed, 'utf8');

    const result = spawnSync('xcodebuild', ['build', '-scheme', 'PortDaddyKit', '-destination', 'generic/platform=iOS Simulator', '-skipMacroValidation', 'CODE_SIGNING_ALLOWED=NO'], {
      cwd: tmpDir,
      env: { ...process.env, CODE_SIGNING_ALLOWED: 'NO' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/error: package name is missing/);
    // Clean up
    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});