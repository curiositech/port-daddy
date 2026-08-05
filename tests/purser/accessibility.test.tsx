import { render, screen } from '@testing-library/react';
import ParleyFlow from '@/src/components/viz/ParleyFlow';

describe('Accessibility', () => {
  it('has proper ARIA labels for nodes', () => {
    render(<ParleyFlow />);
    const nodes = screen.getAllByRole('treeitem');
    nodes.forEach(node => {
      expect(node).toHaveAttribute('aria-label');
    });
  });

  it('respects prefers-reduced-motion', () => {
    jest.spyOn(window, 'matchMedia').mockImplementation(query => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn()
    }));
    render(<ParleyFlow />);
    const edges = screen.getAllByTestId('parley-edge');
    edges.forEach(edge => {
      expect(edge).toHaveStyle({ animation: 'none' });
    });
  });
});