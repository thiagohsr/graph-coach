import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { LiveRegion } from '~/components/a11y/LiveRegion';
import { Button } from '~/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '~/components/ui/dialog';
import { useReducedMotion } from '~/lib/a11y/use-reduced-motion';
import { cn } from '~/lib/utils';
import { SlideImage } from './SlideImage';
import {
  BACK_LABEL,
  NEXT_LABEL,
  PRIMARY_CTA,
  SECONDARY_CTA,
  SKIP_LABEL,
  SLIDES,
  SLIDE_COUNT,
  slideImageSrc,
} from './slides';
import type { OnboardingOutcome } from '@coach/types';

export interface CarouselClose {
  outcome: OnboardingOutcome;
  /** Set when a call to action on the last slide was chosen. */
  to?: string;
}

/**
 * The first-run guide (the design documents): seven slides in a modal dialog. Closing by Skip, Escape, the close
 * control, or Back on slide 1 is a skip; the last slide's calls to action complete it. Reports once through
 * `onClose`; it makes no request of its own.
 */
export function OnboardingCarousel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: (result: CarouselClose) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose({ outcome: 'skipped' })}>
      {open ? <CarouselContent onClose={onClose} /> : null}
    </Dialog>
  );
}

function CarouselContent({ onClose }: { onClose: (result: CarouselClose) => void }) {
  const [index, setIndex] = useState(0);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const reduced = useReducedMotion();
  const slide = SLIDES[index]!;
  const last = index === SLIDE_COUNT - 1;
  const position = `Slide ${index + 1} of ${SLIDE_COUNT}`;

  // Warm the next picture; a missing file is harmless (the placeholder stays).
  useEffect(() => {
    if (index + 1 < SLIDE_COUNT) new Image().src = slideImageSrc(index + 1);
  }, [index]);

  // The slide is re-created on every change (for the animation); if that took focus with it (arrow keys),
  // put it back on the new headline so keyboard users keep their place.
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body || active.getAttribute('role') === 'dialog') {
      titleRef.current?.focus();
    }
  }, [index]);

  const skip = () => onClose({ outcome: 'skipped' });
  const next = () => setIndex((i) => Math.min(i + 1, SLIDE_COUNT - 1));
  const back = () => (index === 0 ? skip() : setIndex((i) => i - 1));

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      next();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      if (index > 0) setIndex(index - 1);
    }
  }

  return (
    <DialogContent
      aria-modal="true"
      data-testid="onboarding-dialog"
      onKeyDown={onKeyDown}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        titleRef.current?.focus();
      }}
      onPointerDownOutside={(event) => event.preventDefault()}
      onInteractOutside={(event) => event.preventDefault()}
      className={cn(
        'flex flex-col gap-0 overflow-hidden p-0 outline-none sm:max-w-[560px]',
        'max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-h-none max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0',
      )}
    >
      <div className="flex-1 overflow-y-auto p-4 pt-12 sm:p-6 sm:pt-6">
        <div
          key={index}
          data-motion={reduced ? 'none' : 'slide'}
          className={cn(
            'flex flex-col gap-4',
            !reduced && 'animate-in fade-in-0 slide-in-from-right-4 duration-200',
          )}
        >
          <SlideImage index={index} alt={slide.alt} />
          <div className="flex flex-col gap-2">
            <DialogTitle ref={titleRef} tabIndex={-1} className="outline-none">
              {slide.headline}
            </DialogTitle>
            <DialogDescription className="text-base leading-6 text-text-secondary">
              {slide.body}
            </DialogDescription>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t bg-popover p-3 sm:p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground" data-testid="onboarding-position">
            {index + 1} of {SLIDE_COUNT}
          </p>
          <div role="group" aria-label="Slides" className="flex items-center">
            {SLIDES.map((s, i) => (
              <button
                key={s.id}
                type="button"
                aria-label={`Go to slide ${i + 1} of ${SLIDE_COUNT}`}
                aria-current={i === index ? 'step' : undefined}
                onClick={() => setIndex(i)}
                className="group grid h-11 w-8 place-items-center outline-none sm:h-8 sm:w-6"
              >
                <span
                  className={cn(
                    'size-2.5 rounded-full border border-primary transition-colors group-focus-visible:outline-solid group-focus-visible:outline-3 group-focus-visible:outline-offset-2 group-focus-visible:outline-ring',
                    i === index ? 'bg-primary' : 'bg-transparent',
                  )}
                />
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="ghost" onClick={back}>
            {BACK_LABEL}
          </Button>
          <Button type="button" variant="ghost" onClick={skip}>
            {SKIP_LABEL}
          </Button>
          <div className="ml-auto flex flex-wrap justify-end gap-2">
            {last ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => onClose({ outcome: 'completed', to: SECONDARY_CTA.to })}
              >
                {SECONDARY_CTA.label}
              </Button>
            ) : null}
            <Button
              type="button"
              onClick={() =>
                last ? onClose({ outcome: 'completed', to: PRIMARY_CTA.to }) : next()
              }
            >
              {last ? PRIMARY_CTA.label : NEXT_LABEL}
            </Button>
          </div>
        </div>
      </div>
      <LiveRegion message={`${position}: ${slide.headline}`} seq={index} />
    </DialogContent>
  );
}
