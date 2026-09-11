/** Synthetic read-only fixture. Build with --outDir ../.portdaddy/salvage-hold-built. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const buildRoot = fileURLToPath(new URL('../../../.portdaddy/salvage-hold-built/', import.meta.url));
const time = Date.parse('2026-09-02T22:00:00Z');
const makeAgent = (id, name, role, delta, extra) => ({
  id, name, purpose: 'Synthetic evidence only. No operator work or credentials.',
  sessionId: `session-${id}`, lastHeartbeat: time, staleSince: time + delta,
  identityProject: 'synthetic-proof', identityStack: 'fleet', identityContext: role,
  status: 'dead', notes: ['Synthetic context is retained without transferring ownership.'], ...extra,
});
export const agents = [
  makeAgent('synthetic-held', 'Synthetic dormant entry', 'tender', 3000,
    { status: 'dormant', holdReason: 'durable_session_active', replacementAlreadyAdmitted: false }),
  makeAgent('synthetic-admitted', 'Synthetic earlier admission', 'lookout', 2000,
    { status: 'resurrecting', holdReason: 'durable_session_active', replacementAlreadyAdmitted: true }),
  makeAgent('synthetic-ordinary', 'Synthetic ordinary entry', 'tender', 1000, {}),
];

export function makeProofServer() {
  return createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'");
    const json = (status, value) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(value));
    };
    if (!['GET', 'HEAD'].includes(request.method)) return json(405, { error: 'Synthetic read-only proof: mutations are disabled.' });
    if (url.pathname === '/_salvage-hold-proof') return json(200, { fixture: 'salvage-durable-hold-ui', syntheticOnly: true, readOnly: true });
    if (url.pathname === '/salvage') return json(200, { success: true, agents });
    if (url.pathname === '/spawn') return json(200, { success: true, agents: [] });
    if (url.pathname.startsWith('/sessions/')) {
      const id = decodeURIComponent(url.pathname.slice('/sessions/'.length));
      const entry = agents.find(agent => agent.sessionId === id);
      if (!entry) return json(404, { error: 'Synthetic session not found.' });
      return json(200, {
        success: true,
        session: { id, purpose: entry.purpose, status: 'active', phase: 'in_progress',
          agentId: entry.id, worktreeId: 'synthetic-only', createdAt: time, updatedAt: time,
          completedAt: null, metadata: { identity: { verified: true, actorId: `actor-${entry.id}` } } },
        files: [], notes: [{ id: 1, sessionId: id, type: 'progress', createdAt: time,
          content: 'Synthetic retained evidence. A hold is not a cancellation or an execution receipt.' }],
      });
    }
    if (url.pathname.startsWith('/fleet-ui/')) {
      const asset = url.pathname.slice('/fleet-ui/'.length) || 'index.html';
      const path = resolve(buildRoot, asset);
      if (!path.startsWith(resolve(buildRoot) + sep)) return json(404, { error: 'Not found.' });
      try {
        const bytes = await readFile(path);
        response.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[extname(path)] ?? 'application/octet-stream' });
        response.end(bytes);
      } catch { json(404, { error: 'Build the isolated UI first.' }); }
      return;
    }
    if (url.pathname.endsWith('/events') || url.pathname.endsWith('/stream')) {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write(': synthetic proof; no live events\n\n');
      request.on('close', () => response.end());
      return;
    }
    return json(200, { success: true, running: false, fleets: [], agents: [], sessions: [], projects: [],
      events: [], activity: [], notes: [], actors: [], claims: [], messages: [], total: 0, unread: 0 });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = makeProofServer();
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    console.log(JSON.stringify({ pid: process.pid, port, url: `http://127.0.0.1:${port}/fleet-ui/?surface=agents&theme=dark`, syntheticOnly: true }));
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    server.closeAllConnections();
    server.close(() => process.exit(0));
  });
}
