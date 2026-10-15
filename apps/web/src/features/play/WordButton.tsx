import { useDraggable } from '@dnd-kit/core';
import type { KeyboardEvent, MouseEvent } from 'react';
import { cn } from '~/lib/utils';
import type { Word } from './board-state';
import { bankId } from './drag';

export function wordName(word: Word, useCount: number): string {
  return useCount > 0 ? `${word.text}, used in ${useCount} ${useCount === 1 ? 'blank' : 'blanks'}` : word.text;
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
export function WordButton({ word, useCount, selected, tabIndex, disabled, onActivate, onKeyDown, onFocus, register }: WordButtonProps) {
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
        'inline-flex min-h-11 flex-col items-center justify-center rounded-md border bg-background px-3 py-1 text-base font-medium outline-none',
        'hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/60',
        selected && 'ring-2 ring-primary',
        drag.isDragging && 'opacity-40',
      )}
    >
      <span>{word.text}</span>
      {useCount > 0 && (
        <span aria-hidden="true" className="text-xs font-normal text-muted-foreground">
          used in {useCount} {useCount === 1 ? 'blank' : 'blanks'}
        </span>
      )}
    </button>
  );
}
