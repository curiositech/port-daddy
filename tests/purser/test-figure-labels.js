const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const FIGURE_PATH = path.join(__dirname, '../../whitepaper/figures/fig-swk-continuity-organs.tex');
const PDF_PATH = path.join(__dirname, '../../website-v2/public/whitepaper/single-writer-kernel-whitepaper.pdf');

describe('Figure Labels Audit', () => {
  it('should verify continuity organs labels match implementation status', () => {
    const texContent = fs.readFileSync(FIGURE_PATH, 'utf-8');
    expect(texContent).toContain('\textsf{partial}');
    expect(texContent).toContain('\bigstar$ the weakest continuity link');
    expect(texContent).toContain('durable commitments, oracle-bound closure');
  });

  it('should validate figure rendering consistency', () => {
    const dom = new JSDOM(fs.readFileSync(PDF_PATH, 'utf-8'));
    const svgElements = dom.window.document.querySelectorAll('svg');
    expect(svgElements.length).toBeGreaterThan(0);
    expect(Array.from(svgElements).some(el => el.getAttribute('data-organ') === 'ledger')).toBe(true);
  });
});