// The only file in the workspace that imports `falkordb` (spec 002, SC-P03; enforced by ESLint and test/boundary.spec.ts).
import { ConstraintType, EntityType, FalkorDB, type FalkorDBOptions } from 'falkordb';
import { z } from 'zod';
import type {
  GeneratedQuery,
  QueryDef,
  QueryInfo,
  QueryOptions,
} from './define';
import { GraphKitError, GraphUnavailableError } from './errors';
import { defaultQueriesDir, loadQueryDir, prepareStatement, type LoadedQuery } from './loader';
import { mapRow } from './mapping';
import { createRepository, type GraphRepository, type RepositoryOptions } from './repository';
import type { NodeLabel } from './schema';

/** A value that can be bound to a Cypher parameter. */
export type CypherValue =
  string | number | boolean | null | CypherValue[] | { [key: string]: CypherValue };

export type QueryParams = Record<string, CypherValue>;

export interface GraphLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface GraphKitOptions {
  host: string;
  port: number;
  username?: string;
  password?: string;
  /** 'coach' in the application. */
  graphName: string;
  /** Default: the package's queries/ directory. */
  queriesDir?: string;
  /** Default 10_000. */
  defaultTimeoutMs?: number;
  /** Receives query name and duration, never parameter values. */
  logger?: GraphLogger;
}

export interface QueryStats {
  nodesCreated: number;
  nodesDeleted: number;
  relationshipsCreated: number;
  relationshipsDeleted: number;
  propertiesSet: number;
  labelsAdded: number;
  indicesCreated: number;
  indicesDeleted: number;
}

export interface GraphHealth {
  status: 'ok' | 'down';
  latencyMs?: number;
  error?: string;
}

export interface ExecuteOptions {
  readOnly?: boolean;
  timeoutMs?: number;
}

export interface ExecuteResult {
  rows: Record<string, unknown>[];
  stats: QueryStats;
}

type FalkorGraph = ReturnType<FalkorDB['selectGraph']>;

const DEFAULT_TIMEOUT_MS = 10_000;
const CONNECT_TIMEOUT_MS = 2_000;
const HEALTH_TIMEOUT_MS = 1_000;
/** Extra time the client waits beyond the server-side TIMEOUT before giving up on a silent connection. */
const CLIENT_GRACE_MS = 2_000;

const STAT_LABELS: Array<[string, keyof QueryStats]> = [
  ['Nodes created', 'nodesCreated'],
  ['Nodes deleted', 'nodesDeleted'],
  ['Relationships created', 'relationshipsCreated'],
  ['Relationships deleted', 'relationshipsDeleted'],
  ['Properties set', 'propertiesSet'],
  ['Labels added', 'labelsAdded'],
  ['Indices created', 'indicesCreated'],
  ['Indices deleted', 'indicesDeleted'],
];

function emptyStats(): QueryStats {
  return {
    nodesCreated: 0,
    nodesDeleted: 0,
    relationshipsCreated: 0,
    relationshipsDeleted: 0,
    propertiesSet: 0,
    labelsAdded: 0,
    indicesCreated: 0,
    indicesDeleted: 0,
  };
}

/** Parses the metadata lines of a reply ("Nodes created: 1"). */
function parseStats(metadata: readonly string[] | undefined): QueryStats {
  const stats = emptyStats();
  for (const line of metadata ?? []) {
    for (const [label, key] of STAT_LABELS) {
      if (line.startsWith(`${label}:`))
        stats[key] = Number.parseInt(line.slice(label.length + 1), 10) || 0;
    }
  }
  return stats;
}

const CONNECTION_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EPIPE',
  'EAI_AGAIN',
  'EHOSTUNREACH',
]);
const CONNECTION_NAMES = new Set([
  'ConnectionTimeoutError',
  'ClientClosedError',
  'ClientOfflineError',
  'SocketClosedUnexpectedlyError',
  'SocketTimeoutError',
  'DisconnectsClientError',
]);

function isConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && CONNECTION_CODES.has(code)) return true;
  if (CONNECTION_NAMES.has(error.name)) return true;
  const nested = (error as { errors?: unknown }).errors;
  if (Array.isArray(nested) && nested.length > 0 && nested.every(isConnectionError)) return true;
  return /socket closed|connection is closed|client is closed|connection timeout|not connected/i.test(
    error.message,
  );
}

const EMPTY_KEY_MESSAGE = 'Invalid graph operation on empty key';

