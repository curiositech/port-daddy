#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function bool(value) {
  if (value === true) return true;
  if (value === false || value === null || value === undefined) return false;
  if (typeof value !== 'string') return Boolean(value);
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  return !['false', 'none', 'no', 'n/a', 'na', 'missing', 'absent', 'not available', 'not-applicable', '0'].includes(normalized);
}

export function scoreMagicProgression(flow) {
  if (!flow || typeof flow !== 'object') {
    throw new Error('flow must be an object');
  }
  if (!Array.isArray(flow.steps) || flow.steps.length === 0) {
    throw new Error('flow.steps must be a non-empty array');
  }

  const signalKeys = ['context', 'visibleProgress', 'rollback', 'humanGate', 'receipt'];
  const steps = flow.steps.map((step, index) => {
    const friction = clamp(Number(step.friction ?? 3), 0, 5);
    const missingSignals = signalKeys.filter((key) => !bool(step[key]));
    return {
      id: step.id || `step-${index + 1}`,
      label: step.label || step.id || `Step ${index + 1}`,
      friction,
      missingSignals,
    };
  });

  const averageFriction = steps.reduce((sum, step) => sum + step.friction, 0) / steps.length;
  const frictionScore = clamp(100 - averageFriction * 20, 0, 100);
  const totalSignals = steps.length * signalKeys.length;
  const presentSignals = steps.reduce((sum, step) => sum + (signalKeys.length - step.missingSignals.length), 0);
  const signalScore = Math.round((presentSignals / totalSignals) * 100);
  const score = Math.round(frictionScore * 0.45 + signalScore * 0.55);
  const criticalMissingSignals = steps.flatMap((step) =>
    step.missingSignals
      .filter((signal) => ['rollback', 'humanGate', 'receipt'].includes(signal))
      .map((signal) => ({ step: step.id, signal })),
  );

  const recommendations = [];
  for (const step of steps) {
    for (const signal of step.missingSignals) {
      recommendations.push({
        step: step.id,
        signal,
        recommendation: `Add ${signal} to "${step.label}" so progress feels inspectable and recoverable.`,
      });
    }
    if (step.friction >= 4) {
      recommendations.push({
        step: step.id,
        signal: 'friction',
        recommendation: `Split or prefill "${step.label}" because friction ${step.friction} is too high for a comeback loop.`,
      });
    }
  }

  return {
    flowName: flow.flowName || 'unnamed-flow',
    score,
    averageFriction: Number(averageFriction.toFixed(2)),
    frictionScore: Math.round(frictionScore),
    signalScore,
    pass: score >= Number(flow.passScore ?? 75) && criticalMissingSignals.length === 0,
    criticalMissingSignals,
    steps,
    recommendations,
  };
}

function parseArgs(argv) {
  const inputIndex = argv.indexOf('--input');
  if (inputIndex === -1 || !argv[inputIndex + 1]) {
    throw new Error('usage: magic_progression_score.mjs --input flow.json');
  }
  return { input: argv[inputIndex + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const flow = JSON.parse(readFileSync(input, 'utf8'));
    process.stdout.write(`${JSON.stringify(scoreMagicProgression(flow), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`magic_progression_score: ${error.message}\n`);
    process.exit(1);
  }
}
