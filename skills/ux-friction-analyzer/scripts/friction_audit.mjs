#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Thresholds are pinned to the rules already documented in SKILL.md so the
// script and the prose never silently drift apart.
const MAX_SIMULTANEOUS_ATTENTION_ELEMENTS = 4; // Quality Gates: working-memory limit
const CRITICAL_ATTENTION_ELEMENTS = 8; // roughly double the limit = critical, not just high
const HIGH_CHUNK_STEP_THRESHOLD = 4; // Friction vs Feature Trade-offs: ">4 mental chunks"
const LONG_OPERATION_SECONDS = 5; // proxy for "long operation" needing progress feedback
const MICRO_FRICTION_STEP_COUNT = 3; // >=3 steps each carrying real friction = accumulation
const MIN_TOUCH_TARGET_PX = 44; // Quality Gates: mobile touch targets >=44px
const EXPERT_PATH_STEP_THRESHOLD = 3; // flows this long without a shortcut path imprison experts

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Audit a UX flow spec against the 5 failure modes and mobile/touch/feedback
 * quality gates documented in SKILL.md. Pure, deterministic, no I/O.
 *
 * @param {unknown} flow - parsed JSON flow object matching
 *   schemas/flow-audit.schema.json.
 * @returns {{pass: boolean, findings: Array<{id: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditFrictionFlow(flow) {
  if (!isPlainObject(flow)) {
    throw new Error('flow must be a JSON object');
  }
  if (!Array.isArray(flow.steps) || flow.steps.length === 0) {
    throw new Error('flow.steps must be a non-empty array');
  }

  const findings = [];
  const recommendations = [];

  function flag(id, severity, message, recommendation) {
    findings.push({ id, severity, message });
    if (recommendation) recommendations.push(recommendation);
  }

  const steps = flow.steps;

  // --- Failure mode 1: Overwhelm Cascade ---
  const attentionElements = Number(flow.simultaneousAttentionElements) || 0;
  if (attentionElements > MAX_SIMULTANEOUS_ATTENTION_ELEMENTS) {
    flag(
      'overwhelm-cascade-attention',
      attentionElements > CRITICAL_ATTENTION_ELEMENTS ? 'critical' : 'high',
      `${attentionElements} simultaneous attention elements exceeds the working-memory limit of ${MAX_SIMULTANEOUS_ATTENTION_ELEMENTS}.`,
      'Use progressive disclosure to cut visible choices/elements down to the working-memory limit.'
    );
  }
  if (flow.primaryActionObviousWithin3s === false) {
    flag(
      'overwhelm-cascade-hidden-action',
      'high',
      'Primary action is not obvious within 3 seconds of arrival.',
      'Surface a single primary call-to-action above the fold instead of burying it in a menu.'
    );
  }
  for (const step of steps) {
    if (Number(step.chunks) > HIGH_CHUNK_STEP_THRESHOLD) {
      flag(
        'overwhelm-cascade-chunks',
        'medium',
        `Step "${step.label}" requires ${step.chunks} mental chunks, above the ${HIGH_CHUNK_STEP_THRESHOLD}-chunk wizard-split threshold.`,
        `Break "${step.label}" into smaller wizard steps of ${HIGH_CHUNK_STEP_THRESHOLD} chunks or fewer each.`
      );
    }
  }

  // --- Failure mode 2: Context Switch Death Spiral ---
  for (const step of steps) {
    const noAutoSave = step.autoSaves === false;
    const noContext = step.contextPreserved === false;
    if (noAutoSave && noContext) {
      flag(
        'context-switch-death-spiral',
        'critical',
        `Step "${step.label}" neither auto-saves nor preserves context across an interruption.`,
        `Add auto-save and a "continue where you left off" restore path to "${step.label}".`
      );
    } else if (noAutoSave || noContext) {
      flag(
        'context-switch-risk',
        'medium',
        `Step "${step.label}" is missing ${noAutoSave ? 'auto-save' : 'context preservation'} across an interruption.`,
        `Add ${noAutoSave ? 'auto-save' : 'a context-restore banner'} to "${step.label}".`
      );
    }
  }

  // --- Failure mode 3: Invisible Progress Paralysis ---
  for (const step of steps) {
    if (Number(step.timeSeconds) > LONG_OPERATION_SECONDS && step.showsProgress === false) {
      flag(
        'invisible-progress-paralysis',
        'high',
        `Step "${step.label}" takes ${step.timeSeconds}s with no progress indication.`,
        `Add a real-time progress indicator and time estimate to "${step.label}".`
      );
    }
  }

  // --- Failure mode 4: Micro-Friction Accumulation ---
  const frictionSteps = steps.filter((step) => Number(step.chunks) >= 2);
  if (frictionSteps.length >= MICRO_FRICTION_STEP_COUNT) {
    flag(
      'micro-friction-accumulation',
      frictionSteps.length >= MICRO_FRICTION_STEP_COUNT + 2 ? 'high' : 'medium',
      `${frictionSteps.length} steps each carry 2+ mental chunks of friction, which compounds across the flow.`,
      'Systematically remove one friction point per step, starting with the highest-chunk steps.'
    );
  }

  // --- Failure mode 5: Expert User Imprisonment ---
  if (steps.length >= EXPERT_PATH_STEP_THRESHOLD && flow.hasPowerUserPath !== true) {
    flag(
      'expert-user-imprisonment',
      'medium',
      `Flow has ${steps.length} steps and no power-user path (shortcuts, batch actions, skip-ahead).`,
      'Add a keyboard-shortcut or batch-action path for repeat/expert users.'
    );
  }

  // --- Mobile / touch / feedback quality gates ---
  if (typeof flow.touchTargetsMinPx === 'number' && flow.touchTargetsMinPx < MIN_TOUCH_TARGET_PX) {
    flag(
      'touch-target-too-small',
      'high',
      `Smallest touch target is ${flow.touchTargetsMinPx}px, below the ${MIN_TOUCH_TARGET_PX}px minimum.`,
      `Increase all interactive touch targets to at least ${MIN_TOUCH_TARGET_PX}px.`
    );
  }
  if (flow.worksAt320pxNoHscroll === false) {
    flag(
      'no-320px-reflow',
      'high',
      'Flow does not reflow cleanly at a 320px viewport width without horizontal scrolling.',
      'Fix the responsive layout so the flow works at a 320px viewport with no horizontal scroll.'
    );
  }
  if (flow.feedbackWithin100ms === false) {
    flag(
      'feedback-latency',
      'high',
      'Not every user action receives feedback within 100ms.',
      'Add immediate optimistic UI feedback (pressed state, spinner) within 100ms of every action, even if the underlying operation takes longer.'
    );
  }

  const criticalCount = findings.filter((f) => f.severity === 'critical').length;
  const highCount = findings.filter((f) => f.severity === 'high').length;
  const pass = criticalCount === 0 && highCount <= 1;

  return { pass, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: friction_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    process.stdout.write(`${JSON.stringify(auditFrictionFlow(data), null, 2)}\n`);
  } catch (e) {
    process.stderr.write(`friction_audit: ${e.message}\n`);
    process.exit(1);
  }
}
