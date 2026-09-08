#!/usr/bin/env bun
/**
 * Generate the parity fixtures the iOS app's XCTest suite asserts against.
 *
 *   lib/maritime-signals.ts
 *     -> apps/pd-ios/PortDaddy/Resources/maritime-signals.fixture.json
 *     -> Tests/PortDaddyKitTests/MaritimeSignalsParityTests.swift
 *
 *   skills/agent-control-command-contract/examples/sample-input.json
 *     -> apps/pd-ios/PortDaddy/Resources/control-contract.fixture.json
 *     -> Tests/PortDaddyKitTests/ControlVerbsTests.swift
 *
 *   apps/relay/src/interruptions.ts (publicShape) + the operator_interruptions
 *   migration
 *     -> apps/pd-ios/PortDaddy/Resources/interruptions.fixture.json
 *     -> Tests/PortDaddyKitTests/InterruptionsInboxTests.swift
 *
 * Why this exists: MaritimeSignals.swift, ControlVerbs.swift and
 * Interruptions.swift are hand-written ports of things that live elsewhere in
 * this repo. A port drifts silently the moment someone edits one side only.
 * This script freezes the canonical answers into fixtures the Swift tests
 * assert against. So:
 *
 *   - canonical source edited, fixture not regenerated -> `--check` fails in CI.
 *   - fixture regenerated, Swift not updated -> the Swift test fails.
 *
 * Neither side can move alone. In particular: an adapter that gains `pause`
 * cannot reach the phone's UI without ControlVerbsTests going red first, which
 * is the point — ADR-0125 §4 says a passing contract from last quarter is not
 * evidence about today's adapters.
 *
 * The interruptions fixture was hand-authored until it hid a real bug: it wrote
 * `"installationId": "inst_7710"` while `installation_id` is an INTEGER column
 * that publicShape passes straight through, so the Swift test validated the
 * fixture instead of the relay while every installation-scoped ask actually
 * threw DecodingError.typeMismatch and blanked the operator's inbox. Its shape
 * is now derived from publicShape() and the migration's column types, and every
 * seed value is type-checked against its column before it is written.
 *
 * Usage:
 *   bun run scripts/generate-pd-ios-fixtures.ts            # write
 *   bun run scripts/generate-pd-ios-fixtures.ts --check    # verify only
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// lib/maritime.ts strips every ANSI escape to '' unless colour is enabled, and
// colour is off for a non-TTY stdout. A fixture generated without this would
// freeze 26 empty strings and assert nothing. Set BEFORE the module evaluates,
// which is why the import below is dynamic.
if (!process.env.FORCE_COLOR) process.env.FORCE_COLOR = '1';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const RESOURCES = resolve(ROOT, 'apps/pd-ios/PortDaddy/Resources');
const MARITIME_OUT = resolve(RESOURCES, 'maritime-signals.fixture.json');
const CONTRACT_SRC = resolve(ROOT, 'skills/agent-control-command-contract/examples/sample-input.json');
const CONTRACT_OUT = resolve(RESOURCES, 'control-contract.fixture.json');
const INTERRUPTIONS_SRC = resolve(ROOT, 'apps/relay/src/interruptions.ts');
const INTERRUPTIONS_MIGRATION = resolve(ROOT, 'apps/relay/migrations/2026-08-04-operator-interruptions.sql');
const RELAY_BASELINE_MIGRATION = resolve(ROOT, 'apps/relay/migrations/2026-08-08-relay-baseline.sql');
const INTERRUPTIONS_OUT = resolve(RESOURCES, 'interruptions.fixture.json');

const signals = await import(resolve(ROOT, 'lib/maritime-signals.js'));
const { ANSI } = await import(resolve(ROOT, 'lib/maritime.js'));

const {
  SIGNAL_FOR_STATE,
  STATE_FOR_SIGNAL,
  ICS_MEANING,
  NATO_PHONETIC,
  SIGNAL_ANSI,
  HOISTS,
  formatSignal,
  colorize,
} = signals;

const states: string[] = Object.keys(SIGNAL_FOR_STATE);
const letters: string[] = Object.keys(ICS_MEANING).sort();

if (letters.length !== 26) {
  throw new Error(`[maritime-fixture] expected 26 ICS letters, got ${letters.length}`);
}
if (Object.values(SIGNAL_ANSI).some((v) => v === '')) {
  throw new Error('[maritime-fixture] SIGNAL_ANSI came back colourless — FORCE_COLOR did not take');
}

const fixture = {
  // Provenance, so a reader of the JSON knows it is derived, not authored.
  generatedFrom: 'lib/maritime-signals.ts',
  generatedBy: 'scripts/generate-maritime-signals-fixture.ts',
  note: 'Do not hand-edit. Regenerate, then make the Swift port agree.',
  // Declaration order of SIGNAL_FOR_STATE. signalFor()'s throw message
  // interpolates Object.keys() in exactly this order, so the Swift port's
  // error text can only match if the order matches.
  coordinationStates: states,
  signalCodes: letters,
  signalForState: Object.fromEntries(states.map((s) => [s, SIGNAL_FOR_STATE[s]])),
  stateForSignal: Object.fromEntries(
    letters.filter((l) => STATE_FOR_SIGNAL[l] !== undefined).map((l) => [l, STATE_FOR_SIGNAL[l]]),
  ),
  icsMeaning: Object.fromEntries(letters.map((l) => [l, ICS_MEANING[l]])),
  natoPhonetic: Object.fromEntries(letters.map((l) => [l, NATO_PHONETIC[l]])),
  // Raw escape sequences, not colour names. The Swift port keeps the same
  // strings so parity is byte-exact rather than a judgement call about which
  // UIColor "green" means.
  signalAnsi: Object.fromEntries(letters.map((l) => [l, SIGNAL_ANSI[l]])),
  ansiReset: ANSI.reset,
  formatSignal: Object.fromEntries(states.map((s) => [s, formatSignal(s)])),
  colorize: Object.fromEntries(states.map((s) => [s, colorize(s)])),
  colorizeWithLabel: Object.fromEntries(states.map((s) => [s, colorize(s, `${s} label`)])),
  hoists: Object.fromEntries(
    Object.keys(HOISTS).map((k) => [k, { letters: HOISTS[k].letters, meaning: HOISTS[k].meaning }]),
  ),
  // The exact text signalFor() throws for an unknown state, so the Swift
  // port's error is the same sentence and not a paraphrase.
  unknownStateErrorPrefix: '[maritime-signals] unknown coordination state: ',
  unknownStateErrorKnownStates: states.join(', '),
};

const contractRaw = JSON.parse(readFileSync(CONTRACT_SRC, 'utf8')) as {
  backends: { name: string; supportedVerbs: string[] }[];
  verbs: { name: string; terminalStates: string[] }[];
  authorizationSource: string;
};

// Re-rendered rather than byte-copied, so a formatting change in the skill
// fixture does not fail the gate while a semantic change always does.
const contractFixture = {
  generatedFrom: 'skills/agent-control-command-contract/examples/sample-input.json',
  generatedBy: 'scripts/generate-pd-ios-fixtures.ts',
  note: 'Do not hand-edit. Regenerate, then make the Swift port agree.',
  authorizationSource: contractRaw.authorizationSource,
  verbs: contractRaw.verbs.map((v) => v.name),
  terminalStates: contractRaw.verbs.map((v) => v.terminalStates),
  supportedVerbs: Object.fromEntries(contractRaw.backends.map((b) => [b.name, b.supportedVerbs])),
  unsupportedVerbs: Object.fromEntries(
    contractRaw.backends.map((b) => [
      b.name,
      contractRaw.verbs.map((v) => v.name).filter((name) => !b.supportedVerbs.includes(name)),
    ]),
  ),
};

// ── interruptions: publicShape + the SQL column types ────────────────────────
//
// The third fixture, and the one that exists because a hand-authored fixture
// let a real shape mismatch through. `OperatorInterruption.installationId` was
// declared `String?` while `installation_id` is an INTEGER column that
// `publicShape` passes straight through — so the wire value is a JSON number,
// `decodeIfPresent(String.self,...)` throws typeMismatch, and because the
// response's `interruptions` is a non-optional array ONE such ask blanks the
// operator's whole inbox to "unknown". The hand-written fixture said
// `"installationId": "inst_7710"` — a string — so the Swift test validated the
// fixture instead of the relay and the mismatch was invisible.
//
// So this fixture is no longer authored. Only the NARRATIVE is (titles, bodies,
// timestamps — editorial choices a generator has no business making); the
// SHAPE is read out of the relay:
//
//   - which keys exist, and in what order      <- publicShape() in interruptions.ts
//   - what JSON type each key carries          <- the column's SQL type
//   - which keys may be null                   <- the column's NOT NULL
//   - the legal urgency/state values           <- the columns' CHECK lists
//
// Every seed value is type-checked against its column BEFORE being written, so
// a seed that says `installation_id: 'inst_7710'` fails generation outright.
// The rendered `shape` block travels with the fixture so InterruptionsInboxTests
// can assert the Swift Codable models exactly those keys at exactly those types.
//
// Read via readFileSync, never imported: apps/relay/src/interruptions.ts pulls
// in @noble/hashes through crypto.ts, and the pd-ios CI job deliberately runs
// without `bun install`.

type SqlColumn = {
  type: string;
  jsonType: 'string' | 'number';
  nullable: boolean;
  allowed: string[] | null;
};

/** Split a CREATE TABLE body on top-level commas — CHECK (x IN ('a','b')) has commas of its own. */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of body) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

