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
import { useMemo, useState } from 'react';
import { cn } from '~/lib/utils';
import { Button } from '~/components/ui/button';
import { useReducedMotion } from '~/lib/a11y/use-reduced-motion';
import { strokeWidthFor, type Orientation, type PathNodeVM, type WhyPathVM } from './why-path';

type PathNodeData = { vm: PathNodeVM; orientation: Orientation };

/** Node look by kind (design-system "Why-path graph"): puzzle teal, concepts violet, evidence quiet. */
function nodeShape(vm: PathNodeVM): string {
  if (vm.kind === 'Puzzle') return 'rounded-md border-[1.5px] border-primary bg-primary-soft';
  if (vm.kind === 'Concept') {
    return vm.role === 'target'
      ? 'rounded-3xl border-2 border-graph bg-graph-soft'
      : 'rounded-3xl border-[1.5px] border-graph bg-graph-soft';
  }
  if (vm.kind === 'Decision') return 'rounded-md border-[1.5px] border-input bg-card shadow-xs';
  return 'rounded-md border border-input bg-muted text-[13px]';
}

/** Kind and role are written as text in the node, never colour only. */
function PathNode({ data }: NodeProps<Node<PathNodeData>>) {
  const { vm, orientation } = data;
  const horizontal = orientation === 'LR';
  return (
    <div className={cn('w-[200px] px-3 py-2 text-sm text-foreground', nodeShape(vm))}>
      <Handle type="target" position={horizontal ? Position.Left : Position.Top} isConnectable={false} />
      <div className={cn('font-mono text-[11px] leading-4 font-medium tracking-[0.06em] uppercase', vm.kind === 'Puzzle' ? 'text-primary' : vm.kind === 'Concept' ? 'text-graph' : 'text-muted-foreground')}>
        {vm.kindLabel}
        {vm.roleLabel ? ` · ${vm.roleLabel}` : ''}
      </div>
      <div className="line-clamp-3 font-semibold break-words">{vm.title}</div>
      <Handle type="source" position={horizontal ? Position.Right : Position.Bottom} isConnectable={false} />
    </div>
  );
}

function edgeColor(type: string): string {
  if (type === 'RECOMMENDED') return 'var(--primary)';
  if (type === 'PREREQUISITE_OF') return 'var(--graph)';
  return 'var(--muted-foreground)';
}

/** Edges differ by dash pattern and arrowhead as well as colour. */
function edgeStyle(type: string, width: number): React.CSSProperties {
  if (type === 'RECOMMENDED' || type === 'PREREQUISITE_OF') return { strokeWidth: Math.max(width, 2), stroke: edgeColor(type) };
  return { strokeWidth: Math.min(width, 2), stroke: edgeColor(type), strokeDasharray: '5 4' };
}

const nodeTypes = { path: PathNode };

function ZoomControls() {
  const flow = useReactFlow();
  const reduced = useReducedMotion();
  const options = { duration: reduced ? 0 : 200 };
  return (
    <Panel position="top-right" className="flex gap-1">
      <Button type="button" size="sm" variant="outline" onClick={() => void flow.zoomIn(options)}>
        Zoom in
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={() => void flow.zoomOut(options)}>
        Zoom out
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={() => void flow.fitView(options)}>
        Fit
      </Button>
    </Panel>
  );
}

export default function WhyPathGraph({ model, orientation }: { model: WhyPathVM; orientation: Orientation }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const nodes = useMemo<Node<PathNodeData>[]>(
    () =>
      model.nodes.map((vm) => ({
        id: vm.id,
        type: 'path',
        position: vm.position,
        data: { vm, orientation },
        draggable: false,
        connectable: false,
      })),
    [model, orientation],
  );
  const edges = useMemo<Edge[]>(
    () =>
      model.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label,
        markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor(e.type) },
        style: edgeStyle(e.type, strokeWidthFor(e.weight)),
        labelStyle: { fontSize: e.type === 'PREREQUISITE_OF' ? 12 : 11, fill: 'var(--text-secondary)', fontFamily: e.type === 'PREREQUISITE_OF' ? undefined : 'var(--font-mono)' },
        labelBgStyle: { fill: 'var(--card)', fillOpacity: 1 },
        labelBgPadding: [4, 2],
        labelBgBorderRadius: 4,
        className: e.type === 'RECOMMENDED' ? 'why-edge-primary' : e.type === 'PREREQUISITE_OF' ? 'why-edge-graph' : 'why-edge-evidence',
        focusable: false,
      })),
    [model],
  );
  const selected = model.nodes.find((n) => n.id === selectedId) ?? null;

  return (
    <div className="flex flex-col gap-3">
      <div className="h-[420px] w-full overflow-hidden rounded-lg border bg-card shadow-xs">
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
            fitView
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={24} size={1.5} color="var(--border)" />
            <ZoomControls />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
      {selected && (
        <div className="rounded-lg border bg-card p-4 text-sm shadow-sm" aria-live="polite">
          <p className="font-semibold">
            {selected.kindLabel}
            {selected.roleLabel ? ` · ${selected.roleLabel}` : ''}: {selected.title}
          </p>
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
        </div>
      )}
    </div>
  );
}
