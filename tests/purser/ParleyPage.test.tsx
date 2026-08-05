import { render, screen } from '@testing-library/react';
import ParleyPage from '@/src/pages/ParleyPage';

describe('ParleyPage', () => {
  it('matches prose narrative with graph structure', () => {
    render(<ParleyPage />);
    const beats = screen.getAllByTestId('parley-beat');
    expect(beats).toHaveLength(6);
    // Check that each beat's text matches the corresponding node's position
    expect(beats[0].textContent).toContain('Federate, don’t re-tenant');
    expect(beats[1].textContent).toContain('Collision registry');
    expect(beats[2].textContent).toContain('ADR-0118 addendum');
    expect(beats[3].textContent).toContain('Number goes provisional');
    expect(beats[4].textContent).toContain('Adopt the 3-mode vocab');
    expect(beats[5].textContent).toContain('Artifacts reconciled');
  });

  it('disables horizontal scroll on mobile', () => {
    window.innerWidth = 320;
    const { container } = render(<ParleyPage />);
    expect(container.querySelector('.react-flow')).toHaveStyle({ overflowX: 'hidden' });
  });
});