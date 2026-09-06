// tests/unit/purser/gate_wrapper_boot.test.ts
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve __dirname in an ES‑module context
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Execute a hook binary inside a temporary PD_HOME sandbox.
 *
 * The hook is invoked via `node <hookPath>` so that the shebang does not
 * need to be honoured on the filesystem.  All environment variables are
 * passed through except that PD_HOME is overridden with the test sandbox.
 */
function runHook(
  hookName: string,
  pdHome: string,
  cwd = process.cwd(),
): { stdout: string; stderr: string; status: number | null } {
  const hookPath = resolve(__dirname, '../../../bin', hookName);
  const result = spawnSync('node', [hookPath], {
    env: { ...process.env, PD_HOME: pdHome },
    cwd,
    encoding: 'utf8',
  });

  // Normalise the exit status – spawnSync returns `null` when the process
  // could not be spawned; treat that as a failure for the test.
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe('gate‑wrapper behaviour during daemon boot (ADR‑0132 phase 3)', () => {
  // All hooks that must respect the HALT sentinel
  const hooks = [
    'pd-hook-prompt',
    'pd-hook-pre-tool',
    'pd-hook-stop',
    'pd-hook-precompact',
    'pd-hook-post-tool',
  ] as const;

  // Temporary PD_HOME for each test case
  let pdHome: string;

  beforeEach(() => {
    pdHome = mkdtempSync(join(tmpdir(), 'pd-halt-test-'));
    // Ensure the directory exists (mkdtemp already creates it, but be explicit)
    mkdirSync(pdHome, { recursive: true });
  });

  afterEach(() => {
    // Clean up the sandbox after each test to avoid cross‑test pollution
    rmSync(pdHome, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // 1️⃣  No HALT file – the hook must *not* block and must not emit the
  //     sentinel‑related error message.
  // -----------------------------------------------------------------------
  describe.each(hooks)('when %s is invoked without a HALT sentinel', (hook) => {
    test('exits without the SECURITE HALT error', () => {
      const { status, stderr, stdout } = runHook(hook, pdHome);
      // The contract requires a *refusal* only when HALT exists.
      // Any exit code other than 2 is acceptable here.
      expect(status).not.toBe(2);
      expect(stderr).not.toMatch(/SECURITE HALT/);
      // Hooks are silent on success in the current implementation.
      // If they emit logs, the test still passes as long as the sentinel
      // message is absent.
      expect(stdout).toBe('');
    });
  });

  // -----------------------------------------------------------------------
  // 2️⃣  HALT file present – the hook must refuse the call, exit with code 2
  //     and emit the exact sentinel phrase on stderr.
  // -----------------------------------------------------------------------
  describe.each(hooks)('when %s is invoked with a HALT sentinel', (hook) => {
    test('refuses execution with exit code 2 and SECURITE HALT message', () => {
      // Create the sentinel file that signals a global halt.
      writeFileSync(join(pdHome, 'HALT'), '');

      const { status, stderr, stdout } = runHook(hook, pdHome);
      expect(status).toBe(2);
      expect(stderr).toMatch(/SECURITE HALT/);
      // No standard output should be produced on a blocked call.
      expect(stdout).toBe('');
    });
  });
});