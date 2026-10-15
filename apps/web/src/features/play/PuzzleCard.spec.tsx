import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PuzzleSummary } from '~/lib/api/gameplay-schemas';

vi.mock('@tanstack/react-router', async (orig) => (await import('~/test/router-mock')).routerMock(await orig()));

import { summaries } from './fixtures';
import { PuzzleCard } from './PuzzleCard';

const [publicPuzzle, sharedPuzzle] = summaries as [PuzzleSummary, PuzzleSummary];
const owned: PuzzleSummary = { ...publicPuzzle, access: 'owner', visibility: 'private', ownerName: 'Me' };

describe('PuzzleCard', () => {
  it('marks an owned puzzle "Yours"', () => {
    render(<PuzzleCard puzzle={owned} />);
    expect(screen.getByText('Yours')).toBeInTheDocument();
  });

  it('marks an owned public puzzle "Yours · Public"', () => {
    render(<PuzzleCard puzzle={{ ...owned, visibility: 'public' }} />);
    expect(screen.getByText('Yours · Public')).toBeInTheDocument();
  });

  it('marks a shared puzzle with the owner name, and a public one "Public"', () => {
    const { unmount } = render(<PuzzleCard puzzle={sharedPuzzle} />);
    expect(screen.getByText('Shared by Bea Souza')).toBeInTheDocument();
    unmount();
    render(<PuzzleCard puzzle={publicPuzzle} />);
    expect(screen.getByText('Public')).toBeInTheDocument();
  });

  it('shows "Source available" linked to the source when the item carries sourceId', () => {
    render(<PuzzleCard puzzle={sharedPuzzle} />);
    expect(screen.getByRole('link', { name: 'Source available' })).toHaveAttribute('href', '/sources/src-3');
  });

  it('shows plain "Source not shared" with no link when the source is not shared', () => {
    const { sourceId: _sourceId, ...rest } = sharedPuzzle;
    render(<PuzzleCard puzzle={{ ...rest, sourceShared: false }} />);
    expect(screen.getByText('Source not shared')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Source/ })).not.toBeInTheDocument();
  });

  it('shows no source text for a public puzzle', () => {
    render(<PuzzleCard puzzle={publicPuzzle} />);
    expect(screen.queryByText(/Source/)).not.toBeInTheDocument();
  });

  it('shows name, question count, concepts, and a Play link to the play route', () => {
    render(<PuzzleCard puzzle={publicPuzzle} />);
    expect(screen.getByRole('heading', { name: 'Databases 101' })).toBeInTheDocument();
    expect(screen.getByText('6 questions')).toBeInTheDocument();
    expect(screen.getByText('Concepts: Indexes, B-trees')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Play Databases 101' })).toHaveAttribute('href', '/puzzles/pz-db-101/play');
  });

  it('shows the origin of every puzzle, with the prompt notice for a prompt puzzle', () => {
    const { unmount } = render(<PuzzleCard puzzle={publicPuzzle} />);
    expect(screen.getByText('Seeded puzzle')).toBeInTheDocument();
    unmount();
    render(<PuzzleCard puzzle={{ ...owned, origin: 'prompt' }} />);
    expect(screen.getByText('Generated from a prompt, not checked against a source')).toBeInTheDocument();
  });

  it('renders no share or visibility control itself, only what the action slot supplies', () => {
    const { unmount } = render(<PuzzleCard puzzle={owned} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    unmount();
    render(<PuzzleCard puzzle={owned} actions={<button type="button">Share</button>} />);
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
  });
});
