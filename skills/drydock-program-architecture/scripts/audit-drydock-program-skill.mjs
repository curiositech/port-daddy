#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(skillRoot, "../..");
const errors = [];

function requireValue(condition, message) {
  if (!condition) errors.push(message);
}

function filesBelow(root) {
  const result = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) result.push(...filesBelow(path));
    else result.push(path);
  }
  return result;
}

const required = [
  "SKILL.md",
  "README.md",
  "CHANGELOG.md",
  "agents/openai.yaml",
  "references/INDEX.md",
  "references/knowledge-map.md",
  "references/architecture-decisions.md",
  "references/diagram-atlas.md",
  "references/delivery-and-proof.md",
  "references/hypertree-execution-observatory.md",
  "references/controlled-agent-simulation.md",
  "references/agent-lifecycle-and-operator-control.md",
  "references/resurrection-capacity-and-context-control.md",
  "examples/INDEX.md",
  "examples/drydock-resurrection-hypertree.json",
  "examples/hypertree-execution.review-loop.json",
  "schemas/drydock-resurrection-hypertree.schema.json",
  "schemas/hypertree-execution.schema.json",
  "scripts/INDEX.md",
  "scripts/audit-drydock-program-skill.mjs",
  "scripts/validate-drydock-resurrection-hypertree.mjs",
  "scripts/validate-hypertree-execution.mjs",
  "templates/architecture-packet.md",
  "tests/activation.md",
];
for (const path of required) requireValue(existsSync(join(skillRoot, path)), `missing ${path}`);

const markdown = filesBelow(skillRoot).filter((path) => path.endsWith(".md"));
const linkPattern = /\[[^\]]*\]\(([^)]+)\)/g;
let localLinks = 0;
for (const source of markdown) {
  const text = readFileSync(source, "utf8");
  for (const match of text.matchAll(linkPattern)) {
    const target = match[1].split("#")[0];
    if (!target || target.startsWith("#") || /^[a-z]+:/i.test(target)) continue;
    localLinks += 1;
    requireValue(
      existsSync(resolve(dirname(source), target)),
      `broken link ${relative(skillRoot, source)} -> ${match[1]}`,
    );
  }
}

const skillText = readFileSync(join(skillRoot, "SKILL.md"), "utf8");
for (const focused of [
  "sandboxed-adversarial-test-harness",
  "agent-resurrection-and-body-continuity",
  "context-economics-for-agent-swarms",
]) {
  requireValue(skillText.includes(focused), `SKILL.md does not route to ${focused}`);
}
requireValue(skillText.split("\n").length < 500, "SKILL.md must remain below 500 lines");
requireValue(/NOT for/i.test(skillText.slice(0, skillText.indexOf("---", 4))), "description lacks a NOT-for boundary");

const atlas = readFileSync(join(skillRoot, "references/diagram-atlas.md"), "utf8");
const diagrams = [...atlas.matchAll(/^```mermaid\s*$/gm)].length;
requireValue(diagrams === 17, `diagram atlas must contain exactly 17 decision views; found ${diagrams}`);
for (let index = 1; index <= 17; index += 1) {
  requireValue(new RegExp(`^## ${index}\\. `, "m").test(atlas), `diagram atlas omits numbered view ${index}`);
}
requireValue((atlas.match(/\*\*Proves visually:\*\*/g) ?? []).length === 17, "every diagram needs a proof statement");
requireValue((atlas.match(/\*\*Does not prove:\*\*/g) ?? []).length === 17, "every diagram needs a non-proof statement");

const observatory = readFileSync(join(skillRoot, "references/hypertree-execution-observatory.md"), "utf8");
requireValue((observatory.match(/^```mermaid\s*$/gm) ?? []).length >= 3, "hypertree observatory needs at least three decision diagrams");
for (const term of [
  "lowest-capable-reviewed-tier",
  "Producer/reviewer/manager",
  "bounded-workflow",
  "append-only-event-projection",
  "HTML",
  "Swift",
  "Rust",
]) {
  requireValue(observatory.includes(term), `hypertree observatory omits ${term}`);
}

const activation = readFileSync(join(skillRoot, "tests/activation.md"), "utf8");
const positive = activation.match(/## Positive:[\s\S]*?(?=\n## Negative:)/)?.[0] ?? "";
const negative = activation.match(/## Negative:[\s\S]*/)?.[0] ?? "";
requireValue((positive.match(/^\d+\./gm) ?? []).length === 5, "activation suite needs five positive cases");
requireValue((negative.match(/^\d+\./gm) ?? []).length === 5, "activation suite needs five negative cases");

for (const legacy of [
  "docs/proposals/drydock-agent-lifecycle-and-operator-control.md",
  "docs/proposals/drydock-controlled-agent-simulation.md",
  "docs/proposals/drydock-resurrection-capacity-and-context-control.md",
  "docs/proposals/drydock-resurrection-hypertree.json",
  "docs/proposals/drydock-resurrection-hypertree.schema.json",
  "docs/proposals/validate-drydock-resurrection-hypertree.mjs",
]) {
  requireValue(!existsSync(join(repoRoot, legacy)), `legacy loose artifact remains at ${legacy}`);
}

const semantic = spawnSync(process.execPath, [
  join(skillRoot, "scripts/validate-drydock-resurrection-hypertree.mjs"),
  join(skillRoot, "examples/drydock-resurrection-hypertree.json"),
], { encoding: "utf8" });
requireValue(semantic.status === 0, `hypertree semantic validator failed: ${semantic.stderr || semantic.stdout}`);

const executionSemantic = spawnSync(process.execPath, [
  join(skillRoot, "scripts/validate-hypertree-execution.mjs"),
  join(skillRoot, "examples/hypertree-execution.review-loop.json"),
], { encoding: "utf8" });
requireValue(executionSemantic.status === 0, `hypertree execution semantic validator failed: ${executionSemantic.stderr || executionSemantic.stdout}`);

const result = {
  valid: errors.length === 0,
  errors,
  counts: {
    requiredFiles: required.length,
    markdownFiles: markdown.length,
    localLinks,
    diagrams,
  },
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.valid ? 0 : 1);
