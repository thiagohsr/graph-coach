// The barrel feature modules import from (contracts/internal-interfaces.md §5). Add one line per shared unit.
export { ENV } from '../config/config.module';
export type { Env } from '../config/env';
export * from './clock';
export * from './errors/app-error';
export { ApiExceptionFilter } from './errors/api-exception.filter';
export { ZodValidationPipe } from './validation/zod-validation.pipe';
export { DB, SQL_CLIENT, pingSql, type Db } from './db/db.module';
export { GraphKit } from '@coach/graph-kit';
export { hasRole, type AuthUser } from './auth/auth-user';
export { CurrentUser, Public, Roles } from './auth/decorators';
export { AuthGuard } from './auth/auth.guard';
export { RolesGuard } from './auth/roles.guard';
export { CognitoTokenVerifier } from './auth/cognito-token-verifier';
export { DevTokenVerifier } from './auth/dev-token-verifier';
export {
  TOKEN_VERIFIER,
  type IdentityProfile,
  type JwksSource,
  type TokenVerifier,
  type VerifiedIdentity,
} from './auth/token-verifier';
export * from './access/access';
export {
  SETTING_DEFAULTS,
  SettingsService,
  type SettingKey,
  type Settings,
} from './settings/settings.service';
export { MemoryRateLimitStore, type RateLimitStore } from './rate-limit/memory-store';
export {
  RATE_LIMIT_STORE,
  RateLimiter,
  type RateLimitResult,
  type RateLimitRule,
  type RateLimitWindow,
  type WindowUsage,
} from './rate-limit/rate-limiter';
