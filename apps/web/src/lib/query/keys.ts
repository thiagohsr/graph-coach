// Every query key of the web client (data-model.md §2). Keys are defined once, here.

export interface AdminListParams {
  search: string;
  page: number;
  pageSize: number;
}

export const keys = {
  session: ['session'] as const,
  authMode: ['auth', 'mode'] as const,

  puzzles: {
    all: ['puzzles'] as const,
    list: ['puzzles', 'list'] as const,
    shares: (id: string) => ['puzzles', id, 'shares'] as const,
    play: (puzzleId: string) => ['puzzles', 'play', puzzleId] as const,
  },

  sessions: {
    result: (id: string) => ['sessions', id, 'result'] as const,
  },

  me: {
    allowance: ['me', 'allowance'] as const,
  },

  mastery: ['mastery'] as const,

  coach: {
    latest: ['coach', 'latest'] as const,
  },

  decisions: {
    detail: (id: string) => ['decisions', id] as const,
    path: (id: string) => ['decisions', id, 'path'] as const,
  },

  sources: {
    all: ['sources'] as const,
    list: ['sources', 'list'] as const,
    detail: (id: string) => ['sources', id] as const,
  },

  tasks: {
    detail: (id: string) => ['tasks', id] as const,
  },

  review: {
    all: ['review', 'drafts'] as const,
    drafts: (params: { taskId?: string | undefined }) =>
      ['review', 'drafts', { taskId: params.taskId }] as const,
  },

  admin: {
    models: ['admin', 'models'] as const,
    lists: (model: string) => ['admin', model, 'list'] as const,
    list: (model: string, params: AdminListParams) => ['admin', model, 'list', params] as const,
    record: (model: string, id: string) => ['admin', model, 'record', id] as const,
  },
};
