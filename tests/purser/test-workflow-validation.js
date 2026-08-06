const fs = require('fs');
const { execSync } = require('child_process');

describe('Workflow Validation', () => {
  test('Should detect changed PDFs', () => {
    execSync('git add website-v2/public/whitepaper/coordination-papers-mega-volume.pdf');
    const output = execSync('sh scripts/build-whitepapers.sh', { env: { ...process.env, GITHUB_EVENT_NAME: 'pull_request' } }).toString();
    expect(output).toContain('Published PDFs differ');
  });

  test('Should skip if PDFs are up to date', () => {
    const output = execSync('sh scripts/build-whitepapers.sh', { env: { ...process.env, GITHUB_EVENT_NAME: 'pull_request' } }).toString();
    expect(output).toContain('All in-scope published PDFs match');
  });
});