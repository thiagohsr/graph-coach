// buildDecisionPath: turns the uniform rows of `decision_path` into nodes, edges, and ordered text steps
// (data-model.md section 3.10). Pure. The query already whitelists properties; this repeats the whitelist.
import type { PathRow } from './rows';

export type PathLabel =
  | 'Decision'
  | 'Agent'
  | 'Learner'
  | 'Puzzle'
  | 'Concept'
  | 'Session'
  | 'Question'
  | 'Chunk'
  | 'Goal'
  | 'Task';

export interface PathNode {
  id: string;
  label: PathLabel;
  title: string;
  props: Record<string, unknown>;
}

export type PathRole = 'target' | 'driver' | 'alternative' | 'answer' | 'session' | 'passage';

export interface PathEdge {
  from: string;
  to: string;
  type: string;
  reason?: string;
  weight?: number;
  role?: PathRole;
}

export interface DecisionPath {
  nodes: PathNode[];
  edges: PathEdge[];
  steps: string[];
}

const LABELS: readonly string[] = [
  'Decision',
  'Agent',
  'Learner',
  'Puzzle',
  'Concept',
  'Session',
  'Question',
  'Chunk',
  'Goal',
  'Task',
];
const ROLES: readonly string[] = [
  'target',
  'driver',
  'alternative',
  'answer',
  'session',
  'passage',
];
const ROLE_ORDER: Record<string, number> = {
  target: 0,
  driver: 1,
  alternative: 2,
  answer: 3,
  session: 4,
  passage: 5,
};

const WHITELIST: Record<PathLabel, readonly string[]> = {
  Decision: ['kind', 'summary', 'createdAt', 'flags'],
  Agent: ['name'],
  Learner: ['displayName'],
  Puzzle: ['name'],
  Concept: ['name', 'slug'],
  Question: ['sentence'],
  Session: ['submittedAt', 'score', 'maxScore', 'puzzleId', 'puzzleName'],
  Chunk: ['excerpt', 'sourceTitle'],
  Goal: ['text'],
  Task: ['kind', 'status'],
};
const TIME_KEYS = new Set(['createdAt', 'submittedAt']);

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const cut = (text: string, n: number): string => (text.length > n ? text.slice(0, n) : text);
const iso = (ms: number): string => new Date(ms).toISOString();

function isLabel(value: string): value is PathLabel {
  return LABELS.includes(value);
}

function cleanProps(label: PathLabel, data: Record<string, unknown>): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const key of WHITELIST[label]) {
    const value = data[key];
    if (value === null || value === undefined) continue;
    props[key] = TIME_KEYS.has(key) && typeof value === 'number' ? iso(value) : value;
  }
  return props;
}

function titleOf(label: PathLabel, id: string, props: Record<string, unknown>): string {
  const str = (key: string): string | undefined =>
    typeof props[key] === 'string' && props[key] !== '' ? (props[key] as string) : undefined;
  switch (label) {
    case 'Decision':
      return 'Coach decision';
    case 'Agent':
      return str('name') ?? id;
    case 'Learner':
      return str('displayName') ?? 'Learner';
    case 'Puzzle':
    case 'Concept':
      return str('name') ?? id;
    case 'Question':
      return cut(str('sentence') ?? id, 80);
    case 'Session': {
      const when =
        typeof props.submittedAt === 'string' ? `, ${props.submittedAt.slice(0, 10)}` : '';
      return `Session on ${str('puzzleName') ?? 'a puzzle'}${when}`;
    }
    case 'Chunk':
      return `Passage from ${str('sourceTitle') ?? 'a source'}`;
    case 'Goal':
      return cut(str('text') ?? id, 80);
    case 'Task':
      return 'Coverage request';
  }
}

