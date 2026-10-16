// Adapter and port interfaces (contracts/admin-kit-package.md section 5).
import type { AdminLink, AdminValue } from '@coach/types';
import type { ResolvedAdminModel } from '../declaration';
import type { AdminRow } from '../values';

export type { AdminRow };

/** Already validated and clamped by the caller. */
export interface AdminListParams {
  search?: string;
  page: number;
  pageSize: number;
}

export interface AdminAdapter {
  list(
    model: ResolvedAdminModel,
    params: AdminListParams,
  ): Promise<{ rows: AdminRow[]; total: number }>;
  get(model: ResolvedAdminModel, id: string): Promise<AdminRow | null>;
  update(
    model: ResolvedAdminModel,
    id: string,
    changes: Record<string, AdminValue>,
  ): Promise<AdminRow | null>;
  /** [] for sql models. */
  links(model: ResolvedAdminModel, id: string): Promise<AdminLink[]>;
}

export interface GraphPort {
  /** Start-up only. `name` matches /^admin_[a-z0-9]+(_[a-z0-9]+)+$/. */
  register(query: { name: string; cypher: string; mode: 'read' | 'write' }): void;
  run(name: string, params: Record<string, unknown>): Promise<Record<string, unknown>[]>;
}

export interface SqlPort {
  execute(text: string, params: readonly unknown[]): Promise<Record<string, unknown>[]>;
}
