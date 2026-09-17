#!/usr/bin/env node

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const validator = join(here, "validate-fidelity-ledger.mjs");
const example = JSON.parse(readFileSync(join(here, "../examples/source-bound-review.json"), "utf8"));
const clone = (value) => JSON.parse(JSON.stringify(value));
const cases = [
  ["valid source-bound", example, true],
  ["unknown top field", Object.assign(clone(example), { surprise: true }), false],
  ["unlabeled provenance", (() => { const x = clone(example); delete x.propositions[0].provenance; return x; })(), false],
  ["missing source locator", (() => { const x = clone(example); x.propositions[0].sourceLocator = ""; return x; })(), false],
  ["missing falsifier", (() => { const x = clone(example); x.propositions[0].falsifier = ""; return x; })(), false],
  ["false holder confirmation", (() => { const x = clone(example); x.verificationState = "HOLDER_CONFIRMED"; x.confirmationReceipt = { confirmer: "observer", confirmerIsSourceHolder: false, ledgerDigest: `sha256:${"a".repeat(64)}` }; return x; })(), false],
  ["source-bound claims endorsement", (() => { const x = clone(example); x.propositions[0].holderWouldEndorse = "YES"; return x; })(), false],
  ["asymmetric reciprocal review", (() => { const x = clone(example); x.reciprocity.applied = false; return x; })(), false],
  ["harmful persuasion not refused", (() => { const x = clone(example); x.requestedUse = "PERSUADE"; x.harmGate.classification = "REFUSE_OPTIMIZATION"; return x; })(), false],
  ["valid harmful refusal", (() => { const x = clone(example); x.requestedUse = "PERSUADE"; x.harmGate.classification = "REFUSE_OPTIMIZATION"; x.terminalStatus = "REFUSED"; return x; })(), true],
  ["supplemented without evidence", (() => { const x = clone(example); x.propositions[0].provenance = "supplemented"; x.propositions[0].evidence = []; return x; })(), false]
];

const directory = mkdtempSync(join(tmpdir(), "steel-man-tests-"));
const failures = [];
try {
  for (const [name, data, expected] of cases) {
    const file = join(directory, `${name.replaceAll(" ", "-")}.json`);
    writeFileSync(file, JSON.stringify(data));
    const result = spawnSync(process.execPath, [validator, file], { encoding: "utf8" });
    const actual = result.status === 0;
    if (actual !== expected) failures.push({ name, expected, actual, stdout: result.stdout, stderr: result.stderr });
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}

console.log(JSON.stringify({ valid: failures.length === 0, cases: cases.length, failures }, null, 2));
process.exitCode = failures.length === 0 ? 0 : 1;