export function buildDecisionPath(rows: PathRow[]): DecisionPath {
  // Nodes: one per (label, id); data from every row that mentions the node is merged.
  const raw = new Map<string, { label: PathLabel; id: string; data: Record<string, unknown> }>();
  const touch = (label: string, id: string, data: Record<string, unknown>): void => {
    if (!isLabel(label)) return;
    const key = `${label}\u0000${id}`;
    const entry = raw.get(key) ?? { label, id, data: {} };
    for (const [k, v] of Object.entries(data)) if (v !== null && v !== undefined) entry.data[k] = v;
    raw.set(key, entry);
  };
  for (const row of rows) {
    touch(row.fromLabel, row.fromId, row.fromData);
    touch(row.toLabel, row.toId, row.toData);
  }
  const nodes: PathNode[] = [...raw.values()].map(({ label, id, data }) => {
    const props = cleanProps(label, data);
    return { id, label, title: titleOf(label, id, props), props };
  });
  const nodeOf = (label: string, id: string): PathNode | undefined =>
    nodes.find((n) => n.label === label && n.id === id);

  // Edges: one per row; BECAUSE edges carry role and weight, in role order.
  const partOrder = [
    'made',
    'for',
    'recommended',
    'because',
    'passage',
    'chain',
    'answered',
    'tests',
    'toward',
    'targets',
    'requested',
    'concerns',
  ];
  const ordered = [...rows].sort((a, b) => {
    const pa = partOrder.indexOf(a.part);
    const pb = partOrder.indexOf(b.part);
    if (pa !== pb) return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb);
    if (a.part === 'because') {
      return (
        (ROLE_ORDER[a.role ?? ''] ?? 9) - (ROLE_ORDER[b.role ?? ''] ?? 9) ||
        (b.weight ?? 0) - (a.weight ?? 0) ||
        cmp(a.toId, b.toId)
      );
    }
    return cmp(a.fromId, b.fromId) || cmp(a.toId, b.toId);
  });
  const edges: PathEdge[] = [];
  const seen = new Set<string>();
  for (const row of ordered) {
    const key = [row.fromId, row.toId, row.type, row.role ?? ''].join('\u0000');
    if (seen.has(key)) continue;
    seen.add(key);
    const edge: PathEdge = { from: row.fromId, to: row.toId, type: row.type, reason: row.reason };
    if (row.type === 'BECAUSE') {
      if (row.weight !== null) edge.weight = row.weight;
      if (row.role !== null && ROLES.includes(row.role)) edge.role = row.role as PathRole;
    }
    edges.push(edge);
  }

  const titleById = (label: string, id: string): string => nodeOf(label, id)?.title ?? id;
  const steps: string[] = [];

  // (1) the recommendation line
  const recommended = rows.find((r) => r.part === 'recommended');
  steps.push(
    recommended
      ? `The Coach recommended the puzzle "${titleById('Puzzle', recommended.toId)}".`
      : 'The Coach found no playable puzzle for this learner yet.',
  );

  const because = rows.filter((r) => r.part === 'because');
  const byRole = (role: string) => because.filter((r) => r.role === role);
  const line = (row: PathRow): string => `${titleById(row.toLabel, row.toId)} — ${row.reason}.`;

  // (2) the target
  for (const row of byRole('target')) steps.push(line(row));

  // (3) each driver by weight descending, followed by the chain edges from the target to that driver
  const chain = rows.filter((r) => r.part === 'chain');
  const emittedChain = new Set<string>();
  const targets = byRole('target').map((r) => r.toId);
  const drivers = [...byRole('driver')].sort(
    (a, b) => (b.weight ?? 0) - (a.weight ?? 0) || cmp(a.toId, b.toId),
  );
  for (const driver of drivers) {
    steps.push(line(driver));
    for (const edge of chainTo(chain, targets, driver.toId)) {
      const key = `${edge.fromId}>${edge.toId}`;
      if (emittedChain.has(key)) continue;
      emittedChain.add(key);
      steps.push(
        `${titleById('Concept', edge.fromId)} is a prerequisite of ${titleById('Concept', edge.toId)}.`,
      );
    }
  }

  // (4) answers by weight descending then id
  const answers = [...byRole('answer')].sort(
    (a, b) => (b.weight ?? 0) - (a.weight ?? 0) || cmp(a.toId, b.toId),
  );
  for (const row of answers) {
    const sentence = nodeOf('Question', row.toId)?.props.sentence;
    const text = typeof sentence === 'string' ? sentence : titleById('Question', row.toId);
    steps.push(`Question "${text}" — ${row.reason}.`);
  }

  // (5) sessions by submittedAt descending
  const sessions = [...byRole('session')].sort((a, b) => {
    const ta = String(nodeOf('Session', a.toId)?.props.submittedAt ?? '');
    const tb = String(nodeOf('Session', b.toId)?.props.submittedAt ?? '');
    return cmp(tb, ta) || cmp(a.toId, b.toId);
  });
  for (const row of sessions) steps.push(line(row));

  // (6) goal, passage, and task lines. A passage line exists only for a returned passage row, so a viewer without
  // source access gets the same steps minus those lines.
  for (const row of rows.filter((r) => r.part === 'toward')) {
    steps.push(`The Coach was working toward your goal "${titleById('Goal', row.toId)}".`);
  }
  for (const row of rows.filter((r) => r.part === 'passage')) steps.push(line(row));
  const requested = rows.filter((r) => r.part === 'requested');
  if (requested.length > 0) {
    const concerned = [
      ...new Set(
        rows.filter((r) => r.part === 'concerns').map((r) => titleById('Concept', r.toId)),
      ),
    ].sort();
    steps.push(
      concerned.length > 0
        ? `The Coach asked the Curator for new puzzles on: ${concerned.join(', ')}.`
        : 'The Coach asked the Curator for new puzzles.',
    );
  }

  // (7) the alternatives
  const alternatives = byRole('alternative').sort(
    (a, b) => (b.weight ?? 0) - (a.weight ?? 0) || cmp(a.toId, b.toId),
  );
  if (alternatives.length > 0) {
    steps.push(
      `Also considered: ${alternatives.map((r) => titleById('Concept', r.toId)).join(', ')}.`,
    );
  }

  return { nodes, edges, steps };
}

/** The chain edges that lie on a walk from a target to the driver, breadth first from the target. */
function chainTo(chain: PathRow[], targets: string[], driverId: string): PathRow[] {
  const outgoing = new Map<string, PathRow[]>();
  for (const edge of chain) outgoing.set(edge.fromId, [...(outgoing.get(edge.fromId) ?? []), edge]);
  const canReachDriver = (from: string, visited = new Set<string>()): boolean => {
    if (from === driverId) return true;
    if (visited.has(from)) return false;
    visited.add(from);
    return (outgoing.get(from) ?? []).some((e) => canReachDriver(e.toId, visited));
  };
  const result: PathRow[] = [];
  const queue = [...targets];
  const visited = new Set<string>(queue);
  while (queue.length > 0) {
    const current = queue.shift()!;
    const next = [...(outgoing.get(current) ?? [])].sort((a, b) => cmp(a.toId, b.toId));
    for (const edge of next) {
      if (!canReachDriver(edge.toId)) continue;
      result.push(edge);
      if (!visited.has(edge.toId)) {
        visited.add(edge.toId);
        queue.push(edge.toId);
      }
    }
  }
  return result;
}
