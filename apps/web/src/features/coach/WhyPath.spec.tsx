import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { path } from './fixtures';

// The graph module is replaced: the list must not depend on it.
vi.mock('./WhyPathGraph', () => ({ default: () => <div>graph stub</div> }));

import { WhyPath } from './WhyPath';

describe('WhyPath', () => {
  it('lists the steps in order, equal to the response', async () => {
    render(<WhyPath path={path} />);
    const items = within(screen.getByRole('list'))
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(items).toEqual(path.steps);
    expect(await screen.findByText('graph stub')).toBeInTheDocument();
  });

  it('labels the graph region and describes it by the list heading', () => {
    render(<WhyPath path={path} />);
    const region = screen.getByRole('region', { name: 'Decision path graph' });
    const heading = screen.getByRole('heading', { name: 'The same path as text' });
    expect(region).toHaveAttribute('aria-describedby', heading.id);
  });

  it('shows the "No evidence was stored" error for an empty path', () => {
    render(<WhyPath path={{ nodes: [], edges: [], steps: [] }} />);
    expect(screen.getByText('No evidence was stored for this decision.')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('collapses identical consecutive lines into one with a count', () => {
    const line = 'Session on Databases 101, 2026-10-16 — 6 wrong answers on these concepts.';
    render(<WhyPath path={{ ...path, steps: ['First.', line, line, line, 'Last.'] }} />);
    const items = within(screen.getByRole('list'))
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(items).toEqual(['First.', `${line} (3 times)`, 'Last.']);
  });
});
