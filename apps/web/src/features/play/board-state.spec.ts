import { beforeEach, describe, expect, it } from 'vitest';
import { ApiClientError } from '~/lib/api/errors';
import {
  boardReducer,
  clearDraft,
  createInitialState,
  draftKey,
  draftOf,
  loadDraft,
  restoreDraft,
  saveDraft,
  emptyCount,
  nextEmptySlot,
  slotWord,
  toSubmitRequest,
  useCount,
  type Action,
  type BoardState,
} from './board-state';
import { playPuzzle } from './fixtures';

const S1 = 'q-1:0';
const S2 = 'q-1:1';
const S3 = 'q-2:0';
const [W_WRITES, W_CACHE, W_INDEX] = ['w0', 'w1', 'w2'] as const;

function run(state: BoardState, ...actions: Action[]): BoardState {
  return actions.reduce(boardReducer, state);
}
const fresh = () => createInitialState(playPuzzle);

function keys(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => keys(v, found));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      found.push(k);
      keys(v, found);
    }
  }
  return found;
}

describe('createInitialState', () => {
  it('builds one slot per blank in reading order, with zero-based blank and one-based labels', () => {
    const s = fresh();
    expect(s.slots.map((x) => x.id)).toEqual([S1, S2, S3]);
    expect(s.slots[1]).toMatchObject({ questionId: 'q-1', blank: 1, sentenceNumber: 1, blankNumber: 2, blankCount: 2 });
    expect(s.slots[2]).toMatchObject({ questionId: 'q-2', blank: 0, sentenceNumber: 2, blankNumber: 1 });
    expect(s.words.map((w) => w.text)).toEqual(['writes', 'cache', 'index', 'table']);
    expect(s.words.map((w) => w.id)).toEqual(['w0', 'w1', 'w2', 'w3']);
    expect(s.placements).toEqual({ [S1]: null, [S2]: null, [S3]: null });
    expect(s.status).toBe('editing');
    expect(s.sessionId).toBeNull();
  });

  it('holds no answer, expectation, correctness, or score anywhere', () => {
    const forbidden = ['answers', 'expected', 'correct', 'score'];
    const found = keys(fresh());
    for (const name of forbidden) expect(found).not.toContain(name);
  });

  it('orders questions by `order`, not by array position', () => {
    const reversed = { ...playPuzzle, questions: [...playPuzzle.questions].reverse() };
    expect(createInitialState(reversed).slots.map((x) => x.id)).toEqual([S1, S2, S3]);
  });
});

describe('PLACE (reusable words)', () => {
  it('leaves the word bank unchanged', () => {
    const before = fresh();
    const after = run(before, { type: 'PLACE', wordId: W_INDEX, slotId: S1, via: 'keyboard' });
    expect(after.words).toEqual(before.words);
    expect(slotWord(after, S1)?.text).toBe('index');
  });

  it('lets the same word fill two slots', () => {
    const s = run(
      fresh(),
      { type: 'PLACE', wordId: W_INDEX, slotId: S1, via: 'pointer' },
      { type: 'PLACE', wordId: W_INDEX, slotId: S2, via: 'pointer' },
    );
    expect(slotWord(s, S1)?.id).toBe(W_INDEX);
    expect(slotWord(s, S2)?.id).toBe(W_INDEX);
    expect(useCount(s, W_INDEX)).toBe(2);
  });

  it('replaces a filled slot and touches no other slot', () => {
    const s = run(
      fresh(),
      { type: 'PLACE', wordId: W_INDEX, slotId: S1, via: 'pointer' },
      { type: 'PLACE', wordId: W_CACHE, slotId: S2, via: 'pointer' },
      { type: 'PLACE', wordId: W_WRITES, slotId: S1, via: 'pointer' },
    );
    expect(slotWord(s, S1)?.text).toBe('writes');
    expect(slotWord(s, S2)?.text).toBe('cache');
    expect(s.announcement.text).toBe('Replaced index with writes in sentence 1, blank 1.');
  });

  it('announces a plain placement', () => {
    const s = run(fresh(), { type: 'PLACE', wordId: W_INDEX, slotId: S2, via: 'pointer' });
    expect(s.announcement.text).toBe('Placed index in sentence 1, blank 2.');
  });

  it('increases the announcement seq so identical texts are announced again', () => {
    const a = run(fresh(), { type: 'PLACE', wordId: W_INDEX, slotId: S1, via: 'pointer' });
    const b = run(a, { type: 'PLACE', wordId: W_INDEX, slotId: S1, via: 'pointer' });
    expect(b.announcement.seq).toBeGreaterThan(a.announcement.seq);
    expect(b.placements).toEqual(a.placements);
  });

  it('asks for focus on the next empty slot after a keyboard placement, and on submit after the last', () => {
    let s = run(fresh(), { type: 'PLACE', wordId: W_INDEX, slotId: S1, via: 'keyboard' });
    expect(s.focusRequest?.target).toBe(S2);
    s = run(s, { type: 'PLACE', wordId: W_WRITES, slotId: S2, via: 'keyboard' });
    expect(s.focusRequest?.target).toBe(S3);
    s = run(s, { type: 'PLACE', wordId: W_CACHE, slotId: S3, via: 'keyboard' });
    expect(s.focusRequest?.target).toBe('submit');
  });

  it('asks for no focus change after a pointer placement', () => {
    const s = run(fresh(), { type: 'PLACE', wordId: W_INDEX, slotId: S1, via: 'pointer' });
    expect(s.focusRequest).toBeNull();
  });

  it('ignores an unknown word or slot', () => {
    const before = fresh();
    expect(run(before, { type: 'PLACE', wordId: 'nope', slotId: S1, via: 'pointer' })).toBe(before);
    expect(run(before, { type: 'PLACE', wordId: W_INDEX, slotId: 'nope', via: 'pointer' })).toBe(before);
  });
});

