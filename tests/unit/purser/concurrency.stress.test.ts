// tests/unit/purser/concurrency.stress.test.ts
import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const execFileAsync = promisify(execFile);

// Resolve the path to the screenshot‑capture script that builds the iOS UI.
// The script lives at <repo‑root>/scripts/capture-screenshots.sh.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const captureScript = path.resolve(__dirname, "../../scripts/capture-screenshots.sh");

// Helper that runs the capture script and resolves only on a zero‑exit code.
// Any non‑zero exit (including crashes, missing assets, or early termination)
// causes the promise to reject with a detailed error.
function runCapture(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!existsSync(captureScript)) {
      return reject(
        new Error(`Capture script not found at expected location: ${captureScript}`),
      );
    }

    // `shell: true` lets the script run as a normal POSIX shell script.
    const child = execFile(captureScript, { shell: true }, (error, stdout, stderr) => {
      if (error) {
        const msg = [
          `❌ capture‑script failed (code ${error.code})`,
          `--- STDOUT ---`,
          stdout,
          `--- STDERR ---`,
          stderr,
        ].join("\n");
        reject(new Error(msg));
      } else {
        resolve();
      }
    });

    // Propagate any unexpected spawn errors (e.g., ENOENT).
    child.on("error", (spawnErr) => reject(spawnErr));
  });
}

/**
 * Stress test that simulates two concurrent view‑appearances that each trigger
 * a fixture load. The intent‑first UI loads data lazily when it appears; a race
 * between the appearance animation and the fixture decoding could surface a
 * nil‑dereference or a capture‑leak (e.g., a dangling reference to a view that
 * never finished mounting). By launching two independent capture runs in
 * parallel we force the underlying sandbox / UI code to handle the race safely.
 *
 * The test passes only if **both** processes exit cleanly (exit code 0). Any
 * crash, assertion failure, or resource‑leak detection that causes a non‑zero
 * exit will fail the test, surfacing the very race condition the contract
 * demands be guarded against.
 */
describe("Concurrency stress: view appearance vs fixture load", () => {
  // The iOS build can be heavy; give the test ample time.
  jest.setTimeout(300_000); // 5 minutes

  test("simultaneous captures must not crash or leak", async () => {
    // Run two independent captures side‑by‑side.
    await Promise.all([runCapture(), runCapture()]);
  });
});