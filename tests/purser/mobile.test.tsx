import { render, screen } from '@testing-library/react';
import ParleyFlow from '@/src/components/viz/ParleyFlow';

describe('Mobile Responsiveness', () => {
  it('renders vertical card stack on small screens', () => {
    window.innerWidth = 320;
    render(<ParleyFlow />);
    const nodes = screen.getAllByTestId('parley-node');
    expect(nodes).toHaveLength(6);
    nodes.forEach(node => {
      expect(node).toHaveStyle({ position: 'static' });
      expect(node).toHaveStyle({ width: '100%' });
    });
  });
});