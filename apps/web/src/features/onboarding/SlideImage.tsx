import { useState } from 'react';
import { useTheme } from '~/lib/theme/theme';
import { slideImageSrc } from './slides';
import { SlidePlaceholder } from './SlidePlaceholder';

/**
 * One slide's picture at 4:3. The CSS/SVG placeholder is always underneath, so layout never shifts and a missing,
 * slow, or broken file shows the placeholder, never a broken-image icon. Tries `slide-N-dark.webp` first under the
 * dark theme, then `slide-N.webp` (public/onboarding/README.md).
 */
export function SlideImage({ index, alt }: { index: number; alt: string }) {
  const dark = useTheme().theme === 'dark';
  const candidates = dark
    ? [slideImageSrc(index, 'dark'), slideImageSrc(index)]
    : [slideImageSrc(index)];
  const [failures, setFailures] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const src = candidates[failures];

  return (
    <div
      className="relative aspect-[4/3] w-full overflow-hidden rounded-lg border bg-muted"
      data-testid="slide-image"
    >
      <div aria-hidden={loaded ? 'true' : undefined} className="absolute inset-0">
        <SlidePlaceholder index={index} alt={alt} />
      </div>
      {src ? (
        <img
          key={src}
          src={src}
          alt={loaded ? alt : ''}
          width={1600}
          height={1200}
          loading={index === 0 ? 'eager' : 'lazy'}
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => {
            setLoaded(false);
            setFailures((n) => n + 1);
          }}
          className={`absolute inset-0 size-full object-cover ${loaded ? '' : 'invisible'}`}
        />
      ) : null}
    </div>
  );
}