/** True only when the whole message is FalkorDB's "empty key" error (an optional `ERR ` prefix and trailing dot aside). */
function isEmptyKeyError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.trim().replace(/^ERR\s+/, '').replace(/\.$/, '');
  return message === EMPTY_KEY_MESSAGE;
}

const sleep =(ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class GraphKit {
  readonly graphName: string;

  protected readonly options: GraphKitOptions;
  private db: FalkorDB | undefined;
  private connecting: Promise<FalkorDB> | undefined;
  private closed = false;

  private readonly queries: Map<string, LoadedQuery>;

  protected constructor(options: GraphKitOptions, queries: Map<string, LoadedQuery>) {
    this.options = options;
    this.graphName = options.graphName;
    this.queries = queries;
  }

  /**
   * Loads and checks every query file, then returns. Does not require the server to be reachable: the connection is
   * opened on first use.
   */
  static async create(options: GraphKitOptions): Promise<GraphKit> {
    const queries = loadQueryDir(options.queriesDir ?? defaultQueriesDir());
    return new GraphKit(options, queries);
  }

  // ─── Named queries ─────────────────────────────────────────────────────────

  /** Steps 1 to 3 of the contract: the name exists, every parameter is present, no key is unused. */
  private checkCall(name: string, params: QueryParams): LoadedQuery {
    const query = this.queries.get(name);
    if (!query) {
      throw new GraphKitError('UNKNOWN_QUERY', `Unknown query "${name}"`, { queryName: name });
    }
    for (const param of query.params) {
      if (params[param] === undefined) {
        throw new GraphKitError('MISSING_PARAM', `Query "${name}" is missing parameter "$${param}"`, {
          queryName: name,
          param,
        });
      }
    }
    for (const key of Object.keys(params)) {
      if (!query.params.includes(key)) {
        throw new GraphKitError(
          'UNEXPECTED_PARAM',
          `Query "${name}" does not use parameter "$${key}"`,
          { queryName: name, param: key },
        );
      }
    }
    return query;
  }

  private validateRows<T>(name: string, rows: Record<string, unknown>[], schema?: z.ZodType<T>): T[] {
    if (!schema) return rows as T[];
    return rows.map((row, index) => {
      const parsed = schema.safeParse(row);
      if (parsed.success) return parsed.data;
      const issue = parsed.error.issues[0];
      throw new GraphKitError(
        'ROW_VALIDATION_FAILED',
        `Query "${name}" row ${index} failed validation at ${issue?.path.join('.') || '(root)'}: ${issue?.message ?? 'invalid'}`,
        { queryName: name },
      );
    });
  }

  /** Runs the named query. Rows are plain objects keyed by RETURN alias. */
  async query<T = Record<string, unknown>>(
    name: string,
    params: QueryParams = {},
    options: QueryOptions<T> = {},
  ): Promise<T[]> {
    return (await this.queryWithStats<T>(name, params, options)).rows;
  }

  /** First row or null. Throws QUERY_FAILED if more than one row comes back. */
  async queryOne<T = Record<string, unknown>>(
    name: string,
    params: QueryParams = {},
    options: QueryOptions<T> = {},
  ): Promise<T | null> {
    const rows = await this.query<T>(name, params, options);
    if (rows.length > 1) {
      throw new GraphKitError('QUERY_FAILED', `Query "${name}" returned ${rows.length} rows, expected at most one`, {
        queryName: name,
      });
    }
    return rows[0] ?? null;
  }

  /** As query(), plus write statistics. */
  async queryWithStats<T = Record<string, unknown>>(
    name: string,
    params: QueryParams = {},
    options: QueryOptions<T> = {},
  ): Promise<{ rows: T[]; stats: QueryStats }> {
    const query = this.checkCall(name, params);
    const result = await this.execute(query.text, params, {
      readOnly: query.mode === 'read',
      queryName: name,
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    });
    return { rows: this.validateRows(name, result.rows, options.schema), stats: result.stats };
  }

  /** Typed form: rows are always validated against the definition's schema. */
  run<P extends QueryParams, R>(def: QueryDef<P, R>, params: P, options: { timeoutMs?: number } = {}): Promise<R[]> {
    return this.query<R>(def.name, params, { schema: def.row, ...options });
  }

  runOne<P extends QueryParams, R>(
    def: QueryDef<P, R>,
    params: P,
    options: { timeoutMs?: number } = {},
  ): Promise<R | null> {
    return this.queryOne<R>(def.name, params, { schema: def.row, ...options });
  }

  /**
   * Registers a generated statement named `admin_<model>_<operation>`. The text is fixed after registration; request
   * data only ever arrives as bound parameters.
   */
  defineQuery<P extends QueryParams = QueryParams, R = Record<string, unknown>>(
    definition: GeneratedQuery<R>,
  ): QueryDef<P, R> {
    const { name } = definition;
    if (!/^admin_[a-z0-9]+(_[a-z0-9]+)+$/.test(name)) {
      throw new GraphKitError(
        'INVALID_QUERY_FILE',
        `Generated query "${name}": the name must look like admin_<model>_<operation>`,
        { queryName: name },
      );
    }
    const prepared = prepareStatement(definition.cypher, `Generated query "${name}"`, name);
    const existing = this.queries.get(name);
    if (existing) {
      if (existing.text !== prepared.text || existing.mode !== definition.mode) {
        throw new GraphKitError('DUPLICATE_QUERY', `Query "${name}" is already defined with different text`, {
          queryName: name,
        });
      }
    } else {
      this.queries.set(name, {
        name,
        owner: definition.owner ?? '006',
        mode: definition.mode,
        params: prepared.params,
        source: 'generated',
        text: prepared.text,
      });
    }
    const row = (definition.row ?? z.record(z.unknown())) as z.ZodType<R>;
    return { name, row };
  }

  /** Alias of defineQuery. */
  registerQuery<P extends QueryParams = QueryParams, R = Record<string, unknown>>(
    definition: GeneratedQuery<R>,
  ): QueryDef<P, R> {
    return this.defineQuery<P, R>(definition);
  }

  /** Names of all loaded queries with their parameter names and mode. */
  listQueries(): QueryInfo[] {
    return [...this.queries.values()].map((q) => ({
      name: q.name,
      owner: q.owner,
      mode: q.mode,
      params: [...q.params],
      source: q.source,
      ...(q.file !== undefined ? { file: q.file } : {}),
    }));
  }

  repository<T extends Record<string, CypherValue>>(
    label: NodeLabel,
    options: RepositoryOptions<T> = {},
  ): GraphRepository<T> {
    return createRepository<T>(this, label, options);
  }

  // ─── Connection ────────────────────────────────────────────────────────────

  private connect(): Promise<FalkorDB> {
    if (this.closed)
      return Promise.reject(new GraphUnavailableError('The graph connection is closed'));
    if (this.db) return Promise.resolve(this.db);
    this.connecting ??= (async () => {
      try {
        const db = await FalkorDB.connect({
          // `reconnectStrategy` is accepted by the underlying redis client but missing from the client's own type.
          socket: {
            host: this.options.host,
            port: this.options.port,
            connectTimeout: CONNECT_TIMEOUT_MS,
            // No automatic retry loop: a lost connection is dropped and re-opened by the next call.
            reconnectStrategy: false,
          } as FalkorDBOptions['socket'],
          ...(this.options.username ? { username: this.options.username } : {}),
          ...(this.options.password ? { password: this.options.password } : {}),
        });
        db.on('error', () => this.drop(db));
        this.db = db;
        return db;
      } catch (cause) {
        throw new GraphUnavailableError(
          `FalkorDB is not reachable at ${this.options.host}:${this.options.port}`,
          { cause },
        );
      } finally {
        this.connecting = undefined;
      }
    })();
    return this.connecting;
  }

  /** Forgets a broken connection so that the next call opens a new one. */
  private drop(db: FalkorDB): void {
    if (this.db === db) this.db = undefined;
    db.close().catch(() => undefined);
  }

  private async selectGraph(): Promise<{ db: FalkorDB; graph: FalkorGraph }> {
    const db = await this.connect();
    return { db, graph: db.selectGraph(this.graphName) };
  }

  /** Raised error translation shared by every call that reaches the server. */
  private translate(error: unknown, queryName?: string): GraphKitError {
    if (error instanceof GraphKitError) return error;
    const ctx = queryName ? { queryName, cause: error } : { cause: error };
    if (isConnectionError(error)) {
      return new GraphUnavailableError(
        `FalkorDB is not reachable at ${this.options.host}:${this.options.port}`,
        ctx,
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    if (/timed out/i.test(message)) {
      return new GraphKitError(
        'QUERY_TIMEOUT',
        `Query${queryName ? ` "${queryName}"` : ''} timed out`,
        ctx,
      );
    }
    if (/unique constraint violation/i.test(message)) {
      return new GraphKitError('CONSTRAINT_VIOLATION', `Uniqueness violated: ${message}`, ctx);
    }
    return new GraphKitError(
      'QUERY_FAILED',
      `Query${queryName ? ` "${queryName}"` : ''} failed: ${message}`,
      ctx,
    );
  }

  /**
   * Sends one statement with bound parameters. Internal: named queries, the repository, setup, import, and the test
   * harness build on this; application code calls `query` instead.
   */
  async execute(
    text: string,
    params: QueryParams = {},
    options: ExecuteOptions & { queryName?: string } = {},
  ): Promise<ExecuteResult> {
    const timeoutMs = options.timeoutMs ?? this.options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let db: FalkorDB | undefined;
    try {
      const connected = await this.selectGraph();
      db = connected.db;
      // An empty params object would produce a bare `CYPHER` prefix, which the server rejects.
      const queryOptions =
        Object.keys(params).length > 0 ? { params, TIMEOUT: timeoutMs } : { TIMEOUT: timeoutMs };
      const call = options.readOnly
        ? connected.graph.roQuery<Record<string, unknown>>(text, queryOptions)
        : connected.graph.query<Record<string, unknown>>(text, queryOptions);
      const silence = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new GraphKitError(
                'QUERY_TIMEOUT',
                `Query${options.queryName ? ` "${options.queryName}"` : ''} timed out`,
              ),
            ),
          timeoutMs + CLIENT_GRACE_MS,
        );
      });
      const reply = await Promise.race([call, silence]);
      this.options.logger?.debug('graph query', {
        name: options.queryName,
        ms: Date.now() - started,
      });
      return { rows: (reply.data ?? []).map(mapRow), stats: parseStats(reply.metadata) };
    } catch (error) {
      // A read-only query on a graph that has not been created yet (before `setup-graph`) finds no data.
      // Only that exact server error, only for read-only queries: a write never hits it, and any other error surfaces.
      if (options.readOnly === true && isEmptyKeyError(error)) {
        return { rows: [], stats: emptyStats() };
      }
      const translated = this.translate(error, options.queryName);
      if (translated instanceof GraphUnavailableError && db) this.drop(db);
      this.options.logger?.error('graph query failed', {
        name: options.queryName,
        code: translated.code,
        ms: Date.now() - started,
      });
      throw translated;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Never throws. 1 s timeout. Runs `RETURN 1 AS ok`. */
  async health(): Promise<GraphHealth> {
    const started = Date.now();
    try {
      const result = await Promise.race([
        this.execute('RETURN 1 AS ok', {}, { readOnly: true, timeoutMs: HEALTH_TIMEOUT_MS }),
        sleep(HEALTH_TIMEOUT_MS).then(() => {
          throw new Error('health check timed out');
        }),
      ]);
      // No rows = the server answered but the graph does not exist yet; the store itself is fine.
      if (result.rows.length > 0 && result.rows[0]?.ok !== 1)
        return { status: 'down', error: 'unexpected reply' };
      return { status: 'ok', latencyMs: Date.now() - started };
    } catch (error) {
      return { status: 'down', error: error instanceof Error ? error.message : String(error) };
    }
  }

  // ─── Operations that need the raw client (used by setup and the harness only) ──

  /** @internal Creates a uniqueness constraint (FalkorDB `GRAPH.CONSTRAINT CREATE`). */
  async createUniqueConstraint(label: string, ...properties: string[]): Promise<void> {
    try {
      const { graph } = await this.selectGraph();
      await graph.constraintCreate(ConstraintType.UNIQUE, EntityType.NODE, label, ...properties);
    } catch (error) {
      throw this.translate(error);
    }
  }

  /** @internal Deletes the whole graph key. A graph that does not exist is not an error. */
  async deleteGraph(): Promise<void> {
    try {
      const { graph } = await this.selectGraph();
      await graph.delete();
    } catch (error) {
      if (error instanceof Error && /empty key|does not exist/i.test(error.message)) return;
      throw this.translate(error);
    }
  }

  /** @internal Names of every graph on the server. */
  async listGraphs(): Promise<string[]> {
    try {
      const db = await this.connect();
      return await db.list();
    } catch (error) {
      throw this.translate(error);
    }
  }

  /** @internal Deletes another graph on the same server (global set-up of the test harness). */
  async deleteGraphNamed(name: string): Promise<void> {
    try {
      const db = await this.connect();
      await db.selectGraph(name).delete();
    } catch (error) {
      if (error instanceof Error && /empty key|does not exist/i.test(error.message)) return;
      throw this.translate(error);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    const db = this.db ?? (await this.connecting?.catch(() => undefined));
    this.db = undefined;
    if (db) await db.close().catch(() => undefined);
  }
}
