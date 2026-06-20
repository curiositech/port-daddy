#!/usr/bin/env node
// Install-command guard.
//
// The canonical, verified ways to install Port Daddy are:
//   brew install curiositech/tap/port-daddy
//   npm install -g port-daddy
//   npx port-daddy            (run without installing)
//
// This check greps the rendered site source for `brew install` /
// `npm install -g` / `npx` invocations that reference port-daddy and fails if
// any of them deviates from the canonical set. It catches drift like
// `brew install port-daddy` (missing the tap) or `npm install port-daddy`
// (missing -g) before it ships.
//
// stdlib only, no deps.

import fs from "node:fs";
import path from "node:path";

const ROOTS = ["src", "content"];
const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".md",
  ".mdx",
  ".json",
  ".css",
  ".html",
]);

// Canonical install invocations. A line that references port-daddy via one of
// the install verbs must match one of these exactly (the install token only;
// trailing chained commands like `&& pd setup` are allowed).
const CANONICAL = {
  brew: "brew install curiositech/tap/port-daddy",
  npmGlobal: "npm install -g port-daddy",
  // Local dependency install for the SDK (`import ... from 'port-daddy/client'`).
  // This is a distinct, correct usage from the global CLI install — it adds the
  // package to a project, so `-g` would be wrong advice here.
  npmLocal: "npm install port-daddy",
  npx: "npx port-daddy",
};

// Any occurrence of these verbs followed (eventually) by a port-daddy reference
// is a candidate we must validate. The trailing `[\w/@.-]*` captures the FULL
// package token (so `port-daddy-cli` or `port-daddy/client` is seen whole, not
// truncated to a passing `port-daddy` prefix).
const CANDIDATE_RE =
  /(brew\s+install|npm\s+install|npx)\b[^\n`'"]*port-daddy[\w/@.-]*/gi;

function collectFiles(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // root may not exist (e.g. no content/ dir) — that's fine
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      collectFiles(full, out);
    } else if (TEXT_EXTENSIONS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
}

/**
 * Returns null if the candidate matches a canonical form, otherwise a reason.
 * `match` is the raw matched substring (e.g. "brew install port-daddy").
 */
function classify(match) {
  // Normalize whitespace inside the verb so `brew  install` == `brew install`.
  const normalized = match.replace(/\s+/g, " ").trim();

  // The package token must terminate at a word boundary, so `port-daddy-cli`
  // or `port-daddy/client` past the canonical token is NOT silently accepted as
  // a prefix. (Trailing whitespace, `&&`, end-of-string all count as boundaries;
  // a `/` subpath import like `port-daddy/client` is its own allowed form below.)
  const startsCanonical = (form) =>
    normalized === form || /^[\s&|;]/.test(normalized.slice(form.length));

  if (/^brew install/i.test(normalized)) {
    // The brew install argument (package spec) must be the canonical tap path.
    // Accept the canonical token possibly followed by a chained command.
    if (startsCanonical(CANONICAL.brew)) return null;
    return `brew install must use the tap form: "${CANONICAL.brew}"`;
  }

  if (/^npm install/i.test(normalized)) {
    // Global CLI install, or local SDK dependency install — both reference the
    // bare canonical package name. Anything else (a tap path, a scoped name,
    // a typo) is drift.
    if (startsCanonical(CANONICAL.npmGlobal) || startsCanonical(CANONICAL.npmLocal))
      return null;
    return `npm install must use the bare package name: "${CANONICAL.npmGlobal}" (CLI) or "${CANONICAL.npmLocal}" (SDK dependency)`;
  }

  if (/^npx/i.test(normalized)) {
    // `npx port-daddy`, optionally with a subcommand (`npx port-daddy mcp`).
    if (startsCanonical(CANONICAL.npx)) return null;
    return `npx must invoke the bare package: "${CANONICAL.npx} ..."`;
  }

  return `unrecognized install invocation: "${normalized}"`;
}

const files = [];
for (const root of ROOTS) collectFiles(root, files);

const violations = [];
let candidateCount = 0;

for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  const lines = source.split("\n");
  lines.forEach((line, i) => {
    let m;
    CANDIDATE_RE.lastIndex = 0;
    while ((m = CANDIDATE_RE.exec(line)) !== null) {
      candidateCount += 1;
      const reason = classify(m[0]);
      if (reason) {
        violations.push({
          file,
          line: i + 1,
          text: m[0].trim(),
          reason,
        });
      }
    }
  });
}

if (violations.length > 0) {
  console.error("\n✗ Install-command check FAILED\n");
  console.error("Canonical install commands:");
  console.error(`  - ${CANONICAL.brew}`);
  console.error(`  - ${CANONICAL.npmGlobal}`);
  console.error(`  - ${CANONICAL.npx} (run without installing)\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`    found:  ${v.text}`);
    console.error(`    reason: ${v.reason}\n`);
  }
  console.error(
    `${violations.length} deviation(s) across ${candidateCount} install reference(s).`,
  );
  process.exit(1);
}

console.log(
  `✓ Install commands healthy: ${candidateCount} port-daddy install reference(s) all canonical.`,
);