const CONSTRAINT_KEYWORDS = new Set(['PRIMARY', 'UNIQUE', 'FOREIGN', 'CHECK', 'CONSTRAINT']);

/** The columns of one CREATE TABLE, as the migration actually declares them. */
function tableColumns(sql: string, table: string, label: string): Record<string, SqlColumn> {
  const marker = `CREATE TABLE IF NOT EXISTS ${table} (`;
  const start = sql.indexOf(marker);
  if (start < 0) throw new Error(`[pd-ios-fixtures] ${label}: no CREATE TABLE for ${table}`);
  const end = sql.indexOf('\n);', start);
  if (end < 0) throw new Error(`[pd-ios-fixtures] ${label}: unterminated CREATE TABLE for ${table}`);
  const body = sql
    .slice(start + marker.length, end)
    .replace(/--[^\n]*/g, ''); // trailing comments are prose, not schema

  const columns: Record<string, SqlColumn> = {};
  for (const part of splitTopLevel(body)) {
    const text = part.trim().replace(/\s+/g, ' ');
    if (!text) continue;
    const [name, type] = text.split(' ');
    if (CONSTRAINT_KEYWORDS.has(name.toUpperCase())) continue; // a table-level constraint, not a column
    if (!type) throw new Error(`[pd-ios-fixtures] ${label}: column '${name}' has no type`);

    // Only the two storage classes this table uses are mapped. A new one is a
    // decision about the Swift type, so it stops generation instead of guessing.
    const jsonType = type === 'INTEGER' ? 'number' : type === 'TEXT' ? 'string' : null;
    if (jsonType === null) {
      throw new Error(
        `[pd-ios-fixtures] ${label}: ${table}.${name} is ${type}; ` +
          'teach this script which JSON type that is, and check the Swift property agrees',
      );
    }

    const checkMatch = text.match(new RegExp(`CHECK \\(${name} IN \\(([^)]*)\\)\\)`));
    columns[name] = {
      type,
      jsonType,
      // A PRIMARY KEY is nullable in SQLite's letter but never in this table's
      // practice — every writer sets it — so it is modelled non-null.
      nullable: !/\bNOT NULL\b/.test(text) && !/\bPRIMARY KEY\b/.test(text),
      allowed: checkMatch ? checkMatch[1].split(',').map((v) => v.trim().replace(/^'|'$/g, '')) : null,
    };
  }
  return columns;
}

