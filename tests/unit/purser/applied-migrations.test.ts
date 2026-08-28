// tests/unit/purser/applied-migrations.test.ts
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve paths relative to the repository root
const REPO_ROOT = path.resolve(__dirname, '../../..');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'apps', 'relay', 'migrations');
const APPLIED_JSON_PATH = path.join(MIGRATIONS_DIR, 'applied-staging.json');

// Simple ISO‑8601 UTC validator (YYYY‑MM‑DDTHH:MM:SSZ)
const ISO_8601_UTC_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

type MigrationRecord = {
  file: string;
  appliedAt: string;
};

describe('applied-staging.json contract', () => {
  let appliedMigrations: MigrationRecord[] = [];
  let migrationFiles: string[] = [];

  beforeAll(async () => {
    // Load and parse the JSON file – will throw if syntax is invalid
    const rawJson = await fs.readFile(APPLIED_JSON_PATH, 'utf-8');
    const parsed = JSON.parse(rawJson);
    if (!Array.isArray(parsed)) {
      throw new Error('applied-staging.json must export a JSON array');
    }
    appliedMigrations = parsed as MigrationRecord[];

    // List all migration script files (exclude the JSON itself)
    const dirEntries = await fs.readdir(MIGRATIONS_DIR, { withFileTypes: true });
    migrationFiles = dirEntries
      .filter((de) => de.isFile())
      .map((de) => de.name)
      .filter((name) => name !== 'applied-staging.json');
  });

  test('JSON parses without syntax errors and is an array', () => {
    expect(Array.isArray(appliedMigrations)).toBe(true);
  });

  test('each record contains required keys', () => {
    for (const rec of appliedMigrations) {
      expect(rec).toHaveProperty('file');
      expect(rec).toHaveProperty('appliedAt');
      expect(typeof rec.file).toBe('string');
      expect(typeof rec.appliedAt).toBe('string');
    }
  });

  test('all timestamps follow ISO‑8601 UTC format', () => {
    for (const rec of appliedMigrations) {
      expect(ISO_8601_UTC_REGEX.test(rec.appliedAt)).toBe(
        true,
      );
    }
  });

  test('no duplicate migration entries in applied-staging.json', () => {
    const seen = new Set<string>();
    for (const rec of appliedMigrations) {
      expect(seen.has(rec.file)).toBe(false);
      seen.add(rec.file);
    }
  });

  test('every migration script file is recorded exactly once', () => {
    const recordedSet = new Set(appliedMigrations.map((r) => r.file));

    // All files must be present
    for (const file of migrationFiles) {
      expect(recordedSet.has(file)).toBe(
        true,
      );
    }

    // No extra entries (recorded files must be a subset of actual files)
    for (const recorded of recordedSet) {
      expect(migrationFiles).toContain(recorded);
    }
  });
});