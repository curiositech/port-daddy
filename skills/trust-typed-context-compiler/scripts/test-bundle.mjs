#!/usr/bin/env node
import fs from "node:fs";
import { validateContextIR } from "./validate-context-ir.mjs";

const base = JSON.parse(fs.readFileSync(new URL("../examples/valid-continuation-capsule.json", import.meta.url), "utf8"));
const clone = () => structuredClone(base);
const cases = [
  ["valid", () => clone(), null],
  ["unknown", () => { const x = clone(); x.resume = true; return x; }, "E_UNKNOWN_FIELD"],
  ["fact as directive", () => { const x = clone(); x.items[0].instructionUse = "DIRECTIVE_ELIGIBLE"; return x; }, "E_UNTRUSTED_DIRECTIVE"],
  ["stale directive", () => { const x = clone(); x.items[1].freshness = "STALE"; return x; }, "E_DIRECTIVE_AUTHORITY"],
  ["revocation unchecked", () => { const x = clone(); x.items[1].revocationChecked = false; return x; }, "E_DIRECTIVE_AUTHORITY"],
  ["wrong audience", () => { const x = clone(); x.items[1].audience = "other"; return x; }, "E_DIRECTIVE_AUDIENCE"],
  ["missing provenance", () => { const x = clone(); x.items[0].provenanceRefs = []; return x; }, "E_PROVENANCE_MISSING"],
  ["raw secret", () => { const x = clone(); x.items[2].redaction = "NONE"; x.items[2].contentRef = "secret:raw"; return x; }, "E_RAW_SECRET"],
  ["space mix", () => { const x = clone(); x.retrievalJoins[0].candidateSpaceId = "space:other"; return x; }, "E_VECTOR_SPACE_MIX"],
  ["false rejection", () => { const x = clone(); x.retrievalJoins[0].status = "REJECTED_SPACE_MISMATCH"; return x; }, "E_FALSE_SPACE_REJECTION"],
  ["unknown retrieval status", () => { const x = clone(); x.retrievalJoins[0].status = "PROBABLY_MATCHED"; return x; }, "E_RETRIEVAL_STATUS"],
  ["unsupported obligation", () => { const x = clone(); x.obligations[0].sourceRefs = ["missing"]; return x; }, "E_OBLIGATION_UNSUPPORTED"],
  ["unbound obligation", () => { const x = clone(); x.items[1].obligationIds = []; return x; }, "E_OBLIGATION_NOT_BOUND"],
  ["silent omission", () => { const x = clone(); x.omissions = []; return x; }, "E_OMISSION_NOT_RECEIPTED"],
  ["omission without reason", () => { const x = clone(); x.obligations[1].reason = null; return x; }, "E_OMISSION_REASON"],
  ["unknown obligation status", () => { const x = clone(); x.obligations[0].status = "MAYBE"; return x; }, "E_OBLIGATION_STATUS"],
  ["unknown translation status", () => { const x = clone(); x.translations[0].status = "BEST_EFFORT"; return x; }, "E_TRANSLATION_STATUS"],
  ["admission authority", () => { const x = clone(); x.admissionAuthority = "ADMIT"; return x; }, "E_ADMISSION_AUTHORITY"],
  ["capability authority", () => { const x = clone(); x.capabilityAuthority = "GRANT"; return x; }, "E_CAPABILITY_AUTHORITY"],
  ["truth mint", () => { const x = clone(); x.truthEffect = "VERIFIED"; return x; }, "E_TRUTH_AUTHORITY"]
];

const failures = [];
for (const [name, make, expected] of cases) {
  const codes = validateContextIR(make()).map((error) => error.code);
  if (expected === null ? codes.length !== 0 : !codes.includes(expected)) failures.push({ name, expected, codes });
}
console.log(JSON.stringify({ valid: failures.length === 0, cases: cases.length, failures }, null, 2));
if (failures.length) process.exitCode = 1;
