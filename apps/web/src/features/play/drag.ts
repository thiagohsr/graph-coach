import type { Action, BoardState } from './board-state';

// Drag-and-drop ids. A bank word and a placed word are draggable; a blank is droppable.
export const bankId = (wordId: string) => `bank:${wordId}`;
export const placedId = (slotId: string) => `placed:${slotId}`;
export const blankId = (slotId: string) => `blank:${slotId}`;

function strip(id: string, prefix: string): string | null {
  return id.startsWith(prefix) ? id.slice(prefix.length) : null;
}

/**
 * Maps the end of a drag to a reducer action (data-model.md §1.4), or null for "do nothing".
 *   bank word onto a blank        -> PLACE (pointer)
 *   placed word onto another blank -> MOVE
 *   placed word anywhere else      -> REMOVE
 *   bank word outside any blank    -> null
 */
export function dragToAction(activeId: string, overId: string | null, state: BoardState): Action | null {
  const overSlot = overId ? strip(overId, 'blank:') : null;
  const target = overSlot !== null && state.slots.some((s) => s.id === overSlot) ? overSlot : null;

  const bankWord = strip(activeId, 'bank:');
  if (bankWord !== null) {
    if (target === null || !state.words.some((w) => w.id === bankWord)) return null;
    return { type: 'PLACE', wordId: bankWord, slotId: target, via: 'pointer' };
  }

  const fromSlot = strip(activeId, 'placed:');
  if (fromSlot !== null) {
    if (!state.placements[fromSlot]) return null;
    if (target !== null) {
      return target === fromSlot ? null : { type: 'MOVE', fromSlotId: fromSlot, toSlotId: target };
    }
    return { type: 'REMOVE', slotId: fromSlot };
  }
  return null;
}
