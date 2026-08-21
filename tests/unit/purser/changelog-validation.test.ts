// tests/unit/purser/changelog-validation.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('CHANGELOG.md validation for 3.30.0 release', () => {
  const changelogPath = join(__dirname, '../../../CHANGELOG.md');
  const changelog = readFileSync(changelogPath, 'utf8');
  const lines = changelog.split(/\r?\n/);

  // Helper to find the index of a line matching a regex
  const indexOf = (regex: RegExp) =>
    lines.findIndex((l) => regex.test(l));

  // --- 1. Locate the 3.30.0 section header ---------------------------------
  const headerRegex = /^## \[3\.30\.0\] - (\d{4}-\d{2}-\d{2})$/;
  const headerIdx = indexOf(headerRegex);
  expect(headerIdx).toBeGreaterThan(-1);

  const headerMatch = lines[headerIdx].match(headerRegex);
  expect(headerMatch).toBeTruthy();
  const headerDate = headerMatch![1];
  expect(headerDate).toBe('2026-08-21');

  // --- 2. Ensure the header appears only once --------------------------------
  const headerCount = lines.filter((l) => headerRegex.test(l)).length;
  expect(headerCount).toBe(1);

  // --- 3. Extract the body of the 3.30.0 section -----------------------------
  const nextHeaderIdx = lines
    .slice(headerIdx + 1)
    .findIndex((l) => /^\s*## \[/ .test(l));
  const sectionEndIdx = nextHeaderIdx >= 0 ? headerIdx + 1 + nextHeaderIdx : lines.length;
  const sectionLines = lines.slice(headerIdx + 1, sectionEndIdx);

  // --- 4. Verify subsections Added / Fixed ----------------------------------
  const addedIdx = sectionLines.findIndex((l) => /^\s*### Added\s*$/.test(l));
  const fixedIdx = sectionLines.findIndex((l) => /^\s*### Fixed\s*$/.test(l));

  expect(addedIdx).toBeGreaterThan(-1);
  expect(fixedIdx).toBeGreaterThan(-1);

  // Helper to collect bullet lines between two indices
  const collectBullets = (startIdx: number, endIdx: number) => {
    const bullets: string[] = [];
    for (let i = startIdx + 1; i < endIdx; i++) {
      const l = sectionLines[i];
      if (/^\s*-\s+/.test(l)) {
        bullets.push(l.trim());
      } else if (/^\s*$/.test(l)) {
        continue;
      } else {
        // Stop if we hit a non-bullet non-empty line (e.g., a new subsection)
        break;
      }
    }
    return bullets;
  };

  const addedBullets = collectBullets(addedIdx, fixedIdx);
  const fixedBullets = collectBullets(fixedIdx, sectionLines.length);

  // Expected bullet texts exactly as written in the diff
  const expectedAdded = [
    '**Trusted executor identity, mediator, and Mercy telemetry complete the remote-fleet control loop.** Relay now provisions operator-approved Fleet Executor identities, verifies signed publish/run reports against the current relay and channel, enforces durable per-harbor daily budgets, predicts mediator conflicts, chains summonses and acknowledgements, and requires a human gate for irreversible actions. The Mercy surface reports hook health and SLO burn with request correlation, bounded identifiers, fail-closed quota errors, and readable mobile evidence.',
  ];

  const expectedFixed = [
    '**Agent startup coordination is fast and nonblocking.** Empty `pd attention` calls no longer run channel discovery/history scans inline, and operator-state Guard probes moved behind an asynchronous stale-while-revalidate cache. A fresh current-main daemon now returns real source-CLI attention calls in 0.81–0.94 seconds instead of the observed cold/contention path near 60 seconds, while preserving inbox, channel, and parley delivery semantics.',
    '**Fleet and tutorial cleanup paths fail safely.** Executor credentials stay out of transcripts, retryable telemetry drains ride the Worker execution context, generated Purser duplicates no longer masquerade as coverage, and tutorial cleanup preserves its lock owner across retries.',
    '**Release publication detects and recovers carrier topology.** Version-transition discovery, token failures, tap polling, and fresh-install contracts are executable tests rather than path-only checks, so a rebased/Purser-carried release can still tag the exact version transition and fail loudly when publication authority is unavailable.',
  ];

  expect(addedBullets).toEqual(expectedAdded);
  expect(fixedBullets).toEqual(expectedFixed);

  // Ensure no other subsections exist in the 3.30.0 section
  const subsectionCount = sectionLines.filter((l) => /^\s*###/.test(l)).length;
  expect(subsectionCount).toBe(2);

  // --- 5. Verify the Unreleased section is empty -----------------------------
  const unreleasedIdx = indexOf(/^## \[Unreleased\]\s*$/);
  if (unreleasedIdx >= 0) {
    const nextUnreleasedIdx = lines
      .slice(unreleasedIdx + 1)
      .findIndex((l) => /^\s*## \[/ .test(l));
    const unreleasedEndIdx =
      nextUnreleasedIdx >= 0 ? unreleasedIdx + 1 + nextUnreleasedIdx : lines.length;
    const unreleasedLines = lines.slice(unreleasedIdx + 1, unreleasedEndIdx);
    const hasBullets = unreleasedLines.some((l) => /^\s*-\s+/.test(l));
    expect(hasBullets).toBe(false);
  }

  // --- 6. Verify the 3.29.0 header exists ----------------------------------
  const header29Idx = indexOf(/^## \[3\.29\.0\] - /);
  expect(header29Idx).toBeGreaterThan(-1);
});