const fs = require('fs');
const path = require('path');

const FIGURE_PATH = path.join(__dirname, '../../whitepaper/figures/fig-swk-continuity-organs.tex');
const WHITEPAPER_PATH = path.join(__dirname, '../../whitepaper/single-writer-kernel.tex');

describe('Documentation Coverage Validation', () => {
  it('should verify all continuity organs are accurately described', () => {
    const figureContent = fs.readFileSync(FIGURE_PATH, 'utf-8');
    const whitepaperContent = fs.readFileSync(WHITEPAPER_PATH, 'utf-8');

    // Check checkpoint status
    expect(figureContent).to.match(/\textsf{partial}/);
    expect(whitepaperContent).to.match(/\BuiltWeak/);
    expect(whitepaperContent).to.match(/recovery passes durable \emph{notes}/);

    // Check witnessed-outcome ledger status
    expect(figureContent).to.match(/\textsf{partial}/);
    expect(whitepaperContent).to.match(/durable commitments, daemon-derived deadlines/);
    expect(whitepaperContent).to.not.match(/neutral graded outcomes/);

    // Check non-forgeable identity status
    expect(whitepaperContent).to.match(/\BuiltWeak/);
    expect(whitepaperContent).to.match(/bounded gate ships/);
    expect(whitepaperContent).to.match(/universal write-boundary enforcement absent/);
  });
});