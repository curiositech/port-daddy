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
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { parseCast, VT, lineText } from "../src/lib/porthole/vt.ts";
import {
  findCollisionRefusalFailures,
  findJoinOnlyCastClaims,
  findPortholeCastCorpusFailures,
  findServiceDiscoveryFailures,
  findThreePartyParleyFailures,
  findVisibilityTimelineFailures,
} from "./porthole-proof-contracts.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CASTS_DIR = join(__dirname, "..", "public", "casts", "porthole");
const GALLERY_PATH = join(__dirname, "..", "..", "docs", "artifacts", "porthole-harness-proof-v2", "harness-proof-current.html");
const PARLEY_PANES_PATH = join(__dirname, "..", "src", "data", "evidence", "parley-source-panes.json");

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

function checkParleyPaneArchive() {
  if (!existsSync(PARLEY_PANES_PATH)) {
    fail('parley-source-panes.json: missing recorder-authored tmux pane archive');
    return;
  }
  let archive;
  try {
    archive = JSON.parse(readFileSync(PARLEY_PANES_PATH, 'utf8'));
  } catch (error) {
    fail(`parley-source-panes.json: invalid JSON (${error.message})`);
    return;
  }
  if (archive.schema !== 'porthole.tmux-pane-archive.v1') {
    fail(`parley-source-panes.json: unexpected schema ${archive.schema ?? 'missing'}`);
  }
  if (archive.sourceCast !== 'parley-source.cast' || archive.capturedFromAvailableHistoryStart !== true
    || archive.capture !== 'tmux capture-pane -p -J -S -') {
    fail('parley-source-panes.json: archive must declare a beginning-of-available-history tmux capture bound to parley-source.cast');
  }
  if (archive.outerTerminal?.cols !== 160 || archive.outerTerminal?.rows !== 44
    || !Number.isFinite(Date.parse(archive.recordingStartedAt)) || !Number.isFinite(Date.parse(archive.capturedAt))) {
    fail('parley-source-panes.json: archive is missing real outer geometry or recording/capture timestamps');
  }
  const castPath = join(CASTS_DIR, 'parley-source.cast');
  if (existsSync(castPath)) {
    const actualHash = createHash('sha256').update(readFileSync(castPath)).digest('hex');
    if (archive.sourceCastSha256 !== actualHash) {
      fail(`parley-source-panes.json: source cast hash drifted (archive=${archive.sourceCastSha256 ?? 'missing'}, actual=${actualHash})`);
    }
  }
  const expected = new Map([
    ['nora', /NORA◆/],
    ['milo', /MILO◇/],
    ['aya', /AYA●/],
    ['witness', /PORT DADDY WITNESS[\s\S]*CAUGHT UP · 6 durable turns/],
  ]);
  const panes = Array.isArray(archive.panes) ? archive.panes : [];
  if (panes.length !== expected.size || new Set(panes.map((pane) => pane.id)).size !== expected.size) {
    fail(`parley-source-panes.json: expected four distinct pane histories, observed ${panes.length}`);
  }
  for (const pane of panes) {
    if (!Array.isArray(pane.lines)) {
      fail(`parley-source-panes.json/${pane.id ?? 'unknown'}: pane lines must be an array`);
      continue;
    }
    const transcript = pane.lines.join('\n');
    if (!expected.get(pane.id)?.test(transcript)) {
      fail(`parley-source-panes.json: ${pane.id ?? 'unknown'} pane is missing its real terminal evidence`);
    }
    if (pane.lines?.length < 3) {
      fail(`parley-source-panes.json: ${pane.id ?? 'unknown'} pane has no meaningful scrollback`);
    }
    const digest = createHash('sha256').update(`${transcript}\n`).digest('hex');
    if (pane.digestSha256 !== digest || !Number.isSafeInteger(pane.historySize)
      || pane.historySize < 0 || !Number.isSafeInteger(pane.historyLimit) || pane.historyLimit <= 0
      || pane.historySize > pane.historyLimit
      || typeof pane.historyLimitReached !== 'boolean'
      || pane.historyLimitReached !== (pane.historySize >= pane.historyLimit)
      || !Number.isSafeInteger(pane.geometry?.cols) || !Number.isSafeInteger(pane.geometry?.rows)) {
      fail(`parley-source-panes.json/${pane.id}: pane digest, geometry, history size, or limit receipt is invalid`);
    }
    for (const [pattern, description] of LEAK_PATTERNS) {
      if (pattern.test(transcript)) fail(`parley-source-panes.json/${pane.id}: ${description} (matched ${pattern})`);
    }
    if (/parley turn notification keys collided|REFUSED · command exited|Pane is dead/i.test(transcript)) {
      fail(`parley-source-panes.json/${pane.id}: failed capture was persisted as pane evidence`);
    }
  }
}

