import '@xyflow/react/dist/style.css';
import {
  Background,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '~/lib/utils';
import { Button } from '~/components/ui/button';
import { useReducedMotion } from '~/lib/a11y/use-reduced-motion';
import {
  buildDisplayGraph,
  NODE_HEIGHT,
  nodeWidth,
  type DisplayEdge,
  type DisplayNode,
} from './why-graph';
import type { Orientation, WhyPathVM } from './why-path';

type PathNodeData = { vm: DisplayNode; orientation: Orientation; active: boolean };

/** Node look by kind (design-system "Why-path graph"): puzzle teal, concepts violet, evidence quiet. */
function nodeShape(vm: DisplayNode): string {
  if (vm.kind === 'Puzzle') return 'rounded-md border-[1.5px] border-primary bg-primary-soft';
  if (vm.kind === 'Concept') {
    return vm.role === 'target'
      ? 'rounded-3xl border-2 border-graph bg-graph-soft'
      : 'rounded-3xl border-[1.5px] border-graph bg-graph-soft';
  }
  if (vm.kind === 'Decision') return 'rounded-md border-[1.5px] border-input bg-card shadow-xs';
  return 'rounded-md border border-dashed border-input bg-muted';
}

function nodeLabel(vm: DisplayNode): string {
  if (vm.kind === 'Concept') {
    if (vm.role === 'target') return 'Target concept';
    if (vm.role === 'driver') return 'Weak concept';
    if (vm.role === 'alternative') return 'Alternative';
    return vm.roleLabel ? `Concept · ${vm.roleLabel}` : 'Concept';
  }
  return vm.roleLabel ? `${vm.kindLabel} · ${vm.roleLabel}` : vm.kindLabel;
}

/** Kind and role are written as text in the node, never colour only. */
function PathNode({ data }: NodeProps<Node<PathNodeData>>) {
  const { vm, orientation, active } = data;
  const horizontal = orientation === 'LR';
  return (
    <div
      style={{ width: nodeWidth(orientation), height: NODE_HEIGHT }}
      className={cn(
        'flex flex-col justify-center overflow-hidden px-3 py-2 text-foreground',
        nodeShape(vm),
        vm.faded && 'opacity-60',
        active && 'shadow-md ring-2 ring-ring ring-offset-2 ring-offset-card',
      )}
    >
      <Handle
        type="target"
        position={horizontal ? Position.Left : Position.Top}
        isConnectable={false}
      />
      <div
        className={cn(
          'truncate font-mono text-[11px] leading-4 font-medium tracking-[0.04em] uppercase',
          vm.kind === 'Puzzle'
            ? 'text-primary'
            : vm.kind === 'Concept'
              ? 'text-graph'
              : 'text-muted-foreground',
        )}
      >
        {nodeLabel(vm)}
      </div>
      <div className="line-clamp-2 text-sm leading-[18px] font-semibold break-words">
        {vm.title}
      </div>
      {vm.subtitle && (
        <div className="truncate text-xs leading-4 text-muted-foreground">{vm.subtitle}</div>
      )}
      <Handle
        type="source"
        position={horizontal ? Position.Right : Position.Bottom}
        isConnectable={false}
      />
    </div>
  );
}

const EDGE_COLOR = {
  recommended: 'var(--primary)',
  prerequisite: 'var(--graph)',
  evidence: 'var(--muted-foreground)',
} as const;

const nodeTypes = { path: PathNode };

function ZoomControls({
  fit,
  position,
}: {
  position: 'top-right' | 'bottom-right';
  fit: { padding: number; minZoom: number; maxZoom: number };
}) {
  const flow = useReactFlow();
  const reduced = useReducedMotion();
  const options = { duration: reduced ? 0 : 200 };
  return (
    <Panel position={position} className="flex gap-1">
      <Button type="button" size="sm" variant="outline" onClick={() => void flow.zoomIn(options)}>
        Zoom in
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={() => void flow.zoomOut(options)}>
        Zoom out
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => void flow.fitView({ ...fit, ...options })}
      >
        Fit
      </Button>
    </Panel>
  );
}

