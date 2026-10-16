import dagre from '@dagrejs/dagre';
import type { Orientation, PathNodeVM, WhyPathVM } from './why-path';

// Display model for the why-path graph. Pure: the same view model always gives the same picture.
// The full response stays in the text list; here repeated evidence is aggregated and noise is dropped:
//  - Agent and Learner nodes are not drawn (the page is already about this learner, the Decision says who decided),
//  - Question nodes become one "N missed questions" node per concept they test,
//  - Session nodes become one "N sessions" node, Passage nodes one "N passages" node,
//  - "Also considered" concepts are drawn only when asked for, and faded.

export const NODE_WIDTH = 172;
export const NODE_WIDTH_NARROW = 150;
export const nodeWidth = (o: Orientation) => (o === 'LR' ? NODE_WIDTH : NODE_WIDTH_NARROW);
export const NODE_HEIGHT = 88;

export type DisplayTier = 'story' | 'evidence' | 'context';

export interface DisplayNode {
  id: string;
  kind: string;
  kindLabel: string;
  roleLabel?: string;
  role?: string;
  title: string;
  subtitle?: string;
  tier: DisplayTier;
  faded: boolean;
  details: [string, string][];
  /** Individual items behind an aggregated node, listed in the details panel. */
  items: string[];
  position: { x: number; y: number };
}

export interface DisplayEdge {
  id: string;
  source: string;
  target: string;
  /** Short label always drawn on main-story edges. */
  label?: string;
  /** Label drawn only while an end of the edge is hovered or selected. */
  hoverLabel?: string;
  style: 'recommended' | 'prerequisite' | 'evidence';
  faded: boolean;
}

