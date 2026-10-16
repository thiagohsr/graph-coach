import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithQuery } from '~/test/render';

vi.mock('@tanstack/react-router', async (orig) => (await import('~/test/router-mock')).routerMock(await orig()));

const createSession = vi.fn();
const submitSession = vi.fn();
vi.mock('~/lib/api/gameplay', () => ({
  createSession: (...a: unknown[]) => createSession(...a),
  submitSession: (...a: unknown[]) => submitSession(...a),
}));

import { playPuzzle, submitResult } from './fixtures';
import { PlayBoard } from './PlayBoard';

const blank = (sentence: number, n: number, k: number, state: string) =>
  screen.getByRole('button', { name: `Sentence ${sentence}, blank ${n} of ${k}, ${state}` });
const word = (name: string | RegExp) => screen.getByRole('button', { name });
// The board's own live region (dnd-kit adds an empty one of its own, which stays silent).
const status = () => {
  const ours = screen.getAllByRole('status').find((el) => el.classList.contains('sr-only'));
  if (!ours) throw new Error('board live region not found');
  return ours;
};

/** Keyboard only: focus an element, then press keys. */
function setup() {
  const user = userEvent.setup();
  renderWithQuery(<PlayBoard puzzle={playPuzzle} />);
  return user;
}

beforeEach(() => {
  window.sessionStorage.clear();
  createSession.mockReset().mockResolvedValue({ sessionId: 's-1' });
  submitSession.mockReset().mockResolvedValue(submitResult);
});

describe('PlayBoard (keyboard)', () => {
  it('renders blanks and words as buttons with the contract names, and a described hint', () => {
    setup();
    expect(blank(1, 1, 2, 'empty')).toBeInTheDocument();
    expect(blank(1, 2, 2, 'empty')).toBeInTheDocument();
    expect(blank(2, 1, 1, 'empty')).toBeInTheDocument();
    const bank = screen.getByRole('group', { name: 'Word bank' });
    expect(within(bank).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['writes', 'cache', 'index', 'table']);
    expect(screen.getByRole('group', { name: 'Play board' })).toHaveAccessibleDescription(/select a blank and then a word/);
    expect(screen.getByText('0 of 3 blanks filled')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit answers' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear all' })).toBeInTheDocument();
  });

  it('blank then word places the word; the word stays in the bank with its use count', async () => {
    const user = setup();
    blank(1, 1, 2, 'empty').focus();
    await user.keyboard('{Enter}');
    expect(blank(1, 1, 2, 'empty')).toHaveAttribute('aria-pressed', 'true');
    word('index').focus();
    await user.keyboard('{Enter}');
    expect(blank(1, 1, 2, 'filled with index')).toBeInTheDocument();
    expect(word('index, used in 1 blank')).toBeInTheDocument();
    expect(screen.getByText('1 of 3 blanks filled')).toBeInTheDocument();
    expect(status()).toHaveTextContent('Placed index in sentence 1, blank 1.');
  });

  it('word then blank places the word', async () => {
    const user = setup();
    word('cache').focus();
    await user.keyboard(' ');
    expect(word('cache')).toHaveAttribute('aria-pressed', 'true');
    blank(1, 2, 2, 'empty').focus();
    await user.keyboard('{Enter}');
    expect(blank(1, 2, 2, 'filled with cache')).toBeInTheDocument();
  });

  it('lets the same word fill a second blank', async () => {
    const user = setup();
    for (const target of [blank(1, 1, 2, 'empty'), blank(1, 2, 2, 'empty')]) {
      word(/^index/).focus();
      await user.keyboard('{Enter}');
      target.focus();
      await user.keyboard('{Enter}');
    }
    expect(blank(1, 1, 2, 'filled with index')).toBeInTheDocument();
    expect(blank(1, 2, 2, 'filled with index')).toBeInTheDocument();
    expect(word('index, used in 2 blanks')).toBeInTheDocument();
  });

  it('placing on a filled blank replaces the word', async () => {
    const user = setup();
    blank(1, 1, 2, 'empty').focus();
    await user.keyboard('{Enter}');
    word('index').focus();
    await user.keyboard('{Enter}');
    blank(1, 1, 2, 'filled with index').focus();
    await user.keyboard('{Enter}');
    word(/^writes/).focus();
    await user.keyboard('{Enter}');
    expect(blank(1, 1, 2, 'filled with writes')).toBeInTheDocument();
    expect(status()).toHaveTextContent('Replaced index with writes in sentence 1, blank 1.');
    expect(word('index')).toBeInTheDocument();
  });

  it('Backspace clears a filled blank and keeps focus on it', async () => {
    const user = setup();
    word('table').focus();
    await user.keyboard('{Enter}');
    blank(2, 1, 1, 'empty').focus();
    await user.keyboard('{Enter}');
    const filled = blank(2, 1, 1, 'filled with table');
    filled.focus();
    await user.keyboard('{Backspace}');
    expect(blank(2, 1, 1, 'empty')).toHaveFocus();
    expect(status()).toHaveTextContent('Removed table from sentence 2, blank 1.');
  });

  it('Escape clears the selection', async () => {
    const user = setup();
    blank(1, 1, 2, 'empty').focus();
    await user.keyboard('{Enter}');
    expect(blank(1, 1, 2, 'empty')).toHaveAttribute('aria-pressed', 'true');
    await user.keyboard('{Escape}');
    expect(blank(1, 1, 2, 'empty')).toHaveAttribute('aria-pressed', 'false');
    expect(status()).toHaveTextContent('Selection cleared.');
  });

  it('arrow keys move within the bank (one tab stop)', async () => {
    const user = setup();
    const bank = within(screen.getByRole('group', { name: 'Word bank' }));
    expect(bank.getAllByRole('button').filter((b) => b.tabIndex === 0)).toHaveLength(1);
    word('writes').focus();
    await user.keyboard('{ArrowRight}');
    expect(word('cache')).toHaveFocus();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(word('table')).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(word('writes')).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(word('table')).toHaveFocus();
    expect(word('table')).toHaveAttribute('tabindex', '0');
    expect(word('writes')).toHaveAttribute('tabindex', '-1');
  });

  it('moves focus to the next empty blank after a placement, and to "Submit answers" after the last', async () => {
    const user = setup();
    blank(1, 1, 2, 'empty').focus();
    await user.keyboard('{Enter}'); // select the blank: focus goes to the bank
    expect(word('writes')).toHaveFocus();
    await user.keyboard('{Enter}'); // place "writes"
    expect(blank(1, 2, 2, 'empty')).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(word('writes, used in 1 blank')).toHaveFocus();
    await user.keyboard('{ArrowRight}{Enter}'); // place "cache"
    expect(blank(2, 1, 1, 'empty')).toHaveFocus();

    await user.keyboard('{Enter}');
    await user.keyboard('{Enter}'); // the bank stop is still "cache"
    expect(screen.getByRole('button', { name: 'Submit answers' })).toHaveFocus();
    expect(screen.getByText('3 of 3 blanks filled')).toBeInTheDocument();
  });

  it('asks for confirmation when blanks are empty, and does not submit until confirmed', async () => {
    const user = setup();
    screen.getByRole('button', { name: 'Submit answers' }).focus();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('3 blanks are empty and will count as incorrect.');
    expect(createSession).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Submit anyway' }));
    expect(createSession).toHaveBeenCalledWith('pz-db-101');
    expect(submitSession).toHaveBeenCalledWith('s-1', {
      answers: [
        { questionId: 'q-1', blank: 0, word: null },
        { questionId: 'q-1', blank: 1, word: null },
        { questionId: 'q-2', blank: 0, word: null },
      ],
    });
  });

  it('shows a failure alert with Retry, keeps the placements, and retries with the same session', async () => {
    submitSession.mockRejectedValueOnce(Object.assign(new Error('x'), {}));
    const user = setup();
    word('table').focus();
    await user.keyboard('{Enter}');
    blank(2, 1, 1, 'empty').focus();
    await user.keyboard('{Enter}');
    screen.getByRole('button', { name: 'Submit answers' }).focus();
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('button', { name: 'Submit anyway' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Service unavailable.');
    expect(blank(2, 1, 1, 'filled with table')).toBeInTheDocument();
    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(submitSession).toHaveBeenCalledTimes(2);
  });
});