// Room the details panel takes over the canvas: 320 px wide plus its 12 px inset on the right (LR),
// or up to 60% of the height from the top (TB).
const PANEL_WIDTH = 332;
const PANEL_HEIGHT_SHARE = 0.6;

/** Pans the selected node into the part of the canvas the details panel leaves free. */
function KeepSelectedVisible({
  selectedId,
  orientation,
  canvasHeight,
}: {
  selectedId: string | null;
  orientation: Orientation;
  canvasHeight: number;
}) {
  const flow = useReactFlow();
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!selectedId) return;
    const node = flow.getNode(selectedId);
    if (!node) return;
    const zoom = flow.getZoom();
    const cx = node.position.x + nodeWidth(orientation) / 2;
    const cy = node.position.y + NODE_HEIGHT / 2;
    // setCenter centres the point on the whole canvas; shift it by half the panel so the node
    // lands in the middle of the free area instead.
    const target =
      orientation === 'LR'
        ? { x: cx + PANEL_WIDTH / 2 / zoom, y: cy }
        : { x: cx, y: cy - (canvasHeight * PANEL_HEIGHT_SHARE) / 2 / zoom };
    void flow.setCenter(target.x, target.y, { zoom, duration: reduced ? 0 : 250 });
  }, [selectedId, orientation, canvasHeight, flow, reduced]);
  return null;
}

function toFlowEdge(e: DisplayEdge, active: boolean): Edge {
  const color = EDGE_COLOR[e.style];
  const main = e.style !== 'evidence';
  const label = e.label ?? (active ? e.hoverLabel : undefined);
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    ...(label ? { label } : {}),
    ...(main ? { markerEnd: { type: MarkerType.ArrowClosed, color } } : {}),
    style: {
      stroke: color,
      strokeWidth: main ? 2 : 1.5,
      ...(main ? {} : { strokeDasharray: '5 4' }),
      ...(e.faded ? { opacity: 0.5 } : {}),
    },
    labelStyle: {
      fontSize: 12,
      fill: 'var(--text-secondary)',
      fontFamily: main ? undefined : 'var(--font-mono)',
    },
    labelBgStyle: { fill: 'var(--card)', fillOpacity: 1 },
    labelBgPadding: [4, 2],
    labelBgBorderRadius: 4,
    className:
      e.style === 'recommended'
        ? 'why-edge-primary'
        : e.style === 'prerequisite'
          ? 'why-edge-graph'
          : 'why-edge-evidence',
    focusable: false,
  };
}

function LegendSwatch({ className, children }: { className: string; children: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className={cn('inline-block h-3 w-5', className)} />
      {children}
    </span>
  );
}

function LegendLine({
  dashed,
  color,
  children,
}: {
  dashed?: boolean;
  color: string;
  children: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg aria-hidden="true" width="24" height="8" className="shrink-0">
        <line
          x1="0"
          y1="4"
          x2="24"
          y2="4"
          stroke={color}
          strokeWidth={dashed ? 1.5 : 2}
          strokeDasharray={dashed ? '5 4' : undefined}
        />
      </svg>
      {children}
    </span>
  );
}

const FIT = { padding: 0.06, minZoom: 0.85, maxZoom: 1 };
// Narrow screens stack the layers top to bottom, which is taller; allow a little more shrink so more fits.
const FIT_NARROW = { ...FIT, minZoom: 0.7 };