/** publicShape()'s jsonKey -> column mapping, in declaration order. */
function publicShapeMapping(source: string): [string, string][] {
  const start = source.indexOf('function publicShape(');
  if (start < 0) throw new Error('[pd-ios-fixtures] publicShape() is gone from apps/relay/src/interruptions.ts');
  const open = source.indexOf('return {', start);
  const close = source.indexOf('};', open);
  if (open < 0 || close < 0) throw new Error('[pd-ios-fixtures] could not read publicShape()’s object literal');

  const lines = source
    .slice(open + 'return {'.length, close)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('//'));

  const mapping: [string, string][] = [];
  for (const line of lines) {
    const m = line.match(/^(\w+): row\.(\w+),$/);
    if (!m) {
      // A derived or renamed value is a shape change the phone cannot infer.
      // Fail rather than silently dropping the key from the fixture.
      throw new Error(`[pd-ios-fixtures] publicShape() line is not a plain column pass-through: ${line}`);
    }
    mapping.push([m[1], m[2]]);
  }
  if (mapping.length === 0) throw new Error('[pd-ios-fixtures] publicShape() exposed no columns');
  return mapping;
}

const interruptionsSource = readFileSync(INTERRUPTIONS_SRC, 'utf8');
const shapeMapping = publicShapeMapping(interruptionsSource);

