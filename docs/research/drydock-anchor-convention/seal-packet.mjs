#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(root, "../../..");
const profile = process.argv[2] ?? "v1";

const positionNames = {
  P1: "containment-and-tcb",
  P2: "anchor-evidence-and-verification",
  P3: "identity-resurrection-and-effects",
  P4: "hypertree-execution-and-coordination",
  P5: "capability-and-consequential-effects",
  P6: "capacity-economics-and-conservation",
  P7: "context-integrity-memory-and-cognition",
  P8: "deterministic-evaluation-and-formal-limits",
  P9: "governance-labor-and-mechanism-design",
  P10: "human-factors-and-operator-sovereignty",
};

const v1Files = [
  "README.md",
  "research-basis.md",
  "skill-audit-baseline.md",
  "skill-graft-matrix.md",
  "reality-checks/source-truth.md",
  "synthesis/manager-extraction-r1.md",
  ...Object.entries(positionNames).map(([id, name]) => `positions/${id}-${name}.md`),
  ...[
    "P1-reviews-P9.md",
    "P10-reviews-P5.md",
    "P2-reviews-P8.md",
    "P3-reviews-P7.md",
    "P4-reviews-P6.md",
    "P5-reviews-P10.md",
    "P6-reviews-P4.md",
    "P7-reviews-P3.md",
    "P8-reviews-P2.md",
    "P9-reviews-P1.md",
  ].map((name) => `reviews/${name}`),
  ...["C-P1", "C-P2", "C-P3", "C-P4", "C-P5", "C-P6", "C-P7", "C-P8", "C-P9", "C-P10"].map((name) => `corrections/${name}.md`),
  ...[
    "agent-context-partitioner.md",
    "agent-conversation-protocols.md",
    "manager-driven-team-orchestrator.md",
    "productive-discourse-facilitator.md",
    "provable-action-adjudicator.md",
    "steel-man-argument.md",
    "swarm-invocation-designer.md",
  ].map((name) => `skill-audits/${name}`),
];

const v2SkillRoots = [
  "skills/agent-context-partitioner",
  "skills/agent-conversation-protocols",
  "skills/conserved-capacity-admission-and-settlement",
  "skills/cryptoeconomic-protocol-security",
  "skills/drydock-program-architecture",
  "skills/manager-driven-team-orchestrator",
  "skills/productive-discourse-facilitator",
  "skills/provable-action-adjudicator",
  "skills/steel-man-argument",
  "skills/swarm-invocation-designer",
  "skills/trial-basin-deterministic-systems-evaluation",
  "skills/trust-typed-context-compiler",
];

function filesBelow(directory) {
  const result = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) result.push(...filesBelow(path));
    else result.push(path);
  }
  return result;
}

function packetPaths() {
  if (profile === "v1") return v1Files.map((path) => join(root, path));
  if (profile !== "v2") throw new Error(`unknown seal profile: ${profile}`);

  const packet = filesBelow(root).filter((path) => ![
    "seal-packet.mjs",
    "sealed-packet-v1.json",
    "sealed-packet-v2.json",
  ].includes(relative(root, path)));
  const skills = v2SkillRoots.flatMap((path) => filesBelow(join(repositoryRoot, path)));
  return [...packet, ...skills];
}

const files = [...new Set(packetPaths())]
  .map((path) => ({
    path: relative(repositoryRoot, path),
    sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
  }))
  .sort((left, right) => left.path.localeCompare(right.path));

const canonical = files.map(({ path, sha256 }) => `${path}\0${sha256}\n`).join("");
const packetSha256 = createHash("sha256").update(canonical).digest("hex");

console.log(JSON.stringify({
  schemaVersion: 2,
  profile,
  algorithm: "sha256(path NUL sha256 LF, lexicographic path order)",
  fileCount: files.length,
  packetSha256,
  files,
}, null, 2));