export interface DisplayGraph {
  nodes: DisplayNode[];
  edges: DisplayEdge[];
  width: number;
  height: number;
  hasAlternatives: boolean;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function buildDisplayGraph(
  model: WhyPathVM,
  options: { orientation: Orientation; showAlternatives: boolean },
): DisplayGraph {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const kindOfId = (id: string) => byId.get(id)?.kind;
  const hasAlternatives = model.nodes.some((n) => n.kind === 'Concept' && n.role === 'alternative');
  const hiddenConcept = (n: PathNodeVM) =>
    n.kind === 'Concept' && n.role === 'alternative' && !options.showAlternatives;

  const nodes = new Map<string, DisplayNode>();
  const edges = new Map<string, DisplayEdge>();
  const addEdge = (e: Omit<DisplayEdge, 'id'>) => {
    const id = `${e.source}>${e.target}`;
    if (!edges.has(id)) edges.set(id, { id, ...e });
  };
  const tierOf = (n: PathNodeVM): DisplayTier =>
    n.kind === 'Decision' || n.kind === 'Puzzle' || n.kind === 'Concept' ? 'story' : 'context';

  // Plain nodes: Decision, Puzzle, Concept and anything we have no special treatment for.
  const aggregated = new Set(['Question', 'Session', 'Chunk', 'Agent', 'Learner']);
  const agent = model.nodes.find((n) => n.kind === 'Agent');
  for (const n of model.nodes) {
    if (aggregated.has(n.kind) || hiddenConcept(n)) continue;
    const display: DisplayNode = {
      id: n.id,
      kind: n.kind,
      kindLabel: n.kindLabel,
      title: n.title,
      tier: tierOf(n),
      faded: n.kind === 'Concept' && n.role === 'alternative',
      details: n.details,
      items: [],
      position: { x: 0, y: 0 },
    };
    if (n.roleLabel) display.roleLabel = n.roleLabel;
    if (n.role) display.role = n.role;
    if (n.kind === 'Decision' && agent) display.subtitle = `decided by the ${agent.title}`;
    nodes.set(n.id, display);
  }

  const edgesOf = (type: string) => model.edges.filter((e) => e.type === type);
  const decisionId =
    model.nodes.find((n) => n.kind === 'Decision')?.id ?? model.rootId ?? undefined;
  const puzzle = model.nodes.find((n) => n.kind === 'Puzzle');

  // Why a concept is on the page (the BECAUSE reason) goes into its details, not onto an edge.
  for (const e of edgesOf('BECAUSE')) {
    const target = nodes.get(e.target);
    if (target && target.kind === 'Concept' && e.label !== 'because')
      target.details = [['why', e.label], ...target.details];
  }

  // Story spine: Decision -> Puzzle -> target concept -> concepts that depend on it.
  const prerequisiteEdges = edgesOf('PREREQUISITE_OF').filter(
    (e) => nodes.has(e.source) && nodes.has(e.target),
  );
  const dependent = new Set(prerequisiteEdges.map((e) => e.target));
  if (decisionId && puzzle && nodes.has(decisionId) && nodes.has(puzzle.id)) {
    addEdge({
      source: decisionId,
      target: puzzle.id,
      label: 'recommends',
      style: 'recommended',
      faded: false,
    });
  }
  for (const e of edgesOf('RECOMMENDED')) {
    if (nodes.has(e.source) && nodes.has(e.target))
      addEdge({
        source: e.source,
        target: e.target,
        label: 'recommends',
        style: 'recommended',
        faded: false,
      });
  }
  for (const e of edgesOf('BECAUSE')) {
    const concept = nodes.get(e.target);
    if (!concept || concept.kind !== 'Concept' || !nodes.has(e.source)) continue;
    if (dependent.has(concept.id)) continue; // shown through its prerequisite edge
    const from = concept.role === 'target' && puzzle && nodes.has(puzzle.id) ? puzzle.id : e.source;
    addEdge({
      source: from,
      target: concept.id,
      style: concept.faded ? 'evidence' : 'recommended',
      faded: concept.faded,
    });
  }
  for (const e of prerequisiteEdges) {
    addEdge({
      source: e.source,
      target: e.target,
      label: 'prerequisite of',
      style: 'prerequisite',
      faded: nodes.get(e.target)?.faded === true,
    });
  }
  // Other links between plain nodes (goals, tasks, ...): quiet, labelled on hover only.
  const handled = new Set([
    'BECAUSE',
    'MADE',
    'FOR',
    'RECOMMENDED',
    'PREREQUISITE_OF',
    'TESTS',
    'ANSWERED',
  ]);
  for (const e of model.edges) {
    if (handled.has(e.type) || !nodes.has(e.source) || !nodes.has(e.target)) continue;
    addEdge({
      source: e.source,
      target: e.target,
      hoverLabel: e.label,
      style: 'evidence',
      faded: false,
    });
  }
  for (const e of edgesOf('BECAUSE')) {
    const target = nodes.get(e.target);
    if (target && target.kind !== 'Concept' && nodes.has(e.source)) {
      addEdge({
        source: e.source,
        target: target.id,
        hoverLabel: e.label,
        style: 'evidence',
        faded: false,
      });
    }
  }

  // Missed questions: one node per visible concept they test.
  const questions = model.nodes.filter((n) => n.kind === 'Question');
  const questionReason = new Map<string, string>();
  for (const e of edgesOf('BECAUSE'))
    if (kindOfId(e.target) === 'Question' && !questionReason.has(e.target))
      questionReason.set(e.target, e.label);
  const conceptsOfQuestion = new Map<string, string[]>();
  for (const e of edgesOf('TESTS')) {
    if (kindOfId(e.source) === 'Question' && nodes.has(e.target)) {
      conceptsOfQuestion.set(e.source, [...(conceptsOfQuestion.get(e.source) ?? []), e.target]);
    }
  }
  const testedAnywhere = new Set(
    edgesOf('TESTS')
      .filter((e) => kindOfId(e.source) === 'Question')
      .map((e) => e.source),
  );
  const groups = new Map<string, { conceptId: string | null; items: string[] }>();
  for (const q of questions) {
    const line = `${q.title}${questionReason.get(q.id) && questionReason.get(q.id) !== 'because' ? ` (${questionReason.get(q.id)})` : ''}`;
    const targets = conceptsOfQuestion.get(q.id) ?? [];
    if (targets.length === 0 && testedAnywhere.has(q.id)) continue; // only tests concepts that are hidden
    for (const conceptId of targets.length > 0 ? targets : [null]) {
      const key = conceptId ?? 'none';
      const group = groups.get(key) ?? { conceptId, items: [] };
      group.items.push(line);
      groups.set(key, group);
    }
  }
  const questionGroupOf = new Map<string, string>();
  for (const [key, group] of groups) {
    const id = `agg:questions:${key}`;
    const concept = group.conceptId ? nodes.get(group.conceptId) : undefined;
    nodes.set(id, {
      id,
      kind: 'Question',
      kindLabel: 'Missed questions',
      title: plural(group.items.length, 'missed question', 'missed questions'),
      ...(concept ? { subtitle: `on ${concept.title}` } : {}),
      tier: 'evidence',
      faded: concept?.faded === true,
      details: concept ? [['concept', concept.title]] : [],
      items: group.items,
      position: { x: 0, y: 0 },
    });
    questionGroupOf.set(key, id);
    const from = concept?.id ?? decisionId;
    if (from && nodes.has(from))
      addEdge({
        source: from,
        target: id,
        hoverLabel: 'tests',
        style: 'evidence',
        faded: concept?.faded === true,
      });
  }

  // Sessions: one node, linked from the concepts whose questions were answered in them.
  const sessions = model.nodes.filter((n) => n.kind === 'Session');
  if (sessions.length > 0) {
    const conceptIds = new Set<string>();
    for (const e of edgesOf('ANSWERED')) {
      if (kindOfId(e.source) !== 'Session') continue;
      for (const c of conceptsOfQuestion.get(e.target) ?? []) conceptIds.add(c);
    }
    const id = 'agg:sessions';
    nodes.set(id, {
      id,
      kind: 'Session',
      kindLabel: 'Sessions',
      title: plural(sessions.length, 'recent session', 'recent sessions'),
      tier: 'evidence',
      faded: false,
      details: [],
      items: sessions.map((s) => s.title),
      position: { x: 0, y: 0 },
    });
    const linked = [...conceptIds].filter((c) => nodes.has(c));
    for (const from of linked.length > 0 ? linked : decisionId ? [decisionId] : []) {
      if (nodes.has(from))
        addEdge({
          source: from,
          target: id,
          hoverLabel: 'answered in',
          style: 'evidence',
          faded: false,
        });
    }
  }

  // Passages: one node.
  const passages = model.nodes.filter((n) => n.kind === 'Chunk');
  if (passages.length > 0) {
    const id = 'agg:passages';
    nodes.set(id, {
      id,
      kind: 'Chunk',
      kindLabel: 'Passages',
      title: plural(passages.length, 'source passage', 'source passages'),
      tier: 'evidence',
      faded: false,
      details: [],
      items: passages.map((p) => p.title),
      position: { x: 0, y: 0 },
    });
    if (decisionId && nodes.has(decisionId))
      addEdge({
        source: decisionId,
        target: id,
        hoverLabel: 'because',
        style: 'evidence',
        faded: false,
      });
  }

  // Layered layout with real node sizes: columns follow the story, evidence sits to the right of what it explains.
  const horizontal = options.orientation === 'LR';
  const width = nodeWidth(options.orientation);
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: horizontal ? 'LR' : 'TB',
    nodesep: horizontal ? 28 : 16,
    ranksep: horizontal ? 84 : 44,
    marginx: 16,
    marginy: 16,
  });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes.values()) g.setNode(n.id, { width, height: NODE_HEIGHT });
  for (const e of edges.values()) g.setEdge(e.source, e.target);
  dagre.layout(g);
  for (const n of nodes.values()) {
    const p = g.node(n.id);
    n.position = { x: Math.round(p.x - width / 2), y: Math.round(p.y - NODE_HEIGHT / 2) };
  }
  const graph = g.graph();
  return {
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    width: Math.ceil(graph.width ?? 0),
    height: Math.ceil(graph.height ?? 0),
    hasAlternatives,
  };
}
