#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_DIRECTIONS = ['server-to-client', 'bidirectional'];
const VALID_TRANSPORTS = ['sse', 'websocket'];
const VALID_HTTP_VERSIONS = ['http1.1', 'http2', 'http3'];
const MAX_HEARTBEAT_SECONDS = 30;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Audit a real-time channel plan against server-sent-events-vs-websockets'
 * decision diagram and Quality Gates. All rules operate on structured
 * enum/boolean/number fields -- no free-text matching.
 *
 * @param {unknown} plan - parsed JSON plan, see schemas/sse-ws-channel-plan.schema.json
 * @returns {{pass: boolean, score: number, findings: Array<{rule: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditSseWsChannel(plan) {
  if (!isPlainObject(plan)) {
    throw new TypeError('plan must be a non-null, non-array JSON object');
  }
  if (!VALID_DIRECTIONS.includes(plan.direction)) {
    throw new TypeError(`plan.direction must be one of: ${VALID_DIRECTIONS.join(', ')}`);
  }
  if (!VALID_TRANSPORTS.includes(plan.chosenTransport)) {
    throw new TypeError(`plan.chosenTransport must be one of: ${VALID_TRANSPORTS.join(', ')}`);
  }

  const { direction, chosenTransport } = plan;
  const findings = [];
  const recommendations = [];
  let score = 100;
  let criticalHit = false;

  function fail(rule, severity, message, recommendation) {
    findings.push({ rule, severity, message });
    if (recommendation) recommendations.push(recommendation);
    if (severity === 'critical') criticalHit = true;
    score -= { critical: 30, high: 15, medium: 8, low: 3 }[severity] ?? 5;
  }

  // --- Gate: transport matched to traffic direction (the decision diagram) ---
  if (direction === 'bidirectional' && chosenTransport === 'sse') {
    fail(
      'sse-for-bidirectional-channel',
      'high',
      'chosenTransport is sse for a bidirectional channel: SSE only pushes server-to-client; every client message becomes a separate POST.',
      'Use WebSocket for bidirectional low-latency traffic (chat, multiplayer, collaborative editing), or accept the SSE + occasional-POST tradeoff explicitly for low client message rates.'
    );
  }
  if (direction === 'server-to-client' && chosenTransport === 'websocket') {
    fail(
      'websocket-for-unidirectional-stream',
      'medium',
      'chosenTransport is websocket for a server-to-client-only stream: you now own reconnection, replay, and heartbeats that SSE gives for free over plain HTTP.',
      'Prefer SSE for unidirectional streams (notifications, log tails, LLM token streams) unless you need binary frames or subprotocols.'
    );
  }

  // --- Gate: proxy buffering disabled for SSE (the silent killer) ---
  if (chosenTransport === 'sse' && plan.behindBufferingProxy === true && plan.proxyBufferingDisabled !== true) {
    fail(
      'proxy-buffering-not-disabled',
      'critical',
      'SSE runs behind a buffering proxy but proxyBufferingDisabled is not true: nginx-style buffering batches "real-time" events into 10-60s clumps.',
      'Set X-Accel-Buffering: no on every SSE response and proxy_buffering off in the proxy config; verify through the prod-shaped proxy chain.'
    );
  }

  // --- Gate: HTTP/2 for SSE origins (the 6-per-origin limit) ---
  if (plan.httpVersion !== undefined && !VALID_HTTP_VERSIONS.includes(plan.httpVersion)) {
    fail(
      'invalid-http-version',
      'medium',
      `httpVersion "${plan.httpVersion}" is not one of: ${VALID_HTTP_VERSIONS.join(', ')}.`,
      'Declare the negotiated HTTP version so the connection-limit gate can be checked.'
    );
  } else if (chosenTransport === 'sse' && plan.httpVersion === 'http1.1') {
    fail(
      'sse-on-http1-six-connection-limit',
      'high',
      'SSE over HTTP/1.1: the browser caps connections at 6 per origin, so a 7th tab silently never connects.',
      'Deploy the SSE origin behind HTTP/2 (verify with curl -I --http2), or shard origins as a stopgap.'
    );
  }

  // --- Gate: heartbeat every <=30s on idle connections ---
  if (typeof plan.heartbeatIntervalSeconds !== 'number' || plan.heartbeatIntervalSeconds <= 0) {
    fail(
      'heartbeat-missing',
      'high',
      'heartbeatIntervalSeconds is not a positive number: idle proxies and LBs close "silent" connections after 30-60s.',
      'Send an SSE comment line (": keep-alive") or a WebSocket ping frame every 15-30 seconds.'
    );
  } else if (plan.heartbeatIntervalSeconds > MAX_HEARTBEAT_SECONDS) {
    fail(
      'heartbeat-too-slow',
      'high',
      `heartbeatIntervalSeconds is ${plan.heartbeatIntervalSeconds} (> ${MAX_HEARTBEAT_SECONDS}): many proxies idle-close before the first heartbeat lands.`,
      'Tighten the heartbeat to <=30 seconds (15-30s is the working range).'
    );
  }

  // --- Gate: WebSocket reconnect uses jittered backoff ---
  if (chosenTransport === 'websocket' && plan.reconnectBackoffJittered !== true) {
    fail(
      'reconnect-without-jittered-backoff',
      'high',
      'reconnectBackoffJittered is not true: RFC 6455 has no built-in reconnect, and naive retry loops storm a recovering origin.',
      'Implement full-jitter exponential backoff capped at ~30s; resume from a persisted sequence number.'
    );
  }

  // --- Gate: replay claims are backed by a real store ---
  if (plan.replayOnReconnect === true) {
    if (chosenTransport === 'sse' && plan.serverReplayBufferKeyedById !== true) {
      fail(
        'last-event-id-without-replay-buffer',
        'critical',
        'replayOnReconnect is true for SSE but serverReplayBufferKeyedById is not: the client reconnects with Last-Event-ID and the server has nothing to replay.',
        'Persist events keyed by the emitted id: values and replay from Last-Event-ID on reconnect -- or document "no replay" and drop the id: field.'
      );
    }
    if (chosenTransport === 'websocket' && plan.sequenceNumbersPersisted !== true) {
      fail(
        'replay-without-sequence-persistence',
        'high',
        'replayOnReconnect is true for WebSocket but sequenceNumbersPersisted is not: without client-persisted sequence numbers there is nothing to resume from.',
        'Persist the last-seen sequence number client-side and send a resume message on reconnect; keep a server-side replay window.'
      );
    }
  }

  // --- Gate: per-connection backpressure exists ---
  if (plan.backpressureHandled !== true) {
    fail(
      'no-backpressure-strategy',
      'medium',
      'backpressureHandled is not true: neither protocol has app-level flow control, so a slow client grows an unbounded in-process send buffer.',
      'Measure send-buffer growth (bufferedAmount / blocked writes) and drop, batch, or close when the client falls behind.'
    );
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push('Plan clears every gate this skill checks. Still run the 60-second outage timeline test (reconnect + replay) through the prod-shaped proxy chain before shipping.');
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: sse_ws_channel_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    const report = auditSseWsChannel(data);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.pass) process.exit(1);
  } catch (e) {
    process.stderr.write(`sse_ws_channel_audit: ${e.message}\n`);
    process.exit(1);
  }
}
