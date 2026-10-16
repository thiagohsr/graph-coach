// The seven slides of the first-run carousel (the design documents). Copy is verbatim from the
// storyboard; labels match the real interface. Limits (unit-tested): at most 7 slides, headline at most
// 8 words, body at most 30 words. Slide 5 stays generic about the allowance on purpose (no live call).

export interface Slide {
  id: string;
  headline: string;
  body: string;
  /** Meaning of the image; also used as the placeholder's accessible name. */
  alt: string;
}

export const SLIDES: readonly Slide[] = [
  {
    id: 'what-it-is',
    headline: 'Study with a coach that remembers',
    body: 'Graph Coach gives you fill-in-the-blank puzzles and keeps a map of what you know, so it can help you choose what to study next.',
    alt: 'A blank puzzle tile beside three small connected dots, with a small round guide waiting nearby.',
  },
  {
    id: 'play',
    headline: 'Fill the blanks, one word at a time',
    body: 'Each sentence has gaps. Tap a blank, then a word from the word bank, or drag it in. When every blank is filled, choose "Submit answers".',
    alt: 'A puzzle sentence with two gaps; one gap holds a word chip and four more chips wait below as the word bank.',
  },
  {
    id: 'remembers',
    headline: 'Every answer updates what you know',
    body: 'Each concept in your Mastery view gets a level from weak to strong. Missed answers lower it, right answers raise it. Joins is still weak. Foreign key is not.',
    alt: 'A small graph of connected concepts. Foreign key shows five pips and looks solid; Joins shows one pip and glows rust, marking it as weak.',
  },
  {
    id: 'why',
    headline: 'Ask what next, then see why',
    body: 'Choose "What next?" and the Coach picks a puzzle. Open "Why this?" to see the path: your weak concept, what it builds on, and the puzzle that helps.',
    alt: 'A path from the weak Joins node through a related concept to a highlighted puzzle tile, with other concepts faded below because they were not chosen.',
  },
  {
    id: 'create',
    headline: 'Turn your notes into new puzzles',
    body: 'Under "Create a puzzle", describe what to practise or use your own material. You get a few of each every month, and codes can add more.',
    alt: 'A page of notes feeds three small helper shapes that pass along and shape a new puzzle tile.',
  },
  {
    id: 'review-share',
    headline: 'You review drafts; only you see sources',
    body: 'New questions wait in "Review drafts" until you approve them. Your notes stay private. If you share a puzzle by e-mail, you decide whether the source goes too.',
    alt: "A new puzzle tile with a check mark on it. Your notes sit inside a closed boundary, and one thin line reaches out to a friend's node to show sharing.",
  },
  {
    id: 'start',
    headline: 'Ready? Start with one puzzle',
    body: 'Pick a puzzle, or ask the Coach "What next?". You can reopen this guide any time from the account menu under "How it works".',
    alt: 'The same desk as the first slide, now with the puzzle tile filled in and the dots connected, showing progress.',
  },
] as const;

export const SLIDE_COUNT = SLIDES.length;

export const NEXT_LABEL = 'Next';
export const BACK_LABEL = 'Back';
export const SKIP_LABEL = 'Skip';
export const PRIMARY_CTA = { label: 'Play a puzzle', to: '/puzzles' } as const;
export const SECONDARY_CTA = { label: 'Create a puzzle', to: '/sources/new' } as const;

/** Where the images go: see apps/web/public/onboarding/README.md. */
export function slideImageSrc(index: number, variant: 'light' | 'dark' = 'light'): string {
  return `/onboarding/slide-${index + 1}${variant === 'dark' ? '-dark' : ''}.webp`;
}
