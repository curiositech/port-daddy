#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD_NAMES = ['null', 'len', 'bound', 'utf8', 'parse'];

const WEIGHTS = {
  catchUnwind: 20,
  guards: 20,
  freeFn: 15,
  noRustStruct: 15,
  sentinel: 10,
  constantTime: 8,
  crateType: 4,
  loader: 4,
  runtime: 4,
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Audit an FFI export plan against the quality gates in SKILL.md: no panic
 * unwind across `extern "C"`, five input guards before any logic, a free fn
 * for every handed-out string, no Rust struct/enum crossing the boundary,
 * constant-time MAC comparison, a dual rlib+cdylib crate-type, a loader that
 * degrades gracefully when the dylib is absent, and validation under the
 * real runtime (not only a unit-test harness).
 *
 * @param {unknown} plan - parsed JSON export plan.
 * @returns {{pass: boolean, findings: Array<{id: string, severity: string, message: string, export?: string}>, recommendations: string[]}}
 */
export function auditFfiExport(plan) {
  if (!isPlainObject(plan)) {
    throw new Error('plan must be a JSON object');
  }

  const findings = [];
  const recommendations = [];
  let criticalHit = false;
  let score = 0;

  function fail(id, severity, message, recommendation, exportName) {
    const finding = { id, severity, message };
    if (exportName) finding.export = exportName;
    findings.push(finding);
    if (recommendation) recommendations.push(recommendation);
    if (severity === 'critical') criticalHit = true;
  }

  const exports = Array.isArray(plan.exports) ? plan.exports : [];
  if (exports.length === 0) {
    fail(
      'no-exports-declared',
      'high',
      'plan.exports is empty: nothing to audit at the FFI boundary.',
      'Declare at least one extern "C" export in plan.exports.'
    );
  }

  // --- per-export gates ---
  let catchUnwindOk = 0;
  let guardsOk = 0;
  let freeFnOk = 0;
  let freeFnApplicable = 0;
  let noStructOk = 0;
  let sentinelOk = 0;

  for (const exp of exports) {
    const name = isPlainObject(exp) && isNonEmptyString(exp.name) ? exp.name : '(unnamed export)';

    if (!isPlainObject(exp)) {
      fail('malformed-export-entry', 'high', 'An entry in plan.exports is not an object.', 'Every export must be an object with name, hasCatchUnwindOrPanicAbort, inputGuards, etc.', name);
      continue;
    }

    // Rule 1: panic must never unwind across extern "C".
    if (exp.hasCatchUnwindOrPanicAbort === true) {
      catchUnwindOk += 1;
    } else {
      fail(
        'panic-unwind-risk',
        'critical',
        `${name}: no catch_unwind and no panic="abort" — a panic here is undefined behavior across the extern "C" boundary.`,
        `Wrap ${name}'s body in std::panic::catch_unwind (and/or set panic = "abort" in [profile.release]).`,
        name
      );
    }

    // Rule 2: five input guards before any logic.
    const guards = isPlainObject(exp.inputGuards) ? exp.inputGuards : {};
    const missingGuards = GUARD_NAMES.filter((g) => guards[g] !== true);
    if (missingGuards.length === 0) {
      guardsOk += 1;
    } else {
      fail(
        'missing-input-guards',
        'high',
        `${name}: missing input guard(s): ${missingGuards.join(', ')}.`,
        `Add the missing guard(s) to ${name} before any parsing/logic: null ptr, len==0/len>BOUND, utf8, then parse — each returns the sentinel on failure.`,
        name
      );
    }

    // Rule 3: every into_raw() needs a matching free fn.
    if (exp.handsOutString === true) {
      freeFnApplicable += 1;
      if (exp.hasMatchingFreeFn === true) {
        freeFnOk += 1;
      } else {
        fail(
          'missing-free-fn',
          'high',
          `${name}: hands out a CString via into_raw() but has no matching #[no_mangle] free fn — this leaks on every call.`,
          `Add a paired free fn (e.g. pd_string_free) for ${name} and ensure the TS caller invokes it in a finally block.`,
          name
        );
      }
    }

    // Rule 4: no Rust struct/enum across the boundary.
    if (exp.passesRustStructAcrossBoundary === true) {
      fail(
        'rust-struct-across-boundary',
        'critical',
        `${name}: passes a Rust struct/enum directly across the FFI boundary — the ABI is not C-stable and this is undefined behavior.`,
        `Marshal ${name}'s data as JSON over *const c_char + usize len instead of passing the Rust type by value/reference.`,
        name
      );
    } else {
      noStructOk += 1;
    }

    // Rule 5: fail closed — return a sentinel on any failure.
    if (exp.returnsSentinelOnFailure === true) {
      sentinelOk += 1;
    } else {
      fail(
        'no-fail-closed-sentinel',
        'medium',
        `${name}: does not document/guarantee a sentinel return (false/null) on failure — the host cannot distinguish "ok" from "malformed input".`,
        `Make ${name} return a clear sentinel (null pointer, false, or a negative code) on every failure path.`,
        name
      );
    }
  }

  if (exports.length > 0) {
    score += WEIGHTS.catchUnwind * (catchUnwindOk / exports.length);
    score += WEIGHTS.guards * (guardsOk / exports.length);
    score += WEIGHTS.noRustStruct * (noStructOk / exports.length);
    score += WEIGHTS.sentinel * (sentinelOk / exports.length);
    score += freeFnApplicable > 0 ? WEIGHTS.freeFn * (freeFnOk / freeFnApplicable) : WEIGHTS.freeFn;
  }

  // --- plan-level gates ---
  if (plan.constantTimeCompareForMacs === true) {
    score += WEIGHTS.constantTime;
  } else {
    fail(
      'non-constant-time-mac-compare',
      'critical',
      'constantTimeCompareForMacs is not true: a MAC/tag comparison that early-returns on the first differing byte leaks timing information.',
      'Use a fold-XOR compare over the full length (acc |= a[i]^b[i]; acc==0), never an early return, for any MAC/tag comparison.'
    );
  }

  const crateType = plan.crateType;
  const crateTypeOk = Array.isArray(crateType) && crateType.includes('rlib') && crateType.includes('cdylib');
  if (crateTypeOk) {
    score += WEIGHTS.crateType;
  } else {
    fail(
      'crate-type-not-dual',
      'medium',
      `crateType is ${JSON.stringify(crateType)}, not ["rlib", "cdylib"]: the core cannot be unit-tested as an rlib while also shipping as a dylib.`,
      'Set crate-type = ["rlib", "cdylib"] in Cargo.toml so cargo test exercises the same code that ships as the dylib.'
    );
  }

  if (plan.loaderDegradesGracefully === true) {
    score += WEIGHTS.loader;
  } else {
    fail(
      'loader-hard-fails',
      'high',
      'loaderDegradesGracefully is not true: the TS/Bun loader treats the FFI as a hard dependency instead of an optional upgrade.',
      'Capture the koffi.load() error, return null from the loader, and route callers to a pure-TS fallback path — CI does not build the dylib.'
    );
  }

  if (plan.testedUnderRealRuntime === true) {
    score += WEIGHTS.runtime;
  } else {
    fail(
      'not-tested-under-real-runtime',
      'medium',
      'testedUnderRealRuntime is not true: this has only been exercised under a unit-test harness (e.g. jest), not the real host runtime (e.g. bun).',
      'Run the FFI call path under the actual daemon runtime at least once (ABI width/size_t mismatches only surface there).'
    );
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && exports.length > 0 && clampedScore >= 80;

  if (findings.length === 0) {
    recommendations.push('Plan passes every deterministic gate. Still verify by hand under the real runtime and with `nm -gU` that exported symbol names match the koffi signatures byte-for-byte.');
  }

  return {
    pass,
    findings,
    recommendations,
    score: clampedScore,
  };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: ffi_safety_audit.mjs --input <plan>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    process.stdout.write(`${JSON.stringify(auditFfiExport(data), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`ffi_safety_audit: ${error.message}\n`);
    process.exit(1);
  }
}
