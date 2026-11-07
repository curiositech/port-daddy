import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { discoverSource, discoverBoundary, compareContract, mutationHeads, CONTRACT_PATH } from './check_dispatch_writer_coverage.mjs';

const reviewed = sites => ({ sites: sites.map(site => ({ ...site, classification: 'test-reviewed-site', rationale: 'synthetic scanner control', probe: 'this test' })) });
const source = "export function writer(db) { db.prepare('UPDATE dispatches SET state = ? WHERE id = ?').run('claimed', 'a'); }";

test('positive control recognizes a reviewed exact SQL site', () => {
  const sites = discoverSource('lib/known.ts', source);
  assert.equal(sites.length, 1);
  assert.deepEqual(sites[0].mutations, [{ kind: 'UPDATE', target: 'dispatches' }]);
  assert.deepEqual(compareContract(sites, reviewed(sites)), []);
});

test('negative control: a new production file outside the queue is unclassified', () => {
  const sites = discoverSource('routes/future/direct-writer.ts', source);
  assert.match(compareContract(sites, { sites: [] }).join('\n'), /unclassified writer/);
});

test('negative control: omission of an existing writer is rejected', () => {
  const sites = discoverSource('lib/known.ts', source);
  assert.match(compareContract(sites, { sites: [] }).join('\n'), /unclassified writer/);
  assert.match(compareContract([], reviewed(sites)).join('\n'), /reviewed writer missing/);
});

test('negative control: wrong reviewed SQL bytes fail, even with identical abstract edge', () => {
  const sites = discoverSource('lib/known.ts', source);
  const changed = discoverSource('lib/known.ts', source.replace('WHERE id = ?', 'WHERE state = ?'));
  assert.match(compareContract(changed, reviewed(sites)).join('\n'), /changed since review/);
});

test('negative control: wrong target/operation classification fails independently of byte hash', () => {
  const sites = discoverSource('lib/known.ts', source), contract = reviewed(sites);
  contract.sites[0].mutations = [{ kind: 'DELETE', target: 'other' }];
  assert.match(compareContract(sites, contract).join('\n'), /classification changed/);
});

test('UPDATE RETURNING through get/all/query and bracket-call sinks cannot evade literal discovery', () => {
  for (const sink of ['get', 'all', 'query']) {
    const sites = discoverSource('lib/new.ts', `db['prepare']('UPDATE "main"."dispatches" SET state = ? RETURNING id').${sink}('salvage')`);
    assert.equal(sites.length, 1);
    assert.deepEqual(sites[0].mutations, [{ kind: 'UPDATE', target: 'dispatches' }]);
  }
});

test('dynamic selectors are explicit unknowns, never ignored', () => {
  const sites = discoverSource('lib/new.ts', 'db.exec(`DELETE FROM ${table}`)');
  assert.deepEqual(sites[0].mutations, [{ kind: 'DELETE', target: '__pd_dynamic_0__' }]);
  assert.match(compareContract(sites, { sites: [] }).join('\n'), /unclassified/);
});

test('concatenated literal and dynamic mutation targets are discovered', () => {
  assert.equal(discoverSource('lib/new.ts', `db.exec('UPDATE ' + table + ' SET state = ?')`).length, 1);
  assert.equal(discoverSource('lib/new.ts', `db.exec('DELETE ' + 'FROM dispatches')`).length, 1);
});

test('comments, ordinary UPDATE labels and SQL string values are not mutations', () => {
  assert.deepEqual(mutationHeads("SELECT 'UPDATE dispatches SET state = 1'; -- DELETE FROM dispatches\n/* ALTER TABLE dispatches */"), []);
  assert.deepEqual(discoverSource('lib/new.ts', "const event='UPDATE';"), []);
});

