import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', async (orig) =>
  (await import('~/test/router-mock')).routerMock(await orig()),
);

import { MasteryList } from './MasteryList';

const items = [
  {
    conceptId: 'c-b',
    name: 'B-trees',
    score: 0.8,
    attempts: 3,
    lastSeen: '2026-10-11T14:03:22.000Z',
  },
  {
    conceptId: 'c-a',
    name: 'Indexes',
    score: 0.25,
    attempts: 1,
    lastSeen: '2026-10-10T10:00:00.000Z',
  },
];

describe('MasteryList', () => {
  it('lists the weakest concept first with meter semantics and the value as text', () => {
    render(<MasteryList items={items} />);
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Indexes');
    const meter = within(rows[0]!).getByRole('meter', { name: 'Indexes' });
    expect(meter).toHaveAttribute('aria-valuemin', '0');
    expect(meter).toHaveAttribute('aria-valuemax', '1');
    expect(meter).toHaveAttribute('aria-valuenow', '0.25');
    expect(rows[0]).toHaveTextContent('25%');
    expect(rows[0]).toHaveTextContent('1 attempt');
    expect(rows[1]).toHaveTextContent('B-trees');
  });

  it('shows the empty state with a link to the puzzles', () => {
    render(<MasteryList items={[]} />);
    expect(screen.getByText('Play a puzzle to start building your mastery.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to puzzles' })).toHaveAttribute('href', '/puzzles');
  });
});
