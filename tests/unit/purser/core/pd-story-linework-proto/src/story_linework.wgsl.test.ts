// tests/unit/purser/core/pd-story-linework-proto/src/story_linework.wgsl.test.ts

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve the WGSL shader source relative to the repository root.
const shaderPath = resolve(
  __dirname,
  // tests/unit/purser/core/pd-story-linework-proto/src  ->  ../../../../../core/pd-story-linework-proto/src/
  "../../../../../core/pd-story-linework-proto/src/story_linework.wgsl",
);
const shaderSource = readFileSync(shaderPath, "utf8");

describe("story_linework.wgsl – shader contract compliance", () => {
  test("contains the Uniforms struct with the expected layout", () => {
    // The Uniforms struct must expose two vec4f rows (row0 and row1).
    expect(shaderSource).toMatch(
      /struct\s+Uniforms\s*{\s*row0\s*:\s*vec4f\s*,\s*row1\s*:\s*vec4f\s*}/,
    );

    // Verify that the uniform binding is declared exactly as required.
    expect(shaderSource).toMatch(
      /@group\(0\)\s*@binding\(0\)\s*var<uniform>\s+U\s*:\s*Uniforms/,
    );
  });

  test("exposes vertex and fragment entry points", () => {
    expect(shaderSource).toMatch(/@vertex\s+fn\s+vs_main\s*\(/);
    expect(shaderSource).toMatch(/@fragment\s+fn\s+fs_main\s*\(/);
  });

  test("uniform buffer size matches eight f32 values (32 bytes)", () => {
    // Each vec4f contributes 4 f32 components → 2 × 4 = 8 components.
    const vec4Matches = shaderSource.match(/vec4f/g) ?? [];
    expect(vec4Matches.length).toBe(2);
  });

  test("defines the expected colour constants", () => {
    const colourConsts = [
      "PAPER",
      "INK",
      "DARK",
      "PANEL",
      "LINE",
      "COBALT",
      "COBALT_SOFT",
      "KELP",
      "HEALTH",
      "LIME",
      "GOLD",
      "CORAL",
      "VIOLET",
      "FOAM",
      "MUTED",
    ];
    for (const name of colourConsts) {
      const re = new RegExp(`const\\s+${name}\\s*:\\s*vec3f`);
      expect(shaderSource).toMatch(re);
    }
  });

  test("contains the dithering / hatch helper with the expected pattern", () => {
    // The hatch function should use a fract‑based pattern that divides by 12.0.
    expect(shaderSource).toMatch(
      /fn\s+hatch\s*\([^)]*\)\s*->\s*vec3f\s*{[^}]*fract\([^)]*\/\s*12\.0\)/,
    );
  });

  test("uses the time uniform to drive a pulse animation", () => {
    // The fragment shader must compute a pulse using sin(t * 1.35).
    expect(shaderSource).toMatch(
      /let\s+pulse\s*=\s*0\.5\s*\+\s*0\.5\s*\*\s*sin\s*\(\s*t\s*\*\s*1\.35\s*\)/,
    );
  });

  test("exposes a motion uniform that is clamped between 0.0 and 1.0", () => {
    // Verify that the motion uniform is read from row1.x and clamped.
    expect(shaderSource).toMatch(
      /let\s+motion\s*=\s*U\.row1\.x\s*\.clamp\(\s*0\.0\s*,\s*1\.0\s*\)/,
    );
  });

  test("includes the expected panel rendering helpers", () => {
    // Functions that draw panels, corners, and strokes are part of the visual language.
    const helpers = ["panel_shell", "corner_frame", "stroke_rect", "rect_mask"];
    for (const fn of helpers) {
      const re = new RegExp(`fn\\s+${fn}\\s*\\(`);
      expect(shaderSource).toMatch(re);
    }
  });
});