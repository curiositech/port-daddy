const { execSync } = require('child_process');
const path = require('path');

const TEX_DIR = path.join(__dirname, '../../whitepaper');

describe('LaTeX Build Validation', () => {
  it('should produce a clean LaTeX build', () => {
    try {
      execSync(`cd ${TEX_DIR} && latexmk -pdf single-writer-kernel.tex`, { stdio: 'inherit' });
      // Check for overfull boxes
      const logContent = fs.readFileSync(path.join(TEX_DIR, 'single-writer-kernel.log'), 'utf-8');
      expect(logContent).not.to.match(/Overfull/);
      expect(logContent).not.to.match(/Rerun/);
      expect(logContent).not.to.match(/Undefined/);
    } catch (error) {
      throw new Error(`LaTeX build failed: ${error.message}`);
    }
  });
});