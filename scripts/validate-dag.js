#!/usr/bin/env node

/**
 * Jury-rig V3 DAG Validator
 *
 * Validates a .dag.yaml file against the Jury-rig V3 DAGDefinition spec.
 * Checks structural integrity, dependency graph acyclicity, edge consistency,
 * sub-DAG correctness, and Jury-rig-specific invariants.
 *
 * Usage:
 *   node scripts/validate-dag.js <path-to-dag.yaml>
 *   node scripts/validate-dag.js v4.dag.yaml --json
 *   node scripts/validate-dag.js v4.dag.yaml --strict
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — errors found (invalid DAG)
 *   2 — usage error
 *
 * Gift from the Port Daddy project to Jury-rig.
 * Spec reference: Jury-rig V3 Practitioner's Guide, Parts 1–3.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// Resolve YAML parser: try 'yaml', then 'js-yaml', then fail with helpful message
let parseYaml;
try {
  const require = createRequire(import.meta.url);
  try {
    const yaml = require('yaml');
    parseYaml = (str) => yaml.parse(str);
  } catch {
    const jsYaml = require('js-yaml');
    parseYaml = (str) => jsYaml.load(str);
  }
} catch {
  console.error('Error: No YAML parser found. Install one of: npm install --save-dev yaml  OR  npm install --save-dev js-yaml');
  process.exit(2);
}

// ─── Constants from Jury-rig V3 spec ──────────────────────────

const VALID_NODE_TYPES = ['concrete', 'vague', 'human-gate'];
const VALID_COMMITMENT_LEVELS = ['COMMITTED', 'TENTATIVE', 'EXPLORATORY'];
const VALID_EDGE_TYPES = ['data-flow', 'contract', 'subscription'];
const VALID_EDGE_PROTOCOLS = ['hard', 'soft'];
const VALID_COORDINATION_TYPES = ['dag', 'team', 'market', 'debate', 'blackboard', 'hierarchical'];
const VALID_CHECKPOINT_STRATEGIES = ['per-node', 'per-batch', 'per-wave'];
const VALID_EXECUTION_MODES = ['sequential', 'async', 'multiprocess'];
const VALID_TERMINATION_GUARANTEES = ['guaranteed', 'probabilistic', 'none'];

// Required top-level fields per Jury-rig DAGDefinition interface
const REQUIRED_TOP_LEVEL = ['id', 'name', 'description', 'nodes'];
// Optional but recommended
const RECOMMENDED_TOP_LEVEL = ['default_model', 'edges', 'execution', 'coordination_model'];

// Required fields per node type
const REQUIRED_CONCRETE_FIELDS = ['id', 'type', 'name'];
const REQUIRED_VAGUE_FIELDS = ['id', 'type', 'name', 'role_description', 'dependency_list'];
const REQUIRED_HUMAN_GATE_FIELDS = ['id', 'type', 'prompt', 'outcomes'];

// ─── Validation engine ───────────────────────────────────────

class DagValidator {
  constructor(dag, options = {}) {
    this.dag = dag;
    this.strict = options.strict || false;
    this.errors = [];
    this.warnings = [];
    this.info = [];
    this.nodeIds = new Set();
    this.subNodeIds = new Set();
    this.allNodeIds = new Set(); // top-level + sub-dag nodes
  }

  error(check, message, context) {
    this.errors.push({ check, message, context });
  }

  warn(check, message, context) {
    this.warnings.push({ check, message, context });
  }

  note(check, message) {
    this.info.push({ check, message });
  }

  validate() {
    this.checkTopLevel();
    this.checkNodes();
    this.checkEdges();
    this.checkAcyclicity();
    this.checkCriticalPath();
    this.checkCoordinationModel();
    this.checkExecution();
    this.checkCompleteness();
    return {
      valid: this.errors.length === 0,
      errors: this.errors,
      warnings: this.warnings,
      info: this.info,
      stats: this.computeStats(),
    };
  }

  // ─── Top-level structure ─────────────────────────────────

  checkTopLevel() {
    const check = 'top-level';

    for (const field of REQUIRED_TOP_LEVEL) {
      if (this.dag[field] === undefined || this.dag[field] === null) {
        this.error(check, `Missing required field: ${field}`);
      }
    }

    for (const field of RECOMMENDED_TOP_LEVEL) {
      if (this.dag[field] === undefined) {
        this.warn(check, `Missing recommended field: ${field}`);
      }
    }

    if (typeof this.dag.id === 'string' && !/^[a-z0-9][a-z0-9._-]*$/.test(this.dag.id)) {
      this.warn(check, `DAG id "${this.dag.id}" contains unusual characters — recommend lowercase alphanumeric with hyphens`);
    }

    if (this.dag.nodes && !Array.isArray(this.dag.nodes)) {
      this.error(check, `"nodes" must be an array, got ${typeof this.dag.nodes}`);
    }

    if (this.dag.edges && !Array.isArray(this.dag.edges)) {
      this.error(check, `"edges" must be an array, got ${typeof this.dag.edges}`);
    }
  }

  // ─── Node validation ─────────────────────────────────────

  checkNodes() {
    const nodes = this.dag.nodes;
    if (!Array.isArray(nodes)) return;

    if (nodes.length === 0) {
      this.error('nodes', 'DAG has no nodes');
      return;
    }

    for (const node of nodes) {
      this.checkNode(node);
    }

    // Check for duplicate IDs
    const ids = nodes.map(n => n.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dupes.length > 0) {
      this.error('nodes', `Duplicate node IDs: ${[...new Set(dupes)].join(', ')}`);
    }
  }

  checkNode(node) {
    const check = `node:${node.id || '(unnamed)'}`;

    // Basic fields
    if (!node.id) {
      this.error(check, 'Node missing required field: id');
      return;
    }

    this.nodeIds.add(node.id);
    this.allNodeIds.add(node.id);

    if (!node.type) {
      this.error(check, 'Node missing required field: type');
    } else if (!VALID_NODE_TYPES.includes(node.type)) {
      this.error(check, `Invalid node type "${node.type}" — expected one of: ${VALID_NODE_TYPES.join(', ')}`);
    }

    if (!node.name) {
      this.error(check, 'Node missing required field: name');
    }

    // Type-specific validation
    if (node.type === 'concrete') {
      this.checkConcreteNode(node, check);
    } else if (node.type === 'vague') {
      this.checkVagueNode(node, check);
    } else if (node.type === 'human-gate') {
      this.checkHumanGateNode(node, check);
    }

    // Commitment level
    if (node.commitment_level !== undefined) {
      if (!VALID_COMMITMENT_LEVELS.includes(node.commitment_level)) {
        this.error(check, `Invalid commitment_level "${node.commitment_level}" — expected one of: ${VALID_COMMITMENT_LEVELS.join(', ')}`);
      }
    }

    // LOE sanity
    if (node.loe !== undefined) {
      if (typeof node.loe !== 'number' || node.loe < 0) {
        this.error(check, `loe must be a non-negative number, got ${node.loe}`);
      }
      if (node.loe > 10000) {
        this.warn(check, `loe of ${node.loe} is very large — consider decomposing into a sub-DAG`);
      }
    }

    // Version field
    if (node.version !== undefined && typeof node.version !== 'string') {
      this.warn(check, `version should be a string, got ${typeof node.version}`);
    }

    // Tier field
    if (node.tier !== undefined && (typeof node.tier !== 'number' || node.tier < 0)) {
      this.warn(check, `tier should be a non-negative number, got ${node.tier}`);
    }
  }

  checkConcreteNode(node, check) {
    // Concrete nodes should have description, skills, or input/output
    if (!node.description && !node.skills) {
      this.warn(check, 'Concrete node has neither description nor skills — may perform poorly');
    }

    if (node.input?.requires && !Array.isArray(node.input.requires)) {
      this.error(check, '"input.requires" must be an array');
    }

    // Check that input.requires references valid node IDs (deferred to edge check)
  }

  checkVagueNode(node, check) {
    if (!node.role_description) {
      this.error(check, 'Vague node missing required field: role_description');
    }

    if (!node.dependency_list) {
      this.error(check, 'Vague node missing required field: dependency_list');
    } else if (!Array.isArray(node.dependency_list)) {
      this.error(check, '"dependency_list" must be an array');
    }

    if (node.estimated_expansion_depth !== undefined) {
      if (typeof node.estimated_expansion_depth !== 'number' || node.estimated_expansion_depth < 1) {
        this.warn(check, `estimated_expansion_depth should be a positive integer, got ${node.estimated_expansion_depth}`);
      }
    }

    // Validate sub-DAG if present
    if (node.sub_dag) {
      this.checkSubDag(node, check);
    }
  }

  checkHumanGateNode(node, check) {
    if (!node.prompt) {
      this.error(check, 'Human gate node missing required field: prompt');
    }
    if (!node.outcomes || !Array.isArray(node.outcomes) || node.outcomes.length === 0) {
      this.error(check, 'Human gate node missing required field: outcomes (non-empty array)');
    }
  }

  // ─── Sub-DAG validation ──────────────────────────────────

  checkSubDag(parentNode, parentCheck) {
    const subDag = parentNode.sub_dag;
    if (!Array.isArray(subDag)) {
      this.error(parentCheck, '"sub_dag" must be an array');
      return;
    }

    if (subDag.length === 0) {
      this.warn(parentCheck, 'sub_dag is empty');
      return;
    }

    const subIds = new Set();
    const prefix = parentNode.id + '.';

    for (const subNode of subDag) {
      const subCheck = `sub_dag:${subNode.id || '(unnamed)'}`;

      if (!subNode.id) {
        this.error(subCheck, 'Sub-DAG node missing id');
        continue;
      }

      // Sub-node IDs should be prefixed with parent ID
      if (!subNode.id.startsWith(prefix)) {
        this.warn(subCheck, `Sub-DAG node id "${subNode.id}" should be prefixed with "${prefix}"`);
      }

      if (subIds.has(subNode.id)) {
        this.error(subCheck, `Duplicate sub-DAG node id: ${subNode.id}`);
      }
      subIds.add(subNode.id);
      this.subNodeIds.add(subNode.id);
      this.allNodeIds.add(subNode.id);

      if (!subNode.name) {
        this.error(subCheck, 'Sub-DAG node missing name');
      }

      // Check depends_on references within sub-DAG or parent's dependencies
      if (subNode.depends_on) {
        if (!Array.isArray(subNode.depends_on)) {
          this.error(subCheck, '"depends_on" must be an array');
        } else {
          for (const dep of subNode.depends_on) {
            // Dep can be a sub-node of same parent OR a top-level node in parent's dependency_list
            const isSubNode = subDag.some(n => n.id === dep);
            const isParentDep = parentNode.dependency_list?.includes(dep);
            const isTopLevel = this.dag.nodes?.some(n => n.id === dep);

            if (!isSubNode && !isParentDep && !isTopLevel) {
              this.error(subCheck, `depends_on references unknown node "${dep}" — not in sub-DAG, parent dependency_list, or top-level nodes`);
            }
          }
        }
      }
    }

    // Check sub-DAG acyclicity
    this.checkSubDagAcyclicity(parentNode.id, subDag);

    // Cross-reference: estimated_expansion_depth vs actual
    if (parentNode.estimated_expansion_depth !== undefined) {
      if (subDag.length !== parentNode.estimated_expansion_depth) {
        this.note(parentCheck, `estimated_expansion_depth is ${parentNode.estimated_expansion_depth} but sub_dag has ${subDag.length} nodes`);
      }
    }

    // Verify sub-DAG LOE sums to parent LOE (approximately)
    const subLoeTotal = subDag.reduce((sum, n) => sum + (n.loe || 0), 0);
    if (parentNode.loe && subLoeTotal > 0) {
      const ratio = subLoeTotal / parentNode.loe;
      if (ratio < 0.5 || ratio > 2.0) {
        this.warn(parentCheck, `Sub-DAG LOE total (${subLoeTotal}) differs significantly from parent LOE (${parentNode.loe})`);
      }
    }
  }

  checkSubDagAcyclicity(parentId, subDag) {
    const adj = new Map();
    for (const node of subDag) {
      adj.set(node.id, node.depends_on?.filter(d => subDag.some(n => n.id === d)) || []);
    }

    const visited = new Set();
    const inStack = new Set();

    const hasCycle = (nodeId) => {
      if (inStack.has(nodeId)) return true;
      if (visited.has(nodeId)) return false;
      visited.add(nodeId);
      inStack.add(nodeId);
      for (const dep of (adj.get(nodeId) || [])) {
        if (hasCycle(dep)) return true;
      }
      inStack.delete(nodeId);
      return false;
    };

    for (const node of subDag) {
      if (hasCycle(node.id)) {
        this.error(`sub_dag:${parentId}`, `Cycle detected in sub-DAG starting from ${node.id}`);
        return;
      }
    }
  }

  // ─── Edge validation ─────────────────────────────────────

  checkEdges() {
    const edges = this.dag.edges;
    if (!Array.isArray(edges)) return;

    const edgeSet = new Set();

    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i];
      const check = `edge[${i}]:${edge.from}→${edge.to}`;

      // Required fields
      if (!edge.from) {
        this.error(check, 'Edge missing required field: from');
        continue;
      }
      if (!edge.to) {
        this.error(check, 'Edge missing required field: to');
        continue;
      }

      // Self-loop
      if (edge.from === edge.to) {
        this.error(check, `Self-loop: "${edge.from}" depends on itself`);
      }

      // Duplicate edge
      const edgeKey = `${edge.from}→${edge.to}`;
      if (edgeSet.has(edgeKey)) {
        this.warn(check, `Duplicate edge: ${edgeKey}`);
      }
      edgeSet.add(edgeKey);

      // Reference existing nodes
      if (!this.nodeIds.has(edge.from)) {
        this.error(check, `"from" references unknown node "${edge.from}"`);
      }
      if (!this.nodeIds.has(edge.to)) {
        this.error(check, `"to" references unknown node "${edge.to}"`);
      }

      // Edge type
      if (edge.type && !VALID_EDGE_TYPES.includes(edge.type)) {
        this.warn(check, `Unknown edge type "${edge.type}" — expected one of: ${VALID_EDGE_TYPES.join(', ')}`);
      }

      // Edge protocol
      if (edge.protocol && !VALID_EDGE_PROTOCOLS.includes(edge.protocol)) {
        this.warn(check, `Unknown edge protocol "${edge.protocol}" — expected one of: ${VALID_EDGE_PROTOCOLS.join(', ')}`);
      }
    }

    // Check that all input.requires references have corresponding edges
    this.checkEdgeCompleteness(edges);
  }

  checkEdgeCompleteness(edges) {
    const nodes = this.dag.nodes;
    if (!Array.isArray(nodes)) return;

    const edgeFromTo = new Set(edges.map(e => `${e.from}→${e.to}`));

    for (const node of nodes) {
      // Check concrete node input.requires
      if (node.input?.requires) {
        for (const dep of node.input.requires) {
          if (!edgeFromTo.has(`${dep}→${node.id}`)) {
            this.warn(`completeness:${node.id}`, `input.requires "${dep}" but no edge ${dep}→${node.id} in edges list`);
          }
        }
      }

      // Check vague node dependency_list
      if (node.type === 'vague' && node.dependency_list) {
        for (const dep of node.dependency_list) {
          if (!edgeFromTo.has(`${dep}→${node.id}`)) {
            this.warn(`completeness:${node.id}`, `dependency_list includes "${dep}" but no edge ${dep}→${node.id} in edges list`);
          }
        }
      }
    }
  }

  // ─── Acyclicity check (top-level DAG) ────────────────────

  checkAcyclicity() {
    const edges = this.dag.edges;
    if (!Array.isArray(edges)) return;

    // Build adjacency list (only hard edges, since soft edges can be deferred)
    const adj = new Map();
    for (const id of this.nodeIds) {
      adj.set(id, []);
    }
    for (const edge of edges) {
      if (edge.protocol !== 'soft' && adj.has(edge.from)) {
        adj.get(edge.from).push(edge.to);
      }
    }

    // Kahn's algorithm for topological sort / cycle detection
    const inDegree = new Map();
    for (const id of this.nodeIds) {
      inDegree.set(id, 0);
    }
    for (const [, neighbors] of adj) {
      for (const neighbor of neighbors) {
        if (inDegree.has(neighbor)) {
          inDegree.set(neighbor, inDegree.get(neighbor) + 1);
        }
      }
    }

    const queue = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }

    let sorted = 0;
    while (queue.length > 0) {
      const node = queue.shift();
      sorted++;
      for (const neighbor of (adj.get(node) || [])) {
        if (inDegree.has(neighbor)) {
          const newDeg = inDegree.get(neighbor) - 1;
          inDegree.set(neighbor, newDeg);
          if (newDeg === 0) queue.push(neighbor);
        }
      }
    }

    if (sorted < this.nodeIds.size) {
      const cycleNodes = [...inDegree.entries()]
        .filter(([, deg]) => deg > 0)
        .map(([id]) => id);
      this.error('acyclicity', `Cycle detected among hard edges — involved nodes: ${cycleNodes.join(', ')}`);
    } else {
      this.note('acyclicity', `Topological order valid — ${sorted} nodes, no cycles in hard edges`);
    }

    // Also check with soft edges included
    const adjAll = new Map();
    for (const id of this.nodeIds) {
      adjAll.set(id, []);
    }
    for (const edge of edges) {
      if (adjAll.has(edge.from)) {
        adjAll.get(edge.from).push(edge.to);
      }
    }

    const inDegreeAll = new Map();
    for (const id of this.nodeIds) {
      inDegreeAll.set(id, 0);
    }
    for (const [, neighbors] of adjAll) {
      for (const neighbor of neighbors) {
        if (inDegreeAll.has(neighbor)) {
          inDegreeAll.set(neighbor, inDegreeAll.get(neighbor) + 1);
        }
      }
    }

    const queueAll = [];
    for (const [id, deg] of inDegreeAll) {
      if (deg === 0) queueAll.push(id);
    }

    let sortedAll = 0;
    while (queueAll.length > 0) {
      const node = queueAll.shift();
      sortedAll++;
      for (const neighbor of (adjAll.get(node) || [])) {
        if (inDegreeAll.has(neighbor)) {
          const newDeg = inDegreeAll.get(neighbor) - 1;
          inDegreeAll.set(neighbor, newDeg);
          if (newDeg === 0) queueAll.push(neighbor);
        }
      }
    }

    if (sortedAll < this.nodeIds.size) {
      const cycleNodes = [...inDegreeAll.entries()]
        .filter(([, deg]) => deg > 0)
        .map(([id]) => id);
      this.error('acyclicity', `Cycle detected when including soft edges — involved nodes: ${cycleNodes.join(', ')}`);
    }
  }

  // ─── Critical path validation ────────────────────────────

  checkCriticalPath() {
    const metadata = this.dag.metadata;
    if (!metadata?.critical_path) return;

    const cp = metadata.critical_path;
    if (!Array.isArray(cp)) {
      this.error('critical-path', '"metadata.critical_path" must be an array');
      return;
    }

    // All critical path nodes must exist
    for (const nodeId of cp) {
      if (!this.nodeIds.has(nodeId)) {
        this.error('critical-path', `Critical path references unknown node: ${nodeId}`);
      }
    }

    // Critical path nodes should be marked critical_path: true
    const nodes = this.dag.nodes || [];
    for (const nodeId of cp) {
      const node = nodes.find(n => n.id === nodeId);
      if (node && !node.critical_path) {
        this.warn('critical-path', `Node "${nodeId}" is in critical_path but not marked critical_path: true`);
      }
    }

    // Verify critical path is actually a path (each node depends on the previous)
    const edges = this.dag.edges || [];
    const hardEdgeSet = new Set(
      edges.filter(e => e.protocol !== 'soft').map(e => `${e.from}→${e.to}`)
    );

    for (let i = 0; i < cp.length - 1; i++) {
      const from = cp[i];
      const to = cp[i + 1];

      // Check reachability (direct or transitive via hard edges)
      if (!this.isReachable(from, to, edges.filter(e => e.protocol !== 'soft'))) {
        this.warn('critical-path', `Critical path break: no hard-edge path from "${from}" to "${to}"`);
      }
    }
  }

  isReachable(from, to, edges) {
    const adj = new Map();
    for (const id of this.nodeIds) {
      adj.set(id, []);
    }
    for (const edge of edges) {
      if (adj.has(edge.from)) {
        adj.get(edge.from).push(edge.to);
      }
    }

    const visited = new Set();
    const queue = [from];
    visited.add(from);

    while (queue.length > 0) {
      const current = queue.shift();
      if (current === to) return true;
      for (const neighbor of (adj.get(current) || [])) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    return false;
  }

  // ─── Coordination model ──────────────────────────────────

  checkCoordinationModel() {
    const cm = this.dag.coordination_model;
    if (!cm) return;

    if (cm.type && !VALID_COORDINATION_TYPES.includes(cm.type)) {
      this.warn('coordination', `Unknown coordination type "${cm.type}" — expected one of: ${VALID_COORDINATION_TYPES.join(', ')}`);
    }

    if (cm.failure_semantics) {
      const fs = cm.failure_semantics;
      if (fs.termination_guarantee && !VALID_TERMINATION_GUARANTEES.includes(fs.termination_guarantee)) {
        this.warn('coordination', `Unknown termination_guarantee "${fs.termination_guarantee}"`);
      }
    }
  }

  // ─── Execution config ────────────────────────────────────

  checkExecution() {
    const exec = this.dag.execution;
    if (!exec) return;

    if (exec.checkpoint_strategy && !VALID_CHECKPOINT_STRATEGIES.includes(exec.checkpoint_strategy)) {
      this.warn('execution', `Unknown checkpoint_strategy "${exec.checkpoint_strategy}"`);
    }

    if (exec.mode && !VALID_EXECUTION_MODES.includes(exec.mode)) {
      this.warn('execution', `Unknown execution mode "${exec.mode}"`);
    }

    if (exec.max_parallel !== undefined) {
      if (typeof exec.max_parallel !== 'number' || exec.max_parallel < 1) {
        this.error('execution', `max_parallel must be a positive integer, got ${exec.max_parallel}`);
      }
    }
  }

  // ─── Completeness checks ─────────────────────────────────

  checkCompleteness() {
    const nodes = this.dag.nodes || [];
    const edges = this.dag.edges || [];

    // Orphan detection: nodes with no incoming or outgoing hard edges
    // (except root nodes which legitimately have no incoming)
    const hasIncoming = new Set();
    const hasOutgoing = new Set();
    for (const edge of edges) {
      if (edge.protocol !== 'soft') {
        hasIncoming.add(edge.to);
        hasOutgoing.add(edge.from);
      }
    }

    const roots = [...this.nodeIds].filter(id => !hasIncoming.has(id));
    const leaves = [...this.nodeIds].filter(id => !hasOutgoing.has(id));
    const orphans = [...this.nodeIds].filter(id => !hasIncoming.has(id) && !hasOutgoing.has(id));

    this.note('topology', `Roots (no hard incoming): ${roots.join(', ')}`);
    this.note('topology', `Leaves (no hard outgoing): ${leaves.join(', ')}`);

    if (orphans.length > 0) {
      // Tier 0 nodes are expected to be roots, not orphans necessarily
      const trueOrphans = orphans.filter(id => {
        const node = nodes.find(n => n.id === id);
        // Nodes with no deps AND no dependents are true orphans
        return !edges.some(e => e.from === id || e.to === id);
      });
      if (trueOrphans.length > 0) {
        this.warn('topology', `Completely disconnected nodes (no edges at all): ${trueOrphans.join(', ')}`);
      }
    }

    // Tier consistency: nodes in lower tiers should not depend on higher tiers via hard edges
    for (const edge of edges) {
      if (edge.protocol === 'soft') continue;
      const fromNode = nodes.find(n => n.id === edge.from);
      const toNode = nodes.find(n => n.id === edge.to);
      if (fromNode?.tier !== undefined && toNode?.tier !== undefined) {
        if (fromNode.tier > toNode.tier) {
          this.warn('tier-order', `Hard edge from tier ${fromNode.tier} (${edge.from}) to tier ${toNode.tier} (${edge.to}) — higher tier depends on lower tier, which inverts the expected flow`);
        }
      }
    }

    // Wave feasibility: nodes in the same tier with no inter-dependencies can run in parallel
    const tiers = new Map();
    for (const node of nodes) {
      if (node.tier !== undefined) {
        if (!tiers.has(node.tier)) tiers.set(node.tier, []);
        tiers.get(node.tier).push(node.id);
      }
    }

    for (const [tier, nodeIds] of tiers) {
      this.note('waves', `Tier ${tier}: ${nodeIds.length} node(s) — ${nodeIds.join(', ')}`);
    }
  }

  // ─── Statistics ───────────────────────────────────────────

  computeStats() {
    const nodes = this.dag.nodes || [];
    const edges = this.dag.edges || [];

    const totalLoe = nodes.reduce((sum, n) => sum + (n.loe || 0), 0);
    const hardEdges = edges.filter(e => e.protocol !== 'soft').length;
    const softEdges = edges.filter(e => e.protocol === 'soft').length;
    const concreteNodes = nodes.filter(n => n.type === 'concrete').length;
    const vagueNodes = nodes.filter(n => n.type === 'vague').length;
    const humanGates = nodes.filter(n => n.type === 'human-gate').length;
    const subDagNodes = nodes.filter(n => n.sub_dag).reduce((sum, n) => sum + n.sub_dag.length, 0);
    const criticalPathNodes = nodes.filter(n => n.critical_path).length;

    const tiers = new Set(nodes.map(n => n.tier).filter(t => t !== undefined));
    const versions = new Set(nodes.map(n => n.version).filter(v => v !== undefined));

    return {
      total_nodes: nodes.length,
      concrete_nodes: concreteNodes,
      vague_nodes: vagueNodes,
      human_gate_nodes: humanGates,
      sub_dag_nodes: subDagNodes,
      total_edges: edges.length,
      hard_edges: hardEdges,
      soft_edges: softEdges,
      total_loe: totalLoe,
      critical_path_nodes: criticalPathNodes,
      tiers: [...tiers].sort(),
      versions: [...versions].sort(),
    };
  }
}

// ─── CLI ──────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const flags = args.filter(a => a.startsWith('--'));
  const positional = args.filter(a => !a.startsWith('--'));

  if (positional.length === 0 || flags.includes('--help')) {
    console.log(`
Jury-rig V3 DAG Validator

Usage: node scripts/validate-dag.js <path-to-dag.yaml> [options]

Options:
  --json      Output results as JSON
  --strict    Treat warnings as errors
  --quiet     Only show errors
  --help      Show this help

Exit codes:
  0  All checks passed
  1  Errors found
  2  Usage error

Example:
  node scripts/validate-dag.js v4.dag.yaml
  node scripts/validate-dag.js v4.dag.yaml --json --strict
`.trim());
    process.exit(positional.length === 0 ? 2 : 0);
  }

  const filePath = positional[0];
  const jsonOutput = flags.includes('--json');
  const strict = flags.includes('--strict');
  const quiet = flags.includes('--quiet');

  let content;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch (err) {
    if (jsonOutput) {
      console.log(JSON.stringify({ valid: false, error: `Cannot read file: ${err.message}` }));
    } else {
      console.error(`Error: Cannot read file "${filePath}": ${err.message}`);
    }
    process.exit(2);
  }

  let dag;
  try {
    dag = parseYaml(content);
  } catch (err) {
    if (jsonOutput) {
      console.log(JSON.stringify({ valid: false, error: `YAML parse error: ${err.message}` }));
    } else {
      console.error(`Error: Invalid YAML in "${filePath}": ${err.message}`);
    }
    process.exit(1);
  }

  if (!dag || typeof dag !== 'object') {
    if (jsonOutput) {
      console.log(JSON.stringify({ valid: false, error: 'YAML parsed to non-object' }));
    } else {
      console.error('Error: YAML file does not contain a valid object');
    }
    process.exit(1);
  }

  const validator = new DagValidator(dag, { strict });
  const result = validator.validate();

  // In strict mode, warnings become errors
  if (strict) {
    for (const warning of result.warnings) {
      result.errors.push({ ...warning, promoted: true });
    }
    result.valid = result.errors.length === 0;
  }

  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printResult(result, quiet);
  }

  process.exit(result.valid ? 0 : 1);
}

function printResult(result, quiet) {
  const { errors, warnings, info, stats, valid } = result;

  // Header
  console.log('');
  console.log(`Jury-rig V3 DAG Validation Report`);
  console.log('═'.repeat(50));

  // Stats
  console.log('');
  console.log(`DAG: ${stats.total_nodes} nodes (${stats.concrete_nodes} concrete, ${stats.vague_nodes} vague) | ${stats.total_edges} edges (${stats.hard_edges} hard, ${stats.soft_edges} soft)`);
  console.log(`LOE: ${stats.total_loe} lines | Sub-DAG nodes: ${stats.sub_dag_nodes} | Critical path: ${stats.critical_path_nodes} nodes`);
  console.log(`Tiers: ${stats.tiers.join(', ')} | Versions: ${stats.versions.join(', ')}`);

  // Errors
  if (errors.length > 0) {
    console.log('');
    console.log(`ERRORS (${errors.length}):`);
    for (const err of errors) {
      const promoted = err.promoted ? ' (promoted from warning)' : '';
      console.log(`  ✗ [${err.check}] ${err.message}${promoted}`);
    }
  }

  // Warnings
  if (!quiet && warnings.length > 0) {
    console.log('');
    console.log(`WARNINGS (${warnings.length}):`);
    for (const warn of warnings) {
      console.log(`  ⚠ [${warn.check}] ${warn.message}`);
    }
  }

  // Info
  if (!quiet && info.length > 0) {
    console.log('');
    console.log(`INFO:`);
    for (const note of info) {
      console.log(`  ℹ [${note.check}] ${note.message}`);
    }
  }

  // Summary
  console.log('');
  if (valid) {
    console.log(`✓ DAG is valid (${errors.length} errors, ${warnings.length} warnings)`);
  } else {
    console.log(`✗ DAG is INVALID (${errors.length} errors, ${warnings.length} warnings)`);
  }
  console.log('');
}

main();
