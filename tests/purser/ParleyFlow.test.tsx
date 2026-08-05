import { render, screen, fireEvent } from '@testing-library/react';
import '@xyflow/react/dist/style.css';
import ParleyFlow from '@/src/components/viz/ParleyFlow';

jest.mock('@/src/lib/theme-context', () => ({ useTheme: () => ({ theme: 'light' }) }));

describe('ParleyFlow', () => {
  it('renders six nodes with correct positions and themes', () => {
    render(<ParleyFlow />);
    const nodes = screen.getAllByTestId('parley-node');
    expect(nodes).toHaveLength(6);
    // Check specific node positions based on parleyData.tsx
    expect(nodes[0]).toHaveStyle({ left: '360px', top: '0px' });
    expect(nodes[1]).toHaveStyle({ left: '20px', top: '300px' });
    expect(nodes[2]).toHaveStyle({ left: '700px', top: '300px' });
    expect(nodes[3]).toHaveStyle({ left: '20px', top: '640px' });
    expect(nodes[4]).toHaveStyle({ left: '700px', top: '640px' });
    expect(nodes[5]).toHaveStyle({ left: '360px', top: '980px' });
  });

  it('applies correct role hues for light theme', () => {
    render(<ParleyFlow />);
    const nodes = screen.getAllByTestId('parley-node');
    expect(nodes[0]).toHaveStyle({ background: '#2f6fd6' });
    expect(nodes[1]).toHaveStyle({ background: '#0e8f7f' });
    expect(nodes[2]).toHaveStyle({ background: '#2f9e57' });
    expect(nodes[3]).toHaveStyle({ background: '#b56a1e' });
    expect(nodes[4]).toHaveStyle({ background: '#a349b5' });
    expect(nodes[5]).toHaveStyle({ background: '#7f8500' });
  });

  it('handles common-fate hover interaction', () => {
    render(<ParleyFlow />);
    const node = screen.getByTestId('parley-node-peer1');
    fireEvent.mouseEnter(node);
    expect(screen.getAllByTestId('parley-edge')).toHaveLength(2);
    fireEvent.mouseLeave(node);
    expect(screen.getAllByTestId('parley-edge')).toHaveLength(6);
  });
});