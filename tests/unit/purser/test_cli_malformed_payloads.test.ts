// tests/unit/purser/test_cli_malformed_payloads.test.ts

import { spawnSync } from "child_process";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import path from "path";

/**
 * Helper to locate the CLI entry point (`bin/pd-hook-prompt`) relative to this test file.
 * The repository is an ES‑module project, so we resolve the path via `import.meta.url`.
 */
function getCliPath(): string {
  const thisFile = fileURLToPath(import.meta.url);
  // tests/unit/purser/… → repo root → bin/pd-hook-prompt
  return path.resolve(thisFile, "../../../bin/pd-hook-prompt");
}

/**
 * Executes the CLI with the given arguments and returns the spawned result.
 * The function always runs the script with `node` (so we don't rely on the shebang
 * being executable in the test environment) and forces UTF‑8 encoding for easy
 * string assertions.
 */
function runCli(args: string[]): ReturnType<typeof spawnSync> {
  const cliPath = getCliPath();
  return spawnSync("node", [cliPath, ...args], {
    encoding: "utf-8",
    // Prevent the child from inheriting the parent stdio – we capture output instead.
    stdio: "pipe",
  });
}

/**
 * Creates a temporary file containing the supplied content and returns its absolute
 * path. The caller is responsible for cleaning the file up via `rmSync(..., { force: true })`.
 */
function writeTempFile(content: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "pd-cli-test-"));
  const filePath = path.join(dir, "payload.json");
  writeFileSync(filePath, content, { encoding: "utf-8" });
  return filePath;
}

/**
 * Clean up a temporary file or directory created by `writeTempFile`.
 */
function cleanTempPath(filePath: string): void {
  // `filePath` is a file inside a temporary directory; remove the whole directory.
  rmSync(path.dirname(filePath), { recursive: true, force: true });
}

describe("CLI nudge command – malformed payload handling", () => {
  test("exits with a non‑zero status and reports a JSON parse error for malformed input", () => {
    const malformedJson = `{ "foo": "bar", `; // deliberately broken JSON
    const payloadPath = writeTempFile(malformedJson);

    const result = runCli(["nudge", "--payload", payloadPath]);

    // The CLI must not crash (no spawn error) and must signal failure via exit code.
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    // The error message should mention JSON or parsing.
    expect(result.stderr).toMatch(/json|parse/i);

    cleanTempPath(payloadPath);
  });

  test("--mermaid flag does not hide the JSON‑parse failure", () => {
    const malformedJson = `["unclosed array"`; // another malformed payload
    const payloadPath = writeTempFile(malformedJson);

    const result = runCli([
      "nudge",
      "--payload",
      payloadPath,
      "--mermaid",
    ]);

    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/json|parse/i);

    cleanTempPath(payloadPath);
  });
});