import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const artifactDir = path.resolve('artifacts');
const names = ['mission-control-dark.png', 'mission-control-light.png', 'mission-control-interaction.webm'];
const files = [];
for (const name of names) {
  const bytes = await readFile(path.join(artifactDir, name));
  files.push({ path: `artifacts/${name}`, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}

const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  generator: 'Playwright Chromium via tests/artifacts.spec.ts',
  viewport: { width: 1600, height: 1050 },
  source: 'deterministic local fixtures; no daemon or production data',
  coordination: {
    mode: 'actor-bound durable session in authorized isolated recovery worktree',
    degraded: true,
    session: 'session-polish-and-land-the-bounded-mission-control-reac-11d9eede390b',
    reason: 'Three earlier $12 dispatch attempts persisted credential:null. This resume minted an actor-bound durable session, roadmap item, notes, and narrow claims without bypass. The canonical Bun daemon crashed once and recovered; sitrep, plan, and reviewer-spawn routes still returned the exact missing URL or port error, so coordination remained degraded and reviewer admission failed closed.',
    bypassed: false,
  },
  caveats: [
    'Labels named live and recorded demonstrate provenance rendering contracts; every datum in this lab remains a fixture.',
    'The recording proves browser interaction behavior, not GPUI parity or daemon integration.',
    'Performance values vary by machine and are measured again by the local test suite.',
  ],
  files,
};

await writeFile(path.join(artifactDir, 'provenance-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
