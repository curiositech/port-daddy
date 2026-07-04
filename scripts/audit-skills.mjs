#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const DEFAULT_ROOTS = ['skills', '.codex/skills'];

function parseArgs(argv) {
  const opts = { json: false, roots: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--root') {
      const next = argv[i + 1];
      if (!next) throw new Error('--root requires a path');
      opts.roots.push(next);
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (opts.roots.length === 0) opts.roots = DEFAULT_ROOTS;
  return opts;
}

function walkSkillFiles(root) {
  const absRoot = join(ROOT, root);
  if (!existsSync(absRoot)) return [];

  const found = [];
  const stack = [absRoot];

  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
        continue;
      }
      if (entry.isFile() && entry.name === 'SKILL.md') {
        found.push(abs);
      }
    }
  }

  return found.sort();
}

function parseFrontmatter(contents) {
  const match = contents.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { raw: '', fields: new Set() };

  const fields = new Set();
  for (const line of match[1].split('\n')) {
    const field = line.match(/^([A-Za-z0-9_-]+):/);
    if (field) fields.add(field[1]);
  }
  return { raw: match[1], fields };
}

function classifySkill(relPath, frontmatter) {
  if (/metadata:\n[\s\S]*provenance:\n[\s\S]*kind:\s*first-party/.test(frontmatter.raw)) {
    return 'first-party';
  }
  if (relPath.startsWith('.codex/')) return 'repo-local';
  if (/\/(fipa-|hong-|huang-|nisan-|ongaro-|sagas-|smith-|wang-|wu-|hoare-|tlaplus|proverif|ostrom|mechanism-design|distributed-algorithms|empirical-systems|olog-)/.test(`/${relPath}`)) {
    return 'imported-literature';
  }
  return 'unclassified';
}

export function auditSkills({ roots = DEFAULT_ROOTS } = {}) {
  const skillFiles = roots.flatMap(walkSkillFiles);
  const skills = skillFiles.map((absPath) => {
    const relPath = relative(ROOT, absPath);
    const contents = readFileSync(absPath, 'utf8');
    const frontmatter = parseFrontmatter(contents);
    const required = ['name', 'description', 'license', 'allowed-tools', 'metadata'];
    const missing = required.filter((field) => !frontmatter.fields.has(field));
    const hasChangelog = existsSync(join(absPath, '..', 'CHANGELOG.md'));
    const hasOpenAiAgent = existsSync(join(absPath, '..', 'agents', 'openai.yaml'));
    const referencesDir = join(absPath, '..', 'references');
    const hasReferences = existsSync(referencesDir) && statSync(referencesDir).isDirectory();

    return {
      path: relPath,
      class: classifySkill(relPath, frontmatter),
      bytes: contents.length,
      missing,
      hasChangelog,
      hasOpenAiAgent,
      hasReferences,
    };
  });

  const summary = {
    total: skills.length,
    missingGovernance: skills.filter((skill) => skill.missing.length > 0).length,
    firstParty: skills.filter((skill) => skill.class === 'first-party').length,
    importedLiterature: skills.filter((skill) => skill.class === 'imported-literature').length,
    repoLocal: skills.filter((skill) => skill.class === 'repo-local').length,
    unclassified: skills.filter((skill) => skill.class === 'unclassified').length,
  };

  return { summary, skills };
}

function printMarkdown(report) {
  console.log('# Skill Governance Audit');
  console.log('');
  console.log(`Total skills: ${report.summary.total}`);
  console.log(`Missing governance fields: ${report.summary.missingGovernance}`);
  console.log(`First-party: ${report.summary.firstParty}`);
  console.log(`Imported literature: ${report.summary.importedLiterature}`);
  console.log(`Repo-local: ${report.summary.repoLocal}`);
  console.log(`Unclassified: ${report.summary.unclassified}`);
  console.log('');
  console.log('| Path | Class | Missing | Changelog | References |');
  console.log('|---|---|---|---|---|');
  for (const skill of report.skills) {
    const missing = skill.missing.length > 0 ? skill.missing.join(', ') : '-';
    console.log(`| ${skill.path} | ${skill.class} | ${missing} | ${skill.hasChangelog ? 'yes' : 'no'} | ${skill.hasReferences ? 'yes' : 'no'} |`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const report = auditSkills({ roots: opts.roots });
    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printMarkdown(report);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
