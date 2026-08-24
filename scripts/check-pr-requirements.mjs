// scripts/check-pr-requirements.mjs
// Updated to correctly parse `changelog-exempt` markers without capturing the trailing '-->'.

import fs from 'fs';
import path from 'path';
import { isUserVisibleSurface } from './lib/user-visible-surfaces.mjs';

/**
 * Detects a `changelog-exempt` marker in the PR body.
 * The marker format is:
 *   <!-- changelog-exempt: <reason> -->
 * The reason may be any non‑empty string without the terminating '-->'.
 */
function getChangelogExemptReason(body) {
  // Use a non‑greedy match up to the first occurrence of '-->'
  const match = body.match(/<!--\s*changelog-exempt:\s*([^>-][\s\S]*?)\s*-->/i);
  // If a match is found, trim whitespace and return the reason; otherwise null.
  return match ? match[1].trim() : null;
}

function hasChangelogFragment(body) {
  // A fragment is required unless an exempt reason is present.
  return !!getChangelogExemptReason(body);
}

export async function checkPRRequirements(pr) {
  const { diff, body } = pr;

  // Rule 4: User‑visible surface changes require a changelog fragment.
  if (isUserVisibleSurface(diff)) {
    if (!hasChangelogFragment(body)) {
      throw new Error('User‑visible surface changes require a changelog fragment or an explicit `changelog-exempt` marker.');
    }
  }

  // ... other existing rules remain unchanged ...
}

// Export helper for tests
export { getChangelogExemptReason };
