export type GraphErrorCode =
  | 'UNKNOWN_QUERY'
  | 'MISSING_PARAM'
  | 'UNEXPECTED_PARAM'
  | 'INVALID_QUERY_FILE'
  | 'DUPLICATE_QUERY'
  | 'INVALID_IDENTIFIER'
  | 'ROW_VALIDATION_FAILED'
  | 'GRAPH_UNAVAILABLE'
  | 'QUERY_TIMEOUT'
  | 'CONSTRAINT_VIOLATION'
  | 'QUERY_FAILED';

export interface GraphKitErrorOptions {
  queryName?: string;
  param?: string;
  cause?: unknown;
}

export class GraphKitError extends Error {
  readonly code: GraphErrorCode;
  readonly queryName?: string;
  readonly param?: string;
  override readonly cause?: unknown;

  constructor(code: GraphErrorCode, message: string, options: GraphKitErrorOptions = {}) {
    super(message);
    this.name = 'GraphKitError';
    this.code = code;
    if (options.queryName !== undefined) this.queryName = options.queryName;
    if (options.param !== undefined) this.param = options.param;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

export class GraphUnavailableError extends GraphKitError {
  declare readonly code: 'GRAPH_UNAVAILABLE';

  constructor(message = 'FalkorDB is not reachable', options: GraphKitErrorOptions = {}) {
    super('GRAPH_UNAVAILABLE', message, options);
    this.name = 'GraphUnavailableError';
  }
}