const migrationColumns = tableColumns(
  readFileSync(INTERRUPTIONS_MIGRATION, 'utf8'),
  'operator_interruptions',
  'operator-interruptions migration',
);
const baselineColumns = tableColumns(
  readFileSync(RELAY_BASELINE_MIGRATION, 'utf8'),
  'operator_interruptions',
  'relay baseline',
);
// Two migrations declare this table. If they ever disagree, the phone cannot
// know which one the deployed D1 ran — so that disagreement is the failure.
if (JSON.stringify(migrationColumns) !== JSON.stringify(baselineColumns)) {
  throw new Error(
    '[pd-ios-fixtures] operator_interruptions is declared differently in the ' +
      'feature migration and the relay baseline — reconcile them first',
  );
}

// The narrative. Keyed by COLUMN name (not JSON key) so the mapping above is
// the only thing that decides what reaches the wire, and so a renamed column
// fails loudly here instead of emitting a key nothing populates.
const interruptionSeeds: Record<string, string | number | null>[] = [
  {
    id: 'oi_4f1c8a02',
    installation_id: 77103928,
    source_agent: 'pd-relay-deploy',
    source_session: 'sess_a19c',
    title: 'Deploy the relay worker or stop the wave?',
    body: "The queue-consumer patch is merged but not deployed. Loads are queuing behind it. Answer 'deploy' to proceed or 'hold' to stop the wave here.",
    urgency: 'critical',
    state: 'open',
    answer: null,
    created_at: 1755820380,
    nag_count: 2,
    last_nagged_at: 1755820680,
    closed_at: null,
  },
  {
    id: 'oi_9b220d51',
    installation_id: 77103928,
    source_agent: 'pd-ios-builder',
    source_session: 'sess_4f2a',
    title: 'Approve App Store Connect spend for the TestFlight lane?',
    body: "The iOS distribution lane needs an Apple Distribution certificate and a provisioning profile. Neither exists in this account's secrets today.",
    urgency: 'high',
    state: 'open',
    answer: null,
    created_at: 1755819100,
    nag_count: 1,
    last_nagged_at: 1755820100,
    closed_at: null,
  },
  {
    // No installation scope: the column is nullable and an ask filed by a local
    // agent has no GitHub App behind it. Both branches of the optional are in
    // the fixture on purpose.
    id: 'oi_1177ee30',
    installation_id: null,
    source_agent: 'pd-vault',
    source_session: null,
    title: 'Which AEAD for sealed envelopes?',
    body: 'XChaCha20-Poly1305 or AES-256-GCM for the sealed envelope body.',
    urgency: 'normal',
    state: 'answered',
    answer: 'XChaCha20-Poly1305 — nonce reuse risk is the deciding factor.',
    created_at: 1755700000,
    nag_count: 1,
    last_nagged_at: 1755701800,
    closed_at: 1755703000,
  },
  {
    id: 'oi_5502ba9d',
    installation_id: 61200477,
    source_agent: 'pd-nightshift',
    source_session: 'sess_0011',
    title: 'Nightshift budget raise to $40?',
    body: 'The overnight lane hit its cap at 03:12 and parked four items.',
    urgency: 'low',
    state: 'expired',
    answer: null,
    created_at: 1755500000,
    nag_count: 5,
    last_nagged_at: 1755521600,
    closed_at: 1755522000,
  },
];

