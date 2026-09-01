// tests/unit/purser/ad-hoc-fallback.test.ts
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("package-apps.sh ad‑hoc signing guard", () => {
  test("rejects ad‑hoc signing when --allow-ad-hoc is omitted and signing identity is empty", () => {
    // Resolve the script relative to this test file
    const scriptPath = path.resolve(
      __dirname,
      "../../../apps/porthole-stage-capture/Scripts/package-apps.sh"
    );

    // Create a fresh temporary directory for the output bundle
    const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "porthole-test-"));

    // Invoke the script with an empty signing identity ("") but without the
    // `--allow-ad-hoc` flag. The script should refuse to fall back and exit
    // with a non‑zero status, printing a clear error message.
    const result = spawnSync(
      "zsh",
      [
        scriptPath,
        "--configuration",
        "debug",
        "--output",
        outputRoot,
        "--signing-identity",
        "", // empty identity forces the script to consider ad‑hoc
      ],
      {
        encoding: "utf-8",
      }
    );

    // Clean up the temporary directory regardless of outcome
    try {
      fs.rmSync(outputRoot, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }

    // The script must fail (non‑zero exit) and emit the expected guard message.
    expect(result.status).not.toBe(0);
    // Many implementations exit with code 6 for this condition; assert if present.
    if (result.status !== null) {
      expect(result.status).toBe(6);
    }

    const stderr = result.stderr as string;
    expect(stderr).toMatch(
      /ad‑hoc signing requires explicit --allow-ad-hoc and is forbidden for TCC proof/i
    );
  });
});