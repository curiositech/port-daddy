// tests/unit/purser/state_sync.test.ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Simulates the state‑sync protocol between the Rust backend (pd‑console)
 * and the React ClaimTree visualizer. The test deliberately reorders and
 * conflicts updates to ensure the visualizer never enters an invalid
 * state and that stale backend messages are ignored.
 *
 * It also validates that the Rust source declares the required
 * `selected_surface` field, as mandated by the PR contract.
 */

/* -------------------------------------------------------------------------- */
/* Helper to resolve a repository‑relative path without using __dirname.      */
function repoPath(...segments: string[]): string {
  // import.meta.url points to this test file (as a file URL)
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, '..', '..', '..', ...segments);
}

/* -------------------------------------------------------------------------- */
/* Types representing the minimal slice of state shared between backend and
   frontend for the purpose of this test.                                    */
type BackendState = {
  /** Index of the currently selected claim surface, or null if none. */
  selectedSurface: number | null;
  /** Monotonically increasing version to detect stale messages. */
  version: number;
};

type FrontendState = {
  /** Identifier of the currently selected claim card, or null if none. */
  selectedCardId: string | null;
  /** The version of the last backend message that was applied. */
  lastVersion: number;
};

/* -------------------------------------------------------------------------- */
/* Deterministic mapping between a surface index and a card identifier.      */
const surfaceToCardId = (index: number): string => `c${index}`;
const cardIdToSurface = (cardId: string): number | null => {
  const m = /^c(\d+)$/.exec(cardId);
  return m ? Number(m[1]) : null;
};

/* -------------------------------------------------------------------------- */
/* Backend simulation -------------------------------------------------------- */
function backendPush(
  state: BackendState,
  selected: number | null,
): void {
  if (selected !== null && selected < 0) {
    throw new Error('selectedSurface must be non‑negative or null');
  }
  state.selectedSurface = selected;
  state.version += 1; // bump version for every push
}

/* -------------------------------------------------------------------------- */
/* Frontend simulation ------------------------------------------------------- */
function frontendReceive(
  backend: BackendState,
  frontend: FrontendState,
): void {
  // Apply only if the incoming version is newer than what we have seen.
  if (backend.version <= frontend.lastVersion) {
    // stale – ignore
    return;
  }
  frontend.lastVersion = backend.version;

  if (backend.selectedSurface === null) {
    frontend.selectedCardId = null;
  } else {
    frontend.selectedCardId = surfaceToCardId(backend.selectedSurface);
  }
}

/* Optimistic UI update triggered by a user click. */
function frontendOptimisticSelect(
  frontend: FrontendState,
  cardId: string,
): void {
  frontend.selectedCardId = cardId;
  // Optimistic updates do NOT bump the version; they are provisional.
}

/* -------------------------------------------------------------------------- */
/* Invariant checks ---------------------------------------------------------- */
function assertInvariants(
  backend: BackendState,
  frontend: FrontendState,
): void {
  // 1️⃣ backend.selectedSurface must be null or a non‑negative integer.
  expect(
    backend.selectedSurface === null ||
      (Number.isInteger(backend.selectedSurface) && backend.selectedSurface >= 0),
  ).toBe(true);

  // 2️⃣ When backend.selectedSurface is defined, frontend must reflect it.
  if (backend.selectedSurface === null) {
    expect(frontend.selectedCardId).toBeNull();
  } else {
    expect(frontend.selectedCardId).toBe(surfaceToCardId(backend.selectedSurface));
  }

  // 3️⃣ frontend.lastVersion must never exceed backend.version.
  expect(frontend.lastVersion).toBeLessThanOrEqual(backend.version);
}

/* -------------------------------------------------------------------------- */
/* Test suite ---------------------------------------------------------------- */
describe('State‑sync adversarial simulation between Rust backend and React frontend', () => {
  test('Rust source declares selected_surface field', async () => {
    const claimsPanePath = repoPath('core', 'pd-console', 'src', 'claims_pane.rs');
    const content = await fs.readFile(claimsPanePath, 'utf8');
    // The struct handling claim pane state should contain a field named `selected_surface`.
    expect(content).toMatch(/selected_surface\s*:/);
  });

  test('out‑of‑order and stale updates never violate visualizer invariants', () => {
    // Initialise both sides.
    const backend: BackendState = { selectedSurface: null, version: 0 };
    const frontend: FrontendState = { selectedCardId: null, lastVersion: 0 };

    // ── Step 1: Backend pushes selection of surface 2.
    backendPush(backend, 2);
    frontendReceive(backend, frontend);
    assertInvariants(backend, frontend);
    expect(frontend.selectedCardId).toBe('c2');

    // ── Step 2: User clicks card "c5" before backend processes the next push.
    frontendOptimisticSelect(frontend, 'c5');
    // Optimistic state diverges deliberately; invariants that tie frontend to backend
    // are relaxed only for this window, but other invariants must still hold.
    expect(frontend.selectedCardId).toBe('c5');
    expect(frontend.lastVersion).toBe(backend.version); // still same version
    expect(backend.selectedSurface).toBe(2);
    // No invalid values.
    expect(frontend.selectedCardId).not.toBeNull();

    // ── Step 3: Backend confirms the user's selection (surface 5).
    backendPush(backend, 5);
    frontendReceive(backend, frontend);
    // Now frontend should be synced again.
    assertInvariants(backend, frontend);
    expect(frontend.selectedCardId).toBe('c5');

    // ── Step 4: Backend mistakenly sends a stale update (surface 3) after user
    //          has already moved on to surface 7 via another optimistic click.
    // Simulate another optimistic user action.
    frontendOptimisticSelect(frontend, 'c7');
    expect(frontend.selectedCardId).toBe('c7');

    // Backend now pushes a stale version (e.g., version 3) while its internal
    // version counter would be 4 after the previous push. To emulate staleness,
    // we manually decrement the backend version before pushing.
    backend.version -= 1; // make this push appear older
    backendPush(backend, 3);
    // Frontend should ignore this because backend.version (now 4) <= frontend.lastVersion (5).
    frontendReceive(backend, frontend);
    // Frontend must still show the optimistic selection.
    expect(frontend.selectedCardId).toBe('c7');
    // Invariants hold: backend may be out of sync but still respects its own rules.
    assertInvariants(backend, frontend);
  });
});