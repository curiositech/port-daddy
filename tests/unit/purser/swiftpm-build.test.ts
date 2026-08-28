// tests/unit/purser/swiftpm-build.test.ts
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec as execCallback, execSync } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execCallback);

/**
 * Run `xcrun swift build` inside a directory.
 * Returns stdout, stderr and the process exit code.
 */
async function runSwiftPMBuild(
  cwd: string,
  timeoutMs = 60_000,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await exec('xcrun swift build', {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (e: any) {
    // exec throws on non‑zero exit; capture its output.
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      exitCode: typeof e.code === 'number' ? e.code : 1,
    };
  }
}

/**
 * Conditionally run a test only when Xcode is available on macOS.
 * If not on macOS or Xcode cannot be located, the test is skipped.
 */
function testIfXcode(
  name: string,
  fn: () => Promise<void>,
  timeout?: number,
): void {
  const isDarwin = process.platform === 'darwin';
  if (!isDarwin) {
    test.skip(`${name} (skipped – not macOS)`, fn);
    return;
  }

  try {
    execSync('xcode-select -p', { stdio: 'ignore' });
  } catch {
    test.skip(`${name} (skipped – Xcode not found)`, fn);
    return;
  }

  if (typeof timeout === 'number') {
    test(name, fn, timeout);
  } else {
    test(name, fn);
  }
}

/**
 * Helper: copy the pd-ios SwiftPM project to a fresh temporary directory.
 */
async function copyPdIosProject(): Promise<string> {
  const src = path.resolve('apps', 'pd-ios');
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pd-ios-test-'));
  await fs.cp(src, tmpDir, { recursive: true });
  return tmpDir;
}

/**
 * Test suite for the SwiftPM build harness used by the iOS Purser tooling.
 */
describe('SwiftPM build harness for apps/pd-ios', () => {
  testIfXcode('Build succeeds with valid Package.swift', async () => {
    const tmpDir = await copyPdIosProject();

    try {
      const result = await runSwiftPMBuild(tmpDir);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/build succeeded/i);
    } finally {
      // Ensure temporary artefacts are always removed.
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  // This test is the one that required the extended timeout.
  testIfXcode(
    'Build fails when the target is changed to an executable',
    async () => {
      const tmpDir = await copyPdIosProject();

      try {
        // Locate Package.swift and flip the product type from library → executable.
        const pkgPath = path.join(tmpDir, 'Package.swift');
        let pkgContent = await fs.readFile(pkgPath, 'utf8');

        // Very simple substitution; works for the current repo layout.
        pkgContent = pkgContent.replace(
          /\.library\s*\(/,
          '.executable(',
        );

        await fs.writeFile(pkgPath, pkgContent, 'utf8');

        // Run the build and expect failure.
        const result = await runSwiftPMBuild(tmpDir, 120_000);
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toMatch(/error:/i);
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    },
    120_000, // explicit 2‑minute timeout as required by the contract
  );

  testIfXcode('Build fails with malformed Package.swift', async () => {
    const tmpDir = await copyPdIosProject();

    try {
      const pkgPath = path.join(tmpDir, 'Package.swift');
      // Overwrite with syntactically invalid Swift code.
      await fs.writeFile(pkgPath, 'THIS IS NOT VALID SWIFT PACKAGE', 'utf8');

      const result = await runSwiftPMBuild(tmpDir);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toMatch(/error:/i);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});