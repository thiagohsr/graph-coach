import type { KeyboardEvent, MouseEvent } from 'react';
import type { PlayQuestion } from '~/lib/api/gameplay-schemas';
import type { BoardState } from './board-state';
import { slotWord } from './board-state';
import { Blank } from './Blank';
import { splitSentence } from './sentence';

interface SentenceRowProps {
  question: PlayQuestion;
  sentenceNumber: number;
  state: BoardState;
  disabled: boolean;
  onActivate: (slotId: string, event: MouseEvent<HTMLButtonElement>) => void;
  onBlankKeyDown: (slotId: string, event: KeyboardEvent<HTMLButtonElement>) => void;
  register: (slotId: string, element: HTMLButtonElement | null) => void;
}

/** One numbered sentence with an inline blank button for each `___`. */
export function SentenceRow({ question, sentenceNumber, state, disabled, onActivate, onBlankKeyDown, register }: SentenceRowProps) {
  const split = splitSentence(question.sentence, question.blanks);
  if (!split.ok) return null; // the board refuses to render a mismatched puzzle before getting here
  return (
    <li className="grid grid-cols-[28px_1fr] gap-2.5 px-3.5 py-3.5 sm:grid-cols-[32px_1fr] sm:gap-3.5 sm:px-6 sm:py-[18px]">
      <span
        aria-hidden="true"
        className="grid size-7 place-items-center rounded-full border bg-background font-mono text-xs text-muted-foreground sm:size-8 sm:text-[13px]"
      >
        {sentenceNumber}
      </span>
      <p className="min-w-0 text-base leading-[46px] break-words sm:text-lg sm:leading-[44px]">
        {split.segments.map((segment, i) => {
          if (segment.kind === 'text') return <span key={i}>{segment.text}</span>;
          const slot = state.slots.find((s) => s.questionId === question.id && s.blank === segment.index);
          if (!slot) return null;
          return (
            <Blank
              key={i}
              slot={slot}
              word={slotWord(state, slot.id)}
              selected={state.selection.kind === 'slot' && state.selection.slotId === slot.id}
              disabled={disabled}
              onActivate={onActivate}
              onKeyDown={onBlankKeyDown}
              register={register}
            />
          );
        })}
      </p>
    </li>
  );
}
