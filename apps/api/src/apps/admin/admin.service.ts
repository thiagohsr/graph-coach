import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  ADMIN_MAX_ID_LENGTH,
  ADMIN_MAX_OFFSET,
  ADMIN_MAX_PAGE_SIZE,
  ADMIN_MAX_SEARCH_LENGTH,
  adminRegistry,
  buildActions,
  buildModelMeta,
  computedFieldKeys,
  createGraphAdapter,
  createSqlAdapter,
  toRecordDto,
  validateUpdate,
  type AdminAdapter,
  type AdminHookContext,
  type AdminHookResult,
  type ResolvedAdminModel,
} from '@coach/admin-kit';
import {
  AdminListQuery,
  type AdminDetailResponse,
  type AdminListResponse,
  type AdminModelMeta,
  type AdminRecordDto,
  type AdminUpdateResponse,
  type AdminValue,
  type ValidationDetails,
} from '@coach/types';
import type { AuthUser } from '../../common/auth/auth-user';
import {
  MethodNotAllowedError,
  NotFoundError,
  ValidationFailedError,
} from '../../common/errors/app-error';
import { SettingsService } from '../../common/settings/settings.service';
import { ADMIN_PORTS, type AdminPorts } from './admin.ports';
import { AdminProviders } from './admin.providers';
// Registration files: one import line per `*.admin.ts` (side effect: they register their models).
import './admin.registrations';

type Issue = ValidationDetails['issues'][number];

/** Plain-object check that treats arrays and null as "not an object". */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

@Injectable()
export class AdminService implements OnModuleInit {
  private readonly logger = new Logger('AdminService');
  private graphAdapter!: AdminAdapter;
  private sqlAdapter!: AdminAdapter;

  constructor(
    @Inject(ADMIN_PORTS) private readonly ports: AdminPorts,
    @Inject(AdminProviders) private readonly providers: AdminProviders,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  /** Validates and freezes the registry, checks provider bindings, then registers the generated queries. */
  onModuleInit(): void {
    adminRegistry.validate();
    adminRegistry.freeze();
    const models = adminRegistry.list();

    const missing: string[] = [];
    for (const model of models) {
      if (model.computeProvider && !this.providers.compute[model.computeProvider]) {
        missing.push(`${model.name}: compute provider "${model.computeProvider}"`);
      }
      if (model.updateProvider && !this.providers.update[model.updateProvider]) {
        missing.push(`${model.name}: update provider "${model.updateProvider}"`);
      }
    }
    if (missing.length > 0) {
      throw new Error(
        `Admin declarations name providers that are not bound in admin.providers.ts:\n  ${missing.join('\n  ')}`,
      );
    }

    this.graphAdapter = createGraphAdapter(this.ports.graph, models);
    this.sqlAdapter = createSqlAdapter(this.ports.sql);
  }

  // ─── Reads ─────────────────────────────────────────────────────────────────

  listModels(): AdminModelMeta[] {
    return adminRegistry.list().map(buildModelMeta);
  }

  async list(modelName: string, rawQuery: unknown): Promise<AdminListResponse> {
    const model = this.model(modelName);
    const issues: Issue[] = [];
    const parsed = AdminListQuery.safeParse(isPlainObject(rawQuery) ? rawQuery : {});
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        issues.push({
          path: issue.path.join('.') || 'query',
          message: issue.message,
          code: issue.code,
        });
      }
      throw new ValidationFailedError(issues);
    }

    const page = parsed.data.page;
    const pageSize = Math.min(parsed.data.pageSize ?? model.pageSize, ADMIN_MAX_PAGE_SIZE);
    const term = parsed.data.search ?? '';
    if (term.length > ADMIN_MAX_SEARCH_LENGTH) {
      issues.push({
        path: 'search',
        message: `search must be at most ${ADMIN_MAX_SEARCH_LENGTH} characters`,
        code: 'too_big',
      });
    } else if (term !== '' && model.searchFields.length === 0) {
      issues.push({
        path: 'search',
        message: `${model.label} cannot be searched`,
        code: 'invalid_type',
      });
    }
    if ((page - 1) * pageSize > ADMIN_MAX_OFFSET) {
      issues.push({
        path: 'page',
        message: `page is too far: the offset may not exceed ${ADMIN_MAX_OFFSET}`,
        code: 'too_big',
      });
    }
    if (issues.length > 0) throw new ValidationFailedError(issues);

