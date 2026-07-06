#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The only easing curves this skill confirms exist on gpui 0.2.x. Anything
// else (ease_out, cubic-bezier(), spring physics, ...) is a web-motion
// vocabulary word that does not port. See references/06-motion-aesthetics-and-vocabulary.md.
const CONFIRMED_EASINGS = new Set(['ease_in_out', 'bounce', 'pulsating_between', 'linear']);

const SURFACE_KINDS = new Set(['micro', 'transition', 'bespoke']);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Audit a JSON motion plan against this skill's Quality Gates.
 *
 * A motion plan describes every animated surface in a gpui app as a flat
 * list. Each surface is checked against the seven Core Rules / Quality Gates
 * in SKILL.md: no fluent-transform usage, no layout animation in a hot
 * render, exactly one motion owner, reduced-motion that preserves
 * orientation, repeat() loops that are scoped and paused, only confirmed
 * gpui easings, and interruptible shape/identity transitions.
 *
 * @param {unknown} plan - parsed JSON motion plan, shape: { surfaces: [...] }.
 * @returns {{pass: boolean, score: number, findings: Array<{id: string, severity: string, surface: string, message: string}>, recommendations: string[]}}
 */
export function auditMotionPlan(plan) {
  if (!isPlainObject(plan)) {
    throw new Error('motion plan must be a JSON object');
  }
  if (!Array.isArray(plan.surfaces) || plan.surfaces.length === 0) {
    throw new Error('motion plan must have a non-empty "surfaces" array');
  }

  const findings = [];
  const recommendations = [];
  let criticalHit = false;
  const surfaceScores = [];

  function fail(surfaceName, id, severity, message, recommendation) {
    findings.push({ id, severity, surface: surfaceName, message });
    if (recommendation) recommendations.push(recommendation);
    if (severity === 'critical') criticalHit = true;
  }

  plan.surfaces.forEach((surface, index) => {
    const name = isNonEmptyString(surface?.name) ? surface.name : `surfaces[${index}]`;

    if (!isPlainObject(surface)) {
      fail(name, 'malformed-surface', 'critical', 'Surface entry is not an object.', 'Every entry in surfaces[] must be an object with at least name and kind.');
      surfaceScores.push(0);
      return;
    }

    let deductions = 0;

    // Gate: zero transform/scale/translate/rotate usage.
    if (surface.usesTransform === true) {
      fail(
        name,
        'uses-transform',
        'critical',
        `"${name}" is marked usesTransform: true, but gpui 0.2.x has no fluent transform on div — no .scale()/.translate()/.rotate().`,
        `Re-derive "${name}"'s intent as opacity + BoxShadow + an animated layout fraction instead of a transform.`
      );
      deductions += 40;
    }

    // Gate: no width/height/px/inset animation in a hot render.
    if (surface.animatesLayoutInHotRender === true) {
      fail(
        name,
        'layout-animation-in-hot-render',
        'high',
        `"${name}" animates layout (width/height/px/inset) inside a hot render; every re-render walks the whole element tree.`,
        `Animate a single layout fraction at the smallest enclosing node for "${name}", or replace the effect with opacity/BoxShadow.`
      );
      deductions += 25;
    }

    // Gate: exactly one motion owner per surface.
    const owners = typeof surface.owners === 'number' ? surface.owners : null;
    if (owners === null) {
      fail(name, 'owners-unspecified', 'medium', `"${name}" does not declare an owner count.`, `Declare surfaces[].owners for "${name}" so multi-owner conflicts can be detected.`);
      deductions += 10;
    } else if (owners > 1) {
      fail(
        name,
        'multiple-motion-owners',
        'high',
        `"${name}" has ${owners} motion owners; two with_animations (or a with_animation and a state machine) fighting one element produces flicker and stale values.`,
        `Make one owner authoritative for "${name}" — a single with_animation or a single transition state machine — and remove the competing driver.`
      );
      deductions += 25;
    }

    // Gate: reduced-motion handled and preserves orientation.
    const reducedMotion = surface.reducedMotion;
    if (!isPlainObject(reducedMotion) || reducedMotion.handled !== true) {
      fail(
        name,
        'reduced-motion-missing',
        'high',
        `"${name}" has no reduced-motion handling. There is no @media fallback in gpui — the static/instant path must be decided explicitly.`,
        `Add a reduced-motion branch for "${name}" that resolves to the final state instantly.`
      );
      deductions += 20;
    } else if (reducedMotion.preservesOrientation !== true) {
      fail(
        name,
        'reduced-motion-deletes-orientation',
        'high',
        `"${name}" handles reduced motion but does not preserve orientation — the operator loses track of what moved or which state is active.`,
        `Keep a minimal fade or final-state hint for "${name}" under reduced motion; reduced motion means less travel, not deleted feedback.`
      );
      deductions += 15;
    }

    // Gate: every repeat() loop is scoped to its smallest leaf view and paused when idle.
    const repeat = surface.repeat;
    if (isPlainObject(repeat) && repeat.present === true) {
      if (repeat.scopedToLeaf !== true) {
        fail(
          name,
          'repeat-not-scoped',
          'medium',
          `"${name}" has a .repeat() loop that is not scoped to its smallest leaf view.`,
          `Scope the .repeat() on "${name}" to the smallest leaf view that needs it, not a view mounted high in the tree.`
        );
        deductions += 15;
      }
      if (repeat.pausesWhenIdle !== true) {
        fail(
          name,
          'repeat-never-pauses',
          'high',
          `"${name}" has a .repeat() loop that never pauses; it re-renders the window forever even when off-screen or idle.`,
          `Pause or unmount the .repeat() on "${name}" when its surface is idle, hidden, or off-screen.`
        );
        deductions += 20;
      }
    }

    // Gate: only confirmed gpui easings.
    if (isNonEmptyString(surface.easing) && !CONFIRMED_EASINGS.has(surface.easing)) {
      fail(
        name,
        'unconfirmed-easing',
        'high',
        `"${name}" uses easing "${surface.easing}", which is not a confirmed gpui 0.2.x curve.`,
        `Use one of ${[...CONFIRMED_EASINGS].join(', ')} for "${name}" instead of "${surface.easing}".`
      );
      deductions += 15;
    }

    // Gate: shape/identity transitions are interruptible state machines.
    if (surface.kind === 'transition' && surface.interruptible !== true) {
      fail(
        name,
        'non-interruptible-transition',
        'medium',
        `"${name}" is a shape/identity transition but is not marked interruptible; mid-flight interruptions will restart from zero instead of retargeting.`,
        `Model "${name}" as a retargetable transition state machine that can be interrupted mid-flight without restarting.`
      );
      deductions += 15;
    }

    // Structural sanity: surface kind must be one of the three the skill recognizes.
    if (!SURFACE_KINDS.has(surface.kind)) {
      fail(
        name,
        'unknown-surface-kind',
        'medium',
        `"${name}" has kind "${surface.kind}", which is not one of micro/transition/bespoke.`,
        `Classify "${name}" as micro, transition, or bespoke per the skill's Decision Points.`
      );
      deductions += 10;
    }

    surfaceScores.push(Math.max(0, 100 - deductions));
  });

  const score = Math.round(surfaceScores.reduce((sum, s) => sum + s, 0) / surfaceScores.length);
  const pass = !criticalHit && findings.every((f) => f.severity !== 'high') && score >= 90;

  if (findings.length === 0) {
    recommendations.push('Motion plan is clean against all Quality Gates. Build and run it — this audit checks the plan, not the rendered frame.');
  }

  return {
    pass,
    score,
    findings,
    recommendations,
  };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: motion_audit.mjs --input <plan>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    process.stdout.write(`${JSON.stringify(auditMotionPlan(data), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`motion_audit: ${error.message}\n`);
    process.exit(1);
  }
}
