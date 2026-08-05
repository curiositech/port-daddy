import { execSync } from 'child_process';

describe('PDF reproducibility', () => {
  test('pdflatex must compile without errors', () => {
    try {
      execSync('cd ../../whitepaper && pdflatex -interaction=nonstopmode legible-swarm.tex', { stdio: 'pipe' });
      expect(true).toBe(true);
    } catch (error) {
      expect(error).toBeUndefined();
    }
  });
});