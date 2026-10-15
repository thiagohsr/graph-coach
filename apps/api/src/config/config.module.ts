import { Global, Module } from '@nestjs/common';
import { parseEnv, type Env } from './env';

/** Injection token: the parsed environment (`Env`). */
export const ENV = Symbol('ENV');

/**
 * Global. Parses `process.env` once; an invalid environment throws EnvError here, before anything listens.
 * Tests and the CLI can replace the provider.
 */
@Global()
@Module({
  providers: [{ provide: ENV, useFactory: (): Env => parseEnv() }],
  exports: [ENV],
})
export class ConfigModule {}
