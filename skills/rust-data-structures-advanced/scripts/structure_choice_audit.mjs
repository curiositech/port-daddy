#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_SHAPES = ['graph', 'tree', 'pool', 'sequence', 'map', 'shared'];
const VALID_CONCURRENT_MAPS = ['dashmap', 'rwlock', 'arc-swap', 'global-mutex'];
// Shapes where relationships are modeled node-by-node (the classic Rc<RefCell> trap).
const NODE_SHAPES = ['graph', 'tree', 'pool'];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Audit a single relationship entry from a structure-choice plan against
 * rust-data-structures-advanced's thesis (choose the structure that makes
 * ownership trivial; arena+indices over Rc<RefCell>) and its Quality Gates.
 *
 * @param {unknown} rel - one entry of plan.relationships
 * @param {number} idx - index in the relationships array, for finding ids/messages
 * @param {Array} findings - accumulator, mutated in place
 * @param {Array} recommendations - accumulator, mutated in place
 * @returns {number} score delta (negative) contributed by this relationship
 */
function auditRelationship(rel, idx, findings, recommendations) {
  if (!isPlainObject(rel)) {
    throw new Error(`plan.relationships[${idx}] must be an object`);
  }
  if (!VALID_SHAPES.includes(rel.shape)) {
    throw new Error(`plan.relationships[${idx}].shape must be one of: ${VALID_SHAPES.join(', ')}`);
  }

  let delta = 0;
  const penalties = { critical: 30, high: 15, medium: 8, low: 3 };
  let criticalHit = false;

  function fail(id, severity, message, recommendation) {
    findings.push({ id, severity, relationship: idx, shape: rel.shape, message });
    if (recommendation) recommendations.push(recommendation);
    if (severity === 'critical') criticalHit = true;
    delta -= penalties[severity] ?? 5;
  }

  // --- Gate: no Rc<RefCell<...>>/Arc<Mutex<...>> on a NODE type ---
  if (NODE_SHAPES.includes(rel.shape)) {
    if (rel.usesRcRefCellOnNode === true) {
      fail(
        'rc-refcell-on-node',
        'critical',
        `relationship[${idx}] (${rel.shape}) uses Rc<RefCell<...>> on the node type; nodes point at each other so cycles leak and borrow_mut() panics at runtime.`,
        'Put every node in one arena (slotmap/generational-arena); edges become Copy keys, so ownership is trivial and cycles are just usizes.'
      );
    }
    if (rel.usesArcMutexOnNode === true) {
      fail(
        'arc-mutex-on-node',
        'critical',
        `relationship[${idx}] (${rel.shape}) uses Arc<Mutex<...>> on the node type; this is the threaded version of the Rc<RefCell> trap and serializes every access.`,
        'Model the relationship as arena keys/indices instead; if the arena itself is shared across threads, guard the arena once (RwLock/dashmap), not every node.'
      );
    }
  }

  // --- Gate: deletable graph must use StableGraph, never plain Graph ---
  if (rel.shape === 'graph' && rel.deletableGraphUsesStableGraph === false) {
    fail(
      'deletable-graph-without-stablegraph',
      'high',
      `relationship[${idx}] is a graph without deletableGraphUsesStableGraph; deleting a node from a plain petgraph::Graph silently shifts every later NodeIndex.`,
      'Use StableGraph if nodes/edges are ever removed; reserve plain Graph for build-once/append-only graphs.'
    );
  }

  // --- Gate: reused slots need a generational index ---
  if (rel.shape === 'pool' && rel.generationalIndex === false) {
    fail(
      'reused-slot-without-generational-index',
      'high',
      `relationship[${idx}] is a pool of reused slots without a generational index; a stale bare usize/handle silently aliases a reallocated slot instead of failing.`,
      'Use slotmap or generational-arena so a stale handle fails a generation check (returns None) instead of dangling or aliasing.'
    );
  }

  // --- Gate: smallvec/arrayvec presence must be backed by a benchmark ---
  if (rel.smallvecJustifiedByBench === false) {
    fail(
      'smallvec-reflex-optimization',
      'medium',
      `relationship[${idx}] (${rel.shape}) uses an inline vector (smallvec/tinyvec/arrayvec) without smallvecJustifiedByBench; inline capacity is always in the struct even when spilled, so an unjustified swap just bloats the type.`,
      'Measure first: keep smallvec/arrayvec only where the collection is usually below the inline cap AND lives in a hot/cache-sensitive path, with a benchmark to show it.'
    );
  }

  // --- Gate: concurrent map must not default to one global Mutex ---
  if (rel.concurrentMap !== undefined) {
    if (!VALID_CONCURRENT_MAPS.includes(rel.concurrentMap)) {
      throw new Error(
        `plan.relationships[${idx}].concurrentMap must be one of: ${VALID_CONCURRENT_MAPS.join(', ')}`
      );
    }
    if (rel.concurrentMap === 'global-mutex') {
      fail(
        'arc-mutex-hashmap-default',
        'high',
        `relationship[${idx}] uses Arc<Mutex<HashMap>> (one global mutex) as the concurrent map; every thread serializes on the single lock.`,
        'Reach for dashmap (sharded locks) or, for read-mostly access, arc-swap/RwLock. Keep any dashmap Ref/RefMut guard lifetime short to avoid same-shard deadlocks.'
      );
    }
  }

  // --- Gate: hand-rolled lock-free needs epoch/hazard reclamation AND Loom ---
  if (isPlainObject(rel.handRolledLockFree) && rel.handRolledLockFree.present === true) {
    if (rel.handRolledLockFree.hasEpochOrHazard !== true) {
      fail(
        'lock-free-without-reclamation',
        'critical',
        `relationship[${idx}] hand-rolls lock-free code without epoch/hazard-pointer reclamation; freeing a popped node immediately risks the ABA problem and use-after-free.`,
        'Use crossbeam-epoch (defers frees until no thread can observe the pointer) or crossbeam-queue, which already solved this, instead of raw AtomicPtr + immediate Box::from_raw/drop.'
      );
    } else if (rel.handRolledLockFree.hasLoom !== true) {
      fail(
        'lock-free-without-loom-verification',
        'high',
        `relationship[${idx}] hand-rolls lock-free code with reclamation but no Loom coverage; interleavings that only show up under specific thread scheduling go untested.`,
        'Add a Loom model test (and run under Miri) before trusting hand-rolled lock-free code in production.'
      );
    }
  }

  // --- Gate: cheap-clone shared state should use a persistent structure ---
  if (rel.shape === 'shared' && rel.cheapCloneUsesPersistent === false) {
    fail(
      'deep-clone-instead-of-persistent',
      'medium',
      `relationship[${idx}] is shared/cheap-clone state without cheapCloneUsesPersistent; a deep clone() of a big Vec/HashMap on every snapshot is O(n) instead of O(log n) structural sharing.`,
      'Use Cow for mostly-borrow/occasionally-own data, or im/rpds for cheap-clone snapshots with structural sharing (clone is pointer+refcount; edits copy only the touched path).'
    );
  }

  // --- Gate: hasher choice must be deliberate ---
  if (rel.hasherDeliberate === false) {
    fail(
      'hasher-not-deliberate',
      'low',
      `relationship[${idx}] (${rel.shape}) does not have a deliberate hasher choice; the SipHash default is only correct when keys are untrusted/adversarial.`,
      'Keep SipHash only with a note that keys are untrusted (HashDoS risk); otherwise switch to fxhash/ahash for a faster, still-documented choice. See references/04-choosing-a-map.md.'
    );
  }

  return { delta, criticalHit };
}

