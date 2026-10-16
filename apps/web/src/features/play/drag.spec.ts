import { describe, expect, it } from 'vitest';
import { boardReducer, createInitialState } from './board-state';
import { bankId, blankId, dragToAction, placedId } from './drag';
import { playPuzzle } from './fixtures';

const base = boardReducer(createInitialState(playPuzzle), {
  type: 'PLACE',
  wordId: 'w2',
  slotId: 'q-1:0',
  via: 'pointer',
});

describe('dragToAction', () => {
  it('bank word onto a blank is a pointer PLACE', () => {
    expect(dragToAction(bankId('w1'), blankId('q-1:1'), base)).toEqual({
      type: 'PLACE',
      wordId: 'w1',
      slotId: 'q-1:1',
      via: 'pointer',
    });
  });

  it('bank word onto a filled blank is also PLACE (it replaces)', () => {
    expect(dragToAction(bankId('w1'), blankId('q-1:0'), base)).toEqual({
      type: 'PLACE',
      wordId: 'w1',
      slotId: 'q-1:0',
      via: 'pointer',
    });
  });

  it('placed word onto another blank is MOVE', () => {
    expect(dragToAction(placedId('q-1:0'), blankId('q-2:0'), base)).toEqual({
      type: 'MOVE',
      fromSlotId: 'q-1:0',
      toSlotId: 'q-2:0',
    });
  });

  it('placed word dropped anywhere else is REMOVE', () => {
    expect(dragToAction(placedId('q-1:0'), null, base)).toEqual({
      type: 'REMOVE',
      slotId: 'q-1:0',
    });
    expect(dragToAction(placedId('q-1:0'), 'something-else', base)).toEqual({
      type: 'REMOVE',
      slotId: 'q-1:0',
    });
  });

  it('placed word dropped back on its own blank does nothing', () => {
    expect(dragToAction(placedId('q-1:0'), blankId('q-1:0'), base)).toBeNull();
  });

  it('bank word dropped outside a blank does nothing', () => {
    expect(dragToAction(bankId('w1'), null, base)).toBeNull();
    expect(dragToAction(bankId('w1'), 'something-else', base)).toBeNull();
  });

  it('ignores unknown ids', () => {
    expect(dragToAction(bankId('nope'), blankId('q-1:1'), base)).toBeNull();
    expect(dragToAction(bankId('w1'), blankId('nope'), base)).toBeNull();
    expect(dragToAction('mystery', blankId('q-1:1'), base)).toBeNull();
  });
});
