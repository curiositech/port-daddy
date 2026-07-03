#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_SYMPTOMS = ['panic', 'hang', 'slow', 'wrong-result', 'dyld-load', 'link-fail', 'ub', 'heisenbug'];
const VALID_STACK_KNOBS = ['RUST_MIN_STACK', 'recursion_limit'];

// The canonical tool-shape map from this skill's Decision Points flowchart.
// Each symptom (and, for 'hang', each async-ness) names the substrings that
// indicate a correctly-matched tool. `chosenTool` is matched case-insensitively.
const SHAPE_TOOLS = {
  panic: ['backtrace', 'panic-hook', 'panic hook', 'catch_unwind', 'rust_backtrace'],
  'hang:async': ['tokio-console', 'async-backtrace', 'console-subscriber'],
  'hang:sync': ['lldb', 'gdb'],
  slow: ['flamegraph', 'samply', 'instruments', 'xctrace'],
  'wrong-result': ['tracing', 'trace'],
  'dyld-load': ['otool', 'dyld', 'install_name_tool', 'nm', 'dlopen', 'dlerror'],
  'link-fail': ['cargo build -v', 'cargo tree', 'linker', 'cargo build'],
  ub: ['miri', 'sanitizer', 'tsan', 'asan'],
  heisenbug: ['miri', 'sanitizer', 'overflow-checks'],
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function toolContainsAny(chosenTool, substrings) {
  const lower = chosenTool.toLowerCase();
  return substrings.some((s) => lower.includes(s.toLowerCase()));
}

/**
 * Audit a Rust debug-session plan against rust-debugging-mastery's thesis
 * (match the tool to the bug's *shape*) and its Quality Gates.
 *
 * @param {unknown} plan - parsed JSON debug-session plan, see schemas/debug-plan.schema.json
 * @returns {{pass: boolean, score: number, findings: Array<{id: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditDebugPlan(plan) {
  if (!isPlainObject(plan)) {
    throw new Error('plan must be a JSON object');
  }
  if (!VALID_SYMPTOMS.includes(plan.symptom)) {
    throw new Error(`plan.symptom must be one of: ${VALID_SYMPTOMS.join(', ')}`);
  }
  if (typeof plan.isAsync !== 'boolean') {
    throw new Error('plan.isAsync must be a boolean');
  }
  if (!isNonEmptyString(plan.chosenTool)) {
    throw new Error('plan.chosenTool must be a non-empty string');
  }

  const { symptom, isAsync, chosenTool } = plan;
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

  // --- Gate 1: tool matched to bug shape (the skill's core thesis) ---
  const shapeKey = symptom === 'hang' ? `hang:${isAsync ? 'async' : 'sync'}` : symptom;
  const shapeTools = SHAPE_TOOLS[shapeKey] ?? [];
  const shapeMatches = toolContainsAny(chosenTool, shapeTools);

  if (symptom === 'hang' && isAsync && toolContainsAny(chosenTool, ['lldb', 'gdb', 'rust-lldb', 'rust-gdb'])) {
    // The flagship anti-pattern: attaching a traditional debugger to a hung
    // async program. A suspended .await is heap state, not a stack frame.
    fail(
      'debugger-attached-to-async-hang',
      'critical',
      `chosenTool "${chosenTool}" is a stack-frame debugger applied to an async hang; a suspended .await is heap state, not a stack frame, so lldb/gdb will only show executor poll frames.`,
      'Use tokio-console (RUSTFLAGS="--cfg tokio_unstable" + tokio "tracing" feature) to find the never-yielded/lost-waker task instead of attaching lldb/gdb.'
    );
  } else if (!shapeMatches) {
    fail(
      'tool-mismatched-to-bug-shape',
      'high',
      `chosenTool "${chosenTool}" does not match the expected tool shape for symptom "${symptom}"${symptom === 'hang' ? ` (isAsync=${isAsync})` : ''}. Expected one of: ${shapeTools.join(', ') || '(no shape defined)'}.`,
      'Re-check the Decision Points flowchart in SKILL.md and pick the tool that answers this symptom\'s actual question, not habit.'
    );
  }

  // --- Gate 2: no tracing span guard held across .await in async code ---
  if (isAsync) {
    if (plan.tracingSpanGuardAcrossAwait === true) {
      fail(
        'span-guard-held-across-await',
        'critical',
        'tracingSpanGuardAcrossAwait is true: a span.enter()/entered() guard is held across an .await point, which corrupts the trace once the task yields.',
        'Use #[tracing::instrument] on the async fn, or future.instrument(span).await, instead of holding the RAII guard across .await.'
      );
    }
  }

  // --- Gate 3: tokio-console requires the unstable flags ---
  if (toolContainsAny(chosenTool, ['tokio-console'])) {
    if (plan.tokioConsoleFlagsSet !== true) {
      fail(
        'tokio-console-missing-unstable-flags',
        'high',
        'chosenTool is tokio-console but tokioConsoleFlagsSet is not true: without RUSTFLAGS="--cfg tokio_unstable" and the tokio "tracing" feature, tokio-console shows no data.',
        'Set RUSTFLAGS="--cfg tokio_unstable" and enable tokio\'s "tracing" feature before trusting an empty tokio-console view.'
      );
    }
  }

  // --- Gate 4: release profiling needs debug symbols ---
  if (symptom === 'slow' || toolContainsAny(chosenTool, ['flamegraph', 'samply', 'instruments'])) {
    if (plan.releaseDebugSymbols !== true) {
      fail(
        'release-profile-missing-debug-symbols',
        'high',
        'Profiling a release build without releaseDebugSymbols=true produces a flamegraph of unnamed/flat frames.',
        'Set [profile.release] debug = true so the flamegraph/samply/Instruments trace resolves real symbol names.'
      );
    }
  }

  // --- Gate 5: generic-fn breakpoints must use a regex ---
  if (toolContainsAny(chosenTool, ['lldb', 'gdb'])) {
    if (plan.genericBreakpointRegex !== true) {
      fail(
        'generic-breakpoint-not-regex',
        'medium',
        'lldb/gdb is in use but genericBreakpointRegex is not true: a breakpoint on a generic fn symbol only catches one monomorphization.',
        'Use a regex breakpoint (lldb: breakpoint set -r \'crate::fn_name\'; gdb: rbreak crate::fn_name) to catch every instantiation.'
      );
    }
  }

  // --- Gate 6: RUST_MIN_STACK (runtime) vs recursion_limit (compile-time) ---
  if (plan.stackOverflowKnob !== undefined) {
    if (!VALID_STACK_KNOBS.includes(plan.stackOverflowKnob)) {
      fail(
        'invalid-stack-overflow-knob',
        'medium',
        `stackOverflowKnob "${plan.stackOverflowKnob}" is not one of: ${VALID_STACK_KNOBS.join(', ')}.`,
        'Use RUST_MIN_STACK (runtime thread stack size) or recursion_limit (compile-time recursion cap) -- there is no third knob.'
      );
    } else if (symptom === 'link-fail' && plan.stackOverflowKnob === 'RUST_MIN_STACK') {
      fail(
        'stack-knob-mismatched-compile-time',
        'critical',
        'symptom is a compile-time failure (link-fail) but stackOverflowKnob is RUST_MIN_STACK, which only resizes a runtime thread stack and does nothing for a compile-time recursion limit.',
        'Use #![recursion_limit = "256"] (or higher) for compile-time macro/type recursion; reserve RUST_MIN_STACK for a runtime "has overflowed its stack" crash.'
      );
    } else if (symptom !== 'link-fail' && plan.stackOverflowKnob === 'recursion_limit') {
      fail(
        'stack-knob-mismatched-runtime',
        'high',
        'stackOverflowKnob is recursion_limit for a non-compile-time symptom; recursion_limit is a compile-time-only lint knob and does nothing for a runtime stack overflow.',
        'Use RUST_MIN_STACK or thread::Builder::stack_size for a runtime "has overflowed its stack" fatal error.'
      );
    }
  }

  // --- Gate 7: dlopen/Library::new on a critical path must be guarded ---
  if (symptom === 'dyld-load') {
    if (plan.dlopenGuarded !== true) {
      fail(
        'unguarded-dlopen-on-critical-path',
        'critical',
        'symptom is dyld-load but dlopenGuarded is not true: a hard dyld abort (Library not loaded / image not found) cannot be caught after the fact and takes down the whole process.',
        'Probe with dlopen(..., RTLD_NOLOAD) / libloading::Library::new and degrade the feature on Err, or bundle+re-sign the dylib with an @loader_path install name -- never unwrap() a Library::new on a critical path.'
      );
    }
  }

  // --- Gate 8: heisenbugs/UB must be reproduced under Miri/sanitizer, not "fixed" by a print ---
  if (symptom === 'heisenbug' || symptom === 'ub') {
    if (plan.reproducedUnderMiriOrSanitizer !== true) {
      fail(
        'heisenbug-not-reproduced-deterministically',
        'critical',
        `symptom is ${symptom} but reproducedUnderMiriOrSanitizer is not true: adding a print/log perturbs timing and layout, which "fixes" a heisenbug without diagnosing it.`,
        'Reproduce deterministically under Miri (cargo +nightly miri test) or a sanitizer (-Zsanitizer=address/thread) with overflow-checks=true before considering this diagnosed.'
      );
    }
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push('Plan matches the bug\'s shape and clears every quality gate this skill checks. Still verify the diagnosis against a captured artifact (backtrace, tokio-console screenshot, Miri output) before closing it out.');
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: debug_plan_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    process.stdout.write(`${JSON.stringify(auditDebugPlan(data), null, 2)}\n`);
  } catch (e) {
    process.stderr.write(`debug_plan_audit: ${e.message}\n`);
    process.exit(1);
  }
}
