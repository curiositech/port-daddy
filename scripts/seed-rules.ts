import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { initDatabase } from '../lib/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, '../port-registry.db');
const db = initDatabase({ dbPath });

db.exec(`
  CREATE TABLE IF NOT EXISTS orchestrator_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT, 
    name TEXT NOT NULL, 
    channel_pattern TEXT NOT NULL, 
    condition TEXT, 
    action TEXT NOT NULL, 
    payload TEXT NOT NULL, 
    enabled INTEGER DEFAULT 1
  );
`);

const rules = [
  {
    name: 'Auto-Lint',
    channel_pattern: 'fs:changed',
    condition: '.ts',
    action: 'exec',
    payload: JSON.stringify({ cmd: 'npm run lint' }),
    enabled: 1
  },
  {
    name: 'Lint-Fixer',
    channel_pattern: 'lint:failed',
    condition: null,
    action: 'spawn',
    payload: JSON.stringify({ task: 'Fix lint errors in {{msg}}', identity: 'pd:coder:fixer' }),
    enabled: 1
  }
];

const insert = db.prepare('INSERT INTO orchestrator_rules (name, channel_pattern, condition, action, payload, enabled) VALUES (?, ?, ?, ?, ?, ?)');

for (const rule of rules) {
  const existing = db.prepare('SELECT id FROM orchestrator_rules WHERE name = ?').get(rule.name);
  if (!existing) {
    insert.run(rule.name, rule.channel_pattern, rule.condition, rule.action, rule.payload, rule.enabled);
    console.log(`Seeded rule: ${rule.name}`);
  }
}