test('DDL, migration, triggers and whole database snapshot syntax are classified', () => {
  const sql = 'CREATE TABLE "dispatches" (id TEXT); CREATE INDEX ix ON dispatches(id); ALTER TABLE dispatches ADD COLUMN x TEXT; DROP TABLE dispatches; VACUUM INTO ?;';
  const kinds = discoverSource('migrations/999_unknown.sql', sql)[0].mutations.map(x => x.kind);
  assert.deepEqual(kinds, ['CREATE_TABLE', 'CREATE_INDEX', 'ALTER_TABLE', 'DROP_TABLE', 'WHOLE_DATABASE_COPY']);
  assert.deepEqual(mutationHeads('CREATE TRIGGER t AFTER UPDATE ON dispatches BEGIN DELETE FROM dispatches; END;'), [
    { kind: 'CREATE_TRIGGER', target: 'dispatches' }, { kind: 'DELETE', target: 'dispatches' },
  ]);
});

test('REPLACE, INSERT OR REPLACE, CTE UPDATE and quoted SQLite table names are recognized', () => {
  for (const sql of ["REPLACE INTO 'dispatches' VALUES (?)", 'INSERT OR REPLACE INTO [dispatches] VALUES (?)']) {
    assert.deepEqual(mutationHeads(sql), [{ kind: 'INSERT', target: 'dispatches' }]);
  }
  assert.deepEqual(mutationHeads('WITH x AS (SELECT 1) UPDATE dispatches SET state = ?'), [{ kind: 'UPDATE', target: 'dispatches' }]);
});

test('exact source boundary changes fail when admission wrapping is removed but SQL is unchanged', () => {
  const admitted = "function writer(db) { return admission.run('claim', () => db.exec('UPDATE dispatches SET state = 1')); }";
  const first = discoverBoundary('lib/writer.ts', admitted, 'writer');
  const changed = discoverBoundary('lib/writer.ts', admitted.replace("admission.run('claim', () =>", 'unguarded('), 'writer');
  assert.match(compareContract([changed], reviewed([first])).join('\n'), /changed since review/);
});

test('generic retention call additions, including import aliases, require their own review', () => {
  const sites = discoverSource('lib/new.ts', "import {ttlPolicy as cleanup} from './observability/retention-registry.js'; cleanup(db, 'dispatches', 'created_at');");
  assert.deepEqual(sites[0].mutations, [{ kind: 'GENERIC_SQL_CALL', target: 'dispatches' }]);
  assert.match(compareContract(sites, { sites: [] }).join('\n'), /unclassified/);
});

test('lifecycle and bounded-selector declarations have exact independent hashes', () => {
  const a = discoverBoundary('lib/seed.ts', "const TABLES=['dispatches'];", 'TABLES', 'selector');
  const b = discoverBoundary('lib/seed.ts', "const TABLES=['dispatches','nightshift_intents'];", 'TABLES', 'selector');
  assert.match(compareContract([b], reviewed([a])).join('\n'), /changed since review/);
});

test('actual contract declares limitations rather than claiming arbitrary SQL or owner confinement', () => {
  const contract = JSON.parse(readFileSync(new URL('../../' + CONTRACT_PATH, import.meta.url), 'utf8'));
  assert.match(contract.scope, /Source-contract audit only/);
  assert.match(contract.scope, /generated SQL/);
  assert.match(contract.scope, /privileged DB-owner/);
});


test('clock-trigger deletion, index removal and protected-name schema replacement require review', () => {
  assert.deepEqual(mutationHeads('DROP TRIGGER dispatch_admission_update; DROP INDEX idx_dispatches_state; ALTER TABLE replacement RENAME TO dispatches; CREATE VIEW dispatches AS SELECT 1;'), [
    {kind: 'DROP_TRIGGER', target: 'dispatch_admission_update'},
    {kind: 'DROP_INDEX', target: 'idx_dispatches_state'},
    {kind: 'RENAME_TO', target: 'dispatches'},
    {kind: 'CREATE_VIEW', target: 'dispatches'},
  ]);
});
