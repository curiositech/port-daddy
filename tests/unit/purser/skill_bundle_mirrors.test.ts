// tests/unit/purser/skill_bundle_mirrors.test.ts

import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Resolve the repository root from this test file.
 * The test lives at <repo>/tests/unit/purser/skill_bundle_mirrors.test.ts
 * so we need to go up three levels.
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

// Runtime directories that must contain skill bundles with a `metadata.mirrors` entry.
const RUNTIME_DIRS = [".agents", ".codex", ".claude"] as const;

/**
 * Represents a discovered skill bundle.
 */
interface SkillBundle {
  /** Runtime directory (e.g. ".agents") */
  runtime: typeof RUNTIME_DIRS[number];
  /** Name of the skill directory under `skills/` */
  name: string;
  /** Absolute path to the SKILL.md file */
  skillMdPath: string;
}

/**
 * Scan the repository for all skill bundles under the supported runtime directories.
 */
async function discoverSkillBundles(): Promise<SkillBundle[]> {
  const bundles: SkillBundle[] = [];

  for (const runtime of RUNTIME_DIRS) {
    const skillsRoot = join(REPO_ROOT, runtime, "skills");
    try {
      const entries = await fs.readdir(skillsRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillDir = join(skillsRoot, entry.name);
        const skillMd = join(skillDir, "SKILL.md");
        bundles.push({
          runtime,
          name: entry.name,
          skillMdPath: skillMd,
        });
      }
    } catch (err) {
      // If a runtime directory or its `skills` sub‑folder does not exist,
      // we simply skip it – the contract only applies where the directory is present.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        // Unexpected error – surface it so the test suite fails loudly.
        throw err;
      }
    }
  }

  return bundles;
}

/**
 * Helper that validates a single SKILL.md file contains a non‑empty
 * `metadata.mirrors` mapping.
 *
 * The check is deliberately lightweight: we look for a line that
 * matches `metadata.mirrors:` (YAML style) or `metadata.mirrors =` (JSON style)
 * and ensure there is at least one non‑whitespace character after the colon/equal.
 */
async function hasValidMetadataMirrors(skillMdPath: string): Promise<boolean> {
  try {
    const content = await fs.readFile(skillMdPath, "utf8");
    // Capture the part after the key up to the end of the line.
    const match = content.match(/metadata\.mirrors\s*[:=]\s*(.+)/);
    if (!match) return false;
    // Consider the mapping valid if the captured value contains something
    // other than whitespace (i.e. not an empty mapping).
    return /\S/.test(match[1]);
  } catch {
    // If the file cannot be read, treat it as invalid.
    return false;
  }
}

/**
 * Primary test: every discovered skill bundle must declare a non‑empty
 * `metadata.mirrors` mapping.
 */
describe("Skill bundle metadata.mirrors enforcement", () => {
  test("all skill bundles declare a non‑empty metadata.mirrors mapping", async () => {
    const bundles = await discoverSkillBundles();

    // Collect any bundles that fail the check.
    const failing: string[] = [];

    for (const bundle of bundles) {
      const valid = await hasValidMetadataMirrors(bundle.skillMdPath);
      if (!valid) {
        failing.push(
          `${bundle.runtime}/skills/${bundle.name} (missing or empty metadata.mirrors)`,
        );
      }
    }

    // Jest will report the array contents nicely if the expectation fails.
    expect(failing).toEqual([]);
  });
});