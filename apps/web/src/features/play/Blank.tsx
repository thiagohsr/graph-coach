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
        'mx-1 inline-flex min-h-11 min-w-24 items-center justify-center rounded-md border-2 border-dashed px-3 py-1 align-middle text-base font-medium outline-none',
        'focus-visible:ring-[3px] focus-visible:ring-ring/60',
        word ? 'border-solid bg-secondary text-secondary-foreground' : 'bg-background text-muted-foreground',
        selected && 'ring-2 ring-primary',
        drop.isOver && 'border-primary bg-accent',
        drag.isDragging && 'opacity-40',
      )}
    >
      {word ? word.text : <span aria-hidden="true">&nbsp;</span>}
    </button>
  );
}
