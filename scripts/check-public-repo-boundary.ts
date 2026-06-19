import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type BoundaryConfig = {
  version: number;
  purpose: string;
  denylistedTrackedPathRegexes: string[];
  requiredGitignoreEntries: string[];
};

const repoRoot = resolve(new URL('..', import.meta.url).pathname);
const configPath = resolve(repoRoot, 'config/public-repo-boundary.json');
const gitignorePath = resolve(repoRoot, '.gitignore');

function readConfig(): BoundaryConfig {
  return JSON.parse(readFileSync(configPath, 'utf8'));
}

function listTrackedFiles(): string[] {
  const output = execFileSync('git', ['ls-files'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return output.split('\n').map((line) => line.trim()).filter(Boolean);
}

function main() {
  const config = readConfig();
  const trackedFiles = listTrackedFiles();
  const patterns = config.denylistedTrackedPathRegexes.map((pattern) => new RegExp(pattern));
  const leakedFiles = trackedFiles.filter((file) => patterns.some((pattern) => pattern.test(file)));

  const gitignore = readFileSync(gitignorePath, 'utf8');
  const missingIgnoreEntries = config.requiredGitignoreEntries.filter((entry) => !gitignore.includes(entry));

  if (leakedFiles.length > 0 || missingIgnoreEntries.length > 0) {
    console.error('Public repo boundary check failed.');

    if (leakedFiles.length > 0) {
      console.error('\nTracked files that violate the denylist:');
      for (const file of leakedFiles) {
        console.error(`- ${file}`);
      }
    }

    if (missingIgnoreEntries.length > 0) {
      console.error('\n.gitignore entries missing for local-only residue:');
      for (const entry of missingIgnoreEntries) {
        console.error(`- ${entry}`);
      }
    }

    process.exit(1);
  }

  console.log('Public repo boundary check passed.');
  console.log(`Checked ${trackedFiles.length} tracked paths against ${patterns.length} denylist patterns.`);
}

main();