describe('PlayBoard (long sentence, many blanks)', () => {
  it('keeps every blank an inline button inside its sentence paragraph', () => {
    const words = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'];
    const filler = 'a rather long stretch of explanatory text that has to wrap on a narrow phone screen';
    const sentence = `${words.map(() => `${filler} ___`).join(', ')}.`;
    renderWithQuery(
      <PlayBoard puzzle={{ ...playPuzzle, questions: [{ id: 'q-long', order: 1, sentence, blanks: words.length }], wordBank: words }} />,
    );
    const blanks = screen.getAllByRole('button', { name: /^Sentence 1, blank \d+ of 8, empty$/ });
    expect(blanks).toHaveLength(8);
    const paragraph = blanks[0]!.closest('p');
    expect(paragraph).not.toBeNull();
    for (const b of blanks) {
      expect(b.closest('p')).toBe(paragraph);
      expect(b.tagName).toBe('BUTTON');
    }
    expect(screen.getByText('0 of 8 blanks filled')).toBeInTheDocument();
  });
});

describe('PlayBoard (payload guards)', () => {
  it('refuses a sentence whose blank count does not match', () => {
    renderWithQuery(<PlayBoard puzzle={{ ...playPuzzle, questions: [{ id: 'q', order: 1, sentence: 'One ___ only.', blanks: 2 }] }} />);
    expect(screen.getByText('This puzzle cannot be displayed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit answers' })).not.toBeInTheDocument();
  });

  it('shows the empty state for a puzzle with no questions', () => {
    renderWithQuery(<PlayBoard puzzle={{ ...playPuzzle, questions: [] }} />);
    expect(screen.getByText('This puzzle has no questions.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to puzzles' })).toHaveAttribute('href', '/puzzles');
  });
});
