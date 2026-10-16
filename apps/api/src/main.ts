import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { EnvError, parseEnv, type Env } from './config/env';
import { LOG_LEVELS, configureApp } from './configure-app';

async function bootstrap(): Promise<void> {
  // Step 1 of the start-up sequence: the whole environment, including the production rules.
  let env: Env;
  try {
    env = parseEnv();
  } catch (error) {
    if (error instanceof EnvError) {
      console.error(error.problems.join('\n'));
      process.exit(1);
    }
    throw error;
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(env.auth.mode), {
    logger: LOG_LEVELS[env.LOG_LEVEL],
  });
  configureApp(app, env);
  await app.listen(env.API_PORT);
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`API failed to start: ${message}`);
  process.exit(1);
});
