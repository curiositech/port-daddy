// tests/unit/purser/test_excluded_skills_absent.test.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const auditReportPath = join(__dirname, '..', '..', '..', 'metadata', 'audit-report.json');

const auditReportContent = readFileSync(auditReportPath, 'utf-8');
let auditReport: any;
try {
  auditReport = JSON.parse(auditReportContent);
} catch (e) {
  throw new Error(`Failed to parse audit report JSON at ${auditReportPath}: ${e}`);
}

let skillNames: string[] = [];

if (Array.isArray(auditReport.skills)) {
  // Expected format: [{ name: '...', ... }, ...]
  skillNames = auditReport.skills.map((s: any) => s.name);
} else if (auditReport.skills && typeof auditReport.skills === 'object') {
  // Possible format: { 'skill-name': {...}, ... }
  skillNames = Object.keys(auditReport.skills);
} else {
  // Fallback: attempt to find skill names in the whole report
  if (auditReport.name) {
    skillNames = [auditReport.name];
  }
}

describe('Excluded platform-specific skills omitted from catalog', () => {
  it('should not include airflow-dag-orchestrator or android-background-task-specialist', () => {
    const excluded = ['airflow-dag-orchestrator', 'android-background-task-specialist'];
    excluded.forEach((skill) => {
      expect(skillNames).not.toContain(skill);
    });
  });
});