export default function WhyPathGraph({
  model,
  orientation,
}: {
  model: WhyPathVM;
  orientation: Orientation;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [showAlternatives, setShowAlternatives] = useState(false);

  const graph = useMemo(
    () => buildDisplayGraph(model, { orientation, showAlternatives }),
    [model, orientation, showAlternatives],
  );

  const nodes = useMemo<Node<PathNodeData>[]>(
    () =>
      graph.nodes.map((vm) => ({
        id: vm.id,
        type: 'path',
        position: vm.position,
        width: nodeWidth(orientation),
        height: NODE_HEIGHT,
        data: { vm, orientation, active: vm.id === selectedId },
        draggable: false,
        connectable: false,
      })),
    [graph, orientation, selectedId],
  );
  const activeId = selectedId ?? hoveredId;
  const edges = useMemo<Edge[]>(
    () =>
      graph.edges.map((e) =>
        toFlowEdge(e, activeId !== null && (e.source === activeId || e.target === activeId)),
      ),
    [graph, activeId],
  );
  const fit = orientation === 'LR' ? FIT : FIT_NARROW;
  const selected = graph.nodes.find((n) => n.id === selectedId) ?? null;
  // The canvas grows with the layout, between 360 and 560 px.
  const height = Math.min(560, Math.max(360, graph.height + 24));

  // Escape closes the details panel.
  useEffect(() => {
    if (!selectedId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div
          role="group"
          aria-label="Legend"
          className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground"
        >
          <LegendSwatch className="rounded-sm border-[1.5px] border-primary bg-primary-soft">
            Puzzle
          </LegendSwatch>
          <LegendSwatch className="rounded-full border-[1.5px] border-graph bg-graph-soft">
            Concept
          </LegendSwatch>
          <LegendSwatch className="rounded-sm border border-dashed border-input bg-muted">
            Evidence
          </LegendSwatch>
          <LegendLine color="var(--graph)">Main path (solid)</LegendLine>
          <LegendLine color="var(--muted-foreground)" dashed>
            Evidence link (dashed)
          </LegendLine>
        </div>
        {graph.hasAlternatives && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-pressed={showAlternatives}
            onClick={() => setShowAlternatives((v) => !v)}
          >
            {showAlternatives ? 'Hide alternatives' : 'Show alternatives'}
          </Button>
        )}
      </div>
      <div
        style={{ height }}
        className="relative w-full overflow-hidden rounded-lg border bg-card shadow-xs"
        data-testid="why-graph-canvas"
      >
        <ReactFlowProvider>
          <ReactFlow
            key={`${orientation}-${showAlternatives}`}
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
            fitView
            fitViewOptions={fit}
            minZoom={0.4}
            maxZoom={1.5}
            zoomOnScroll={false}
            preventScrolling={false}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onNodeMouseEnter={(_, node) => setHoveredId(node.id)}
            onNodeMouseLeave={() => setHoveredId(null)}
            onPaneClick={() => setSelectedId(null)}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={24} size={1.5} color="var(--border)" />
            <KeepSelectedVisible
              selectedId={selectedId}
              orientation={orientation}
              canvasHeight={height}
            />
            <ZoomControls
              fit={fit}
              position={orientation === 'LR' ? 'top-right' : 'bottom-right'}
            />
          </ReactFlow>
        </ReactFlowProvider>
        {/* Details sit inside the canvas, next to the clicked node, so they are seen without scrolling. */}
        {selected && (
          <aside
            aria-live="polite"
            aria-label="Node details"
            className={cn(
              'absolute z-10 overflow-y-auto rounded-lg border bg-card p-4 text-sm shadow-lg',
              orientation === 'LR' ? 'top-14 right-3 bottom-3 w-80' : 'inset-x-3 top-3 max-h-[60%]',
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold">
                {selected.kindLabel}
                {selected.roleLabel ? ` · ${selected.roleLabel}` : ''}: {selected.title}
              </p>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="-mt-1 -mr-2 size-7 shrink-0"
                aria-label="Close details"
                onClick={() => setSelectedId(null)}
              >
                <X aria-hidden="true" />
              </Button>
            </div>
            {selected.details.length > 0 && (
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                {selected.details.map(([label, value]) => (
                  <div key={label} className="contents">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="break-words">{value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {selected.items.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {selected.items.map((item, index) => (
                  <li key={index} className="break-words">
                    {item}
                  </li>
                ))}
              </ul>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
