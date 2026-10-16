import type { ApiClientError } from '~/lib/api/errors';
import type { PlayPuzzle, SubmitRequest } from '~/lib/api/gameplay-schemas';

// Pure play-board state machine (data-model.md §1). No React, no network.
// Words are reusable: placing a word never removes it from `words`; `placements` maps slot -> word id.
// The state is built only from the play payload: it never holds an expected answer, correctness, or score.

export interface Slot {
  id: string;
  questionId: string;
  /** Zero-based, as sent to the API (reconciliation A3). */
  blank: number;
  /** One-based, for labels. */
  sentenceNumber: number;
  blankNumber: number;
  /** Blanks in this sentence ("blank m of k"). */
  blankCount: number;
}

export interface Word {
  id: string;
  text: string;
}

export type Selection =
  { kind: 'none' } | { kind: 'slot'; slotId: string } | { kind: 'word'; wordId: string };
export type FocusTarget = string | 'bank' | 'submit' | 'error';
export type Via = 'keyboard' | 'pointer';

export interface BoardState {
  puzzleId: string;
  slots: Slot[];
  words: Word[];
  placements: Record<string, string | null>;
  selection: Selection;
  status: 'editing' | 'submitting' | 'submit_failed';
  sessionId: string | null;
  error: ApiClientError | null;
  announcement: { seq: number; text: string };
  focusRequest: { seq: number; target: FocusTarget } | null;
}

export type Action =
  | { type: 'PLACE'; wordId: string; slotId: string; via: Via }
  | { type: 'MOVE'; fromSlotId: string; toSlotId: string }
  | { type: 'REMOVE'; slotId: string }
  | { type: 'SELECT_SLOT'; slotId: string; via?: Via }
  | { type: 'SELECT_WORD'; wordId: string; via?: Via }
  | { type: 'CLEAR_SELECTION' }
  | { type: 'RESET' }
  | { type: 'RESTORE_DRAFT'; draft: unknown }
  | { type: 'SUBMIT_START' }
  | { type: 'SESSION_CREATED'; sessionId: string }
  | { type: 'SUBMIT_FAIL'; error: ApiClientError };

export function createInitialState(puzzle: PlayPuzzle): BoardState {
  const questions = [...puzzle.questions].sort((a, b) => a.order - b.order);
  const slots: Slot[] = questions.flatMap((q, qi) =>
    Array.from({ length: q.blanks }, (_, blank) => ({
      id: `${q.id}:${blank}`,
      questionId: q.id,
      blank,
      sentenceNumber: qi + 1,
      blankNumber: blank + 1,
      blankCount: q.blanks,
    })),
  );
  return {
    puzzleId: puzzle.id,
    slots,
    words: puzzle.wordBank.map((text, i) => ({ id: `w${i}`, text })),
    placements: Object.fromEntries(slots.map((s) => [s.id, null])),
    selection: { kind: 'none' },
    status: 'editing',
    sessionId: null,
    error: null,
    announcement: { seq: 0, text: '' },
    focusRequest: null,
  };
}

// ---------------------------------------------------------------------------------------------
// Selectors

const findSlot = (state: BoardState, slotId: string) => state.slots.find((s) => s.id === slotId);
const findWord = (state: BoardState, wordId: string) => state.words.find((w) => w.id === wordId);

export function slotWord(state: BoardState, slotId: string): Word | null {
  const wordId = state.placements[slotId];
  return wordId ? (findWord(state, wordId) ?? null) : null;
}

/** Number of slots currently holding the word (shown on its bank button as text). */
export function useCount(state: BoardState, wordId: string): number {
  return state.slots.reduce((n, s) => (state.placements[s.id] === wordId ? n + 1 : n), 0);
}

export function emptyCount(state: BoardState): number {
  return state.slots.reduce((n, s) => (state.placements[s.id] ? n : n + 1), 0);
}

