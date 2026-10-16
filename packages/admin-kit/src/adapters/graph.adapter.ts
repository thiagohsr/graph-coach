import type { AdminLink, AdminValue } from '@coach/types';
import { assertResolved, editableFields, type ResolvedAdminModel } from '../declaration';
import { ADMIN_MAX_LINK_ITEMS } from '../limits';
import type { AdminAdapter, AdminListParams, AdminRow, GraphPort } from './adapter';
import { buildGraphQueries, graphLinkQueryName, graphQueryName } from './graph.cypher';

function asCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function asText(value: unknown): string | null {
  if (typeof value === 'string' && value !== '') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return null;
}

function graphModel(model: ResolvedAdminModel): ResolvedAdminModel {
  assertResolved(model);
  if (model.source !== 'graph') throw new Error(`Model ${model.name} is not a graph model`);
  return model;
}

/**
 * Registers every generated statement for every graph model once, through the port, then runs them by name. Request
 * values only ever arrive as parameters.
 */
export function createGraphAdapter(
  port: GraphPort,
  models: readonly ResolvedAdminModel[],
): AdminAdapter {
  for (const model of models) {
    if (model.source !== 'graph') continue;
    for (const query of buildGraphQueries(model)) port.register(query);
  }

  const getRow = async (model: ResolvedAdminModel, id: string): Promise<AdminRow | null> => {
    graphModel(model);
    const rows = await port.run(graphQueryName(model, 'detail'), { id });
    return (rows[0] as AdminRow | undefined) ?? null;
  };

  return {
    async list(model, params: AdminListParams) {
      graphModel(model);
      const search =
        params.search !== undefined && params.search !== '' && model.searchFields.length > 0;
      const suffix = search ? '_search' : '';
      const base: Record<string, unknown> = search ? { search: params.search } : {};
      const [rows, counts] = await Promise.all([
        port.run(graphQueryName(model, search ? 'list_search' : 'list'), {
          ...base,
          skip: (params.page - 1) * params.pageSize,
          limit: params.pageSize,
        }),
        port.run(graphQueryName(model, `count${suffix}` as 'count' | 'count_search'), base),
      ]);
      return { rows: rows as AdminRow[], total: asCount(counts[0]?.total) };
    },

    get: getRow,

    async update(model, id, changes: Record<string, AdminValue>) {
      graphModel(model);
      // $props is rebuilt from the declaration's editable fields; the caller's own keys are never iterated.
      const props: Record<string, unknown> = {};
      for (const field of editableFields(model)) {
        if (Object.hasOwn(changes, field.key)) props[field.key] = changes[field.key];
      }
      if (Object.keys(props).length === 0) return getRow(model, id);
      const rows = await port.run(graphQueryName(model, 'update'), { id, props });
      return (rows[0] as AdminRow | undefined) ?? null;
    },

    async links(model, id) {
      graphModel(model);
      const links: AdminLink[] = [];
      for (const link of model.links) {
        if (link.kind === 'route') {
          links.push({
            kind: 'route',
            name: link.name,
            label: link.label,
            href: link.href.replace(':id', encodeURIComponent(id)),
          });
        } else if (link.kind === 'count') {
          const rows = await port.run(graphLinkQueryName(model, link.name), { id });
          links.push({
            kind: 'count',
            name: link.name,
            label: link.label,
            count: asCount(rows[0]?.total),
          });
        } else {
          const rows = await port.run(graphLinkQueryName(model, link.name), {
            id,
            limit: ADMIN_MAX_LINK_ITEMS + 1,
          });
          const items = rows.slice(0, ADMIN_MAX_LINK_ITEMS).flatMap((row) => {
            const itemId = asText(row.id);
            return itemId === null ? [] : [{ id: itemId, title: asText(row.title) ?? itemId }];
          });
          links.push({
            kind: 'records',
            name: link.name,
            label: link.label,
            ...(link.model !== undefined ? { model: link.model } : {}),
            items,
            truncated: rows.length > ADMIN_MAX_LINK_ITEMS,
          });
        }
      }
      return links;
    },
  };
}
