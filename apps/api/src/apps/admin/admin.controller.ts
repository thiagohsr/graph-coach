import { Body, Controller, Get, Inject, Param, Patch, Query } from '@nestjs/common';
import type {
  AdminDetailResponse,
  AdminListResponse,
  AdminModelMeta,
  AdminUpdateResponse,
} from '@coach/types';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { AdminService } from './admin.service';

/**
 * The four admin endpoints (contracts/admin-api.md). `@Roles('admin')` on the class: the platform guards are global, so a
 * route added here cannot be reached by another role. `:model` and `:id` are only ever looked up or bound as parameters.
 */
@Controller('admin')
@Roles('admin')
export class AdminController {
  constructor(@Inject(AdminService) private readonly admin: AdminService) {}

  // Declared before `:model`, which would otherwise match "models".
  @Get('models')
  models(): AdminModelMeta[] {
    return this.admin.listModels();
  }

  @Get(':model')
  list(@Param('model') model: string, @Query() query: Record<string, unknown>): Promise<AdminListResponse> {
    return this.admin.list(model, query);
  }

  @Get(':model/:id')
  get(@Param('model') model: string, @Param('id') id: string): Promise<AdminDetailResponse> {
    return this.admin.get(model, id);
  }

  @Patch(':model/:id')
  update(
    @Param('model') model: string,
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() actor: AuthUser,
  ): Promise<AdminUpdateResponse> {
    return this.admin.update(model, id, body, actor);
  }
}