/** First empty slot after the given one in reading order, wrapping once; null if none. */
export function nextEmptySlot(state: BoardState, afterSlotId: string): string | null {
  const start = state.slots.findIndex((s) => s.id === afterSlotId);
  const n = state.slots.length;
  for (let i = 1; i <= n; i++) {
    const slot = state.slots[(start + i + n) % n];
    if (slot && !state.placements[slot.id]) return slot.id;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Draft placements (stretch; data-model.md §5): slot id -> word text, kept in sessionStorage so a reload keeps them.
// The bank order changes with each shuffle, the words do not, so words are stored by text and looked up on restore.

export type Draft = Record<string, string>;

export const draftKey = (puzzleId: string) => `gc.play.${puzzleId}`;

/** Only filled slots; word text, never ids. */
export function draftOf(state: BoardState): Draft {
  const draft: Draft = {};
  for (const s of state.slots) {
    const word = slotWord(state, s.id);
    if (word) draft[s.id] = word.text;
  }
  return draft;
}

/** Placements for the slots of `state` found in `draft`; unknown slots and words missing from the bank are dropped. */
export function restoreDraft(state: BoardState, draft: unknown): BoardState {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return state;
  const placements = { ...state.placements };
  let changed = false;
  for (const s of state.slots) {
    const text = (draft as Record<string, unknown>)[s.id];
    if (typeof text !== 'string') continue;
    const word = state.words.find((w) => w.text === text);
    if (word) {
      placements[s.id] = word.id;
      changed = true;
    }
  }
  return changed ? { ...state, placements } : state;
}

/** Storage access only from effects and handlers; every call is safe on the server and when storage is blocked. */
export function loadDraft(puzzleId: string): unknown {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(draftKey(puzzleId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveDraft(puzzleId: string, draft: Draft): void {
  if (typeof window === 'undefined') return;
  try {
    if (Object.keys(draft).length === 0) window.sessionStorage.removeItem(draftKey(puzzleId));
    else window.sessionStorage.setItem(draftKey(puzzleId), JSON.stringify(draft));
  } catch {
    // Storage is a convenience only.
  }
}

export const clearDraft = (puzzleId: string): void => saveDraft(puzzleId, {});

export function toSubmitRequest(state: BoardState): SubmitRequest {
  return {
    answers: state.slots.map((s) => ({
      questionId: s.questionId,
      blank: s.blank,
      word: slotWord(state, s.id)?.text ?? null,
    })),
  };
}

// ---------------------------------------------------------------------------------------------
// Reducer

const label = (s: Slot) => `sentence ${s.sentenceNumber}, blank ${s.blankNumber}`;

function announce(state: BoardState, text: string): Pick<BoardState, 'announcement'> {
  return { announcement: { seq: state.announcement.seq + 1, text } };
}

function focus(state: BoardState, target: FocusTarget): Pick<BoardState, 'focusRequest'> {
  return { focusRequest: { seq: (state.focusRequest?.seq ?? 0) + 1, target } };
}

function place(state: BoardState, wordId: string, slotId: string, via: Via): BoardState {
  const slot = findSlot(state, slotId);
  const word = findWord(state, wordId);
  if (!slot || !word) return state;
  const previous = slotWord(state, slotId);
  const replaced = previous && previous.id !== word.id ? previous : null;
  const placements = { ...state.placements, [slotId]: wordId };
  const next: BoardState = { ...state, placements, selection: { kind: 'none' } };
  const text = replaced
    ? `Replaced ${replaced.text} with ${word.text} in ${label(slot)}.`
    : `Placed ${word.text} in ${label(slot)}.`;
  const target = via === 'keyboard' ? (nextEmptySlot(next, slotId) ?? 'submit') : null;
  return {
    ...next,
    ...announce(state, text),
    ...(target ? focus(state, target) : {}),
  };
}

function editingFrom(state: BoardState): BoardState {
  return state.status === 'submit_failed' ? { ...state, status: 'editing', error: null } : state;
}

/** Moves are ignored while submitting; a move after a failure returns the board to editing. */
function move(state: BoardState, action: Action): BoardState {
  const s = editingFrom(state);
  switch (action.type) {
    case 'PLACE':
      return place(s, action.wordId, action.slotId, action.via);

    case 'MOVE': {
      const from = findSlot(s, action.fromSlotId);
      const to = findSlot(s, action.toSlotId);
      const moved = slotWord(s, action.fromSlotId);
      if (!from || !to || !moved || from.id === to.id) return state;
      const replaced = slotWord(s, to.id);
      const placements = { ...s.placements, [from.id]: null, [to.id]: moved.id };
      const text = `Moved ${moved.text} to ${label(to)}.${replaced ? ` Replaced ${replaced.text}.` : ''}`;
      return { ...s, placements, selection: { kind: 'none' }, ...announce(s, text) };
    }

    case 'REMOVE': {
      const slot = findSlot(s, action.slotId);
      const removed = slotWord(s, action.slotId);
      if (!slot || !removed) return state;
      return {
        ...s,
        placements: { ...s.placements, [slot.id]: null },
        selection: { kind: 'none' },
        ...announce(s, `Removed ${removed.text} from ${label(slot)}.`),
        ...focus(s, slot.id),
      };
    }

    case 'SELECT_SLOT': {
      const slot = findSlot(s, action.slotId);
      if (!slot) return state;
      if (s.selection.kind === 'word')
        return place(s, s.selection.wordId, slot.id, action.via ?? 'keyboard');
      if (s.selection.kind === 'slot' && s.selection.slotId === slot.id) {
        return { ...s, selection: { kind: 'none' }, ...announce(s, 'Selection cleared.') };
      }
      const current = slotWord(s, slot.id);
      const text = `Sentence ${slot.sentenceNumber}, blank ${slot.blankNumber} selected. Choose a word.${current ? ` Currently ${current.text}.` : ''}`;
      return {
        ...s,
        selection: { kind: 'slot', slotId: slot.id },
        ...announce(s, text),
        ...((action.via ?? 'keyboard') === 'keyboard' ? focus(s, 'bank') : {}),
      };
    }

    case 'SELECT_WORD': {
      const word = findWord(s, action.wordId);
      if (!word) return state;
      if (s.selection.kind === 'slot')
        return place(s, word.id, s.selection.slotId, action.via ?? 'keyboard');
      if (s.selection.kind === 'word' && s.selection.wordId === word.id) {
        return { ...s, selection: { kind: 'none' }, ...announce(s, 'Selection cleared.') };
      }
      return {
        ...s,
        selection: { kind: 'word', wordId: word.id },
        ...announce(s, `${word.text} selected. Choose a blank.`),
      };
    }

    case 'CLEAR_SELECTION':
      return { ...s, selection: { kind: 'none' }, ...announce(s, 'Selection cleared.') };

    case 'RESTORE_DRAFT':
      return restoreDraft(s, action.draft);

    case 'RESET': {
      const first = s.slots[0];
      return {
        ...s,
        placements: Object.fromEntries(s.slots.map((x) => [x.id, null])),
        selection: { kind: 'none' },
        ...announce(s, 'All blanks cleared.'),
        ...(first ? focus(s, first.id) : {}),
      };
    }

    default:
      return state;
  }
}

export function boardReducer(state: BoardState, action: Action): BoardState {
  switch (action.type) {
    case 'SUBMIT_START':
      if (state.status === 'submitting') return state;
      return {
        ...state,
        status: 'submitting',
        error: null,
        selection: { kind: 'none' },
        ...announce(state, 'Submitting answers.'),
      };
    case 'SESSION_CREATED':
      return { ...state, sessionId: action.sessionId };
    case 'SUBMIT_FAIL':
      return {
        ...state,
        status: 'submit_failed',
        error: action.error,
        ...announce(state, 'Submit failed. Your answers are still here.'),
        ...focus(state, 'error'),
      };
    default:
      return state.status === 'submitting' ? state : move(state, action);
  }
}
