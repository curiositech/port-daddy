#!/usr/bin/env node

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(process.argv[2] ?? resolve(here, "convention.json"));
const root = dirname(manifestPath);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const failures = [];

const expect = (condition, message) => {
  if (!condition) failures.push(message);
};

expect(manifest.schemaVersion === "1.2.0", "schemaVersion must be 1.2.0");
expect(/^[0-9a-f]{40}$/.test(manifest.anchor ?? ""), "anchor must be an exact 40-character SHA");
expect(manifest.truthState === "T0_STATIC", "truthState must remain T0_STATIC");
expect(manifest.runtimeAuthority === "NONE", "runtimeAuthority must remain NONE");
expect(Array.isArray(manifest.positions) && manifest.positions.length === 10, "exactly ten positions are required");
expect(Array.isArray(manifest.pairings) && manifest.pairings.length === 5, "exactly five reciprocal pairings are required");
expect(Array.isArray(manifest.realityChecks) && manifest.realityChecks.length === 3, "exactly three reality checks are required");
expect(manifest.limits?.reciprocalReviewCount === 10, "exactly ten reciprocal reviews are allowed");
expect(manifest.limits?.correctionsPerPosition === 1, "exactly one correction per position is allowed");
expect(manifest.limits?.recursiveBirths === 0, "recursive births must remain zero");

const ids = manifest.positions?.map((position) => position.id) ?? [];
expect(new Set(ids).size === 10, "position IDs must be unique");
expect(ids.join(",") === "P1,P2,P3,P4,P5,P6,P7,P8,P9,P10", "position IDs must be P1 through P10 in order");

const paired = [];
for (const pairing of manifest.pairings ?? []) {
  expect(ids.includes(pairing.a), `unknown pairing endpoint ${pairing.a}`);
  expect(ids.includes(pairing.b), `unknown pairing endpoint ${pairing.b}`);
  expect(pairing.a !== pairing.b, `self-pairing is forbidden for ${pairing.a}`);
  paired.push(pairing.a, pairing.b);
}
expect(new Set(paired).size === 10 && paired.length === 10, "each position must appear in exactly one pair");

for (const position of manifest.positions ?? []) {
  const path = resolve(root, position.file);
  if (!position.sealed) continue;
  expect(existsSync(path), `${position.id} is sealed but its file is missing: ${position.file}`);
  if (!existsSync(path)) continue;
  const text = readFileSync(path, "utf8");
  for (const heading of ["Thesis", "Non-negotiables", "Falsification tests", "Impossible combinations", "Skill"]) {
    expect(text.toLowerCase().includes(heading.toLowerCase()), `${position.id} is missing required section text: ${heading}`);
  }
  expect(/SEALED/i.test(text), `${position.id} must carry a sealed marker`);
}

const expectedRoles = ["ENGINEERING", "PRODUCT", "DESIGN"];
expect(
  (manifest.realityChecks ?? []).map((check) => check.role).join(",") === expectedRoles.join(","),
  "reality-check roles must be ENGINEERING, PRODUCT, DESIGN in order"
);
for (const check of manifest.realityChecks ?? []) {
  if (!check.sealed) continue;
  const path = resolve(root, check.file);
  expect(existsSync(path), `${check.role} is sealed but its file is missing: ${check.file}`);
  if (!existsSync(path)) continue;
  const text = readFileSync(path, "utf8");
  expect(/\*\*Decision:\*\*/.test(text), `${check.role} lacks an explicit decision`);
  expect(/^## Reciprocal-review correction$/m.test(text), `${check.role} lacks its reciprocal-review correction`);
}

for (const [name, file] of Object.entries(manifest.outputs ?? {})) {
  expect(existsSync(resolve(root, file)), `declared output ${name} is missing: ${file}`);
}

for (const pairing of manifest.pairings ?? []) {
  for (const [reviewer, subject] of [[pairing.a, pairing.b], [pairing.b, pairing.a]]) {
    const file = resolve(root, `reviews/${reviewer}-reviews-${subject}.md`);
    expect(existsSync(file), `missing reciprocal review: ${reviewer}-reviews-${subject}.md`);
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    expect(/steel-?man/i.test(text), `${reviewer}-reviews-${subject}.md lacks a steel-man gate`);
    expect(/falsifi/i.test(text), `${reviewer}-reviews-${subject}.md lacks a falsifier`);
  }
}

for (const id of ids) {
  const file = resolve(root, `corrections/C-${id}.md`);
  expect(existsSync(file), `missing bounded correction for ${id}`);
  if (!existsSync(file)) continue;
  const text = readFileSync(file, "utf8");
  expect(/Disposition/.test(text), `correction C-${id} lacks a disposition`);
  expect(/Retained dissent/.test(text), `correction C-${id} drops dissent`);
}

if (failures.length > 0) {
  console.error(JSON.stringify({ valid: false, manifestPath, failures }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  valid: true,
  manifestPath,
  anchor: manifest.anchor,
  truthState: manifest.truthState,
  runtimeAuthority: manifest.runtimeAuthority,
  positions: manifest.positions.length,
  sealedPositions: manifest.positions.filter((position) => position.sealed).length,
  pairings: manifest.pairings.length,
  sealedRealityChecks: manifest.realityChecks.filter((check) => check.sealed).length,
  outputs: Object.keys(manifest.outputs ?? {}).length,
  limits: manifest.limits
}, null, 2));
