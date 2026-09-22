#!/usr/bin/env node
// Offline source-function fixture. No canonical module imports or runtime calls.
import { readFileSync, writeFileSync, mkdirSync, existsSync, realpathSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const here = realpathSync(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
assert.equal(args.length, 4, 'usage: --root CANONICAL --out run-NN');
assert.equal(args[0], '--root');
assert.equal(args[2], '--out');
assert.match(args[3], /^run-[0-9]+$/);
const root = realpathSync(resolve(args[1]));
const out = join(here, args[3]);
assert.equal(existsSync(out), false, 'never overwrite an existing run');
const sha = value => createHash('sha256').update(value).digest('hex');
const selections = [
  {
    path: 'lib/handoff-capsule.ts',
    sha256: '5da9ae1f277b4f1b81bca1f12279cf5758267e0fdef2471b43b0830a1b54b60e',
    ranges: [[7, 505], [568, 644]],
  },
  {
    path: 'lib/dispatch/handoff-from-transcript.ts',
    sha256: '684c7cd5a7b6d3bbc981ddf8ebcfd689c7a3c36bddb8e8fdd03cd647033283e5',
    ranges: [[59, 65], [123, 237], [250, 255]],
  },
];
const sourceEvidence = [];
let selected = '';
for (const spec of selections) {
  const bytes = readFileSync(join(root, spec.path));
  assert.equal(sha(bytes), spec.sha256, 'source drift: ' + spec.path);
  const lines = bytes.toString('utf8').split('\n');
  const excerpt = spec.ranges.map(([a, b]) => lines.slice(a - 1, b).join('\n')).join('\n');
  sourceEvidence.push({ ...spec, extracted_sha256: sha(excerpt) });
  selected += excerpt + '\n';
}
// Only export modifiers are removed. Type erasure does not rewrite the algorithms.
const executable = stripTypeScriptTypes(selected.replace(/^export /gm, ''), { mode: 'strip' });
const sandbox = vm.createContext({
  Buffer, createHash,
  randomUUID: () => '00000000-0000-4000-8000-000000000001',
  homedir: () => here,
  redactSecrets: text => text,
  scanContent: () => [],
}, { codeGeneration: { strings: false, wasm: false } });
vm.runInContext(executable, sandbox, { timeout: 2000 });

const instruction = 'OBL-01: preserve the existing acceptance criteria.';
const user = content => ({ role: 'user', content, timestamp: 1_800_000_000_000 });
const assistant = content => ({ role: 'assistant', content, timestamp: 1_800_000_000_001 });
const later = n => Array.from({ length: n }, (_, i) => user('Unrelated formatting request ' + i));
const chatter = () => Array.from({ length: 8 }, (_, i) => assistant('Local drafting step ' + i));
const old = [user(instruction), ...later(4), ...chatter()];
const fixtures = [
  { id: 'recent', messages: [assistant('Working locally.'), user(instruction)], requiredText: instruction },
  { id: 'old', messages: old, requiredText: instruction },
  { id: 'fourth-from-last', messages: [user(instruction), ...later(3), ...chatter()], requiredText: instruction },
  { id: 'long-item', messages: [user('x'.repeat(2050) + instruction)], requiredText: 'x'.repeat(2050) + instruction },
  { id: 'reaffirmed', messages: [...old, user(instruction)], requiredText: instruction },
  { id: 'unconstrained', messages: [user('Use plain prose.')], requiredText: null },
];
assert.ok(Buffer.byteLength(JSON.stringify(fixtures)) < 64 * 1024);
function ledgerFor(fixture) {
  if (fixture.requiredText === null) return [];
  const allowedIds = fixture.messages.filter(m => m.role === 'user')
    .flatMap((m, index) => m.content === fixture.requiredText ? ['turn-' + index] : []);
  assert.ok(allowedIds.length > 0);
  return [{ id: 'OBL-01', allowed_source_ids: allowedIds, text: fixture.requiredText,
            text_sha256: sha(fixture.requiredText) }];
}
function missing(ledger, brief) {
  return ledger.filter(record => !brief.operatorTurns.some(row =>
    record.allowed_source_ids.includes(row.id) && sha(row.text) === record.text_sha256
  )).map(record => record.id);
}
const observations = [];
const briefs = {};
for (const fixture of fixtures) {
  // Expected answers live in the observer; no ledger is supplied to the projection.
  sandbox.fixture = { id: fixture.id, messages: fixture.messages };
  sandbox.here = here;
  const measured = vm.runInContext(`
    (() => {
      if ('requiredText' in fixture || 'required_ledger' in fixture) {
        throw new Error('observer labels leaked into projection context');
      }
      const dispatch = {
        id: 'dispatch-' + fixture.id, goal: 'Write the local design note.',
        sessionId: 'session-' + fixture.id, spawnedAgentId: 'synthetic-agent',
        worktreePath: here, branch: 'synthetic-fixture'
      };
      const transcript = {
        id: 'transcript-' + fixture.id, project: 'synthetic',
        messages: fixture.messages, outputs: []
      };
      const draft = draftCapsule(dispatch, transcript, 'synthetic-A', 'synthetic-B',
                                  () => 1800000000000);
      const capsule = sanitizeHandoffCapsule(draft, {
        tokenBudget: DEFAULT_TOKEN_BUDGET, home: here,
        gitleaksRunner: () => ({ findings: [] })
      });
      const prompt = renderHandoffSuccessorPrompt(capsule);
      return JSON.stringify({
        draft_omitted: draft.budget.omitted,
        capsule,
        hash_matches: computeIntegrity(capsule) === capsule.integrity.contentHash,
        prompt, brief: JSON.parse(prompt.slice(prompt.indexOf('{')))
      });
    })()
  `, sandbox, { timeout: 2000 });
  const m = JSON.parse(measured);
  const ledger = ledgerFor(fixture);
  briefs[fixture.id] = m.brief;
  observations.push({
    fixture: fixture.id, input: fixture, required_ledger: ledger,
    source_messages: fixture.messages.length,
    source_operator_turns: fixture.messages.filter(row => row.role === 'user').length,
    retained_operator_ids: m.brief.operatorTurns.map(row => row.id),
    draft_omitted: m.draft_omitted, sanitized_omitted: m.capsule.budget.omitted,
    brief_omitted: m.brief.omissions,
    capsule_transcript_ref: m.capsule.source.transcriptRef,
    brief_contains_transcript_ref: JSON.stringify(m.brief).includes(m.capsule.source.transcriptRef),
    approximate_tokens: m.capsule.budget.estimatedTokens,
    hash_matches: m.hash_matches, capsule_hash: m.capsule.integrity.contentHash,
    prompt_contains_instruction: m.prompt.includes(instruction),
    truncation_marker: m.prompt.includes('[truncated for the handoff brief]'),
    missing_obligations: missing(ledger, m.brief),
    retained_operator_records: m.brief.operatorTurns,
  });
}
const get = id => observations.find(row => row.fixture === id);
const recentLedger = ledgerFor(fixtures[0]);
const badId = structuredClone(briefs.recent);
badId.operatorTurns[0].id = 'forged-source-id';
const badText = structuredClone(briefs.recent);
badText.operatorTurns[0].text = 'OBL-01: changed instruction.';
const tailCopy = structuredClone(briefs.recent);
tailCopy.recentContext.push({ id: 'forged-tail', role: 'assistant', text: instruction });
tailCopy.operatorTurns = [];
const controls = {
  forged_source_id_rejected: missing(recentLedger, badId).length === 1,
  edited_text_rejected: missing(recentLedger, badText).length === 1,
  assistant_only_copy_rejected: missing(recentLedger, tailCopy).length === 1,
  restored_operator_evidence_passes: missing(recentLedger, briefs.recent).length === 0,
  weak_hash_gate_accepts_old_loss: get('old').hash_matches,
  weak_counter_gate_accepts_old_loss: get('old').brief_omitted.tail === 0,
  output_derived_denominator_accepts_old_loss: missing([], briefs.old).length === 0,
};
const checks = {
  old_loses_obligation_with_valid_hash:
    get('old').missing_obligations.length === 1 && !get('old').prompt_contains_instruction &&
    get('old').hash_matches,
  prior_omissions_reset: get('old').draft_omitted.tail === 5 && get('old').brief_omitted.tail === 0,
  recent_preserved: get('recent').missing_obligations.length === 0,
  fourth_from_last_preserved: get('fourth-from-last').missing_obligations.length === 0,
  clipped_suffix_disclosed: get('long-item').missing_obligations.length === 1 &&
    !get('long-item').prompt_contains_instruction && get('long-item').truncation_marker,
  reaffirmation_restores: get('reaffirmed').missing_obligations.length === 0,
  no_false_requirement: get('unconstrained').missing_obligations.length === 0,
  all_hashes_match: observations.every(row => row.hash_matches),
  full_capsule_retains_reference: observations.every(row => Boolean(row.capsule_transcript_ref)),
  rendered_brief_omits_reference: observations.every(row => !row.brief_contains_transcript_ref),
  controls_all_expected: Object.values(controls).every(Boolean),
};
const result = {
  scope: 'Synthetic source-extracted projection test; scanners stubbed; no PD runtime or providers.',
  run: args[3], node: process.version,
  script_sha256: sha(readFileSync(fileURLToPath(import.meta.url))),
  protocol_sha256: sha(readFileSync(join(here, 'PROTOCOL.md'))),
  source_evidence: sourceEvidence,
  erased_source_sha256: sha(executable),
  scanner_boundary: 'Identity redaction and clean scanner stubs; no security-scanner efficacy claim.',
  observations, controls, checks, pass: Object.values(checks).every(Boolean),
};
const json = JSON.stringify(result, null, 2) + '\n';
assert.ok(Buffer.byteLength(json) < 256 * 1024);
mkdirSync(out);
writeFileSync(join(out, 'results.json'), json, { flag: 'wx' });
console.log(JSON.stringify({
  pass: result.pass, cases: observations.length, checks, controls,
  output: join(out, 'results.json'), sha256: sha(json),
}, null, 2));
process.exitCode = result.pass ? 0 : 1;
