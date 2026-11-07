import Database from 'better-sqlite3';
import { ttlPolicy, maxAgePolicy, capPolicy } from '../../lib/observability/retention-registry.js';

let db;
beforeEach(() => {
  db = new Database(':memory:');
  for (const table of ['dispatches', 'nightshift_intents', 'dispatch_admission_authority', 'dispatch_admission_events', 'dispatch_admission_future', 'ordinary_events']) {
    db.exec(`CREATE TABLE ${table} (id INTEGER PRIMARY KEY, created_at INTEGER); INSERT INTO ${table} VALUES (1, 1), (2, 2)`);
  }
});
afterEach(() => db.close());
const builders = [
  ['ttl', (table, column = 'created_at') => ttlPolicy(db, table, column)],
  ['age', (table, column = 'created_at') => maxAgePolicy(db, table, column, 1)],
  ['cap', (table, column = 'created_at') => capPolicy(db, table, column, 1)],
];

describe.each(builders)('%s retention boundary', (_name, build) => {
  test.each(['dispatches', 'DISPATCHES', 'nightshift_intents', 'dispatch_admission_authority', 'dispatch_admission_events', 'dispatch_admission_future'])('refuses protected control table %s', (table) => {
    expect(() => build(table)).toThrow(/dispatch control table/);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n).toBe(2);
  });
  test.each(['main.dispatches', '"dispatches"', '[dispatches]', 'dispatches -- disguise'])('refuses identifier disguise %s', (table) => {
    expect(() => build(table)).toThrow(/identifier/);
    expect(db.prepare('SELECT COUNT(*) AS n FROM dispatches').get().n).toBe(2);
  });
  test('still prunes an ordinary table', () => {
    expect(build('ordinary_events').sweep(3)).toBeGreaterThan(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM dispatches').get().n).toBe(2);
  });
  test('rejects a column expression before preparing SQL', () => {
    expect(() => build('ordinary_events', 'created_at OR 1=1')).toThrow(/identifier/);
  });
});
