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

const __dirname = dirname(fileURLToPath(import.meta.url));
const CASTS_DIR = join(__dirname, "..", "public", "casts", "porthole");

/** A flat theme is enough here — the gate cares about TEXT content, never
 *  about which color a cell landed in, so real token names are unneeded. */
const FLAT_THEME = Array.from({ length: 16 }, (_, i) => `c${i}`);

const LEAK_PATTERNS = [
  [/Unknown command/i, "an unrecognized command reached camera"],
  [/^✗/m, "a failure glyph in the transcript"],
  [/\bERROR\b/, "an ERROR line in the transcript"],
  [/Traceback \(most recent/, "a Python traceback"],
  [/command not found/i, "a shell 'command not found'"],
  [/\/Users\/[a-zA-Z0-9_-]+/, "a leaked macOS home path"],
  [/\/home\/[a-zA-Z0-9_-]+\/(?!coding\/port-daddy\b)/, "a leaked non-sandbox home path"],
  [/UnhandledPromiseRejection|Cannot read propert(?:y|ies) of (?:undefined|null)/, "an unhandled runtime error"],
];

const failures = [];
const fail = (msg) => failures.push(msg);

if (!existsSync(CASTS_DIR)) {
  console.log("[check-porthole-casts] no porthole casts directory yet — nothing to gate.");
  process.exit(0);
}

const files = readdirSync(CASTS_DIR).filter((f) => f.endsWith(".cast"));
if (files.length === 0) {
  console.log("[check-porthole-casts] porthole casts directory exists but is empty — nothing to gate.");
  process.exit(0);
}

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
  for (const [, data] of cast.events) vt.feed(data);
  const transcript = vt.lines.map(lineText).join("\n");

  if (!transcript.trim()) {
    fail(`${file}: decoded transcript is blank — the payoff produced no visible output`);
  }
  for (const [pattern, description] of LEAK_PATTERNS) {
    if (pattern.test(transcript)) fail(`${file}: ${description} (matched ${pattern})`);
  }
}

if (failures.length) {
  console.error(`[check-porthole-casts] ${failures.length} finding(s) in ${files.length} porthole cast(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(`[check-porthole-casts] ${files.length} porthole cast(s) replayed clean — no errors, no empty payoffs, no leaked paths.`);