/**
 * Loads the committed, self-contained gallery in a browser-like DOM and
 * checks the lifecycle boundary a viewer actually exercises: changing scenes
 * destroys the prior player before it mounts the next one.  A string check
 * would not catch a retained-but-never-disconnected observer, so the test
 * replaces the platform observer with a counter and drives six real tab
 * clicks through the embedded client bundle.
 */
async function checkGalleryResizeObserverLifecycle() {
  if (!existsSync(GALLERY_PATH)) {
    fail("harness-proof-current.html: missing committed gallery lifecycle witness");
    return;
  }

  const observers = [];
  const createdUrls = [];
  const revokedUrls = [];
  const galleryCast = `${JSON.stringify({ version: 2, width: 100, height: 28, timestamp: 0 })}\n${JSON.stringify([0.1, "o", "gallery lifecycle witness\\r\\n"])}\n`;
  const dom = new JSDOM(readFileSync(GALLERY_PATH, "utf8"), {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: "https://porthole.test/harness-proof-current.html",
    beforeParse(window) {
      class CountingResizeObserver {
        disconnectCount = 0;
        constructor() {
          observers.push(this);
        }
        observe() {}
        unobserve() {}
        disconnect() {
          this.disconnectCount += 1;
        }
      }

      window.ResizeObserver = CountingResizeObserver;
      window.matchMedia = () => ({
        matches: true,
        media: "(prefers-reduced-motion: reduce)",
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent() { return false; },
      });
      window.URL.createObjectURL = () => {
        const url = `blob:porthole-test-${createdUrls.length}`;
        createdUrls.push(url);
        return url;
      };
      window.URL.revokeObjectURL = (url) => revokedUrls.push(url);
      window.fetch = async () => ({
        ok: true,
        status: 200,
        text: async () => galleryCast,
      });
      Object.defineProperty(window.navigator, "clipboard", {
        configurable: true,
        value: { writeText: async () => {} },
      });
    },
  });

  try {
    const encoded = dom.window.document.querySelector('#gallery-data')?.textContent;
    const gallery = encoded ? JSON.parse(encoded) : null;
    const receiptScene = gallery?.scenes?.find((scene) => scene.id === 'parley');
    const sourceScene = gallery?.scenes?.find((scene) => scene.id === 'parley-source');
    if (receiptScene?.cast !== 'parley') {
      fail('harness-proof-current.html: primary Wardroom scene must use performative-free parley.cast');
    }
    if (sourceScene?.cast !== 'parley-source' || !/drill-down/i.test(`${sourceScene?.station ?? ''} ${sourceScene?.label ?? ''}`)) {
      fail('harness-proof-current.html: parley-source.cast must remain an explicitly labeled drill-down scene');
    }
    if (gallery?.paneArchive?.paneCount !== 4 || gallery?.paneArchive?.sourceCast !== 'parley-source.cast') {
      fail('harness-proof-current.html: pane inspector is not bound to four parley-source histories');
    }

    // `activate(0)` is intentionally fire-and-forget in the real gallery.
    // Let that initial async cast load finish before we begin exercising the
    // same public scene-switch path; otherwise a closing JSDOM can make an
    // in-flight, already-replaced player look like a gallery failure.
    const settle = () => new Promise((resolve) => dom.window.setTimeout(resolve, 0));
    await settle();
    const sceneIds = ["harness-next-turn", "collision", "visibility", "ports", "parley", "parley-source"];
    for (const id of sceneIds) {
      const button = dom.window.document.querySelector(`#scene-tab-${id}`);
      if (!(button instanceof dom.window.HTMLButtonElement)) {
        fail(`harness-proof-current.html: scene tab ${id} is missing from the executable gallery`);
        return;
      }
      const retired = [...observers];
      const observersBeforeSwitch = observers.length;
      button.click();
      await settle();
      if (button.getAttribute("aria-selected") !== "true") {
        fail(`harness-proof-current.html: scene tab ${id} did not become active`);
      }
      if (observers.length <= observersBeforeSwitch) {
        fail(`harness-proof-current.html: scene switch ${id} did not create an observer for the replacement player`);
      }
      if (retired.some((observer) => observer.disconnectCount < 1)) {
        fail(`harness-proof-current.html: scene switch ${id} left a retired player observer connected`);
      }
    }

    const activeObservers = observers.filter((observer) => observer.disconnectCount === 0);
    const retiredObservers = observers.length - activeObservers.length;
    if (activeObservers.length < 1 || retiredObservers < sceneIds.length) {
      fail(`harness-proof-current.html: scene switches must leave a live player generation and retire every prior generation (created=${observers.length}, active=${activeObservers.length}, retired=${retiredObservers})`);
    } else {
      console.log(`[check-porthole-casts] gallery lifecycle clean — ${observers.length} observer(s) created; ${retiredObservers} retired observer(s) disconnected.`);
    }
    const paneInspector = dom.window.document.querySelector('#parley-pane-inspector');
    const paneRegions = paneInspector?.querySelectorAll('[role="region"][aria-label*="tmux pane scrollback"]') ?? [];
    if (!(paneInspector instanceof dom.window.HTMLElement) || paneInspector.hidden || paneRegions.length !== 4) {
      fail(`harness-proof-current.html: parley-source must reveal four independently focusable pane histories (observed ${paneRegions.length})`);
    } else {
      if ([...paneRegions].some((region) => region.getAttribute('tabindex') !== '0')) {
        fail('harness-proof-current.html: every pane history must be keyboard focusable');
      }
      const [noraRegion, miloRegion, ayaRegion, witnessRegion] = [...paneRegions];
      const startingOffsets = [100, 101, 102, 103];
      [noraRegion, miloRegion, ayaRegion, witnessRegion].forEach((region, index) => {
        Object.defineProperty(region, 'scrollHeight', { configurable: true, value: 900 + index });
        region.scrollTop = startingOffsets[index];
      });
      const noraLatest = paneInspector.querySelector('[data-pane-latest="nora"]');
      if (!(noraLatest instanceof dom.window.HTMLButtonElement)
        || noraLatest.getAttribute('aria-controls') !== noraRegion.id) {
        fail('harness-proof-current.html: Nora latest control is not bound to her pane history');
      } else {
        noraLatest.click();
        if (noraRegion.scrollTop !== 900
          || miloRegion.scrollTop !== 101 || ayaRegion.scrollTop !== 102 || witnessRegion.scrollTop !== 103) {
          fail('harness-proof-current.html: scrolling Nora must leave Milo, Aya, and witness offsets unchanged');
        }
      }
    }

    const failureButton = dom.window.document.querySelector('#scene-tab-quickstart');
    dom.window.fetch = async () => ({ ok: false, status: 503, text: async () => '' });
    if (!(failureButton instanceof dom.window.HTMLButtonElement)) {
      fail('harness-proof-current.html: quickstart tab is missing from the load-failure regression');
    } else {
      failureButton.click();
      await settle();
      const alert = dom.window.document.querySelector('[role="alert"].player-error');
      const lastCreatedUrl = createdUrls.at(-1);
      if (!(alert instanceof dom.window.HTMLElement) || !/replay unavailable/i.test(alert.textContent ?? '')) {
        fail('harness-proof-current.html: a failed cast load must render an unmistakable error state');
      }
      if (!lastCreatedUrl || !revokedUrls.includes(lastCreatedUrl)) {
        fail('harness-proof-current.html: a failed cast load must revoke its object URL');
      }
      if (observers.some((observer) => observer.disconnectCount === 0)) {
        fail('harness-proof-current.html: a failed cast load left a player observer connected');
      }
    }
  } finally {
    dom.window.close();
  }
}

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
  const explicitGeometry = {
    'parley-source.cast': [160, 44],
    'parley.cast': [140, 40],
  };
  const expectedGeometry = explicitGeometry[file]
    ?? (command.includes("drive-tmux") ? [120, 34] : [100, 28]);
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
  fail('parley.cast: primary receipt is present without the preserved raw three-session protocol transcript');
}
if (observedByFile.has('parley-source.cast') && observedByFile.has('parley.cast')) {
  for (const failure of findThreePartyParleyFailures(
    observedByFile.get('parley-source.cast'),
    observedByFile.get('parley.cast'),
  )) fail(failure);
}

for (const failure of findJoinOnlyCastClaims(observedByFile)) fail(failure);

checkParleyPaneArchive();
await checkGalleryResizeObserverLifecycle();

if (failures.length) {
  console.error(`[check-porthole-casts] ${failures.length} finding(s) in ${files.length} porthole cast(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(`[check-porthole-casts] ${files.length} porthole cast(s) replayed clean — no errors, no empty payoffs, no leaked paths.`);
