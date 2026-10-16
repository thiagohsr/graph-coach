import type { CSSProperties } from 'react';
import { useReducedMotion } from '~/lib/a11y/use-reduced-motion';

/**
 * Landing hero illustration, drawn inline so it costs no request and follows the theme tokens.
 *
 * IMAGE SLOT: this component is a stand-in for the generated hero in
 * docs/brand/image-prompts/hero-illustrations.md ("a learner's path lighting up through a concept
 * graph"). To swap it, render an <img>/<picture> of the same footprint in its place: 3:2
 * (1800x1200) from `lg` up, 16:9 (1920x1080) on small screens, with a light and a dark twin, and
 * keep the figure's accessible name. The page does not depend on anything else in this file.
 *
 * Motion: the path draws and the nodes light up once on load. With prefers-reduced-motion the
 * picture is shown fully lit and still (data-animate="false"; the keyframes live in app.css).
 */

const BACKGROUND_EDGES: [number, number, number, number][] = [
  [90, 80, 170, 135],
  [170, 135, 250, 60],
  [250, 60, 340, 100],
  [340, 100, 420, 40],
  [420, 40, 510, 110],
  [170, 135, 150, 230],
  [150, 230, 60, 290],
  [420, 40, 480, 20],
  [330, 340, 420, 300],
  [420, 300, 520, 330],
  [520, 330, 560, 250],
  [250, 340, 330, 340],
  [250, 340, 205, 300],
];
const BACKGROUND_NODES: [number, number][] = [
  [90, 80],
  [170, 135],
  [250, 60],
  [340, 100],
  [420, 40],
  [510, 110],
  [150, 230],
  [60, 290],
  [480, 20],
  [330, 340],
  [420, 300],
  [520, 330],
  [560, 250],
  [250, 340],
  [205, 300],
];

/** The learner's path, left to right and rising; the last point is the next blank. */
const PATH: [number, number][] = [
  [58, 360],
  [150, 318],
  [255, 262],
  [350, 232],
  [440, 170],
  [525, 112],
];
const STEP = 330; // ms between nodes
const START = 250;

function step(i: number): string {
  return `${START + i * STEP}ms`;
}

export function HeroGraph({ className }: { className?: string }) {
  const reduced = useReducedMotion();
  const target = PATH[PATH.length - 1]!;
  return (
    <figure
      className={className}
      data-animate={reduced ? 'false' : 'true'}
      data-testid="hero-graph"
      role="img"
      aria-label="A learner's path lighting up node by node through a concept graph, ending at the next blank to fill in."
    >
      <div className="rounded-2xl border bg-card p-3 shadow-sm sm:p-5">
        <svg viewBox="0 0 600 390" className="block h-auto w-full" aria-hidden="true">
          <g className="stroke-graph/35" strokeWidth="1.5" fill="none" strokeLinecap="round">
            {BACKGROUND_EDGES.map(([x1, y1, x2, y2]) => (
              <line key={`${x1}-${y1}-${x2}-${y2}`} x1={x1} y1={y1} x2={x2} y2={y2} />
            ))}
          </g>
          <g className="fill-graph-soft stroke-graph/60" strokeWidth="1.5">
            {BACKGROUND_NODES.map(([cx, cy]) => (
              <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="9" />
            ))}
          </g>

          {/* path edges */}
          <g
            className="stroke-primary"
            strokeWidth="4"
            fill="none"
            strokeLinecap="round"
            data-part="path"
          >
            {PATH.slice(1).map(([x2, y2], i) => {
              const [x1, y1] = PATH[i]!;
              return (
                <line
                  key={`e${i}`}
                  className="hg-edge"
                  pathLength={1}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  style={{ '--d': step(i) } as CSSProperties}
                />
              );
            })}
          </g>

          {/* path nodes: a soft violet base, then the teal fill lights up on top */}
          {PATH.slice(0, -1).map(([cx, cy], i) => (
            <g key={`n${i}`}>
              <circle
                cx={cx}
                cy={cy}
                r="15"
                className="fill-graph-soft stroke-graph"
                strokeWidth="2"
              />
              <circle
                className="hg-lit fill-primary stroke-card"
                cx={cx}
                cy={cy}
                r="13"
                strokeWidth="2"
                style={{ '--d': step(i) } as CSSProperties}
              />
              <path
                className="hg-lit stroke-primary-foreground"
                d={`M${cx - 5} ${cy} l3.5 3.5 l6.5 -7`}
                fill="none"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ '--d': step(i) } as CSSProperties}
              />
            </g>
          ))}

          {/* the next blank: a hollow rounded square with a halo */}
          <rect
            className="hg-halo stroke-primary/50"
            x={target[0] - 30}
            y={target[1] - 30}
            width="60"
            height="60"
            rx="16"
            fill="none"
            strokeWidth="3"
            style={{ '--d': step(PATH.length - 1) } as CSSProperties}
          />
          <rect
            className="fill-card stroke-primary"
            x={target[0] - 20}
            y={target[1] - 20}
            width="40"
            height="40"
            rx="10"
            strokeWidth="2.5"
            strokeDasharray="6 5"
          />
        </svg>

        {/* the fill-in-the-blank sentence */}
        <div className="-mt-6 ml-auto w-[min(100%,21rem)] rounded-xl border bg-surface-raised p-4 shadow-lg sm:-mt-12 sm:mr-2">
          <p className="font-mono text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
            Next puzzle
          </p>
          <p className="mt-1 text-base leading-7 font-medium text-foreground">
            In a graph, every concept is a{' '}
            <span className="mx-0.5 inline-block h-7 w-20 translate-y-2 rounded-md border-2 border-dashed border-primary bg-primary-soft" />{' '}
            joined to others by edges.
          </p>
          <div className="mt-3 flex gap-2">
            {['node', 'edge', 'table'].map((w) => (
              <span
                key={w}
                className="rounded-md border border-input bg-card px-3 py-1 text-sm font-medium"
              >
                {w}
              </span>
            ))}
          </div>
        </div>
      </div>
    </figure>
  );
}
