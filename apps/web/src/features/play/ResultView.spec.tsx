import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SubmitResult } from '~/lib/api/gameplay-schemas';

vi.mock('@tanstack/react-router', async (orig) =>
  (await import('~/test/router-mock')).routerMock(await orig()),
);

import { submitResult } from './fixtures';
import { ResultView } from './ResultView';

const noPassage: SubmitResult = {
  ...submitResult,
  review: submitResult.review.map(({ passage: _passage, ...rest }) => rest),
};

describe('ResultView', () => {
  it('renders the puzzle name and the score as "score / maxScore" from the response', () => {
    render(<ResultView result={{ ...submitResult, score: 30, maxScore: 50 }} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Databases 101' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('30 / 50');
  });

  it('groups blanks under each question sentence, in order', () => {
    const result: SubmitResult = {
      ...submitResult,
      questions: [
        { id: 'q-2', order: 2, sentence: 'A ___ stores rows.' },
        { id: 'q-1', order: 1, sentence: 'A ___ speeds up lookups at the cost of slower ___.' },
      ],
      review: [
        ...submitResult.review,
        { questionId: 'q-2', blank: 0, submitted: 'table', expected: 'table', correct: true },
      ],
    };
    render(<ResultView result={result} />);
    const items = screen.getAllByRole('listitem').filter((li) => li.querySelector(':scope > ul'));
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('A ___ speeds up lookups at the cost of slower ___.');
    expect(within(items[0]!).getAllByRole('listitem')).toHaveLength(2);
    expect(items[1]).toHaveTextContent('A ___ stores rows.');
    expect(within(items[1]!).getAllByRole('listitem')).toHaveLength(1);
  });

  it('shows submitted (or "left empty"), expected, and Correct / Incorrect as text for each blank', () => {
    render(<ResultView result={submitResult} />);
    const lines = screen
      .getAllByRole('listitem')
      .filter((li) => /Correct|Incorrect/.test(li.textContent ?? '') && !li.querySelector('ul'));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveTextContent('Correct');
    expect(lines[0]).toHaveTextContent('Your answer: Index');
    expect(lines[0]).toHaveTextContent('Expected: index');
    expect(lines[1]).toHaveTextContent('Incorrect');
    expect(lines[1]).toHaveTextContent('Your answer: left empty');
    expect(lines[1]).toHaveTextContent('Expected: writes');
  });

  it('shows the passage excerpt only for a missed blank that carries one, linked to the source', () => {
    render(<ResultView result={submitResult} />);
    expect(screen.getByRole('heading', { name: 'From the source' })).toBeInTheDocument();
    expect(screen.getByText(/Every index must be updated on insert/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open source' })).toHaveAttribute(
      'href',
      '/sources/src-3',
    );
  });

  it('renders no passage heading or source link when the passage is absent', () => {
    render(<ResultView result={noPassage} />);
    expect(screen.queryByRole('heading', { name: 'From the source' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open source' })).not.toBeInTheDocument();
  });

  it('does not show a passage for a correct blank even if one were sent', () => {
    const correctWithPassage: SubmitResult = {
      ...submitResult,
      review: [
        {
          questionId: 'q-1',
          blank: 0,
          submitted: 'index',
          expected: 'index',
          correct: true,
          passage: { chunkId: 'c', sourceId: 's', excerpt: 'x' },
        },
      ],
    };
    render(<ResultView result={correctWithPassage} />);
    expect(screen.queryByRole('link', { name: 'Open source' })).not.toBeInTheDocument();
  });

  it('shows the mastery table with before and after per concept and a text direction', () => {
    render(<ResultView result={submitResult} />);
    const table = screen.getByRole('table', { name: /Mastery/ });
    const row = within(table).getByRole('row', { name: /Indexes/ });
    expect(row).toHaveTextContent('50%');
    expect(row).toHaveTextContent(/4[56]%/);
    expect(row).toHaveTextContent('down');
  });

  it('links to the coach, to play again, and to all puzzles', () => {
    render(<ResultView result={submitResult} />);
    expect(screen.getByRole('link', { name: 'What next?' })).toHaveAttribute('href', '/coach');
    expect(screen.getByRole('link', { name: 'Play again' })).toHaveAttribute(
      'href',
      '/puzzles/pz-db-101/play',
    );
    expect(screen.getByRole('link', { name: 'All puzzles' })).toHaveAttribute('href', '/puzzles');
  });

  it('shows the empty-mastery message and no table', () => {
    render(<ResultView result={{ ...submitResult, mastery: [] }} />);
    expect(
      screen.getByText('No concepts are linked to this puzzle, so mastery did not change.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('labels a prompt puzzle as not checked against a source', () => {
    render(
      <ResultView
        result={{ ...submitResult, puzzle: { ...submitResult.puzzle, origin: 'prompt' } }}
      />,
    );
    expect(
      screen.getByText('Generated from a prompt, not checked against a source'),
    ).toBeInTheDocument();
  });
});
