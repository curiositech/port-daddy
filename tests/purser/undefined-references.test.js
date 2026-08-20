const fs = require('fs');
const path = require('path');

const logPath = 'website-v2/public/whitepaper/legible-swarm-whitepaper.pdf.log';

describe('Undefined references check', () => {
  test('No undefined references in final PDF logs', () => {
    const content = fs.readFileSync(path.resolve(__dirname, '../../', logPath), 'utf-8');
    expect(content).not.toMatch(/undefined reference/);
    expect(content).not.toMatch(/missing citation/);
    expect(content).not.toMatch(/overfull box/);
  });
});