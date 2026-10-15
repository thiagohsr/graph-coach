import { useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { Selection, Word } from './board-state';
import { WordButton } from './WordButton';

interface WordBankProps {
  words: Word[];
  useCountOf: (wordId: string) => number;
  selection: Selection;
  disabled: boolean;
  onActivate: (wordId: string, event: MouseEvent<HTMLButtonElement>) => void;
}

/**
 * Always renders every word (words are reusable). One tab stop; the arrow keys move between words
 * (roving tabindex). The wrapper has `data-word-bank` so the board can move focus to the current stop.
 */
export function WordBank({ words, useCountOf, selection, disabled, onActivate }: WordBankProps) {
  const [active, setActive] = useState(0);
  const elements = useRef(new Map<string, HTMLButtonElement>());

  const register = (wordId: string, element: HTMLButtonElement | null) => {
    if (element) elements.current.set(wordId, element);
    else elements.current.delete(wordId);
  };

  const focusAt = (index: number) => {
    const word = words[index];
    if (!word) return;
    setActive(index);
    elements.current.get(word.id)?.focus();
  };

  const onKeyDown = (index: number) => (event: KeyboardEvent<HTMLButtonElement>) => {
    const last = words.length - 1;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        focusAt(index === last ? 0 : index + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        focusAt(index === 0 ? last : index - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusAt(0);
        break;
      case 'End':
        event.preventDefault();
        focusAt(last);
        break;
      default:
    }
  };

  return (
    <div role="group" aria-label="Word bank" data-word-bank className="flex flex-wrap gap-2">
      {words.map((word, index) => (
        <WordButton
          key={word.id}
          word={word}
          useCount={useCountOf(word.id)}
          selected={selection.kind === 'word' && selection.wordId === word.id}
          tabIndex={index === Math.min(active, words.length - 1) ? 0 : -1}
          disabled={disabled}
          onActivate={onActivate}
          onKeyDown={onKeyDown(index)}
          onFocus={() => setActive(index)}
          register={register}
        />
      ))}
    </div>
  );
}
