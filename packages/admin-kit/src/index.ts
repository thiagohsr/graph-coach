// Public interface of @coach/admin-kit (the design documents).
export type {
  AdminComputeProvider,
  AdminCountLink,
  AdminDeclaration,
  AdminFieldDeclaration,
  AdminHookContext,
  AdminHookResult,
  AdminLinkDeclaration,
  AdminRecordsLink,
  AdminRouteLink,
  AdminSource,
  AdminUpdateProvider,
  AdminValidateHook,
  ResolvedAdminModel,
  ResolvedField,
} from './declaration';
export { editableFields, storedFields } from './declaration';
export {
  AdminDeclarationError,
  AdminRegistryFrozenError,
  adminRegistry,
  createAdminRegistry,
  registerAdmin,
  type AdminDeclarationProblem,
  type AdminRegistry,
} from './registry';
export { buildActions, buildModelMeta, computedFieldKeys } from './metadata';
export { toRecordDto, toAdminValue, toIsoString, type AdminRow } from './values';
export { validateUpdate, type UpdateValidation } from './update-validator';
export type { AdminAdapter, AdminListParams, GraphPort, SqlPort } from './adapters/adapter';
export { createGraphAdapter } from './adapters/graph.adapter';
export { createSqlAdapter } from './adapters/sql.adapter';
export * from './limits';
export { isSensitiveName, isForbiddenLabel, queryNameSegment } from './identifiers';
