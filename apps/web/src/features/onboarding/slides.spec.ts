import { describe, expect, it } from 'vitest';
import { SLIDES, SLIDE_COUNT, slideImageSrc } from './slides';

const words = (text: string) => text.trim().split(/\s+/).length;

describe('slides (SC-O07)', () => {
  it('has exactly seven slides with unique ids', () => {
    expect(SLIDE_COUNT).toBe(7);
    expect(new Set(SLIDES.map((s) => s.id)).size).toBe(7);
  });

  it.each(SLIDES.map((s, i) => [i + 1, s] as const))(
    'slide %i has a headline of at most 8 words, a body of at most 30 words, and alt text',
    (_n, slide) => {
      expect(words(slide.headline)).toBeLessThanOrEqual(8);
      expect(words(slide.body)).toBeLessThanOrEqual(30);
      expect(slide.alt.length).toBeGreaterThan(20);
    },
  );

  it('uses the real interface labels', () => {
    const text = SLIDES.map((s) => s.body).join(' ');
    for (const label of [
      'What next?',
      'Why this?',
      'Create a puzzle',
      'Review drafts',
      'How it works',
    ]) {
      expect(text).toContain(label);
    }
  });

  it('keeps slide 5 generic about the allowance (no numbers)', () => {
    expect(SLIDES[4]!.body).not.toMatch(/\d/);
    expect(SLIDES[4]!.body).toContain('a few of each every month');
  });

  it('names the image files slide-1.webp to slide-7.webp, with optional dark twins', () => {
    expect(slideImageSrc(0)).toBe('/onboarding/slide-1.webp');
    expect(slideImageSrc(6)).toBe('/onboarding/slide-7.webp');
    expect(slideImageSrc(2, 'dark')).toBe('/onboarding/slide-3-dark.webp');
  });
});
