// tests/unit/purser/navigation-granularity.test.ts

import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Resolve __dirname in an ES‑module context.
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Repository‑root relative helpers.
 */
const repoRoot = path.resolve(__dirname, "../../..");
const graphCanvasPath = path.join(
  repoRoot,
  "demos/mission-control-reactflow/src/components/GraphCanvas.tsx",
);
const graftMapPath = path.join(
  repoRoot,
  "demos/mission-control-reactflow/GPUI-GRAFT-MAP.md",
);

/**
 * Helper to extract the “Rejected grafts” markdown section.
 */
function extractRejectedSection(md: string): string {
  const match = md.match(/##\s*Rejected grafts([\s\S]*?)(?:\n##|$)/i);
  return match ? match[1] : "";
}

/**
 * Navigation‑granularity contract tests.
 *
 * 1️⃣ Verify that a single click (without modifiers) is the only path that
 *    opens the Inspector.  The implementation must explicitly guard against
 *    `event.shiftKey` (Shift‑click) and `event.detail > 1` (double‑click) so
 *    that those interactions cannot bypass the inspector‑open flow.
 *
 * 2️⃣ Verify that the GPUI‑GRAFT‑MAP declares React and Zustand as rejected
 *    grafts, ensuring the Rust port’s contract boundary is respected.
 */
describe("Mission Control interaction contracts", () => {
  test("GraphCanvas click handler enforces single‑click, non‑Shift, non‑double‑click", async () => {
    const source = await fs.readFile(graphCanvasPath, "utf-8");

    // The component must contain a guard for Shift‑click.
    // We look for any reference to `event.shiftKey` inside an onClick/onMouseDown handler.
    const shiftGuard = /on(?:Click|MouseDown)\s*=\s*\{[^}]*event\.shiftKey[^}]*\}/s;
    expect(source).toMatch(
      shiftGuard,
      "GraphCanvas should explicitly check `event.shiftKey` to reject Shift‑clicks.",
    );

    // The component must also reject double‑clicks (event.detail > 1).
    const doubleClickGuard = /event\.detail\s*>\s*1/;
    expect(source).toMatch(
      doubleClickGuard,
      "GraphCanvas should explicitly check `event.detail > 1` to reject double‑clicks.",
    );
  });

  test("GPUI‑GRAFT‑MAP lists React and Zustand as rejected grafts", async () => {
    const md = await fs.readFile(graftMapPath, "utf-8");
    const rejected = extractRejectedSection(md);

    // Ensure the section exists.
    expect(rejected).not.toBe(
      "",
      "GPUI‑GRAFT‑MAP must contain a ‘Rejected grafts’ section.",
    );

    // Verify the required entries.
    expect(rejected).toMatch(
      /React/i,
      "React must be listed as a rejected graft in GPUI‑GRAFT‑MAP.",
    );
    expect(rejected).toMatch(
      /Zustand/i,
      "Zustand must be listed as a rejected graft in GPUI‑GRAFT‑MAP.",
    );
  });
});