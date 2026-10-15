import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { path } from './fixtures';

vi.mock('./WhyPathGraph', () => {
  throw new Error('chunk failed to load');
});

import { WhyPath } from './WhyPath';

describe('WhyPath when the graph code does not load', () => {
  it('renders the list on the first render, without the graph module', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<WhyPath path={path} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(path.steps.length);
    spy.mockRestore();
  });

  it('keeps the list and shows a note after the import fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<WhyPath path={path} />);
    expect(await screen.findByText(/The graph is unavailable/)).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(path.steps.length);
    spy.mockRestore();
  });
});
