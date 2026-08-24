// scripts/check-pr-requirements.mjs
// ... other imports and code ...

/**
 * Detects a `<!-- changelog-exempt: <reason> -->` marker in PR description.
 * Returns true if a non‑empty reason is provided.
 */
function hasMarker(text) {
  // Old buggy regex: /<!--\s*changelog-exempt:\s*(\S*)\s*-->/
  // Fixed regex: require at least one non‑whitespace character in the reason.
  const marker = /<!--\s*changelog-exempt:\s*([^\s].*?)\s*-->/;
  return marker.test(text);
}

// Export for CI usage
module.exports = { hasMarker };

// ... rest of the file unchanged ...