describe('MOVE and REMOVE', () => {
  it('MOVE fills the target and empties the source', () => {
    const s = run(
      fresh(),
      { type: 'PLACE', wordId: W_INDEX, slotId: S1, via: 'pointer' },
      { type: 'MOVE', fromSlotId: S1, toSlotId: S2 },
    );
    expect(slotWord(s, S1)).toBeNull();
    expect(slotWord(s, S2)?.text).toBe('index');
    expect(s.announcement.text).toBe('Moved index to sentence 1, blank 2.');
  });

  it('MOVE onto a filled slot replaces it and says so', () => {
    const s = run(
      fresh(),
      { type: 'PLACE', wordId: W_INDEX, slotId: S1, via: 'pointer' },
      { type: 'PLACE', wordId: W_CACHE, slotId: S2, via: 'pointer' },
      { type: 'MOVE', fromSlotId: S1, toSlotId: S2 },
    );
    expect(slotWord(s, S2)?.text).toBe('index');
    expect(slotWord(s, S1)).toBeNull();
    expect(s.announcement.text).toBe('Moved index to sentence 1, blank 2. Replaced cache.');
  });

  it('MOVE from an empty slot or onto itself changes nothing', () => {
    const placed = run(fresh(), { type: 'PLACE', wordId: W_INDEX, slotId: S1, via: 'pointer' });
    expect(run(placed, { type: 'MOVE', fromSlotId: S2, toSlotId: S3 })).toBe(placed);
    expect(run(placed, { type: 'MOVE', fromSlotId: S1, toSlotId: S1 })).toBe(placed);
  });

  it('REMOVE empties the slot and asks for focus on it', () => {
    const s = run(
      fresh(),
      { type: 'PLACE', wordId: W_INDEX, slotId: S1, via: 'pointer' },
      { type: 'REMOVE', slotId: S1 },
    );
    expect(slotWord(s, S1)).toBeNull();
    expect(s.focusRequest?.target).toBe(S1);
    expect(s.announcement.text).toBe('Removed index from sentence 1, blank 1.');
  });

  it('REMOVE on an empty slot changes nothing', () => {
    const before = fresh();
    expect(run(before, { type: 'REMOVE', slotId: S1 })).toBe(before);
  });
});

