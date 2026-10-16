import { useDraggable } from '@dnd-kit/core';
import type { KeyboardEvent, MouseEvent } from 'react';
import { cn } from '~/lib/utils';
import type { Word } from './board-state';
import { bankId } from './drag';

export function wordName(word: Word, useCount: number): string {
  return useCount > 0
    ? `${word.text}, used in ${useCount} ${useCount === 1 ? 'blank' : 'blanks'}`
    : word.text;
}

interface WordButtonProps {
  word: Word;
  useCount: number;
  selected: boolean;
  /** Roving tabindex: 0 for the one tab stop of the bank, -1 for the others. */
  tabIndex: 0 | -1;
  /** Only while submitting. A word is never disabled by use. */
  disabled: boolean;
  onActivate: (wordId: string, event: MouseEvent<HTMLButtonElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onFocus: () => void;
  register: (wordId: string, element: HTMLButtonElement | null) => void;
}

/** A word of the bank. Dragging it copies the word (the bank keeps it). */
export function WordButton({
  word,
  useCount,
  selected,
  tabIndex,
  disabled,
  onActivate,
  onKeyDown,
  onFocus,
  register,
}: WordButtonProps) {
  const drag = useDraggable({ id: bankId(word.id), disabled });
  return (
    <button
      type="button"
      ref={(element) => {
        drag.setNodeRef(element);
        register(word.id, element);
      }}
      aria-label={wordName(word, useCount)}
      aria-pressed={selected}
      tabIndex={tabIndex}
      disabled={disabled}
      onClick={(event) => onActivate(word.id, event)}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      {...drag.listeners}
      className={cn(
        'inline-flex h-11 cursor-grab touch-manipulation items-center justify-center gap-1.5 rounded-full border border-input bg-card px-3.5 text-base font-semibold shadow-xs outline-none sm:h-10',
        'transition-colors duration-(--duration-fast) ease-(--ease-standard) hover:border-muted-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring',
        useCount > 0 && 'border-primary',
        selected &&
          'border-primary bg-primary text-primary-foreground hover:border-primary hover:bg-primary-hover',
        drag.isDragging && 'border-dashed opacity-45 shadow-none',
      )}
    >
      <span>{word.text}</span>
      {useCount > 0 && (
        <span
          aria-hidden="true"
          className={cn(
            'rounded-full bg-primary-soft px-1.5 py-[3px] font-mono text-[11px] leading-none font-medium text-primary',
          )}
        >
          used in {useCount} {useCount === 1 ? 'blank' : 'blanks'}
        </span>
      )}
    </button>
  );
}
