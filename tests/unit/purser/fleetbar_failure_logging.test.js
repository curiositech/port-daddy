// tests/unit/purser/fleetbar_failure_logging.test.js
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  chmodSync,
  rmSync,
  mkdirSync,
} from 'fs';
import { tmpdir } from 'os';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..', '..');

/**
 * Create an executable mock script that simply exits with the given code.
 *
 * @param {string} dir   Directory where the script should be placed.
 * @param {string} name  Filename of the script (no extension needed).
 * @param {number} code  Exit code the script should return.
 * @returns {string} Absolute path to the created script.
 */
function makeMockScript(dir, name, code) {
  const scriptPath = resolve(dir, name);
  const content = `#!/usr/bin/env bash
# Mock ${name}
exit ${code}
`;
  writeFileSync(scriptPath, content, { mode: 0o755 });
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

/**
 * Parse a simple `key=value` state file into an object.
 *
 * @param {string} path Path to the state file.
 * @returns {Record<string,string>} Mapping of keys to values.
 */
function parseStateFile(path) {
  const raw = readFileSync(path, 'utf8');
  const lines = raw.split('\n').filter(Boolean);
  const map = {};
  for (const line of lines) {
    const [key, ...rest] = line.split('=');
    map[key] = rest.join('=');
  }
  return map;
}

describe('pd-app-watch.sh – FleetBar failure handling', () => {
  const originalEnv = { ...process.env };

  afterAll(() => {
    // Restore the parent environment to avoid side‑effects for other tests.
    process.env = originalEnv;
  });

  test('logs FleetBar failure but still records BUILT_MAIN_SHA when console succeeds', async () => {
    // -----------------------------------------------------------------
    // 1️⃣ Set up isolated temporary workspace
    // -----------------------------------------------------------------
    const tempRoot = mkdtempSync(resolve(tmpdir(), 'pd-app-watch-test-'));
    const logDir = resolve(tempRoot, 'logs');
    const stateFile = resolve(tempRoot, 'pd-app-watch.state');

    // Ensure the log directory exists – the script will write a file inside it.
    mkdirSync(logDir, { recursive: true });

    // -----------------------------------------------------------------
    // 2️⃣ Create mock binaries that the watch script will invoke
    // -----------------------------------------------------------------
    // The watch script expects `pd-console` and `fleetbar` on PATH.
    makeMockScript(tempRoot, 'pd-console', 0);   // succeeds
    makeMockScript(tempRoot, 'fleetbar', 1);    // fails

    // -----------------------------------------------------------------
    // 3️⃣ Prepare environment for the script
    // -----------------------------------------------------------------
    const env = {
      ...process.env,
      // Direct the script to our temporary locations.
      PD_BUILD_LOGS: logDir,
      PD_STATE_FILE: stateFile,
      // Prepend the temporary directory to PATH so our mocks shadow real binaries.
      PATH: `${tempRoot}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}`,
      // Explicitly initialise the lane‑status variables – the script should
      // overwrite them, but we start from a known clean state.
      LANE_CONSOLE_RC: '0',
      LANE_FLEETBAR_RC: '0',
      // Prevent any external side‑effects the script might try to perform.
      PD_FORCE_LATEST: '1',
      PD_FORCE_PROD: '1',
    };

    // -----------------------------------------------------------------
    // 4️⃣ Execute the watch script
    // -----------------------------------------------------------------
    const scriptPath = resolve(REPO_ROOT, 'scripts', 'pd-app-watch.sh');

    let execResult;
    try {
      execResult = await execFileAsync('bash', [scriptPath], { env });
    } catch (err) {
      // The contract states the overall exit code must follow LANE_CONSOLE_RC
      // (which is 0 in this scenario). Any non‑zero exit is a test failure.
      throw new Error(
        `pd-app-watch.sh exited with code ${err.code}\nstdout:\n${err.stdout}\nstderr:\n${err.stderr}`
      );
    }

    // -----------------------------------------------------------------
    // 5️⃣ Verify the script exited successfully (implicitly exit 0)
    // -----------------------------------------------------------------
    expect(execResult).toBeDefined();

    // -----------------------------------------------------------------
    // 6️⃣ Validate log output – FleetBar failure should be recorded but
    //    must not abort the lane.
    // -----------------------------------------------------------------
    const logPath = resolve(logDir, 'pd-app-watch.log');
    const logContent = readFileSync(logPath, 'utf8');

    expect(logContent).toMatch(/FleetBar.*failed/i);
    // The lane should still be considered successful; no fatal failure line.
    expect(logContent).not.toMatch(/lane build FAILED/i);

    // -----------------------------------------------------------------
    // 7️⃣ Validate state file – BUILT_MAIN_SHA must be present and non‑empty
    // -----------------------------------------------------------------
    const state = parseStateFile(stateFile);
    expect(state).toHaveProperty('BUILT_MAIN_SHA');
    expect(state.BUILT_MAIN_SHA).toBeTruthy();

    // -----------------------------------------------------------------
    // 8️⃣ Clean up temporary artifacts
    // -----------------------------------------------------------------
    rmSync(tempRoot, { recursive: true, force: true });
  });
});