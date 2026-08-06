const fs = require('fs');

describe('Appendices Inclusion', () => {
  test('Should include status appendix', () => {
    const texContent = fs.readFileSync('website-v2/public/whitepaper/coordination-papers-mega-volume-appendices.tex', 'utf-8');
    expect(texContent).toContain('\section{Consolidated implementation and assurance ledger}');
  });

  test('Should include roadmap appendix', () => {
    const texContent = fs.readFileSync('website-v2/public/whitepaper/coordination-papers-mega-volume-appendices.tex', 'utf-8');
    expect(texContent).toContain('\section{Research and engineering roadmap}');
  });
});