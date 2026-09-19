/**
 * SWARM TELEMETRY LIVE SERVER
 * ============================
 * Serves the Bostockesque Swarm Surveillance Dashboard and exposes
 * real-time SSE & REST endpoints for live turn telemetry.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3344;
const HTML_PATH = path.join(__dirname, 'index.html');

let telemetryState = {
  epochs: [
    { epoch: 0, r: 0.000, treeR: 0.000, L: 1.000, label: "Boot" },
    { epoch: 1, r: 0.000, treeR: 0.000, L: 1.000, label: "Passkey Lock" },
    { epoch: 2, r: 0.756, treeR: 0.000, L: 0.667, label: "Overlap Race" },
    { epoch: 3, r: 45.271, treeR: 0.000, L: 0.667, label: "Hallucination" },
    { epoch: 4, r: 0.000, treeR: 0.000, L: 1.000, label: "CR-4 Repair" }
  ],
  leases: [
    { agent: "SecDev", role: "Security", symbol: "src/auth.ts::handleRegistration", mode: "EXCLUSIVE", epoch: 1 },
    { agent: "AuthDev", role: "Client Auth", symbol: "src/session.ts::createSessionToken", mode: "SHARED_READ", epoch: 2 }
  ],
  logs: [
    { time: "00:01", type: "lease", text: "SecDev granted EXCLUSIVE lease on src/auth.ts::handleRegistration" },
    { time: "00:02", type: "alarm", text: "COLLISION: AuthDev concurrent lease conflict on src/auth.ts (r = 0.756)" },
    { time: "00:03", type: "alarm", text: "EQUIVOCATION: Redteam QA emitted contradictory stance (PASS to Mgr, FAIL to Sec) (r = 45.271)" },
    { time: "00:04", type: "repair", text: "CR-4 MIN-CUT: Quenched edge SecDev->QA. Ground truth consensus restored (r = 0.000)" }
  ]
};

const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/' || req.url === '/index.html') {
    fs.readFile(HTML_PATH, 'utf8', (err, content) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Error loading dashboard');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(content);
    });
    return;
  }

  if (req.url === '/api/telemetry' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(telemetryState));
    return;
  }

  if (req.url === '/api/push_action' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        if (payload.epoch) telemetryState.epochs.push(payload.epoch);
        if (payload.log) telemetryState.logs.push(payload.log);
        if (payload.lease) telemetryState.leases.push(payload.lease);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', totalEpochs: telemetryState.epochs.length }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`[SwarmTelemetry Server] Listening on http://localhost:${PORT}`);
});
