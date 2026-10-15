// Public interface of @coach/graph-kit (contracts/internal-interfaces.md §2). Nothing from `falkordb` is exported.
export {
  GraphKit,
  type CypherValue,
  type GraphHealth,
  type GraphKitOptions,
  type GraphLogger,
  type QueryParams,
  type QueryStats,
} from './client';
export {
  typedQuery,
  type GeneratedQuery,
  type QueryDef,
  type QueryInfo,
  type QueryOptions,
} from './define';
export { GraphKitError, GraphUnavailableError, type GraphErrorCode } from './errors';
export type { GraphEdge, GraphNode, GraphPath } from './mapping';
export type { GraphRepository, RepositoryOptions } from './repository';
export {
  NODE_LABELS,
  REL_TYPES,
  assertNodeLabel,
  assertRelType,
  keyPropertyOf,
  type NodeLabel,
  type RelType,
} from './schema';
export {
  createLearner,
  creationCountsQuery,
  deleteLearner,
  usageTotalsQuery,
  type CreationCountRow,
  type DeletedRow,
  type LearnerRow,
  type UsageTotalRow,
} from './queries/platform';
export {
  describeSchema,
  dropGraph,
  setupGraph,
  type SchemaItem,
  type SetupOptions,
  type SetupReport,
} from './setup';
export {
  importGraph,
  type FixtureEdge,
  type FixtureNode,
  type GraphFixture,
  type ImportReport,
  type NodeRef,
} from './fixture';
export { SeedData, type SeedIssue } from './seed/schema';
export { SeedReadError, defaultSeedDir, readSeedDir } from './seed/read';
export { validateSeed } from './seed/validate';
export { seedIds, seedToFixture, type SeedFixtureOptions } from './seed/to-fixture';
export { deterministicId, newId, toEpochMs, toIso } from './ids';
