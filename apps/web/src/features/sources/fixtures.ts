import type { SourceDetailDto, SourceSummaryDto, TaskDto } from '@coach/types';

/** Test fixtures for the sources feature (shapes of packages/types/src/curator.ts). */
export const usage = { modelCalls: 0, inputTokens: 0, outputTokens: 0, embeddingTokens: 0 };

export function taskDto(over: Partial<TaskDto> = {}): TaskDto {
  return {
    id: 't-1',
    kind: 'ingest',
    status: 'in_progress',
    result: null,
    usage,
    steps: [],
    produced: { concepts: 0, questions: 0 },
    sourceId: 'src-1',
    ...over,
  };
}

export const sourceSummaries: SourceSummaryDto[] = [
  {
    id: 'src-1',
    title: 'Interview notes',
    kind: 'markdown',
    origin: 'upload',
    chunkCount: 12,
    conceptCount: 7,
    taskId: 't-1',
    taskStatus: 'awaiting_review',
    createdAt: '2026-10-14T09:00:00.000Z',
    access: 'owner',
    ownerName: 'Me',
  },
  {
    id: 'src-2',
    title: 'Shared reading',
    kind: 'text',
    origin: 'upload',
    chunkCount: 5,
    conceptCount: 3,
    puzzleId: 'pz-2',
    taskId: 't-2',
    taskStatus: 'done',
    createdAt: '2026-10-13T09:00:00.000Z',
    access: 'shared',
    ownerName: 'Bea Souza',
  },
  {
    id: 'src-3',
    title: 'B-tree drills',
    kind: 'prompt',
    origin: 'prompt',
    chunkCount: 0,
    conceptCount: 0,
    puzzleId: 'pz-3',
    taskId: 't-3',
    taskStatus: 'done',
    createdAt: '2026-10-12T09:00:00.000Z',
    access: 'owner',
    ownerName: 'Me',
  },
];

export const uploadDetail: SourceDetailDto = {
  id: 'src-1',
  title: 'Interview notes',
  kind: 'markdown',
  origin: 'upload',
  createdAt: '2026-10-14T09:00:00.000Z',
  access: 'owner',
  ownerName: 'Me',
  content: 'First line of the notes.\nSecond line, with **markdown** kept as text.',
  puzzleId: 'pz-1',
};

export const promptDetail: SourceDetailDto = {
  id: 'src-3',
  title: 'B-tree drills',
  kind: 'prompt',
  origin: 'prompt',
  createdAt: '2026-10-12T09:00:00.000Z',
  access: 'owner',
  ownerName: 'Me',
  brief: { subject: 'B-tree indexes', focus: 'page splits', difficulty: 'medium', sentences: 5 },
};
