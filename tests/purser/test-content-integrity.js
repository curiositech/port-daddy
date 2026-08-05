const fs = require('fs');
const path = require('path');

describe('Content Integrity', () => {
  it('should contain no secrets or absolute paths', () => {
    const skillAuditPath = path.join(__dirname, '..', 'website-v2', 'public', 'skill-audit.json');
    const llmsPath = path.join(__dirname, '..', 'website-v2', 'public', 'llms.txt');
    
    const skillAudit = fs.readFileSync(skillAuditPath, 'utf-8');
    const llms = fs.readFileSync(llmsPath, 'utf-8');
    
    // Check for secrets
    expect(skillAudit).not.toMatch(/(token|secret|key|password)/i);
    expect(llms).not.toMatch(/(token|secret|key|password)/i);
    
    // Check for absolute paths
    expect(skillAudit).not.toMatch(/\/home\/|\/Users\/|\/var\/|\/etc\//);
    expect(llms).not.toMatch(/\/home\/|\/Users\/|\/var\/|\/etc\//);
  });
});