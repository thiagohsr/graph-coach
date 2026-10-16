import { cn } from '~/lib/utils';

export type MasteryStep = 1 | 2 | 3 | 4 | 5;

export const MASTERY_LABELS: Record<MasteryStep, string> = { 1: 'Weak', 2: 'Shaky', 3: 'Developing', 4: 'Good', 5: 'Strong' };

/**
 * Display band of a score the server sent (design-system "Concept chip"). This only picks a colour and a label;
 * the client never computes mastery.
 */
export function masteryStep(score: number): MasteryStep {
  if (score >= 0.8) return 5;
  if (score >= 0.6) return 4;
  if (score >= 0.4) return 3;
  if (score >= 0.2) return 2;
  return 1;
}

const CHIP_COLORS: Record<MasteryStep, string> = {
  1: 'bg-mastery-1-bg text-mastery-1-fg',
  2: 'bg-mastery-2-bg text-mastery-2-fg',
  3: 'bg-mastery-3-bg text-mastery-3-fg',
  4: 'bg-mastery-4-bg text-mastery-4-fg',
  5: 'bg-mastery-5-bg text-mastery-5-fg',
};

/** Five bars, `step` of them filled, in `currentColor`: the level is readable without colour. */
export function MasteryPips({ step, className }: { step: MasteryStep; className?: string }) {
  return (
    <span aria-hidden="true" className={cn('inline-flex gap-0.5', className)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <i key={n} className={cn('h-3 w-[5px] rounded-[2px] bg-current', n <= step ? 'opacity-100' : 'opacity-[0.22]')} />
      ))}
    </span>
  );
}

/** Pips, optional name, and level label on the step's colours. `name` is shown before the label. */
export function ConceptChip({ step, name, showLabel = true, className }: { step: MasteryStep; name?: string; showLabel?: boolean; className?: string }) {
  return (
    <span
      data-mastery-step={step}
      className={cn('inline-flex items-center gap-2 rounded-full py-1.5 pr-3 pl-2 text-[13px] leading-[18px] font-semibold', CHIP_COLORS[step], className)}
    >
      <MasteryPips step={step} />
      {name}
      {showLabel && <span className={cn('font-medium', name && 'before:content-["·_"]')}>{MASTERY_LABELS[step]}</span>}
    </span>
  );
}

/** Solid mastery colour for meter bars. */
export const MASTERY_SOLID: Record<MasteryStep, string> = {
  1: 'bg-mastery-1',
  2: 'bg-mastery-2',
  3: 'bg-mastery-3',
  4: 'bg-mastery-4',
  5: 'bg-mastery-5',
};
