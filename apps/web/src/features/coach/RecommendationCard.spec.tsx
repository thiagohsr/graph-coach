import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '~/lib/api/errors';

vi.mock('@tanstack/react-router', async (orig) =>
  (await import('~/test/router-mock')).routerMock(await orig()),
);

import { recommendation } from './fixtures';
import { CoachError, RecommendationCard } from './RecommendationCard';

describe('RecommendationCard', () => {
  it('shows target, verbatim summary, puzzle with Play, alternatives and the Why this? link', () => {
    render(<RecommendationCard recommendation={recommendation} />);
    expect(screen.getByRole('heading', { name: 'B-trees' })).toBeInTheDocument();
    expect(screen.getByText(recommendation.summary)).toBeInTheDocument();
    expect(screen.getByText('Databases 101: Storage and B-trees')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Play Databases 101: Storage and B-trees' }),
    ).toHaveAttribute('href', '/puzzles/pz-1/play');
    expect(screen.getByText('Transactions')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Why this?' })).toHaveAttribute(
      'href',
      '/decisions/dec-1',
    );
    expect(screen.queryByText('Reused from a recent decision')).not.toBeInTheDocument();
  });

  it('shows the no-puzzle and no-alternatives texts, and "No specific concept" without a target', () => {
    render(
      <RecommendationCard
        recommendation={{ ...recommendation, puzzle: null, target: null, alternatives: [] }}
      />,
    );
    expect(screen.getByText('No puzzle is available for this yet')).toBeInTheDocument();
    expect(screen.getByText('No alternatives were considered')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'No specific concept' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Play/ })).not.toBeInTheDocument();
  });

  it('shows "Reused from a recent decision" when reused', () => {
    render(<RecommendationCard recommendation={{ ...recommendation, reused: true }} />);
    expect(screen.getByText('Reused from a recent decision')).toBeInTheDocument();
  });

  it('shows one notice per known flag and none for an unknown flag', () => {
    render(
      <RecommendationCard
        recommendation={{
          ...recommendation,
          flags: ['unseen', 'repeat', 'brand_new_flag' as never],
        }}
      />,
    );
    expect(screen.getByText('You have not practised this concept yet.')).toBeInTheDocument();
    expect(screen.getByText('You played this puzzle recently.')).toBeInTheDocument();
    expect(screen.queryByText(/brand_new_flag/)).not.toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Notes' }).children).toHaveLength(2);
  });

  it('lists coverage gap concepts and links to the content request', () => {
    render(
      <RecommendationCard
        recommendation={{
          ...recommendation,
          flags: ['coverage_gap', 'coverage_requested'],
          coverageGap: { concepts: [{ conceptId: 'c-1', name: 'Joins' }] },
          coverageTaskId: 'task-9',
        }}
      />,
    );
    expect(screen.getByText('Not enough content yet for:')).toBeInTheDocument();
    expect(screen.getByText('Joins')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Follow the content request' })).toHaveAttribute(
      'href',
      '/tasks/task-9',
    );
  });

  it('has no content-request link without a task id', () => {
    render(
      <RecommendationCard
        recommendation={{
          ...recommendation,
          flags: ['coverage_gap'],
          coverageGap: { concepts: [{ conceptId: 'c-1', name: 'Joins' }] },
        }}
      />,
    );
    expect(
      screen.queryByRole('link', { name: 'Follow the content request' }),
    ).not.toBeInTheDocument();
  });
});

describe('CoachError', () => {
  const err = (status: number, code: string) =>
    new ApiClientError({ status, code: code as never, message: 'm' });

  it('409 NO_PLAYABLE_CONTENT shows the empty message with links and no card', () => {
    render(<CoachError error={err(409, 'NO_PLAYABLE_CONTENT')} />);
    expect(screen.getByText('There is nothing to practise yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create a puzzle' })).toHaveAttribute(
      'href',
      '/sources/new',
    );
    expect(screen.getByRole('link', { name: 'Browse puzzles' })).toHaveAttribute(
      'href',
      '/puzzles',
    );
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('503 GRAPH_UNAVAILABLE shows its message with Retry', () => {
    const retry = vi.fn();
    render(<CoachError error={err(503, 'GRAPH_UNAVAILABLE')} onRetry={retry} />);
    expect(
      screen.getByText(
        'The Coach needs the knowledge graph, which is unavailable. No recommendation was made.',
      ),
    ).toBeInTheDocument();
    screen.getByRole('button', { name: 'Retry' }).click();
    expect(retry).toHaveBeenCalled();
  });

  it('503 DECISION_NOT_RECORDED shows its message', () => {
    render(<CoachError error={err(503, 'DECISION_NOT_RECORDED')} onRetry={() => {}} />);
    expect(
      screen.getByText('The Coach could not store its evidence, so no recommendation was made.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });
});