/**
 * Audit a structure-choice plan against rust-data-structures-advanced's thesis
 * (choose the structure that makes ownership trivial; arena+indices over
 * Rc<RefCell>) and its Quality Gates.
 *
 * @param {unknown} plan - parsed JSON structure-choice plan, see schemas/structure-plan.schema.json
 * @returns {{pass: boolean, score: number, findings: Array<{id: string, severity: string, relationship: number, shape: string, message: string}>, recommendations: string[]}}
 */
export function auditStructureChoice(plan) {
  if (!isPlainObject(plan)) {
    throw new Error('plan must be a JSON object');
  }
  if (!Array.isArray(plan.relationships) || plan.relationships.length === 0) {
    throw new Error('plan.relationships must be a non-empty array');
  }

  const findings = [];
  const recommendations = [];
  let score = 100;
  let criticalHit = false;

  plan.relationships.forEach((rel, idx) => {
    const { delta, criticalHit: relCritical } = auditRelationship(rel, idx, findings, recommendations);
    score += delta;
    if (relCritical) criticalHit = true;
  });

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push(
      'Every relationship makes ownership trivial (arena keys, StableGraph where deletable, generational indices, sharded/read-optimized concurrency, verified lock-free, persistent snapshots, deliberate hashers). Still re-check against a real benchmark before calling the structure choice final.'
    );
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: structure_choice_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    process.stdout.write(`${JSON.stringify(auditStructureChoice(data), null, 2)}\n`);
  } catch (e) {
    process.stderr.write(`structure_choice_audit: ${e.message}\n`);
    process.exit(1);
  }
}
