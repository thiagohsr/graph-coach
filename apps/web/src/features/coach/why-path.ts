import type { DecisionPathDto } from '@coach/types';

// Why-path view model (data-model.md §4). Pure: the same response always gives the same picture.

export type Orientation = 'LR' | 'TB';

export interface PathNodeVM {
  id: string;
  kind: string;
  kindLabel: string;
  roleLabel?: string;
  title: string;
  depth: number;
  position: { x: number; y: number };
  details: [string, string][];
}

export interface PathEdgeVM {
  id: string;
  source: string;
  target: string;
  label: string;
  weight?: number;
}

export interface WhyPathVM {
  steps: string[];
  nodes: PathNodeVM[];
  edges: PathEdgeVM[];
  rootId: string | null;
  droppedEdges: number;
  isEmpty: boolean;
}

const KIND_LABELS: Record<string, string> = {
  Decision: 'Decision',
  Agent: 'Agent',
  Learner: 'Learner',
  Puzzle: 'Puzzle',
  Concept: 'Concept',
  Session: 'Session',
  Question: 'Question',
  Goal: 'Goal',
  Task: 'Task',
  Chunk: 'Passage',
};

const ROLE_LABELS: Record<string, string> = {
  target: 'Target',
  driver: 'Weak concept',
  alternative: 'Alternative',
  answer: 'Missed answer',
  session: 'Session',
  passage: 'Passage',
};

const EDGE_TYPE_PHRASES: Record<string, string> = {
  MADE: 'made',
  FOR: 'for',
  RECOMMENDED: 'recommends',
  BECAUSE: 'because',
  PREREQUISITE_OF: 'prerequisite of',
  ANSWERED: 'answered',
  TESTS: 'tests',
};

export function kindOf(label: string): { kind: string; kindLabel: string } {
  const known = KIND_LABELS[label];
  return known ? { kind: label, kindLabel: known } : { kind: 'other', kindLabel: label };
}

export function edgeTypePhrase(type: string): string {
  return EDGE_TYPE_PHRASES[type] ?? type.toLowerCase().replace(/_/g, ' ');
}

function formatDate(value: number | string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function detailsOf(props: Record<string, unknown>): [string, string][] {
  const out: [string, string][] = [];
  for (const [key, value] of Object.entries(props)) {
    if (out.length >= 6) break;
    if (typeof value === 'number' && key.endsWith('At')) {
      out.push([key, formatDate(value) ?? String(value)]);
    } else if (typeof value === 'string' && key.endsWith('At') && formatDate(value)) {
      out.push([key, formatDate(value) as string]);
    } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out.push([key, String(value)]);
    }
  }
  return out;
}

export function buildWhyPath(dto: DecisionPathDto, orientation: Orientation = 'LR'): WhyPathVM {
  const ids = new Set(dto.nodes.map((n) => n.id));
  const validEdges = dto.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  const droppedEdges = dto.edges.length - validEdges.length;

  const rootId =
    dto.nodes.find((n) => n.label === 'Decision')?.id ??
    dto.nodes.find((n) => !validEdges.some((e) => e.to === n.id))?.id ??
    dto.nodes[0]?.id ??
    null;

  // Breadth-first distance from the root, edges taken as undirected.
  const adjacency = new Map<string, string[]>();
  for (const e of validEdges) {
    adjacency.set(e.from, [...(adjacency.get(e.from) ?? []), e.to]);
    adjacency.set(e.to, [...(adjacency.get(e.to) ?? []), e.from]);
  }
  const depths = new Map<string, number>();
  if (rootId !== null) {
    depths.set(rootId, 0);
    const queue = [rootId];
    for (let i = 0; i < queue.length; i++) {
      const current = queue[i] as string;
      for (const next of adjacency.get(current) ?? []) {
        if (!depths.has(next)) {
          depths.set(next, (depths.get(current) as number) + 1);
          queue.push(next);
        }
      }
    }
  }
  const maxDepth = Math.max(0, ...depths.values());

  const roles = new Map<string, string>();
  for (const e of validEdges) {
    if (e.type === 'BECAUSE' && e.role && !roles.has(e.to)) roles.set(e.to, e.role);
  }

  const byDepth = new Map<number, typeof dto.nodes>();
  for (const n of dto.nodes) {
    const depth = depths.get(n.id) ?? maxDepth + 1;
    byDepth.set(depth, [...(byDepth.get(depth) ?? []), n]);
  }
  const nodes: PathNodeVM[] = [];
  for (const [depth, group] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
    const sorted = [...group].sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    sorted.forEach((n, index) => {
      const role = roles.get(n.id);
      const vm: PathNodeVM = {
        id: n.id,
        ...kindOf(n.label),
        title: n.title,
        depth,
        position: orientation === 'LR' ? { x: depth * 260, y: index * 110 } : { x: index * 200, y: depth * 140 },
        details: detailsOf(n.props),
      };
      if (role !== undefined) vm.roleLabel = ROLE_LABELS[role] ?? role;
      nodes.push(vm);
    });
  }

  const edges: PathEdgeVM[] = validEdges.map((e, index) => {
    const vm: PathEdgeVM = {
      id: `${e.from}|${e.type}|${e.to}|${index}`,
      source: e.from,
      target: e.to,
      label: e.reason ?? edgeTypePhrase(e.type),
    };
    if (e.weight !== undefined) vm.weight = e.weight;
    return vm;
  });

  return {
    steps: dto.steps,
    nodes,
    edges,
    rootId,
    droppedEdges,
    isEmpty: dto.nodes.length === 0 || dto.steps.length === 0,
  };
}

/** Stroke width in three steps from a 0..1 weight. */
export function strokeWidthFor(weight: number | undefined): number {
  if (weight === undefined) return 1.5;
  if (weight >= 0.66) return 4;
  if (weight >= 0.33) return 2.5;
  return 1.5;
}
