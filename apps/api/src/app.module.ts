import { Module, RequestMethod, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { FEATURE_MODULES } from './apps';
import { AuthGuard } from './common/auth/auth.guard';
import { AuthModule } from './common/auth/auth.module';
import { RolesGuard } from './common/auth/roles.guard';
import { ApiExceptionFilter } from './common/errors/api-exception.filter';
import { CommonModule } from './common/common.module';
import { DbModule } from './common/db/db.module';
import { LlmModule } from './common/llm/llm.module';
import { RequestLoggerMiddleware } from './common/logging/request-logger.middleware';
import { GraphModule } from './common/graph/graph.module';
import { ConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule,
    DbModule,
    GraphModule,
    CommonModule,
    LlmModule,
    AuthModule,
    HealthModule,
    ...FEATURE_MODULES,
  ],
  providers: [
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    // Order matters: the token and account first, then the role.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestLoggerMiddleware)
      .forRoutes({ path: '*path', method: RequestMethod.ALL });
  }
}
