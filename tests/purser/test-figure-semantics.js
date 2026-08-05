const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const FIGURE_PATH = path.join(__dirname, '../../whitepaper/figures/fig-swk-continuity-organs.tex');
const PDF_PATH = path.join(__dirname, '../../website-v2/public/whitepaper/single-writer-kernel-whitepaper.pdf');

describe('Figure Semantic Audit', () => {
  it('should validate figure semantics match code documentation', () => {
    const texContent = fs.readFileSync(FIGURE_PATH, 'utf-8');
    expect(texContent).toContain('durable, oracle-bound record');
    expect(texContent).toContain('checkpoint with teeth (a real execution-state');
    expect(texContent).toContain('reputation keys on the richer third organ');
  });

  it('should verify figure-text semantic alignment', () => {
    const dom = new JSDOM(fs.readFileSync(PDF_PATH, 'utf-8'));
    const textElements = dom.window.document.querySelectorAll('text');
    expect(Array.from(textElements).some(el => el.textContent.includes('weakest continuity link'))).toBe(true);
    expect(Array.from(textElements).some(el => el.textContent.includes('durable commitments'))).toBe(true);
  });
});