#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireBoolean(plan, field) {
  if (typeof plan[field] !== 'boolean') {
    throw new Error(`plan.${field} must be a boolean`);
  }
}

/**
 * Audit a coop-IDE (Harbor) architecture plan against build-coop-ide-gpui's
 * phased Quality Gates and its four anti-patterns.
 *
 * The plan describes a slice of the M-Agent + N-Human cooperative IDE: which
 * governance properties it upholds (peers, claims, salvage, daemon-as-server,
 * transport abstraction, build order) and whether it composes the right
 * sibling skills with visual artifacts in the test plan.
 *
 * @param {unknown} plan - parsed JSON coop-IDE architecture plan, see schemas/coop-ide-plan.schema.json
 * @returns {{pass: boolean, score: number, findings: Array<{id: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditCoopIdeArchitecture(plan) {
  if (!isPlainObject(plan)) {
    throw new Error('plan must be a JSON object');
  }
  requireBoolean(plan, 'actorsArePeers');
  requireBoolean(plan, 'claimsGateEdits');
  requireBoolean(plan, 'salvageImplemented');
  requireBoolean(plan, 'daemonIsCollabServer');
  requireBoolean(plan, 'topologyBehindTransportTrait');
  requireBoolean(plan, 'surfaceComposesSiblings');
  requireBoolean(plan, 'visualArtifactsInTestPlan');
  if (!isPlainObject(plan.buildOrder)) {
    throw new Error('plan.buildOrder must be an object');
  }
  if (typeof plan.buildOrder.bufferBeforeTransport !== 'boolean') {
    throw new Error('plan.buildOrder.bufferBeforeTransport must be a boolean');
  }

  const {
    actorsArePeers,
    claimsGateEdits,
    salvageImplemented,
    daemonIsCollabServer,
    topologyBehindTransportTrait,
    surfaceComposesSiblings,
    visualArtifactsInTestPlan,
    buildOrder,
  } = plan;

  const findings = [];
  const recommendations = [];
  let score = 100;
  let criticalHit = false;

  function fail(id, severity, message, recommendation) {
    findings.push({ id, severity, message });
    if (recommendation) recommendations.push(recommendation);
    if (severity === 'critical') criticalHit = true;
    score -= { critical: 30, high: 15, medium: 8, low: 3 }[severity] ?? 5;
  }

  // --- Anti-pattern 1: "Agents as tools, not peers" ---
  if (!actorsArePeers) {
    fail(
      'agents-as-tools-not-peers',
      'critical',
      'actorsArePeers is false: agents are a side-panel that edits *for* the human instead of a first-class Loro replica with a shared cursor, claim, and provenance.',
      'Make every agent a Loro replica keyed to its PD identity (PeerID), rendered identically to a human replica (cursor, claimed range, name, provenance) -- ref 03.'
    );
  }

  // --- Anti-pattern 2: "Trusting CRDT auto-merge for correctness" ---
  if (!claimsGateEdits) {
    fail(
      'trusting-crdt-auto-merge',
      'critical',
      'claimsGateEdits is false: no claim/conflict layer gates edits above the CRDT, so two actors editing the same symbol merge cleanly and silently produce wrong code.',
      'Claim-before-edit and call POST /conflicts/predict before any write; render a Conflicted/Gated band and require a nudge before the byte lands -- ref 03.'
    );
  }

  // --- Anti-pattern 3: "Building the editor before the coordination" ---
  if (!salvageImplemented) {
    fail(
      'editor-before-coordination-salvage-deferred',
      'critical',
      'salvageImplemented is false: the buffer exists but salvage (dead-replica op-log replay + claim inheritance) is deferred -- a Potemkin editor that fails the moment two actors touch one file.',
      'Implement salvage alongside claims, not after: persist the op-log and claim so a successor can inherit and finish a dead replica\'s work -- ref 03.'
    );
  }

  // --- Anti-pattern 4: "Transport-first" ---
  if (!buildOrder.bufferBeforeTransport) {
    fail(
      'transport-first',
      'critical',
      'buildOrder.bufferBeforeTransport is false: transport/topology work (P4 shared, P5 remote) is happening before the buffer and coordination (P1-P3) exist.',
      'Abstract topology behind SyncTransport from day one, but prove the buffer + claims/salvage over the existing daemon bus first -- ref 04.'
    );
  }

  // --- Plus: missing daemon-as-collab-server ---
  if (!daemonIsCollabServer) {
    fail(
      'daemon-not-collab-server',
      'high',
      'daemonIsCollabServer is false: a new sync backend is being stood up instead of using the daemon (Loro Protocol over the existing tube, canonical editor-sync checkpoint/reconnect, typed salvage receipts).',
      'Route collaboration through the daemon that already exists -- no new sync backend. Keep checkpoint/reconnect in the canonical editor-sync contract and salvage evidence in the typed receipt ledger, never notes.'
    );
  }
  if (!topologyBehindTransportTrait) {
    fail(
      'topology-not-behind-transport-trait',
      'high',
      'topologyBehindTransportTrait is false: Shared/LAN/Remote topology is not abstracted behind SyncTransport, so the editor knows which transport it is running over.',
      'Abstract Shared (daemon HTTP+SSE) / LAN (iroh) / Remote (relay+E2E) behind a single SyncTransport trait so the editor never branches on topology -- ref 01/04.'
    );
  }

  // --- Plus: missing visual artifacts in the test plan ---
  if (!visualArtifactsInTestPlan) {
    fail(
      'missing-visual-artifacts-in-test-plan',
      'medium',
      'visualArtifactsInTestPlan is false: this is a UI merge with no screenshot + motion clip in the PR test plan, violating the standing "no UI merges without visual artifacts" rule.',
      'Attach a screenshot and a board->steer->diff (or equivalent) motion clip to the PR test plan before landing any surface change.'
    );
  }

  // --- Additional Quality Gate: surface composes the right siblings ---
  if (!surfaceComposesSiblings) {
    fail(
      'surface-does-not-compose-siblings',
      'medium',
      'surfaceComposesSiblings is false: this surface does not pull the sibling skills (motion/shaders/text/console) it needs instead of reinventing them.',
      'Compose the load-bearing siblings for this layer (rust-gpui-motion, gpui-shaders, vello-parley-rendering, metal-text-pipeline, gpui-rust-console) rather than rebuilding their concerns inline.'
    );
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push(
      'Plan clears every phased Quality Gate and none of the four anti-patterns. Still land with a real screenshot + motion clip in the PR test plan before merging any surface.'
    );
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: coop_ide_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    process.stdout.write(`${JSON.stringify(auditCoopIdeArchitecture(data), null, 2)}\n`);
  } catch (e) {
    process.stderr.write(`coop_ide_audit: ${e.message}\n`);
    process.exit(1);
  }
}
