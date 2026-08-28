// tests/unit/purser/atlas-id-drift-duplicate.test.ts
import { execFileSync } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Repository root (tests/unit/purser/… → repo root)
const REPO_ROOT = path.resolve(__dirname, "../../../");

// Paths we will touch
const ATLAS_PATH = path.join(
  REPO_ROOT,
  "skills/whitepaper-figure-system/references/semantic-figure-atlas.md"
);
const TEX_ROOT = path.join(REPO_ROOT, "whitepaper");
const TMP_TEX_PATH = path.join(TEX_ROOT, "tmp_duplicate_test.tex");
const SCRIPT_PATH = path.join(
  REPO_ROOT,
  "skills/whitepaper-figure-system/scripts/check_atlas_coverage.py"
);

describe("check_atlas_coverage detects duplicate IDs and label drift", () => {
  let originalAtlas: string;
  let originalTmpTexExists = false;
  let originalTmpTexContent = "";
  let duplicatedId = "";

  // -------------------------------------------------------------------------
  // Prepare a polluted atlas (duplicate entry) and a stray TeX label.
  // -------------------------------------------------------------------------
  beforeAll(async () => {
    // ----- back‑up original atlas ------------------------------------------------
    originalAtlas = await fs.readFile(ATLAS_PATH, "utf8");

    // ----- locate an existing ID -------------------------------------------------
    const idMatch = originalAtlas.match(/`([^`]*\/fig:[^`]*)`/);
    if (!idMatch) {
      throw new Error("Could not locate a figure ID inside the atlas for duplication");
    }
    duplicatedId = idMatch[1]; // e.g. I/fig:stack-map

    // ----- inject a duplicate ID (reuse the first real ID in the file) ------------
    const duplicateLine = `\n| \`${duplicatedId}\` | Duplicate entry for testing | Dummy grammar | Dummy must‑encode | Dummy reject |\n`;
    await fs.appendFile(ATLAS_PATH, duplicateLine, "utf8");

    // ----- ensure the TeX root exists -------------------------------------------
    await fs.mkdir(TEX_ROOT, { recursive: true });

    // ----- back‑up any pre‑existing temporary file -------------------------------
    try {
      originalTmpTexContent = await fs.readFile(TMP_TEX_PATH, "utf8");
      originalTmpTexExists = true;
    } catch {
      originalTmpTexExists = false;
    }

    // ----- write a figure with a label that does NOT appear in the atlas ----------
    const texContent = `
\\begin{figure}
  \\centering
  \\caption{Test figure for drift detection}
  \\label{tmp:drift}
\\end{figure}
`;
    await fs.writeFile(TMP_TEX_PATH, texContent, "utf8");
  }, 30_000); // generous timeout for file I/O

  // -------------------------------------------------------------------------
  // Restore repository state after the test.
  // -------------------------------------------------------------------------
  afterAll(async () => {
    // Restore original atlas content
    await fs.writeFile(ATLAS_PATH, originalAtlas, "utf8");

    // Restore or delete the temporary TeX file
    if (originalTmpTexExists) {
      await fs.writeFile(TMP_TEX_PATH, originalTmpTexContent, "utf8");
    } else {
      try {
        await fs.unlink(TMP_TEX_PATH);
      } catch {
        // ignore if it does not exist
      }
    }
  });

  test("script exits non‑zero and reports both duplicate ID and missing label", () => {
    let caughtError: any = null;

    try {
      // The script is expected to exit with a non‑zero status on failure.
      execFileSync("python3", [SCRIPT_PATH], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      caughtError = err;
    }

    // The script must have failed; otherwise the test is ineffective.
    expect(caughtError).not.toBeNull();

    // Combine stdout and stderr for inspection.
    const stdout = caughtError?.stdout?.toString?.() ?? "";
    const stderr = caughtError?.stderr?.toString?.() ?? "";
    const combined = `${stdout}\n${stderr}`;

    // The duplicated ID should be mentioned.
    expect(combined).toMatch(new RegExp(duplicatedId));

    // The stray label `tmp:drift` should be reported as drift.
    expect(combined).toMatch(/tmp:drift/);
  });
});