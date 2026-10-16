import { useDraggable, useDroppable } from '@dnd-kit/core';
import type { KeyboardEvent, MouseEvent } from 'react';
import { cn } from '~/lib/utils';
import type { Slot, Word } from './board-state';
import { blankId, placedId } from './drag';

export function blankName(slot: Slot, word: Word | null): string {
  const base = `Sentence ${slot.sentenceNumber}, blank ${slot.blankNumber} of ${slot.blankCount}`;
  return word ? `${base}, filled with ${word.text}` : `${base}, empty`;
}

interface BlankProps {
  slot: Slot;
  word: Word | null;
  selected: boolean;
  disabled: boolean;
  onActivate: (slotId: string, event: MouseEvent<HTMLButtonElement>) => void;
  onKeyDown: (slotId: string, event: KeyboardEvent<HTMLButtonElement>) => void;
  /** Registers the element so the board can move focus to it. */
  register: (slotId: string, element: HTMLButtonElement | null) => void;
}

/** One blank: a button that is a drop target, and (when filled) a draggable placed word. */
export function Blank({ slot, word, selected, disabled, onActivate, onKeyDown, register }: BlankProps) {
  const drop = useDroppable({ id: blankId(slot.id), disabled });
  const drag = useDraggable({ id: placedId(slot.id), disabled: disabled || !word });

  return (
    <button
      type="button"
      ref={(element) => {
        drop.setNodeRef(element);
        drag.setNodeRef(element);
        register(slot.id, element);
      }}
      aria-label={blankName(slot, word)}
      aria-pressed={selected}
      disabled={disabled}
      data-slot-id={slot.id}
      onClick={(event) => onActivate(slot.id, event)}
      onKeyDown={(event) => onKeyDown(slot.id, event)}
      {...drag.listeners}
      className={cn(
        'mx-0.5 inline-flex h-11 min-w-[84px] items-center justify-center rounded-md border-[1.5px] px-3.5 align-middle text-base font-semibold outline-none sm:h-10 sm:min-w-[104px]',
        'transition-colors duration-(--duration-base) ease-(--ease-standard) disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring',
        word
          ? 'border-solid border-primary bg-primary-soft text-primary'
          : 'border-dashed border-input bg-background text-muted-foreground hover:border-solid hover:border-primary hover:bg-primary-soft',
        selected && 'border-solid border-ring bg-card shadow-[0_0_0_6px_color-mix(in_oklab,var(--ring)_12%,transparent)]',
        drop.isOver && 'border-solid border-primary bg-primary-soft',
        drag.isDragging && 'opacity-40',
      )}
    >
      {word ? word.text : <span aria-hidden="true" className={cn('h-0.5 w-8 rounded-full bg-input', selected && 'bg-ring')} />}
    </button>
  );
}