const renderedInterruptions = interruptionSeeds.map((seed, index) => {
  for (const column of Object.keys(seed)) {
    if (!migrationColumns[column]) {
      throw new Error(`[pd-ios-fixtures] seed ${index} sets '${column}', which is not a column of operator_interruptions`);
    }
  }

  const row: Record<string, string | number | null> = {};
  for (const [jsonKey, column] of shapeMapping) {
    const spec = migrationColumns[column];
    if (!spec) {
      throw new Error(`[pd-ios-fixtures] publicShape exposes row.${column}, which operator_interruptions does not have`);
    }
    if (!Object.prototype.hasOwnProperty.call(seed, column)) {
      throw new Error(
        `[pd-ios-fixtures] publicShape now exposes '${jsonKey}' (row.${column}) and seed ${index} has no value for it. ` +
          'Add one here, then model the field in OperatorInterruption.',
      );
    }
    const value = seed[column];

    // THE CHECK THIS FILE EXISTS FOR: a seed whose JS type disagrees with its
    // SQL column never reaches the fixture. `installation_id: 'inst_7710'`
    // dies right here.
    if (value === null) {
      if (!spec.nullable) throw new Error(`[pd-ios-fixtures] seed ${index}: ${column} is NOT NULL but the seed is null`);
    } else if (typeof value !== spec.jsonType) {
      throw new Error(
        `[pd-ios-fixtures] seed ${index}: ${column} is ${spec.type} (JSON ${spec.jsonType}) ` +
          `but the seed is a ${typeof value} — fix the seed, and check OperatorInterruption.${jsonKey}'s Swift type`,
      );
    } else if (spec.type === 'INTEGER' && !Number.isInteger(value as number)) {
      throw new Error(`[pd-ios-fixtures] seed ${index}: ${column} is INTEGER but the seed is not integral`);
    } else if (spec.allowed && !spec.allowed.includes(value as string)) {
      throw new Error(
        `[pd-ios-fixtures] seed ${index}: ${column}='${value}' is outside the column's CHECK (${spec.allowed.join('|')})`,
      );
    }
    row[jsonKey] = value;
  }
  return row;
});

// The urgency/state enums on the phone are pinned to these CHECK lists. If a
// migration ever drops a CHECK, say so here rather than emitting `null` and
// letting the Swift decode fail with something unreadable.
for (const column of ['urgency', 'state'] as const) {
  if (!migrationColumns[column]?.allowed?.length) {
    throw new Error(
      `[pd-ios-fixtures] operator_interruptions.${column} no longer carries a CHECK (... IN (...)) list — ` +
        `InterruptionUrgency/InterruptionState on the phone have nothing left to be pinned to`,
    );
  }
}

const interruptionsFixture = {
  generatedFrom:
    'apps/relay/src/interruptions.ts (publicShape) + apps/relay/migrations/2026-08-04-operator-interruptions.sql',
  generatedBy: 'scripts/generate-pd-ios-fixtures.ts',
  note: 'Do not hand-edit. Regenerate, then make the Swift port agree.',
  // The relay's answer to "what fields, at what JSON types, may any be null".
  // InterruptionsInboxTests asserts OperatorInterruption models exactly this.
  shape: Object.fromEntries(
    shapeMapping.map(([jsonKey, column]) => [
      jsonKey,
      {
        column,
        sqlType: migrationColumns[column].type,
        jsonType: migrationColumns[column].jsonType,
        nullable: migrationColumns[column].nullable,
      },
    ]),
  ),
  urgencies: migrationColumns.urgency.allowed,
  states: migrationColumns.state.allowed,
  // The GET /v1/interruptions envelope, as handleListInterruptions returns it.
  code: 'OK',
  error: null,
  // Counted, never asserted: the fixture cannot claim an open count its own
  // rows disagree with.
  openCount: interruptionSeeds.filter((s) => s.state === 'open').length,
  interruptions: renderedInterruptions,
};

const outputs: { path: string; rendered: string; label: string }[] = [
  { path: MARITIME_OUT, rendered: `${JSON.stringify(fixture, null, 2)}\n`, label: 'maritime-signals' },
  { path: CONTRACT_OUT, rendered: `${JSON.stringify(contractFixture, null, 2)}\n`, label: 'control-contract' },
  { path: INTERRUPTIONS_OUT, rendered: `${JSON.stringify(interruptionsFixture, null, 2)}\n`, label: 'interruptions' },
];

const check = process.argv.includes('--check');
let stale = false;

for (const out of outputs) {
  if (check) {
    let current = '';
    try {
      current = readFileSync(out.path, 'utf8');
    } catch {
      console.error(`[pd-ios-fixtures] missing ${out.path}`);
      stale = true;
      continue;
    }
    if (current !== out.rendered) {
      console.error(`[pd-ios-fixtures] STALE: ${out.label}. Its canonical source changed without regenerating the fixture.`);
      stale = true;
      continue;
    }
    console.log(`[pd-ios-fixtures] up to date: ${out.label}`);
  } else {
    writeFileSync(out.path, out.rendered);
    console.log(`[pd-ios-fixtures] wrote ${out.path}`);
  }
}

if (check && stale) {
  console.error('  fix: bun run scripts/generate-pd-ios-fixtures.ts');
  process.exit(1);
}
