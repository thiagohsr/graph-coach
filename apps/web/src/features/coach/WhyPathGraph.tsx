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
import { Button } from '~/components/ui/button';
import { useReducedMotion } from '~/lib/a11y/use-reduced-motion';
import { strokeWidthFor, type Orientation, type PathNodeVM, type WhyPathVM } from './why-path';

type PathNodeData = { vm: PathNodeVM; orientation: Orientation };

/** Kind and role are written as text in the node, never colour only. */
function PathNode({ data }: NodeProps<Node<PathNodeData>>) {
  const { vm, orientation } = data;
  const horizontal = orientation === 'LR';
  return (
    <div className="w-[200px] rounded-md border bg-card px-3 py-2 text-sm text-card-foreground shadow-sm">
      <Handle type="target" position={horizontal ? Position.Left : Position.Top} isConnectable={false} />
      <div className="text-xs font-medium uppercase text-muted-foreground">
        {vm.kindLabel}
        {vm.roleLabel ? ` · ${vm.roleLabel}` : ''}
      </div>
      <div className="line-clamp-3 break-words">{vm.title}</div>
      <Handle type="source" position={horizontal ? Position.Right : Position.Bottom} isConnectable={false} />
    </div>
  );
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
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { strokeWidth: strokeWidthFor(e.weight) },
        focusable: false,
      })),
    [model],
  );
  const selected = model.nodes.find((n) => n.id === selectedId) ?? null;

  return (
    <div className="flex flex-col gap-3">
      <div className="h-[420px] w-full rounded-md border">
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
            <Background />
            <ZoomControls />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
      {selected && (
        <div className="rounded-md border p-3 text-sm" aria-live="polite">
          <p className="font-medium">
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
