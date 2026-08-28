/**
 * Porthole cast gate — replays every committed `public/casts/porthole/*.cast`
 * through the SAME VT interpreter the browser player uses, then scans the
 * DECODED transcript (not the raw event bytes) for errors, empty payoffs,
 * leaked paths, or capture-doctrine violations.
 *
 * Motivation: `check-terminal-recordings.mjs` (the pre-existing gate) scans
 * raw cast file TEXT with regexes — and `AUDIT-2026-08-18.md` names exactly
 * why that is structurally blind: a typed command is char-split across many
 * separate `"o"` events (`["t",0.1],["o","p"],["o","d"],...`), so a pattern
 * like `/\/Users\/erichowens/` only matches if the leak happens to land
 * inside one event's payload — which the audit found it usually doesn't.
 * This gate instead runs every committed porthole cast through
 * `parseCast`/`VT.feed` — the exact interpreter a viewer's browser runs —
 * and scans the RECONSTRUCTED line text, so a leak split across fifty
 * keystroke events is caught the same way a human watching the replay
 * would see it: as one continuous line.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCast, VT, lineText } from "../src/lib/porthole/vt.ts";
import {
  findCollisionRefusalFailures,
  findJoinOnlyCastClaims,
  findPortholeCastCorpusFailures,
  findServiceDiscoveryFailures,
  findVisibilityTimelineFailures,
} from "./porthole-proof-contracts.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CASTS_DIR = join(__dirname, "..", "public", "casts", "porthole");

/** A flat theme is enough here — the gate cares about TEXT content, never
 *  about which color a cell landed in, so real token names are unneeded. */
const FLAT_THEME = Array.from({ length: 16 }, (_, i) => `c${i}`);

const LEAK_PATTERNS = [
  [/Unknown command/i, "an unrecognized command reached camera"],
  [/^✗/, "a failure glyph in the transcript"],
  [/\bERROR\b/, "an ERROR line in the transcript"],
  [/\b(?:DeprecationWarning|ExperimentalWarning)\b/, "an unexpected runtime warning"],
  [/Traceback \(most recent/, "a Python traceback"],
  [/command not found/i, "a shell 'command not found'"],
  [/\/Users\/[a-zA-Z0-9_-]+/, "a leaked macOS home path"],
  [/\/home\/[a-zA-Z0-9_-]+\/(?!coding\/port-daddy\b)/, "a leaked non-sandbox home path"],
  [/\b[A-Za-z0-9][A-Za-z0-9-]*(?:\.[A-Za-z0-9-]+)*\.(?:local|lan)\b/i, "a leaked local host name"],
  [/~\/coding\/tmp\/pd-porthole-proof-[^/\s]+/, "a random capture fixture path"],
  [/UnhandledPromiseRejection|Cannot read propert(?:y|ies) of (?:undefined|null)/, "an unhandled runtime error"],
];

const failures = [];
const fail = (msg) => failures.push(msg);
const decodedByFile = new Map();
const observedByFile = new Map();

if (!existsSync(CASTS_DIR)) {
  console.log("[check-porthole-casts] no porthole casts directory yet — nothing to gate.");
  process.exit(0);
}

const files = readdirSync(CASTS_DIR).filter((f) => f.endsWith(".cast"));
if (files.length === 0) {
  console.log("[check-porthole-casts] porthole casts directory exists but is empty — nothing to gate.");
  process.exit(0);
}

for (const failure of findPortholeCastCorpusFailures(files)) fail(failure);

for (const file of files) {
  const path = join(CASTS_DIR, file);
  const text = readFileSync(path, "utf8");
  let cast;
  try {
    cast = parseCast(text);
  } catch (err) {
    fail(`${file}: failed to parse as asciicast — ${err.message}`);
    continue;
  }

  if (cast.events.length === 0) {
    fail(`${file}: zero events — an empty payoff shipped as a "recording"`);
    continue;
  }
  const command = typeof cast.head.command === "string" ? cast.head.command : "";
  const expectedGeometry = command.includes("drive-tmux") ? [120, 34] : [100, 28];
  if (cast.cols !== expectedGeometry[0] || cast.rows !== expectedGeometry[1]) {
    fail(`${file}: recorded at ${cast.cols}x${cast.rows}, capture doctrine requires ${expectedGeometry[0]}x${expectedGeometry[1]} for this scene type (a mismatched geometry is how the legacy corpus got corrupted typed lines)`);
  }
  if (cast.duration <= 0) {
    fail(`${file}: non-positive duration (${cast.duration})`);
  }

  const vt = new VT(cast.cols, cast.rows, FLAT_THEME);
  const observedLines = new Set();
  const reportedLines = new Set();
  for (const [, data] of cast.events) {
    vt.feed(data);
    for (const row of vt.dirty) {
      const line = lineText(vt.lines[row] ?? []);
      if (!line.trim()) continue;
      observedLines.add(line);
      for (const [pattern, description] of LEAK_PATTERNS) {
        if (!pattern.test(line)) continue;
        const key = `${description}:${line}`;
        if (reportedLines.has(key)) continue;
        reportedLines.add(key);
        fail(`${file}: ${description} (matched ${pattern})`);
      }
    }
    vt.dirty.clear();
  }
  const transcript = vt.lines.map(lineText).join("\n");
  decodedByFile.set(file, transcript);
  observedByFile.set(file, [...observedLines].join("\n"));

  if (!transcript.trim()) {
    fail(`${file}: decoded transcript is blank — the payoff produced no visible output`);
  }
  if (/❯\s*#/m.test(transcript)) {
    fail(`${file}: typed narration comment reached the recording`);
  }

  if (file === 'ports.cast') {
    const portsEvidence = observedByFile.get(file) ?? transcript;
    for (const failure of findServiceDiscoveryFailures(portsEvidence, file)) fail(failure);
  }

  if (file === 'collision.cast') {
    const redRefusal = cast.events.some(([, data]) => /\x1b\[[\d;]*41;?\d*m/.test(data));
    for (const failure of findCollisionRefusalFailures(transcript, redRefusal)) fail(failure);
  }

  if (file === 'harness-next-turn.cast' && !/(HARNESSED CONTEXT|PORT DADDY HARNESS)/.test(transcript)) {
    fail(`${file}: hook injection is missing its explicit harness boundary`);
  }

  if (file === 'visibility.cast') {
    for (const failure of findVisibilityTimelineFailures(cast, file)) fail(failure);
  }

  if (file === 'parley.cast') {
    const rawPerformatives = [
      /pd parley (?:call|propose|critique|revise|agree|refuse|respond)\b/i,
      /\bperformative\b/i,
      /\b(?:propose|critique|revise|agree|refuse)\s*:/i,
    ];
    if (!/DECISION RECEIPT/.test(transcript)) {
      fail(`${file}: primary decision scene is missing its receipt projection`);
    }
    for (const pattern of rawPerformatives) {
      if (pattern.test(transcript)) fail(`${file}: raw Parley protocol performative reached the primary recording (matched ${pattern})`);
    }
  }
}

if (decodedByFile.has('parley.cast') && !decodedByFile.has('parley-source.cast')) {
  fail('parley.cast: primary receipt is present without the preserved raw two-agent protocol transcript');
}

for (const failure of findJoinOnlyCastClaims(observedByFile)) fail(failure);

if (failures.length) {
  console.error(`[check-porthole-casts] ${failures.length} finding(s) in ${files.length} porthole cast(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(`[check-porthole-casts] ${files.length} porthole cast(s) replayed clean — no errors, no empty payoffs, no leaked paths.`);
