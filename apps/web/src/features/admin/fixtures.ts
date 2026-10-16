import type { AdminDetailResponse, AdminFieldMeta, AdminModelMeta } from '@coach/types';

// An invented model that exists nowhere in the code: the admin screens render from metadata alone.
const f = (
  over: Partial<AdminFieldMeta> & Pick<AdminFieldMeta, 'name' | 'type'>,
): AdminFieldMeta => ({
  label: over.name.charAt(0).toUpperCase() + over.name.slice(1),
  required: false,
  readonly: false,
  computed: false,
  ...over,
});

export const widgetModel: AdminModelMeta = {
  name: 'widget',
  label: 'Widgets',
  group: 'Factory',
  source: 'sql',
  readOnly: false,
  idField: 'id',
  titleField: 'name',
  listDisplay: ['name', 'status', 'size'],
  searchFields: ['name'],
  ordering: ['name'],
  pageSize: 10,
  maxPageSize: 100,
  maxSearchLength: 50,
  fields: [
    f({ name: 'id', type: 'string', readonly: true }),
    f({ name: 'name', type: 'string', required: true, maxLength: 20 }),
    f({ name: 'notes', type: 'text' }),
    f({ name: 'size', type: 'integer', min: 1, max: 10 }),
    f({ name: 'ratio', type: 'number' }),
    f({ name: 'shiny', type: 'boolean' }),
    f({ name: 'status', type: 'enum', choices: ['active', 'blocked'] }),
    f({ name: 'tags', type: 'list' }),
    f({ name: 'config', type: 'json' }),
    f({ name: 'madeAt', type: 'datetime', readonly: true }),
    f({ name: 'usage', type: 'integer', readonly: true, computed: true, label: 'Usage' }),
  ],
  links: [],
};

export const widgetDetail: AdminDetailResponse = {
  record: {
    id: 'w-1',
    title: 'Sprocket',
    values: {
      id: 'w-1',
      name: 'Sprocket',
      notes: 'Round',
      size: 3,
      ratio: 1.5,
      shiny: false,
      status: 'active',
      tags: ['a', 'b'],
      config: { k: 1 },
      madeAt: '2026-10-11T09:00:00.000Z',
      usage: null,
    },
  },
  links: [],
  actions: [],
};

export const widgetItems = [
  { id: 'w-1', title: 'Sprocket', values: { name: 'Sprocket', status: 'active', size: 3 } },
  { id: 'w-2', title: 'Cog', values: { name: 'Cog', status: 'blocked', size: 5 } },
];
