/**
 * Synthetic-only proof server for the built session detail UI.
 * Build first (from fleet-config-ui): npx vite build --outDir ../.scratch/session-plan-build
 * Then: node fleet-config-ui/scripts/session-plan-proof.mjs
 * Binds an OS-selected loopback port, never connects to a daemon, never writes
 * an operator record, and refuses every mutation. Stop with Ctrl-C/SIGTERM.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const buildRoot = fileURLToPath(new URL('../../.scratch/session-plan-build/', import.meta.url));
const createdAt = Date.parse('2026-09-02T14:00:00Z');
const plan = [
  '- [x] Inspect the exact session read contract',
  '- [x] Build the accessible session detail view',
  '- [x] Preserve the complete append-only note history',
  '- [ ] Review light and dark desktop proof',
  '- [ ] Verify the narrow-screen layout and keyboard controls',
  '- [ ] Publish the App-authored pull request',
  '- [ ] Respond to review and make required checks green',
  '- [ ] Verify the protected merge receipt',
  '- [ ] Record the delivery receipt and keep future work visible',
].join('\n');

/** Create a fixture with intentionally shared cwd and distinct session owners. */
function fixture(id) {
  return {
    success: true,
    session: {
      id, purpose: id === 'session-synthetic-a' ? 'Synthetic proof: make delivery plans visible' : 'Synthetic proof: a different session in the same repo',
      status: 'active', phase: 'in_progress', agentId: null, worktreeId: 'synthetic-shared',
      identityProject: 'synthetic-proof', createdAt, updatedAt: createdAt + 600_000, completedAt: null,
      metadata: { identityString: 'synthetic-proof:dashboard:plan-history', identity: { verified: true, actorId: `synthetic-actor-${id.slice(-1)}` }, worktree: { root: '/synthetic/proof/shared-repository', branch: 'synthetic/proof', isMain: false }, roadmapLink: 'synthetic-delivery-plan' },
    },
    notes: Array.from({ length: 9 }, (_, index) => ({
      id: index + 1, sessionId: id, createdAt: createdAt + index * 60_000,
      type: index === 0 || index === 7 ? 'todo_list' : index === 6 ? 'decision' : 'progress',
      content: index === 7 ? plan : index === 0 ? '- [ ] Earlier plan, retained for provenance' : index === 8 ? 'Synthetic evidence receipt: [PR #42](https://github.com/example/synthetic/pull/42) is published, not merged. This is fixture data, not a real product claim.' : index === 6 ? 'Keep the current plan separate from its historical revisions. Never infer a session from a working directory.' : `Synthetic progress note ${index + 1}: source validation checkpoint retained in full.`,
    })),
    files: [],
  };
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  response.setHeader('Cache-Control', 'no-store');
  // The isolated fixture never loads remote media, fonts, or evidence links.
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'");
  const json = (status, value) => {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(value));
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') return json(405, { error: 'Synthetic read-only fixture: mutations are disabled.' });
  if (url.pathname === '/_session-plan-proof') return json(200, { fixture: 'session-plan-view', syntheticOnly: true, readOnly: true });
  if (url.pathname.startsWith('/sessions/')) {
    const id = decodeURIComponent(url.pathname.slice('/sessions/'.length));
    if (id === 'session-synthetic-denied') return json(403, { error: 'Access to this synthetic session is denied.' });
    if (!['session-synthetic-a', 'session-synthetic-b'].includes(id)) return json(404, { error: 'Synthetic session not found.' });
    return json(200, fixture(id));
  }
  if (url.pathname.startsWith('/fleet-ui/')) {
    const asset = url.pathname.slice('/fleet-ui/'.length) || 'index.html';
    const path = resolve(buildRoot, asset);
    if (!path.startsWith(resolve(buildRoot) + sep)) return json(404, { error: 'Not found' });
    try {
      const bytes = await readFile(path);
      response.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[extname(path)] ?? 'application/octet-stream' });
      response.end(bytes);
    } catch {
      json(404, { error: 'Build asset not found; build the isolated proof first.' });
    }
    return;
  }
  if (url.pathname.endsWith('/events') || url.pathname.endsWith('/stream')) {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.write(': synthetic proof, no live events\n\n');
    request.on('close', () => response.end());
    return;
  }
  json(200, { success: true, running: false, fleets: [], agents: [], sessions: [], projects: [], events: [], activity: [], notes: [], actors: [] });
});
server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  console.log(JSON.stringify({ pid: process.pid, port, url: `http://127.0.0.1:${port}/fleet-ui/?surface=sessions&session=session-synthetic-a`, syntheticOnly: true }));
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  server.closeAllConnections();
  server.close(() => process.exit(0));
});
