// Typed handles for named queries (contracts/internal-interfaces.md §2.2). Registers nothing by itself.
import type { z } from 'zod';
import type { QueryParams } from './client';

export interface QueryOptions<T> {
  /** Each row is parsed; failure throws ROW_VALIDATION_FAILED. */
  schema?: z.ZodType<T>;
  timeoutMs?: number;
}

export interface QueryInfo {
  name: string;
  owner: string;
  mode: 'read' | 'write';
  params: string[];
  source: 'file' | 'generated';
  file?: string;
}

export interface QueryDef<P extends QueryParams, R> {
  readonly name: string;
  readonly row: z.ZodType<R>;
  /** Type-level only. */
  readonly __params?: P;
}

/** Typed handle for a query that already exists as a .cypher file. Registers nothing. */
export function typedQuery<P extends QueryParams, R>(name: string, row: z.ZodType<R>): QueryDef<P, R> {
  return { name, row };
}

export interface GeneratedQuery<R> {
  /** Must match /^admin_[a-z0-9]+(_[a-z0-9]+)+$/. */
  name: string;
  /** One Cypher statement; values only through $parameters. */
  cypher: string;
  mode: 'read' | 'write';
  /** Spec id; default '006'. */
  owner?: string;
  /** Default: z.record(z.unknown()). */
  row?: z.ZodType<R>;
}
