import { useEffect, useState, type CSSProperties } from 'react';
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
 * Motion, one CYCLE: the violet graph branches out from its roots (edges draw parent to child, nodes pop in
 * as an edge reaches them), then the teal path draws and lights up node by node, the picture holds, and
 * then rewinds: the teal path retracts from the blank back to its start and the violet graph folds back
 * from its leaves to its roots, so the next run (the drawing is remounted to restart its one-shot
 * keyframes) starts from the same empty canvas. With
 * prefers-reduced-motion the picture is shown fully drawn and still (data-animate="false"; the keyframes
 * live in app.css).
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
const CYCLE = 6000; // one full run: branch out, draw the path, hold, rewind; then the drawing remounts
const BRANCH_START = 150;
const BRANCH_STEP = 230; // ms per level of the violet branching
const EDGE_MS = 520; // hg-draw duration
const STEP = 330; // ms between teal path nodes
// Rewind: the halo goes, the teal path retracts from the blank back to its start, then the violet graph
// folds back from its leaves to its roots, ending empty just before the next run starts from empty.
const REWIND = 4400;
const RETRACT_STEP = 150; // ms between teal edges retracting
const RETRACT_MS = 300; // hg-undraw duration
const FOLD_START = 5000; // the violet fold-back overlaps the end of the teal retract
const FOLD_STEP = 110; // ms per level of the violet fold-back

type Point = [number, number];
const keyOf = ([x, y]: Point) => `${x},${y}`;

/**
 * Breadth-first order of the violet graph: each component grows from its first listed node, every edge
 * is drawn from the node nearer the root, and a node pops in when the edge reaching it finishes.
 */
function branchOrder() {
  const adjacency = new Map<string, Point[]>();
  for (const [x1, y1, x2, y2] of BACKGROUND_EDGES) {
    const a: Point = [x1, y1];
    const b: Point = [x2, y2];
    adjacency.set(keyOf(a), [...(adjacency.get(keyOf(a)) ?? []), b]);
    adjacency.set(keyOf(b), [...(adjacency.get(keyOf(b)) ?? []), a]);
  }
  const nodeDelay = new Map<string, number>();
  const nodeDepth = new Map<string, number>();
  const edges: { from: Point; to: Point; delay: number; depth: number }[] = [];
  for (const root of BACKGROUND_NODES) {
    if (nodeDelay.has(keyOf(root))) continue;
    nodeDelay.set(keyOf(root), BRANCH_START);
    nodeDepth.set(keyOf(root), 0);
    const queue: [Point, number][] = [[root, 0]];
    while (queue.length > 0) {
      const [node, depth] = queue.shift()!;
      for (const next of adjacency.get(keyOf(node)) ?? []) {
        if (nodeDelay.has(keyOf(next))) continue;
        const delay = BRANCH_START + depth * BRANCH_STEP;
        edges.push({ from: node, to: next, delay, depth: depth + 1 });
        nodeDelay.set(keyOf(next), delay + EDGE_MS * 0.8);
        nodeDepth.set(keyOf(next), depth + 1);
        queue.push([next, depth + 1]);
      }
    }
  }
  const end = Math.max(...edges.map((e) => e.delay)) + EDGE_MS;
  // Fold-back: deepest first; a node pops out as the edge reaching it starts to retract, roots last.
  const maxDepth = Math.max(...nodeDepth.values());
  const foldAt = (depth: number) => FOLD_START + (maxDepth - depth) * FOLD_STEP;
  const edgeExit = edges.map((e) => foldAt(e.depth));
  const nodeExit = new Map([...nodeDepth].map(([key, depth]) => [key, foldAt(depth)]));
  return { edges, nodeDelay, end, edgeExit, nodeExit };
}

const BRANCH = branchOrder();
// The teal path starts once the violet graph has finished growing.
const START = BRANCH.end + 150;

function step(i: number): string {
  return `${START + i * STEP}ms`;
}

/** Teal edge i retracts last-first; node i goes out once the edge after it has retracted onto it. */
function retract(i: number): string {
  return `${REWIND + RETRACT_STEP + (PATH.length - 2 - i) * RETRACT_STEP}ms`;
}
function unlight(i: number): string {
  return `${REWIND + RETRACT_STEP + (PATH.length - 2 - i) * RETRACT_STEP + RETRACT_MS}ms`;
}

const vars = (entries: Record<string, string>) => entries as CSSProperties;

export function HeroGraph({ className }: { className?: string }) {
  const reduced = useReducedMotion();
  const target = PATH[PATH.length - 1]!;
  // Bumping the key remounts the drawing, which replays its one-shot animations.
  const [cycle, setCycle] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const timer = setInterval(() => setCycle((c) => c + 1), CYCLE);
    return () => clearInterval(timer);
  }, [reduced]);
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
          <g key={cycle}>
            {/* the violet graph branches out from its roots */}
            <g className="stroke-graph/35" strokeWidth="1.5" fill="none" strokeLinecap="round">
              {BRANCH.edges.map(({ from: [x1, y1], to: [x2, y2], delay }, i) => (
                <line
                  key={`${x1}-${y1}-${x2}-${y2}`}
                  className="hg-edge"
                  pathLength={1}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  style={vars({ '--d': `${delay}ms`, '--x': `${BRANCH.edgeExit[i]}ms` })}
                />
              ))}
            </g>
            <g className="fill-graph-soft stroke-graph/60" strokeWidth="1.5">
              {BACKGROUND_NODES.map((point) => (
                <circle
                  key={keyOf(point)}
                  className="hg-lit"
                  cx={point[0]}
                  cy={point[1]}
                  r="9"
                  style={vars({
                    '--d': `${BRANCH.nodeDelay.get(keyOf(point)) ?? 0}ms`,
                    '--x': `${BRANCH.nodeExit.get(keyOf(point)) ?? FOLD_START}ms`,
                  })}
                />
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
                    style={vars({ '--d': step(i), '--x': retract(i) })}
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
                  style={vars({ '--d': step(i), '--x': unlight(i) })}
                />
                <path
                  className="hg-lit stroke-primary-foreground"
                  d={`M${cx - 5} ${cy} l3.5 3.5 l6.5 -7`}
                  fill="none"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={vars({ '--d': step(i), '--x': unlight(i) })}
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
              style={vars({ '--d': step(PATH.length - 1), '--x': `${REWIND}ms` })}
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
          </g>
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
