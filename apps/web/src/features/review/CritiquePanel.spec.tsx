import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CritiquePanel } from './CritiquePanel';
import { PassagePanel } from './PassagePanel';

describe('CritiquePanel', () => {
  it("shows the critic's verdict and note under \"Critic's check\"", () => {
    render(<CritiquePanel draft={{ critique: { verdict: 'rewrite', note: 'Too easy to guess.' } }} />);
    const region = screen.getByRole('region', { name: "Critic's check" });
    expect(within(region).getByRole('heading', { name: "Critic's check" })).toBeInTheDocument();
    expect(within(region).getByText('rewrite')).toBeInTheDocument();
    expect(within(region).getByText('Too easy to guess.')).toBeInTheDocument();
  });

  it('says so when no critique was recorded', () => {
    render(<CritiquePanel draft={{ critique: null }} />);
    expect(screen.getByText('No critic note was recorded.')).toBeInTheDocument();
  });

  it('the passage panel of an upload draft shows the passage and no critique', () => {
    render(<PassagePanel draft={{ passage: { chunkId: 'c-1', text: 'An index speeds up lookups.' } }} />);
    expect(screen.getByRole('region', { name: 'Source passage' })).toHaveTextContent('An index speeds up lookups.');
    expect(screen.queryByRole('region', { name: "Critic's check" })).not.toBeInTheDocument();
  });
});
