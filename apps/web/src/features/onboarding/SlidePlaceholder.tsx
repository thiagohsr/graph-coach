import type { ReactNode } from 'react';

// Stand-in artwork for the onboarding images (4:3, same footprint as the 1600x1200 files), drawn inline in the
// design-system palette with the node and edge motif. Shown while an image loads, when none exists, and when
// one fails. Replaced by /onboarding/slide-N.webp without any code change (see public/onboarding/README.md).

const mastery = (n: 1 | 2 | 3 | 4 | 5) => `var(--mastery-${n})`;

function Node({
  x,
  y,
  r = 12,
  tone = 'graph',
}: {
  x: number;
  y: number;
  r?: number;
  tone?: 'graph' | 'faded';
}) {
  return (
    <circle
      cx={x}
      cy={y}
      r={r}
      strokeWidth="2"
      className={tone === 'graph' ? 'fill-graph-soft stroke-graph' : 'fill-muted stroke-border'}
    />
  );
}

function Edge({
  a,
  b,
  w = 2,
  faded = false,
  teal = false,
}: {
  a: [number, number];
  b: [number, number];
  w?: number;
  faded?: boolean;
  teal?: boolean;
}) {
  return (
    <line
      x1={a[0]}
      y1={a[1]}
      x2={b[0]}
      y2={b[1]}
      strokeWidth={w}
      strokeLinecap="round"
      className={teal ? 'stroke-primary' : faded ? 'stroke-border' : 'stroke-graph/50'}
    />
  );
}

function Tile({
  x,
  y,
  s = 64,
  dashed = false,
  filled = false,
  halo = false,
}: {
  x: number;
  y: number;
  s?: number;
  dashed?: boolean;
  filled?: boolean;
  halo?: boolean;
}) {
  return (
    <g>
      {halo ? (
        <rect
          x={x - 8}
          y={y - 8}
          width={s + 16}
          height={s + 16}
          rx="18"
          fill="none"
          strokeWidth="3"
          className="stroke-primary/40"
        />
      ) : null}
      <rect
        x={x}
        y={y}
        width={s}
        height={s}
        rx="12"
        strokeWidth="2.5"
        strokeDasharray={dashed ? '7 6' : undefined}
        className={filled ? 'fill-primary-soft stroke-primary' : 'fill-card stroke-primary'}
      />
    </g>
  );
}

function Chip({
  x,
  y,
  w = 44,
  filled = false,
}: {
  x: number;
  y: number;
  w?: number;
  filled?: boolean;
}) {
  return (
    <rect
      x={x}
      y={y}
      width={w}
      height="20"
      rx="6"
      strokeWidth="1.5"
      className={filled ? 'fill-primary stroke-primary' : 'fill-card stroke-input'}
    />
  );
}

function Bars({ x, y, widths }: { x: number; y: number; widths: number[] }) {
  return (
    <g className="fill-border">
      {widths.map((w, i) => (
        <rect key={i} x={x} y={y + i * 14} width={w} height="6" rx="3" />
      ))}
    </g>
  );
}

function Guide({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r="9" className="fill-primary" />
      <circle cx={x + 3} cy={y - 2} r="2" className="fill-primary-foreground" />
    </g>
  );
}

function Pips({ x, y, n }: { x: number; y: number; n: number }) {
  return (
    <g>
      {Array.from({ length: 5 }, (_, i) => (
        <circle
          key={i}
          cx={x + i * 10}
          cy={y}
          r="3"
          className={i < n ? 'fill-foreground' : 'fill-none stroke-input'}
          strokeWidth="1"
        />
      ))}
    </g>
  );
}