describe('selection', () => {
  it('slot then word places the word', () => {
    const s = run(fresh(), { type: 'SELECT_SLOT', slotId: S2 }, { type: 'SELECT_WORD', wordId: W_CACHE });
    expect(slotWord(s, S2)?.text).toBe('cache');
    expect(s.selection).toEqual({ kind: 'none' });
  });

  it('word then slot places the word', () => {
    const s = run(fresh(), { type: 'SELECT_WORD', wordId: W_CACHE }, { type: 'SELECT_SLOT', slotId: S2 });
    expect(slotWord(s, S2)?.text).toBe('cache');
    expect(s.selection).toEqual({ kind: 'none' });
  });

  it('selecting a slot asks for focus on the bank (keyboard) and announces it', () => {
    const s = run(fresh(), { type: 'SELECT_SLOT', slotId: S1 });
    expect(s.selection).toEqual({ kind: 'slot', slotId: S1 });
    expect(s.focusRequest?.target).toBe('bank');
    expect(s.announcement.text).toBe('Sentence 1, blank 1 selected. Choose a word.');
  });

  it('selecting a filled slot mentions the current word', () => {
    const placed = run(fresh(), { type: 'PLACE', wordId: W_INDEX, slotId: S1, via: 'pointer' });
    const s = run(placed, { type: 'SELECT_SLOT', slotId: S1 });
    expect(s.announcement.text).toBe('Sentence 1, blank 1 selected. Choose a word. Currently index.');
  });

  it('selecting a word announces that a blank is needed', () => {
    const s = run(fresh(), { type: 'SELECT_WORD', wordId: W_CACHE });
    expect(s.selection).toEqual({ kind: 'word', wordId: W_CACHE });
    expect(s.announcement.text).toBe('cache selected. Choose a blank.');
  });

  it('toggles a selection off when selected again', () => {
    const slotOff = run(fresh(), { type: 'SELECT_SLOT', slotId: S1 }, { type: 'SELECT_SLOT', slotId: S1 });
    expect(slotOff.selection).toEqual({ kind: 'none' });
    const wordOff = run(fresh(), { type: 'SELECT_WORD', wordId: W_CACHE }, { type: 'SELECT_WORD', wordId: W_CACHE });
    expect(wordOff.selection).toEqual({ kind: 'none' });
  });

  it('switches selection from one slot to another slot', () => {
    const s = run(fresh(), { type: 'SELECT_SLOT', slotId: S1 }, { type: 'SELECT_SLOT', slotId: S2 });
    expect(s.selection).toEqual({ kind: 'slot', slotId: S2 });
  });

  it('CLEAR_SELECTION clears and announces', () => {
    const s = run(fresh(), { type: 'SELECT_WORD', wordId: W_CACHE }, { type: 'CLEAR_SELECTION' });
    expect(s.selection).toEqual({ kind: 'none' });
    expect(s.announcement.text).toBe('Selection cleared.');
  });
});

describe('RESET', () => {
  it('empties every slot, clears the selection, and focuses the first slot', () => {
    const s = run(
      fresh(),
      { type: 'PLACE', wordId: W_INDEX, slotId: S1, via: 'pointer' },
      { type: 'PLACE', wordId: W_CACHE, slotId: S3, via: 'pointer' },
      { type: 'SELECT_WORD', wordId: W_WRITES },
      { type: 'RESET' },
    );
    expect(emptyCount(s)).toBe(3);
    expect(s.selection).toEqual({ kind: 'none' });
    expect(s.focusRequest?.target).toBe(S1);
    expect(s.announcement.text).toBe('All blanks cleared.');
  });
});

describe('submitting', () => {
  it('ignores every move while submitting', () => {
    const submitting = run(fresh(), { type: 'PLACE', wordId: W_INDEX, slotId: S1, via: 'pointer' }, { type: 'SUBMIT_START' });
    expect(submitting.status).toBe('submitting');
    const moves: Action[] = [
      { type: 'PLACE', wordId: W_CACHE, slotId: S2, via: 'pointer' },
      { type: 'MOVE', fromSlotId: S1, toSlotId: S2 },
      { type: 'REMOVE', slotId: S1 },
      { type: 'SELECT_SLOT', slotId: S2 },
      { type: 'SELECT_WORD', wordId: W_CACHE },
      { type: 'CLEAR_SELECTION' },
      { type: 'RESET' },
    ];
    for (const move of moves) expect(run(submitting, move)).toBe(submitting);
  });

  it('SUBMIT_FAIL keeps placements and sessionId, and asks for focus on the error', () => {
    const error = new ApiClientError({ status: 0, code: 'NETWORK', message: 'Service unavailable.' });
    const s = run(
      fresh(),
      { type: 'PLACE', wordId: W_INDEX, slotId: S1, via: 'pointer' },
      { type: 'SUBMIT_START' },
      { type: 'SESSION_CREATED', sessionId: 's-1' },
      { type: 'SUBMIT_FAIL', error },
    );
    expect(s.status).toBe('submit_failed');
    expect(s.error).toBe(error);
    expect(s.sessionId).toBe('s-1');
    expect(slotWord(s, S1)?.text).toBe('index');
    expect(s.focusRequest?.target).toBe('error');
    expect(s.announcement.text).toBe('Submit failed. Your answers are still here.');
  });

  it('any move after a failure returns to editing, clears the error, and keeps the session', () => {
    const error = new ApiClientError({ status: 0, code: 'NETWORK', message: 'x' });
    const failed = run(fresh(), { type: 'SUBMIT_START' }, { type: 'SESSION_CREATED', sessionId: 's-1' }, { type: 'SUBMIT_FAIL', error });
    const s = run(failed, { type: 'PLACE', wordId: W_INDEX, slotId: S1, via: 'pointer' });
    expect(s.status).toBe('editing');
    expect(s.error).toBeNull();
    expect(s.sessionId).toBe('s-1');
  });

  it('Retry (SUBMIT_START after a failure) is allowed and clears the error', () => {
    const error = new ApiClientError({ status: 0, code: 'NETWORK', message: 'x' });
    const failed = run(fresh(), { type: 'SUBMIT_START' }, { type: 'SUBMIT_FAIL', error }, { type: 'SUBMIT_START' });
    expect(failed.status).toBe('submitting');
    expect(failed.error).toBeNull();
  });
});

