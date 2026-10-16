import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { Link } from '@tanstack/react-router';
import { BookTypeIcon, InfoIcon } from 'lucide-react';
import {
  useEffect,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { LiveRegion } from '~/components/a11y/LiveRegion';
import { describeError } from '~/components/states/error-messages';
import { EmptyState } from '~/components/states/EmptyState';
import { NotFoundPage } from '~/components/states/NotFoundPage';
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { OriginLabel } from '~/features/origin/OriginLabel';
import type { PlayPuzzle } from '~/lib/api/gameplay-schemas';
import { useReducedMotion } from '~/lib/a11y/use-reduced-motion';
import {
  boardReducer,
  createInitialState,
  draftOf,
  emptyCount,
  loadDraft,
  saveDraft,
  slotWord,
  useCount,
} from './board-state';
import { dragToAction } from './drag';
import { findSentenceMismatch } from './sentence';
import { SentenceRow } from './SentenceRow';
import { useSubmitSession } from './use-submit-session';
import { WordBank } from './WordBank';

const HINT =
  'Drag a word to a blank, or select a blank and then a word. Words can be used more than once.';
const HINT_ID = 'play-hint';

// The library's own announcements are off: the board speaks through one live region (research R5).
const noAnnouncements: Announcements = {
  onDragStart: () => undefined,
  onDragMove: () => undefined,
  onDragOver: () => undefined,
  onDragEnd: () => undefined,
  onDragCancel: () => undefined,
};

/** The play screen body: guards the payload, then renders the interactive board. */
export function PlayBoard({ puzzle }: { puzzle: PlayPuzzle }) {
  if (puzzle.questions.length === 0) {
    return (
      <EmptyState
        title="This puzzle has no questions."
        action={
          <Link
            to={'/puzzles' as never}
            className="font-medium text-primary underline underline-offset-4 hover:text-primary-hover"
          >
            Back to puzzles
          </Link>
        }
      />
    );
  }
  const mismatch = findSentenceMismatch(puzzle.questions);
  if (mismatch) {
    return (
      <Alert variant="destructive">
        <AlertTitle>This puzzle cannot be displayed</AlertTitle>
        <AlertDescription>{mismatch}</AlertDescription>
      </Alert>
    );
  }
  return <Board puzzle={puzzle} />;
}

function Board({ puzzle }: { puzzle: PlayPuzzle }) {
  const [state, dispatch] = useReducer(boardReducer, puzzle, createInitialState);
  const { submit, notFound } = useSubmitSession(state, dispatch);
  const reducedMotion = useReducedMotion();
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const root = useRef<HTMLDivElement>(null);
  const blanks = useRef(new Map<string, HTMLButtonElement>());
  const submitButton = useRef<HTMLButtonElement>(null);
  const errorBox = useRef<HTMLDivElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  // The reducer asks for focus; this effect is the only place that moves it.
  const focusSeq = state.focusRequest?.seq;
  useEffect(() => {
    const target = state.focusRequest?.target;
    if (!target) return;
    if (target === 'bank')
      root.current?.querySelector<HTMLElement>('[data-word-bank] button[tabindex="0"]')?.focus();
    else if (target === 'submit') submitButton.current?.focus();
    else if (target === 'error') errorBox.current?.focus();
    else blanks.current.get(target)?.focus();
    // Only a new request (a new seq) moves focus.
  }, [focusSeq]);

  // Draft placements (sessionStorage, effects only so server rendering never touches it). The untouched initial
  // placements are not saved, so a restore cannot be overwritten by the first render's empty board.
  const initialPlacements = useRef(state.placements);
  useEffect(() => {
    dispatch({ type: 'RESTORE_DRAFT', draft: loadDraft(puzzle.id) });
  }, [puzzle.id]);
  useEffect(() => {
    if (state.placements === initialPlacements.current || state.status === 'submitting') return;
    saveDraft(state.puzzleId, draftOf(state));
    // Placements and status are the only inputs; puzzleId changes only with a new board.
  }, [state.placements, state.status]);

  if (notFound) return <NotFoundPage />;

  const submitting = state.status === 'submitting';
  const total = state.slots.length;
  const empties = emptyCount(state);
  const questions = [...puzzle.questions].sort((a, b) => a.order - b.order);

  const viaOf = (event: MouseEvent) => (event.detail === 0 ? 'keyboard' : 'pointer');

  const onBlank = (slotId: string, event: MouseEvent<HTMLButtonElement>) =>
    dispatch({ type: 'SELECT_SLOT', slotId, via: viaOf(event) });
  const onWord = (wordId: string, event: MouseEvent<HTMLButtonElement>) =>
    dispatch({ type: 'SELECT_WORD', wordId, via: viaOf(event) });
  const onBlankKeyDown = (slotId: string, event: KeyboardEvent<HTMLButtonElement>) => {
    if ((event.key === 'Backspace' || event.key === 'Delete') && slotWord(state, slotId)) {
      event.preventDefault();
      dispatch({ type: 'REMOVE', slotId });
    }
  };
  const onBoardKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && state.selection.kind !== 'none') {
      event.stopPropagation();
      dispatch({ type: 'CLEAR_SELECTION' });
    }
  };

  const onDragStart = (event: DragStartEvent) => setActiveDragId(String(event.active.id));
  const onDragEnd = (event: DragEndEvent) => {
    setActiveDragId(null);
    const action = dragToAction(
      String(event.active.id),
      event.over ? String(event.over.id) : null,
      state,
    );
    if (action) dispatch(action);
  };

  const activeWordText = (() => {
    if (!activeDragId) return null;
    if (activeDragId.startsWith('bank:'))
      return state.words.find((w) => w.id === activeDragId.slice(5))?.text ?? null;
    if (activeDragId.startsWith('placed:'))
      return slotWord(state, activeDragId.slice(7))?.text ?? null;
    return null;
  })();

  const requestSubmit = () => {
    if (empties > 0) setConfirmOpen(true);
    else void submit();
  };

  return (
    <div
      ref={root}
      role="group"
      aria-label="Play board"
      onKeyDown={onBoardKeyDown}
      className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-x-7 lg:[&>*:not([data-bank-area])]:col-start-1"
      aria-describedby={HINT_ID}
    >
      <p id={HINT_ID} className="flex items-start gap-2 text-sm text-muted-foreground">
        <InfoIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-info" />
        <span>{HINT}</span>
      </p>
      <LiveRegion message={state.announcement.text} seq={state.announcement.seq} />

      <DndContext
        sensors={sensors}
        accessibility={{
          announcements: noAnnouncements,
          screenReaderInstructions: { draggable: '' },
        }}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveDragId(null)}
      >
        <ol
          aria-label="Sentences"
          className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card shadow-xs"
        >
          {questions.map((question, index) => (
            <SentenceRow
              key={question.id}
              question={question}
              sentenceNumber={index + 1}
              state={state}
              disabled={submitting}
              onActivate={onBlank}
              onBlankKeyDown={onBlankKeyDown}
              register={(slotId, element) => {
                if (element) blanks.current.set(slotId, element);
                else blanks.current.delete(slotId);
              }}
            />
          ))}
        </ol>

        {state.status === 'submit_failed' && state.error && (
          <div ref={errorBox} tabIndex={-1} className="outline-none">
            <Alert variant="destructive">
              <AlertTitle>Your answers were not submitted</AlertTitle>
              <AlertDescription>{describeError(state.error).message}</AlertDescription>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => void submit()}
              >
                Retry
              </Button>
            </Alert>
          </div>
        )}

        <div
          data-bank-area
          className="sticky bottom-0 z-10 -mx-4 flex max-h-[40dvh] flex-col gap-3 rounded-t-2xl border-t bg-card px-4 pt-3 pb-3 shadow-[0_-8px_24px_rgb(27_31_36/0.10)] lg:contents"
        >
          <section
            aria-label="Words"
            className="min-h-0 overflow-y-auto lg:col-start-2 lg:row-span-3 lg:row-start-1 lg:sticky lg:top-5 lg:max-h-none lg:overflow-visible lg:rounded-lg lg:border lg:bg-card lg:p-5 lg:shadow-xs"
          >
            <h3 className="mb-3 flex items-center gap-2 text-sm leading-5 font-semibold lg:text-lg lg:leading-6">
              <BookTypeIcon
                aria-hidden="true"
                className="hidden size-4 text-text-secondary lg:block"
              />
              Word bank
            </h3>
            <WordBank
              words={state.words}
              useCountOf={(wordId) => useCount(state, wordId)}
              selection={state.selection}
              disabled={submitting}
              onActivate={onWord}
            />
          </section>

          <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center lg:col-start-1 lg:mt-1">
            <div className="flex items-center gap-3">
              <p className="text-sm font-medium text-text-secondary">
                {total - empties} of {total} blanks filled
              </p>
              <span
                aria-hidden="true"
                className="hidden h-1.5 w-[120px] overflow-hidden rounded-full bg-muted sm:block"
              >
                <span
                  className="block h-full bg-primary transition-[width] duration-(--duration-base) ease-(--ease-standard)"
                  style={{ width: `${total === 0 ? 0 : ((total - empties) / total) * 100}%` }}
                />
              </span>
            </div>
            <div className="flex gap-2 max-sm:[&>*]:flex-1 sm:ml-auto">
              <Button
                type="button"
                variant="ghost"
                className="max-lg:border max-lg:border-input max-lg:bg-card"
                disabled={submitting}
                onClick={() => dispatch({ type: 'RESET' })}
              >
                Clear all
              </Button>
              <Button
                ref={submitButton}
                type="button"
                disabled={submitting}
                onClick={requestSubmit}
              >
                {submitting ? 'Submitting…' : 'Submit answers'}
              </Button>
            </div>
          </div>
        </div>

        <DragOverlay dropAnimation={reducedMotion ? null : undefined}>
          {activeWordText ? (
            <div className="inline-flex h-10 -rotate-3 items-center rounded-full border border-ring bg-card px-3.5 text-base font-semibold shadow-lg motion-reduce:rotate-0">
              {activeWordText}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Submit with empty blanks?</DialogTitle>
            <DialogDescription>
              {empties} {empties === 1 ? 'blank is' : 'blanks are'} empty and will count as
              incorrect.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>
              Keep editing
            </Button>
            <Button
              type="button"
              onClick={() => {
                setConfirmOpen(false);
                void submit();
              }}
            >
              Submit anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Header of the play screen: puzzle name and, for a prompt puzzle, the origin notice. */
export function PlayHeader({ puzzle }: { puzzle: Pick<PlayPuzzle, 'name' | 'origin'> }) {
  return (
    <header className="flex flex-col gap-1">
      <h1 className="text-2xl leading-[30px] font-bold tracking-tight sm:text-[30px] sm:leading-9">
        {puzzle.name}
      </h1>
      {puzzle.origin === 'prompt' && <OriginLabel origin="prompt" />}
    </header>
  );
}
