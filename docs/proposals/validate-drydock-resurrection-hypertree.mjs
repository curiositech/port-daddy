#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) {
  console.error("usage: node docs/proposals/validate-drydock-resurrection-hypertree.mjs <hypertree.json>");
  process.exit(2);
}

let tree;
try {
  tree = JSON.parse(readFileSync(path, "utf8"));
} catch (error) {
  console.error(JSON.stringify({ valid: false, errors: [`invalid JSON: ${error.message}`] }, null, 2));
  process.exit(1);
}

const errors = [];
function requireValue(condition, message) {
  if (!condition) errors.push(message);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function planDigest(document) {
  const scope = document?.artifactIdentity?.digestScope ?? [];
  const payload = Object.fromEntries(scope.map((key) => [key, document[key]]));
  return `sha256:${createHash("sha256").update(JSON.stringify(canonicalize(payload))).digest("hex")}`;
}

requireValue(tree?.schemaVersion === 1, "schemaVersion must be 1");
requireValue(tree?.kind === "DrydockHypertree", "kind must be DrydockHypertree");
requireValue(tree?.sourceSnapshot?.localRuntimeUsed === false, "static plan must prove localRuntimeUsed=false");
requireValue(tree?.sourceSnapshot?.roadmapMutated === false, "static plan must prove roadmapMutated=false");
requireValue(tree?.artifactIdentity?.publicationCommit === null && tree?.artifactIdentity?.publicationTree === null, "self-publication commit/tree must remain external");
const requiredDigestScope = ["root", "roleDefinitions", "nodes", "hyperedges", "assignmentPolicy", "criticalPath"];
requireValue(
  JSON.stringify(tree?.artifactIdentity?.digestScope) === JSON.stringify(requiredDigestScope),
  `digestScope must be exactly ${requiredDigestScope.join(", ")}`
);

const roles = Array.isArray(tree?.roleDefinitions) ? tree.roleDefinitions : [];
const roleIds = new Set();
for (const role of roles) {
  requireValue(!roleIds.has(role.id), `duplicate role ${role.id}`);
  roleIds.add(role.id);
}

const nodes = Array.isArray(tree?.nodes) ? tree.nodes : [];
const nodeById = new Map();
for (const node of nodes) {
  requireValue(!nodeById.has(node.id), `duplicate node ${node.id}`);
  nodeById.set(node.id, node);
  requireValue(roleIds.has(node.ownerRole), `node ${node.id} references unknown owner role ${node.ownerRole}`);
}

for (const node of nodes) {
  for (const dependency of node.dependencies ?? []) {
    requireValue(nodeById.has(dependency), `node ${node.id} references unknown dependency ${dependency}`);
    requireValue(dependency !== node.id, `node ${node.id} depends on itself`);
  }
}

const visiting = new Set();
const visited = new Set();
function visit(id, trail = []) {
  if (visiting.has(id)) {
    errors.push(`dependency cycle: ${[...trail, id].join(" -> ")}`);
    return;
  }
  if (visited.has(id) || !nodeById.has(id)) return;
  visiting.add(id);
  for (const dependency of nodeById.get(id).dependencies ?? []) visit(dependency, [...trail, id]);
  visiting.delete(id);
  visited.add(id);
}
for (const id of nodeById.keys()) visit(id);

const order = Array.isArray(tree?.criticalPath) ? tree.criticalPath : [];
const positions = new Map(order.map((id, index) => [id, index]));
requireValue(order.length === nodeById.size, "criticalPath must contain every node exactly once");
requireValue(new Set(order).size === order.length, "criticalPath contains duplicate nodes");
for (const id of nodeById.keys()) requireValue(positions.has(id), `criticalPath omits ${id}`);
for (const id of order) requireValue(nodeById.has(id), `criticalPath references unknown node ${id}`);
for (const node of nodes) {
  for (const dependency of node.dependencies ?? []) {
    requireValue((positions.get(dependency) ?? Infinity) < (positions.get(node.id) ?? -1), `criticalPath puts ${node.id} before dependency ${dependency}`);
  }
}

const hyperedgeIds = new Set();
for (const edge of tree?.hyperedges ?? []) {
  requireValue(!hyperedgeIds.has(edge.id), `duplicate hyperedge ${edge.id}`);
  hyperedgeIds.add(edge.id);
  for (const id of [...(edge.from ?? []), ...(edge.to ?? [])]) {
    requireValue(nodeById.has(id), `hyperedge ${edge.id} references unknown node ${id}`);
  }
}

function dependsTransitivelyOn(nodeId, requiredId, seen = new Set()) {
  if (nodeId === requiredId) return true;
  if (seen.has(nodeId) || !nodeById.has(nodeId)) return false;
  seen.add(nodeId);
  return (nodeById.get(nodeId).dependencies ?? []).some((dependency) => dependsTransitivelyOn(dependency, requiredId, seen));
}
const launcherIds = new Set();
for (const launcher of tree?.launcherNodes ?? []) {
  requireValue(!launcherIds.has(launcher), `duplicate launcher ${launcher}`);
  launcherIds.add(launcher);
  requireValue(nodeById.has(launcher), `launcherNodes references unknown node ${launcher}`);
  requireValue(dependsTransitivelyOn(launcher, "DD-052"), `launcher ${launcher} is not gated by DD-052 spawn breakers`);
}

const expectedDigest = planDigest(tree);
requireValue(tree?.artifactIdentity?.planDigest === expectedDigest, `planDigest mismatch; expected ${expectedDigest}`);

console.log(JSON.stringify({
  valid: errors.length === 0,
  errors,
  counts: { roles: roles.length, nodes: nodes.length, hyperedges: tree?.hyperedges?.length ?? 0, launchers: tree?.launcherNodes?.length ?? 0 },
  planDigest: expectedDigest
}, null, 2));
process.exit(errors.length === 0 ? 0 : 1);
