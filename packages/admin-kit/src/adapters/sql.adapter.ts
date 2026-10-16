import { assertResolved, sqlColumnOf, storedFields, type ResolvedAdminModel } from '../declaration';
import type { AdminAdapter, AdminRow, SqlPort } from './adapter';
import { buildSqlCount, buildSqlDetail, buildSqlList, buildSqlUpdate } from './sql.builder';

function sqlModel(model: ResolvedAdminModel): ResolvedAdminModel {
  assertResolved(model);
  if (model.source !== 'sql') throw new Error(`Model ${model.name} is not a sql model`);
  return model;
}

/** Maps result columns back to field keys through the declaration (`created_at` -> `createdAt`). */
function mapRow(model: ResolvedAdminModel, raw: Record<string, unknown>): AdminRow {
  const row: AdminRow = {};
  for (const field of storedFields(model)) {
    const column = sqlColumnOf(field);
    if (Object.hasOwn(raw, column)) row[field.key] = raw[column];
  }
  return row;
}

export function createSqlAdapter(port: SqlPort): AdminAdapter {
  const getRow = async (model: ResolvedAdminModel, id: string): Promise<AdminRow | null> => {
    sqlModel(model);
    const built = buildSqlDetail(model, id);
    const rows = await port.execute(built.text, built.params);
    return rows[0] ? mapRow(model, rows[0]) : null;
  };

  return {
    async list(model, params) {
      sqlModel(model);
      const list = buildSqlList(model, params);
      const count = buildSqlCount(model, params);
      const [rows, counts] = await Promise.all([
        port.execute(list.text, list.params),
        port.execute(count.text, count.params),
      ]);
      const total = counts[0]?.total;
      return {
        rows: rows.map((row) => mapRow(model, row)),
        total: typeof total === 'number' ? total : Number(total ?? 0),
      };
    },

    get: getRow,

    async update(model, id, changes) {
      sqlModel(model);
      const built = buildSqlUpdate(model, id, changes);
      if (!built) return getRow(model, id);
      const rows = await port.execute(built.text, built.params);
      return rows[0] ? mapRow(model, rows[0]) : null;
    },

    async links() {
      return [];
    },
  };
}
