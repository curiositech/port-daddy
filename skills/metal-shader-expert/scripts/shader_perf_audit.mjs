#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_STAGES = new Set(['fragment', 'compute', 'vertex', 'tile']);
const VALID_PRECISIONS = new Set(['half', 'float']);

const OCCUPANCY_MIN_PCT = 75;
const REGISTER_USAGE_MAX_PCT = 80;
const TILE_MEMORY_MAX_KB = 32;
const SIMD_GROUP_WIDTH = 32;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isBool(value) {
  return typeof value === 'boolean';
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Audit an MSL shader plan against this skill's deterministic failure modes:
 * bandwidth bandit (multi-pass store/load that a tile shader would avoid, or
 * non-memoryless intermediates), register pressure cascade / precision
 * overkill (float used for display-bound values; low occupancy or high
 * register usage), branch divergence (runtime branch on a uniform instead of
 * a function constant), tile memory over the 32KB per-tile limit, and a
 * threadgroup size that is not a multiple of the 32-wide SIMD group.
 *
 * @param {unknown} plan - parsed JSON shader plan object.
 * @returns {{pass: boolean, findings: Array<{id: string, severity: string, message: string, shader?: string}>, recommendations: string[]}}
 */
export function auditShaderPerf(plan) {
  if (!isPlainObject(plan)) {
    throw new Error('shader plan must be a JSON object');
  }
  if (!Array.isArray(plan.shaders) || plan.shaders.length === 0) {
    throw new Error('shader plan must have a non-empty "shaders" array');
  }

  const findings = [];
  const recommendations = [];
  let criticalOrHighHit = false;

  function flag(id, severity, message, recommendation, shaderName) {
    const finding = { id, severity, message };
    if (shaderName) finding.shader = shaderName;
    findings.push(finding);
    if (recommendation) recommendations.push(recommendation);
    if (severity === 'critical' || severity === 'high') criticalOrHighHit = true;
  }

  // --- per-shader checks ---
  plan.shaders.forEach((shader, index) => {
    if (!isPlainObject(shader)) {
      flag(
        `malformed-shader-${index}`,
        'high',
        `shaders[${index}] is not an object.`,
        'Every entry in shaders[] must be an object matching schemas/shader-plan.schema.json.'
      );
      return;
    }

    const label = typeof shader.name === 'string' && shader.name.trim() ? shader.name : `shaders[${index}]`;

    if (!VALID_STAGES.has(shader.stage)) {
      flag(
        `invalid-stage-${index}`,
        'medium',
        `${label}: stage "${shader.stage}" is not one of fragment|compute|vertex|tile.`,
        `Set ${label}.stage to one of fragment, compute, vertex, tile.`,
        label
      );
    }
    if (!VALID_PRECISIONS.has(shader.precision)) {
      flag(
        `invalid-precision-${index}`,
        'medium',
        `${label}: precision "${shader.precision}" is not one of half|float.`,
        `Set ${label}.precision to half or float.`,
        label
      );
    }

    // Failure mode: Precision Overkill / Register Pressure Cascade
    if (shader.usesFloatForDisplayBound === true) {
      flag(
        `precision-overkill-${index}`,
        'high',
        `${label}: uses float for display-bound values (color/normal) where half would halve register pressure and bandwidth.`,
        `Switch ${label} to half for display-bound colors/normals; keep float only for position/depth math.`,
        label
      );
    } else if (!isBool(shader.usesFloatForDisplayBound)) {
      flag(
        `missing-usesFloatForDisplayBound-${index}`,
        'low',
        `${label}: usesFloatForDisplayBound is not a boolean.`,
        `Record whether ${label} uses float for display-bound values.`,
        label
      );
    }

    // Failure mode: Branch Divergence Disaster
    const runtimeBranch = shader.runtimeBranchOnUniform === true;
    const usesFunctionConstant = shader.usesFunctionConstant === true;
    if (runtimeBranch && !usesFunctionConstant) {
      flag(
        `branch-divergence-${index}`,
        'high',
        `${label}: branches at runtime on a uniform/material property instead of a compile-time function constant.`,
        `Replace the runtime branch in ${label} with a [[function_constant]] so the branch is eliminated at compile time.`,
        label
      );
    } else if (!isBool(shader.runtimeBranchOnUniform) || !isBool(shader.usesFunctionConstant)) {
      flag(
        `missing-branch-fields-${index}`,
        'low',
        `${label}: runtimeBranchOnUniform and/or usesFunctionConstant is not a boolean.`,
        `Record ${label}.runtimeBranchOnUniform and ${label}.usesFunctionConstant explicitly.`,
        label
      );
    }

    // Failure mode: Bandwidth Bandit - multi-pass store/load
    if (shader.multiPassStoreLoad === true && shader.stage !== 'tile') {
      flag(
        `bandwidth-bandit-multipass-${index}`,
        'high',
        `${label}: performs multi-pass store/load that a tile shader would avoid by keeping data resident in tile memory.`,
        `Rework ${label} as a tile shader (or fold the passes into one) to eliminate the store/load round trip.`,
        label
      );
    }

    // Failure mode: Bandwidth Bandit - non-memoryless intermediates
    if (shader.memorylessIntermediates === false) {
      flag(
        `non-memoryless-intermediates-${index}`,
        'medium',
        `${label}: intermediate render targets are not memoryless, wasting bandwidth on data that never needs to leave the GPU.`,
        `Declare ${label}'s intermediate render targets MTLStorageModeMemoryless if they are not sampled after the pass.`,
        label
      );
    } else if (!isBool(shader.memorylessIntermediates)) {
      flag(
        `missing-memorylessIntermediates-${index}`,
        'low',
        `${label}: memorylessIntermediates is not a boolean.`,
        `Record whether ${label}'s intermediates are memoryless.`,
        label
      );
    }
  });

  // --- plan-level GPU counters ---
  if (isFiniteNumber(plan.occupancyPct)) {
    if (plan.occupancyPct < OCCUPANCY_MIN_PCT) {
      flag(
        'low-occupancy',
        'high',
        `GPU occupancy is ${plan.occupancyPct}%, below the ${OCCUPANCY_MIN_PCT}% quality gate.`,
        'Reduce register usage (prefer half over float for display-bound values, pack material structs) to raise occupancy.'
      );
    }
  } else {
    flag('missing-occupancyPct', 'medium', 'occupancyPct is missing or not a number.', 'Measure and record occupancyPct from the Instruments GPU profiler.');
  }

  if (isFiniteNumber(plan.registerUsagePct)) {
    if (plan.registerUsagePct > REGISTER_USAGE_MAX_PCT) {
      flag(
        'high-register-usage',
        'high',
        `Register usage is ${plan.registerUsagePct}%, above the ${REGISTER_USAGE_MAX_PCT}% quality gate and at risk of spilling.`,
        'Pack data more efficiently (half/half2/half3 instead of float4 everywhere) and check the disassembly for spill instructions.'
      );
    }
  } else {
    flag('missing-registerUsagePct', 'medium', 'registerUsagePct is missing or not a number.', 'Measure and record registerUsagePct from the shader profiler.');
  }

  // --- tile memory limit ---
  if (isFiniteNumber(plan.tileMemoryKb)) {
    if (plan.tileMemoryKb > TILE_MEMORY_MAX_KB) {
      flag(
        'tile-memory-exceeded',
        'critical',
        `Tile memory usage is ${plan.tileMemoryKb}KB, exceeding the ${TILE_MEMORY_MAX_KB}KB per-tile Apple GPU limit.`,
        'Reduce per-tile working set: use half instead of float for tile-resident data, or split the pass into fewer simultaneous render targets.'
      );
    }
  } else {
    flag('missing-tileMemoryKb', 'medium', 'tileMemoryKb is missing or not a number.', 'Measure and record tileMemoryKb from the frame debugger.');
  }

  // --- threadgroup size ---
  if (Number.isInteger(plan.threadgroupSize) && plan.threadgroupSize > 0) {
    if (plan.threadgroupSize % SIMD_GROUP_WIDTH !== 0) {
      flag(
        'threadgroup-size-not-multiple-of-32',
        'medium',
        `threadgroupSize is ${plan.threadgroupSize}, not a multiple of ${SIMD_GROUP_WIDTH} (the SIMD-group width), wasting lanes in the last group.`,
        `Round threadgroupSize up or down to the nearest multiple of ${SIMD_GROUP_WIDTH}.`
      );
    }
  } else {
    flag('missing-threadgroupSize', 'medium', 'threadgroupSize is missing or not a positive integer.', 'Record the dispatched threadgroupSize.');
  }

  const pass = !criticalOrHighHit;
  return { pass, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: shader_perf_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    process.stdout.write(`${JSON.stringify(auditShaderPerf(data), null, 2)}\n`);
  } catch (e) {
    process.stderr.write(`shader_perf_audit: ${e.message}\n`);
    process.exit(1);
  }
}