    const search = term === '' ? undefined : model.source === 'graph' ? term.toLowerCase() : term;
    const { rows, total } = await this.adapter(model).list(model, {
      page,
      pageSize,
      ...(search !== undefined ? { search } : {}),
    });
    return { items: rows.map((row) => toRecordDto(model, row, 'list')), total, page, pageSize };
  }

  async get(modelName: string, id: string): Promise<AdminDetailResponse> {
    const model = this.model(modelName);
    const adapter = this.adapter(model);
    const record = await this.load(model, id);
    const links = await adapter.links(model, id);
    return { record, links, actions: buildActions(model, record) };
  }

  // ─── Update ────────────────────────────────────────────────────────────────

  /** Processing order of contracts/admin-api.md (PATCH). Nothing is written unless every step passes. */
  async update(
    modelName: string,
    id: string,
    body: unknown,
    actor: AuthUser,
  ): Promise<AdminUpdateResponse> {
    const model = this.model(modelName);
    if (model.readOnly) throw new MethodNotAllowedError(`${model.label} are read-only`);

    const values = isPlainObject(body) ? body.values : undefined;
    if (!isPlainObject(values) || Object.keys(values).length === 0) {
      throw new ValidationFailedError(
        [
          {
            path: 'values',
            message: 'values must be an object with at least one field',
            code: 'invalid_type',
          },
        ],
        'The update was rejected.',
      );
    }

    const checked = validateUpdate(model, values);
    if (!checked.ok)
      throw new ValidationFailedError(checked.details.issues, 'The update was rejected.');
    const changes = checked.changes;

    const adapter = this.adapter(model);
    const current = await this.load(model, id, false);
    const ctx: AdminHookContext = {
      model: model.name,
      id,
      current: current.values,
      changes,
      actor: { id: actor.id, role: 'admin' },
    };

    if (model.updateProvider) {
      this.reject(await this.providers.update[model.updateProvider]!(ctx));
      if (!(await adapter.get(model, id))) throw new NotFoundError('Record');
    } else {
      if (model.validate) this.reject(await model.validate(ctx));
      const row = await adapter.update(model, id, changes);
      if (!row) throw new NotFoundError('Record');
    }

    this.settings.invalidate();
    this.logger.log(
      `admin update actor=${actor.id} model=${model.name} id=${id} fields=${Object.keys(changes).join(',')}`,
    );
    return { record: await this.load(model, id) };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private model(name: string): ResolvedAdminModel {
    const model = adminRegistry.get(name);
    if (!model) throw new NotFoundError('Model');
    return model;
  }

  private adapter(model: ResolvedAdminModel): AdminAdapter {
    return model.source === 'graph' ? this.graphAdapter : this.sqlAdapter;
  }

  /** The record with every declared field. Computed fields are merged in when `withComputed` is true. */
  private async load(
    model: ResolvedAdminModel,
    id: string,
    withComputed = true,
  ): Promise<AdminRecordDto> {
    if (typeof id !== 'string' || id.length === 0 || id.length > ADMIN_MAX_ID_LENGTH)
      throw new NotFoundError('Record');
    const row = await this.adapter(model).get(model, id);
    if (!row) throw new NotFoundError('Record');
    const record = toRecordDto(model, row, 'all');
    if (withComputed) await this.mergeComputed(model, record);
    return record;
  }

  /** Only the model's computed keys are taken from the provider; a missing key or a failing provider gives null. */
  private async mergeComputed(model: ResolvedAdminModel, record: AdminRecordDto): Promise<void> {
    const keys = computedFieldKeys(model);
    if (keys.length === 0) return;
    let provided: Record<string, AdminValue> = {};
    try {
      const provider = this.providers.compute[model.computeProvider!]!;
      provided = await provider({ id: record.id, values: record.values });
    } catch (error) {
      this.logger.warn(
        `Compute provider ${model.computeProvider} failed: ${error instanceof Error ? error.name : 'error'}`,
      );
    }
    for (const key of keys) {
      record.values[key] = Object.hasOwn(provided, key) ? (provided[key] ?? null) : null;
    }
  }

  /** A hook or provider result with errors becomes 422 with code `rejected`. */
  private reject(result: AdminHookResult): void {
    if (!result) return;
    const issues: Issue[] = [
      ...Object.entries(result.fields ?? {}).map(([field, message]) => ({
        path: `values.${field}`,
        message,
        code: 'rejected',
      })),
      ...(result.form ?? []).map((message) => ({ path: 'values', message, code: 'rejected' })),
    ];
    if (issues.length > 0) throw new ValidationFailedError(issues, 'The update was rejected.');
  }
}