describe('selectors', () => {
  it('useCount counts the slots holding a word', () => {
    const s = run(fresh(), { type: 'PLACE', wordId: W_INDEX, slotId: S1, via: 'pointer' });
    expect(useCount(s, W_INDEX)).toBe(1);
    expect(useCount(s, W_CACHE)).toBe(0);
  });

  it('nextEmptySlot wraps once and returns null when everything is filled', () => {
    const s = run(fresh(), { type: 'PLACE', wordId: W_INDEX, slotId: S1, via: 'pointer' }, { type: 'PLACE', wordId: W_INDEX, slotId: S3, via: 'pointer' });
    expect(nextEmptySlot(s, S1)).toBe(S2);
    expect(nextEmptySlot(s, S3)).toBe(S2);
    const full = run(s, { type: 'PLACE', wordId: W_INDEX, slotId: S2, via: 'pointer' });
    expect(nextEmptySlot(full, S1)).toBeNull();
  });
});

describe('toSubmitRequest', () => {
  it('emits one entry per slot with the word text and null for empty slots', () => {
    const s = run(
      fresh(),
      { type: 'PLACE', wordId: W_INDEX, slotId: S1, via: 'pointer' },
      { type: 'PLACE', wordId: W_INDEX, slotId: S3, via: 'pointer' },
    );
    expect(toSubmitRequest(s)).toEqual({
      answers: [
        { questionId: 'q-1', blank: 0, word: 'index' },
        { questionId: 'q-1', blank: 1, word: null },
        { questionId: 'q-2', blank: 0, word: 'index' },
      ],
    });
  });
});

describe('draft placements (sessionStorage)', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('stores only filled slots, as slot -> word text', () => {
    const s = run(fresh(), { type: 'PLACE', wordId: W_INDEX, slotId: S1, via: 'pointer' });
    expect(draftOf(s)).toEqual({ [S1]: 'index' });
  });

  it('restores by word text against a differently shuffled bank', () => {
    const placed = run(
      fresh(),
      { type: 'PLACE', wordId: W_INDEX, slotId: S1, via: 'pointer' },
      { type: 'PLACE', wordId: W_WRITES, slotId: S2, via: 'pointer' },
    );
    saveDraft(placed.puzzleId, draftOf(placed));
    const shuffled = createInitialState({ ...playPuzzle, wordBank: ['table', 'index', 'writes', 'cache'] });
    const restored = boardReducer(shuffled, { type: 'RESTORE_DRAFT', draft: loadDraft(shuffled.puzzleId) });
    expect(slotWord(restored, S1)?.text).toBe('index');
    expect(slotWord(restored, S2)?.text).toBe('writes');
    expect(slotWord(restored, S3)).toBeNull();
    expect(restored.words.find((w) => w.text === 'index')?.id).toBe(restored.placements[S1]);
  });

  it('drops unknown slots, words missing from the bank, and malformed values', () => {
    const base = fresh();
    expect(restoreDraft(base, { [S1]: 'gone', 'nope:0': 'index', [S2]: 7 })).toBe(base);
    expect(restoreDraft(base, null)).toBe(base);
    expect(restoreDraft(base, ['index'])).toBe(base);
  });

  it('saves under gc.play.<puzzleId>, removes the key when empty, and clears on demand', () => {
    saveDraft('pz', { 'q:0': 'a' });
    expect(window.sessionStorage.getItem('gc.play.pz')).toBe('{"q:0":"a"}');
    expect(draftKey('pz')).toBe('gc.play.pz');
    clearDraft('pz');
    expect(window.sessionStorage.getItem('gc.play.pz')).toBeNull();
  });

  it('ignores corrupt stored data', () => {
    window.sessionStorage.setItem('gc.play.pz', '{not json');
    expect(loadDraft('pz')).toBeNull();
  });
});
