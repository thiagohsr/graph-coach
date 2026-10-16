# Onboarding images

Drop the generated pictures for the first-run carousel (spec 009) here. No code change is needed: the carousel
loads `/onboarding/slide-N.webp` and shows a drawn placeholder for any slide whose file is missing or fails.

| Slide                                      | File           | Optional dark twin  |
| ------------------------------------------ | -------------- | ------------------- |
| 1. Study with a coach that remembers       | `slide-1.webp` | `slide-1-dark.webp` |
| 2. Fill the blanks, one word at a time     | `slide-2.webp` | `slide-2-dark.webp` |
| 3. Every answer updates what you know      | `slide-3.webp` | `slide-3-dark.webp` |
| 4. Ask what next, then see why             | `slide-4.webp` | `slide-4-dark.webp` |
| 5. Turn your notes into new puzzles        | `slide-5.webp` | `slide-5-dark.webp` |
| 6. You review drafts; only you see sources | `slide-6.webp` | `slide-6-dark.webp` |
| 7. Ready? Start with one puzzle            | `slide-7.webp` | `slide-7-dark.webp` |

- **Size**: 1600 x 1200 px (4:3), WebP. Keep each file small (aim for under 150 KB). The picture is shown at up to
  about 520 px wide, cropped with `object-cover`, so keep the subject away from the edges.
- **Dark variants**: optional. Under a dark colour scheme the app tries `slide-N-dark.webp` first and falls back to
  `slide-N.webp`, then to the placeholder. A light picture on a dark page is fine if you make no dark twin.
- **Text**: no text inside the pictures. Meaning is carried by the slide copy and the alt text in
  `apps/web/src/features/onboarding/slides.ts`.
- **Prompts**: `docs/brand/image-prompts/onboarding-carousel.md`.
- Images load from the app's own origin (no CDN) and only the first is loaded eagerly; the next one is warmed when a
  slide is shown.
