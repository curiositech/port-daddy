/**
 * The multiplex lane view (public/lanes.html) is a real consumer, not a mockup.
 *
 * Why this suite exists rather than "we looked at the screenshot": the screenshot
 * IS the deliverable, and a screenshot cannot fail in CI. The one defect that
 * actually shipped while building this page is a perfect example of what a
 * picture will not catch — the daemon writes NAMED SSE events
 * (`event: agent.transcript`), so `EventSource.onmessage` never fires, and the
 * lanes rendered connected, green, and permanently empty. That is the most
 * misleading state a live view can be in: it looks like a system with nothing
 * to say rather than a client wired to the wrong callback.
 *
 * So these are structural assertions against the file, checking the small set of
 * couplings that break silently:
 *
 *   1. The page subscribes to the event NAMES the daemon actually writes.
 *   2. It labels every lane real/fixture, because unlabeled evidence is not
 *      evidence (agent-visual-evidence-manifest).
 *   3. It reports silence AS silence, never as steady state.
 *   4. It stays self-contained — no external origin, which the daemon's CSP
 *      would block at capture time and which would make the artifact depend on
 *      a third party being up.
 */

import { describe, test, expect } from '@jest/globals';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LANES = join(REPO_ROOT, 'public', 'lanes.html');
const COCKPIT = join(REPO_ROOT, 'routes', 'agent-cockpit.ts');

describe('public/lanes.html — the live multiplex view', () => {
  const html = readFileSync(LANES, 'utf8');

  test('subscribes to the event names the daemon actually writes', () => {
    // THE BUG THIS PINS: routes/agent-cockpit.ts writes named SSE events. A
    // client relying on `onmessage` alone connects successfully and then sits
    // silent forever, which reads as "the agents produced nothing".
    const cockpit = readFileSync(COCKPIT, 'utf8');
    const kinds = [...cockpit.matchAll(/kind:\s*'(agent\.[a-z]+)'/g)].map((m) => m[1]);
    expect(kinds.length).toBeGreaterThan(0);
    for (const kind of new Set(kinds)) {
      expect(html).toContain(kind);
    }
    expect(html).toMatch(/addEventListener\(name, onEnvelope\)/);
  });

  test('renders a source label on every lane', () => {
    // An artifact that will not say whether its data is real is not auditable,
    // and a fixture lane silently wearing a "real" look is the precise failure
    // the evidence-manifest rules exist to catch.
    expect(html).toContain("sourceLabel");
    expect(html).toMatch(/chip\.real/);
    expect(html).toMatch(/chip\.fixture/);
  });

  test('reports silence as silence rather than as steady state', () => {
    // The anti-Infinite-Spinner rule: a lane that has stopped receiving events
    // must not look identical to a lane that is thinking.
    expect(html).toMatch(/quiet \$\{quiet\}s/);
    expect(html).toContain('reconnecting');
  });

  test('renders the failover chain from the predecessor edge', () => {
    // A succession must read as one piece of work continuing, not as two
    // unrelated runs that happen to be adjacent.
    expect(html).toContain('failoverFromBackend');
    expect(html).toContain('failoverAttempt');
    expect(html).toContain('handoffEpisodeId');
  });

  test('is self-contained — no external origin to be blocked or to go down', () => {
    // The daemon's CSP is same-origin for connect-src, and an artifact that
    // depends on a third-party CDN being up is an artifact that stops
    // reproducing.
    const externals = html.match(/https?:\/\/(?!127\.0\.0\.1|localhost)[^\s"')]+/g) ?? [];
    expect(externals).toEqual([]);
  });

  test('renders transcript messages by INDEX, so a replay does not double-render', () => {
    // THE SECOND BUG THIS PINS: every transcript envelope carries the whole
    // message array. "Append the last one on each update" makes `end` repeat
    // what `update` just showed and makes a reconnect replay the entire run —
    // and EventSource reconnects on its own, so this is not a rare path. The
    // first capture showed the same sentence three times because of it.
    expect(html).toContain('view.rendered');
    expect(html).toMatch(/for \(let i = view\.rendered; i < messages\.length; i\+\+\)/);
  });

  test('skips a malformed frame instead of rendering it as content', () => {
    expect(html).toMatch(/catch \{\s*\n\s*return; \/\/ A malformed frame is skipped/);
  });
});

describe('scripts/demo-lanes.mjs — the capture harness', () => {
  const script = readFileSync(join(REPO_ROOT, 'scripts', 'demo-lanes.mjs'), 'utf8');

  test('labels fixture-mode artifacts `fixture`, never `real`', () => {
    // The single most important honesty property of the whole capture: a
    // hermetic run must not produce an artifact claiming live providers.
    expect(script).toContain("sourceLabel: LIVE ? 'real' : 'fixture'");
  });

  test('SKIPS a live backend with no credentials rather than substituting a fixture', () => {
    expect(script).toMatch(/skipped\.push\(\{ label: row\.label, reason: `no \$\{needs\.join/);
  });

  test('runs spawns inside a dedicated worktree, honouring the isolation guard', () => {
    // Working around that guard would mean the capture demonstrates a
    // configuration that deleted 403 files on 2026-06-03.
    expect(script).toContain("execFileSync('git', ['worktree', 'add'");
    expect(script).toContain('workdir: worktree.path');
  });

  test('sets an explicit budget and bond rather than bypassing the spend gates', () => {
    // A demo that removed the safety rails would be demonstrating a system with
    // its safety rails removed.
    expect(script).toContain('/budget');
    expect(script).toContain('/top-up');
    expect(script).not.toMatch(/PD_SPAWN_ISOLATION_OFF/);
  });

  test('disables the project fleet so the capture shows only the lanes it asked for', () => {
    expect(script).toContain("PORT_DADDY_NO_FLEET: '1'");
  });

  test('writes a manifest carrying every mandatory provenance field', () => {
    for (const field of ['daemonPort', 'runId', 'transcriptHeadHash', 'agentNodeId', 'commit', 'sourceLabel']) {
      expect(script).toContain(field);
    }
  });

  test('reports a missing capture tool instead of faking a capture', () => {
    expect(script).toContain('Capture skipped, not faked');
  });
});

describe('committed proof artifacts', () => {
  test('every committed manifest names a commit and an honest source label', () => {
    // Structural, not aspirational: if artifacts are committed, their manifests
    // must be complete. An artifact whose manifest omits its provenance is
    // decoration, and this is the check that says so in CI rather than in review.
    const dir = join(REPO_ROOT, 'docs', 'artifacts', 'multi-backend-resilience');
    if (!existsSync(dir)) return; // No artifacts committed yet is a legal state.

    for (const day of readdirSync(dir)) {
      const manifestPath = join(dir, day, 'proof-manifest.json');
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      expect(typeof manifest.branchCommit).toBe('string');
      expect(manifest.branchCommit.length).toBeGreaterThan(6);
      expect(Array.isArray(manifest.artifacts)).toBe(true);
      expect(manifest.artifacts.length).toBeGreaterThan(0);
      for (const artifact of manifest.artifacts) {
        expect(typeof artifact.file).toBe('string');
        expect(['real', 'fixture', 'mock']).toContain(artifact.manifest.sourceLabel);
        expect(typeof artifact.manifest.daemonPort).toBe('number');
        expect(typeof artifact.manifest.runId).toBe('string');
        expect(artifact.manifest.commit).toBe(manifest.branchCommit);
      }
    }
  });
});
