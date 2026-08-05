const fs = require('fs');
const path = require('path');
const { expect } = require('chai');

describe('whitepaper-research-program.md validation', () => {
  const filePath = path.resolve(__dirname, '../../docs/roadmap/whitepaper-research-program.md');
  let content;

  before(() => {
    content = fs.readFileSync(filePath, 'utf-8');
  });

  it('should contain publication-receipt contract section', () => {
    expect(content).to.match(/### Publication receipt contract/);
  });

  it('should have all required fields in publication receipt', () => {
    const requiredFields = [
      'landed source commit',
      'volume edition',
      'mega-volume route',
      'page count',
      'byte count',
      'SHA-256 digest',
      'standalone papers',
      'production library deployment',
      'verification timestamp'
    ];
    requiredFields.forEach(field => expect(content).to.include(field));
  });
});