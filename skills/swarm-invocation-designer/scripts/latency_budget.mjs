#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function list(value) {
  return Array.isArray(value) ? value : [];
}

function nonNegativeNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }
  return number;
}

export function evaluateLatencyBudget(plan) {
  if (!plan || typeof plan !== 'object') {
    throw new Error('plan must be an object');
  }
  if (!plan.name) {
    throw new Error('plan.name is required');
  }
  if (plan.targetP95Ms === undefined) {
    throw new Error('plan.targetP95Ms is required');
  }
  const targetP95Ms = nonNegativeNumber(plan.targetP95Ms, 'plan.targetP95Ms');
  const channels = list(plan.channels);
  if (channels.length === 0) {
    throw new Error('plan.channels must include at least one channel');
  }
  const normalizedChannels = channels.map((channel, index) => ({
    ...channel,
    p95Ms: nonNegativeNumber(channel.p95Ms, `channels[${index}].p95Ms`),
  }));
  const messages = list(plan.messages).map((message, index) => ({
    ...message,
    actualBytes: nonNegativeNumber(message.actualBytes ?? 0, `messages[${index}].actualBytes`),
    maxBytes: nonNegativeNumber(message.maxBytes ?? 4096, `messages[${index}].maxBytes`),
  }));
  const hotChannels = normalizedChannels.filter((channel) => channel.role === 'hot');
  const durableChannels = normalizedChannels.filter((channel) => channel.role === 'durable');
  const hotP95Ms = hotChannels.reduce((sum, channel) => sum + channel.p95Ms, 0);
  const durableP95Ms = durableChannels.reduce((sum, channel) => sum + channel.p95Ms, 0);
  const oversizedMessages = messages.filter((message) => message.actualBytes > message.maxBytes);

  const recommendations = [];
  if (hotP95Ms > targetP95Ms) {
    recommendations.push(`Hot path p95 ${hotP95Ms}ms exceeds target ${targetP95Ms}ms; move bulk context to durable storage and send handles only.`);
  }
  if (oversizedMessages.length > 0) {
    recommendations.push('At least one hot message exceeds its byte budget; replace blobs with content-addressed references.');
  }
  if (Number(plan.modelTurnMs ?? 0) > hotP95Ms * 5 && hotP95Ms > 0) {
    recommendations.push('Model latency dominates the loop; parallelize agent deliberation and keep bus overhead below the perception threshold.');
  }

  const icpMeaning = plan.icpMeaning || 'ambiguous';
  let icpGuidance;
  if (icpMeaning === 'internet-computer') {
    icpGuidance =
      'Internet Computer can provide durable, verifiable coordination, but consensus latency and economics make it a poor hot path for lightning-fast agent chatter.';
    recommendations.push('Use Internet Computer style persistence for receipts/settlement, not per-token or per-tool hot coordination.');
  } else if (icpMeaning === 'ipc') {
    icpGuidance =
      'Local IPC can be lightning-fast when agents exchange small typed messages over Unix domain sockets, shared memory, NATS/Redis-style pubsub, or in-process mailboxes.';
  } else {
    icpGuidance =
      'If ICP means IPC, yes: typed local messages can be sub-millisecond to low-millisecond. If it means Internet Computer Protocol, keep it durable/settlement-only.';
  }

  return {
    name: plan.name || 'unnamed-bus',
    targetP95Ms,
    hotP95Ms,
    durableP95Ms,
    pass: hotP95Ms <= targetP95Ms && oversizedMessages.length === 0,
    hotChannels,
    durableChannels,
    oversizedMessages,
    icpGuidance,
    recommendations,
  };
}

function parseArgs(argv) {
  const inputIndex = argv.indexOf('--input');
  if (inputIndex === -1 || !argv[inputIndex + 1]) {
    throw new Error('usage: latency_budget.mjs --input latency-plan.json');
  }
  return { input: argv[inputIndex + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const plan = JSON.parse(readFileSync(input, 'utf8'));
    process.stdout.write(`${JSON.stringify(evaluateLatencyBudget(plan), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`latency_budget: ${error.message}\n`);
    process.exit(1);
  }
}
