#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const baselinePath = new URL('./npm-audit-baseline.json', import.meta.url);

export function highSeverityAdvisories(report) {
  const advisories = new Map();
  for (const vulnerability of Object.values(report?.vulnerabilities ?? {})) {
    for (const via of vulnerability.via ?? []) {
      if (typeof via !== 'object' || !['high', 'critical'].includes(via.severity)) continue;
      advisories.set(String(via.source), {
        id: String(via.source),
        package: via.name,
        severity: via.severity,
        url: via.url,
      });
    }
  }
  return [...advisories.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function compareAuditBaseline(current, baseline) {
  const currentById = new Map(current.map((item) => [item.id, item]));
  const baselineById = new Map(baseline.map((item) => [item.id, item]));
  return {
    added: current.filter((item) => !baselineById.has(item.id)),
    resolved: baseline.filter((item) => !currentById.has(item.id)),
    changed: current.filter((item) => {
      const prior = baselineById.get(item.id);
      return prior && (
        prior.package !== item.package || prior.severity !== item.severity || prior.url !== item.url
      );
    }),
  };
}

export function main() {
  const audit = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8' });
  if (audit.error || audit.status === null || ![0, 1].includes(audit.status)) {
    console.error(audit.stderr || audit.error?.message || `npm audit exited ${audit.status}`);
    return 1;
  }

  let report;
  let baseline;
  try {
    report = JSON.parse(audit.stdout);
    baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  } catch (error) {
    console.error(`Could not parse npm audit evidence: ${error.message}`);
    return 1;
  }

  const current = highSeverityAdvisories(report);
  const delta = compareAuditBaseline(current, baseline);
  for (const item of current) {
    console.warn(`KNOWN ${item.severity}: ${item.package} ${item.url} (audit ${item.id})`);
  }
  for (const item of delta.added) {
    console.error(`NEW ${item.severity}: ${item.package} ${item.url} (audit ${item.id})`);
  }
  for (const item of delta.resolved) {
    console.error(`STALE BASELINE: audit ${item.id} is no longer present; remove its exception`);
  }
  for (const item of delta.changed) {
    console.error(`CHANGED ADVISORY: audit ${item.id} no longer matches its reviewed baseline record`);
  }

  if (delta.added.length || delta.resolved.length || delta.changed.length) return 1;
  console.log(`npm audit baseline matched: ${current.length} known high/critical advisories, 0 new.`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main());
}
