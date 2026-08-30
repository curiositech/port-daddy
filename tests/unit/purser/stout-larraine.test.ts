// @ts-nocheck
/**
 * tests/unit/purser/stout-larraine.test.ts
 *
 * Adversarial containment audit for the new Mission‑first console flow.
 *
 * This test inspects the Rust source of the terminal drawer and the main
 * application entry point to ensure that:
 *
 * 1. Geometry constants are declared with the correct types and values.
 * 2. The `height_px` helper clamps to the defined limits.
 * 3. PTY row synchronization occurs immediately when the drawer geometry
 *    changes (no stale rows, no scroll‑leakage).
 * 4. `CmdKind::Mission` handling in `app.rs` restores the exact operator‑turn
 *    transcript from the daemon without duplicate SSE playback.
 *
 * The test deliberately reads the source as plain text and validates the
 * presence of the expected patterns.  If the implementation deviates, the
 * regexes will fail, surfacing a contract breach before the PR lands.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve repository root from this test file (tests/unit/purser/)
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const APP_RS_PATH = join(REPO_ROOT, 'core', 'pd-console', 'src', 'app.rs');
const DRAWER_RS_PATH = join(REPO_ROOT, 'core', 'pd-console', 'src', 'shell_drawer.rs');

/**
 * Utility: read a file as UTF‑8 string.
 */
function loadFile(path: string): string {
  return readFileSync(path, { encoding: 'utf8' });
}

describe('Console Mission‑first flow – adversarial containment audit', () => {
  const appRs = loadFile(APP_RS_PATH);
  const drawerRs = loadFile(DRAWER_RS_PATH);

  /**
   * 1️⃣ Geometry constants – must exist, be f64, and match the spec.
   */
  test('drawer geometry constants exist with correct types and values', () => {
    // Minimum drawer height in pixels
    expect(drawerRs).toMatch(
      /pub\s+const\s+MIN_DRAWER_HEIGHT_PX\s*:\s*f64\s*=\s*180\.0\s*;/
    );

    // Maximum viewport ratio (fraction of the window height)
    expect(drawerRs).toMatch(
      /pub\s+const\s+MAX_DRAWER_VIEWPORT_RATIO\s*:\s*f64\s*=\s*0\.72\s*;/
    );

    // Default drawer height used at startup
    expect(drawerRs).toMatch(
      /pub\s+const\s+DEFAULT_DRAWER_HEIGHT_PX\s*:\s*f64\s*=\s*360\.0\s*;/
    );
  });

  /**
   * 2️⃣ `height_px` clamps to limits – the implementation must call `.clamp`
   *    with the MIN constant and a computed maximum based on viewport ratio.
   */
  test('drawer height_px method clamps to defined limits', () => {
    // Look for a method named `height_px` that returns a clamped value.
    const heightPxRegex = /fn\s+height_px\s*\([^)]*\)\s*->\s*f64\s*\{[^}]*\.clamp\(\s*MIN_DRAWER_HEIGHT_PX\s*,\s*[\w:]+::max_drawer_height\([^)]*\)\s*\)/s;
    expect(drawerRs).toMatch(heightPxRegex);
  });

  /**
   * 3️⃣ PTY row synchronization – any geometry change must immediately
   *    propagate to the PTY via `set_rows` (or equivalent) without indirect
   *    scrolling side‑effects.
   */
  test('drawer updates PTY rows synchronously on resize', () => {
    // The drawer should call something like `self.pty.set_rows(new_rows)`.
    const ptySyncRegex = /self\.pty\.set_rows\(\s*[\w:]+\s*\)/s;
    expect(drawerRs).toMatch(ptySyncRegex);
  });

  /**
   * 4️⃣ Mission command handling – the daemon‑provided transcript must be
   *    loaded verbatim and must not be replayed via duplicate SSE streams.
   */
  test('app.rs routes CmdKind::Mission through deterministic transcript hydration', () => {
    // Presence of the enum variant
    expect(appRs).toMatch(/CmdKind::Mission/);

    // The match arm handling Mission should call a deterministic hydrate function.
    const missionMatchRegex = /CmdKind::Mission\s*=>\s*\{[^}]*transcript\.hydrate\([^)]*\)[^}]*\}/s;
    expect(appRs).toMatch(missionMatchRegex);

    // Ensure no duplicate SSE playback – i.e., there should be *no* call to a
    // `play_sse` or similar function inside the Mission branch.
    const sseInMissionRegex = /CmdKind::Mission[\s\S]*?play_sse\s*\(/;
    expect(appRs).not.toMatch(sseInMissionRegex);
  });

  /**
   * 5️⃣ Geometry limits enforcement – the drawer must enforce clamped geometry
   *    when the user drags the handle beyond the allowed bounds.
   */
  test('drawer geometry limits are enforced during drag operations', () => {
    // Look for a drag handler that clamps the height using the constants.
    const dragClampRegex = /let\s+new_height\s*=\s*requested_height\.clamp\(\s*MIN_DRAWER_HEIGHT_PX\s*,\s*MAX_DRAWER_VIEWPORT_RATIO\s*\*\s*viewport_height\s*\)/s;
    expect(drawerRs).toMatch(dragClampRegex);
  });

  /**
   * 6️⃣ Terminal resize propagates PTY row count immediately (no async delay).
   */
  test('terminal resize updates PTY row count without async buffering', () => {
    // Search for a direct call after computing rows, without `.await` or a
    // channel send that would introduce latency.
    const immediateSyncRegex = /let\s+rows\s*=\s*compute_rows\([^)]*\);\s*self\.pty\.set_rows\(\s*rows\s*\);/s;
    expect(drawerRs).toMatch(immediateSyncRegex);
  });
});