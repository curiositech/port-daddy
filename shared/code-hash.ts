import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';

const ROOT_FILES = ['server.ts'];
const SOURCE_DIRS = ['lib', 'routes', 'shared'];

function walkTypeScriptFiles(rootDir: string, dir: string, out: string[]): void {
  const absoluteDir = join(rootDir, dir);
  if (!existsSync(absoluteDir)) return;

  for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const relativePath = join(dir, entry.name);
    const absolutePath = join(rootDir, relativePath);

    if (entry.isDirectory()) {
      walkTypeScriptFiles(rootDir, relativePath, out);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.ts')) {
      out.push(relative(rootDir, absolutePath));
    }
  }
}

export function listRuntimeSourceFiles(rootDir: string): string[] {
  const files: string[] = [];

  for (const file of ROOT_FILES) {
    const absolutePath = join(rootDir, file);
    if (existsSync(absolutePath)) files.push(file);
  }

  for (const dir of SOURCE_DIRS) {
    walkTypeScriptFiles(rootDir, dir, files);
  }

  return Array.from(new Set(files)).sort();
}

export function calculateRuntimeCodeHash(rootDir: string, length: number = 12): string {
  const hash = createHash('sha256');

  for (const file of listRuntimeSourceFiles(rootDir)) {
    const filePath = join(rootDir, file);
    if (!existsSync(filePath)) continue;
    hash.update(file);
    hash.update('\n');
    hash.update(readFileSync(filePath));
    hash.update('\n');
  }

  return hash.digest('hex').slice(0, length);
}