const ART: ReactNode[] = [
  // 1. A blank tile, three loose nodes, a guide waiting
  <g key="1">
    <Tile x={50} y={110} s={90} dashed />
    <Edge a={[240, 120]} b={[290, 160]} faded />
    <Node x={240} y={120} />
    <Node x={290} y={160} />
    <Node x={250} y={200} />
    <Guide x={350} y={250} />
  </g>,
  // 2. A sentence with two slots, one filled, and a word bank
  <g key="2">
    <rect
      x="50"
      y="60"
      width="300"
      height="110"
      rx="14"
      strokeWidth="2.5"
      className="fill-card stroke-primary"
    />
    <Bars x={70} y={84} widths={[90]} />
    <rect
      x="170"
      y="78"
      width="60"
      height="22"
      rx="6"
      strokeWidth="2"
      strokeDasharray="5 4"
      className="fill-card stroke-primary"
    />
    <Bars x={240} y={84} widths={[70]} />
    <Bars x={70} y={122} widths={[60]} />
    <rect x="140" y="116" width="60" height="22" rx="6" className="fill-primary" />
    <Bars x={210} y={122} widths={[100]} />
    <Chip x={50} y={210} />
    <Chip x={110} y={210} w={52} />
    <Chip x={178} y={210} w={40} />
    <Chip x={234} y={210} w={56} />
    <Node x={365} y={40} r={9} />
  </g>,
  // 3. Foreign key solid with five pips; Joins weak with one pip and an amber ring
  <g key="3">
    <Edge a={[110, 150]} b={[290, 150]} />
    <Edge a={[110, 150]} b={[120, 60]} faded />
    <Edge a={[290, 150]} b={[300, 240]} faded />
    <Node x={120} y={60} r={9} tone="faded" />
    <Node x={300} y={240} r={9} tone="faded" />
    <circle cx="110" cy="150" r="34" style={{ fill: mastery(5) }} />
    <Pips x={90} y={198} n={5} />
    <circle cx="290" cy="150" r="26" fill="none" strokeWidth="4" style={{ stroke: mastery(2) }} />
    <circle cx="290" cy="150" r="20" style={{ fill: mastery(1) }} />
    <Pips x={270} y={190} n={1} />
  </g>,
  // 4. Weak node, related node, highlighted puzzle tile; thicker line toward the puzzle
  <g key="4">
    <Node x={90} y={170} r={9} tone="faded" />
    <Node x={150} y={235} r={9} tone="faded" />
    <Node x={260} y={240} r={9} tone="faded" />
    <Edge a={[90, 170]} b={[150, 235]} faded />
    <Edge a={[60, 110]} b={[150, 110]} w={2} teal />
    <Edge a={[150, 110]} b={[240, 110]} w={5} teal />
    <circle cx="60" cy="110" r="18" style={{ fill: mastery(1) }} />
    <circle cx="150" cy="110" r="14" className="fill-graph-soft stroke-graph" strokeWidth="2" />
    <Tile x={250} y={78} s={64} halo />
    <circle cx="100" cy="80" r="3" className="fill-primary" />
    <circle cx="195" cy="80" r="3" className="fill-primary" />
    <circle cx="282" cy="62" r="3" className="fill-primary" />
  </g>,
  // 5. A page of notes, three helper shapes, a new puzzle tile
  <g key="5">
    <path d="M40 70 H100 L120 90 V190 H40 Z" strokeWidth="2.5" className="fill-card stroke-input" />
    <Bars x={54} y={108} widths={[56, 46, 52, 38]} />
    <rect x="150" y="105" width="34" height="34" rx="9" className="fill-graph" />
    <circle cx="214" cy="122" r="17" className="fill-primary" />
    <rect x="244" y="105" width="34" height="34" rx="4" className="fill-foreground" />
    <path
      d="M184 122 H197 M231 122 H244"
      strokeWidth="2.5"
      strokeDasharray="4 4"
      className="stroke-input"
    />
    <Tile x={300} y={95} s={56} filled />
    <Chip x={308} y={113} w={40} filled />
  </g>,
  // 6. A checked tile, notes inside a closed boundary, one line out to another learner
  <g key="6">
    <Tile x={50} y={60} s={72} filled />
    <path
      d="M70 98 l11 11 l22 -26"
      fill="none"
      strokeWidth="5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="stroke-primary"
    />
    <circle cx="160" cy="140" r="26" fill="none" strokeWidth="2.5" className="stroke-primary" />
    <rect
      x="40"
      y="170"
      width="170"
      height="90"
      rx="22"
      fill="none"
      strokeWidth="2.5"
      strokeDasharray="8 6"
      className="stroke-input"
    />
    <Node x={100} y={215} r={14} />
    <Node x={150} y={230} r={9} />
    <Edge a={[150, 230]} b={[210, 215]} faded />
    <Edge a={[210, 215]} b={[320, 200]} w={2} teal />
    <Node x={330} y={198} r={14} />
  </g>,
  // 7. The first desk, finished: filled tile, connected nodes, node moving toward amber, guide at ease
  <g key="7">
    <Tile x={50} y={110} s={90} filled />
    <Chip x={73} y={145} w={44} filled />
    <Edge a={[240, 120]} b={[290, 160]} />
    <Edge a={[290, 160]} b={[250, 200]} />
    <Edge a={[240, 120]} b={[250, 200]} />
    <Node x={240} y={120} />
    <Node x={290} y={160} />
    <circle
      cx="250"
      cy="200"
      r="13"
      strokeWidth="3"
      style={{ fill: mastery(2), stroke: mastery(1) }}
    />
    <Edge a={[140, 155]} b={[240, 120]} w={4} teal />
    <Guide x={190} y={250} />
  </g>,
];

/** Pure artwork, no text. `alt` is the accessible name. */
export function SlidePlaceholder({ index, alt }: { index: number; alt: string }) {
  return (
    <svg
      viewBox="0 0 400 300"
      role="img"
      aria-label={alt}
      data-testid="slide-placeholder"
      className="block size-full"
    >
      <rect width="400" height="300" className="fill-muted" />
      {ART[index]}
    </svg>
  );
}
