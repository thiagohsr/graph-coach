import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { GraphKit, type GraphLogger } from '@coach/graph-kit';
import { ConfigModule, ENV } from '../../config/config.module';
import type { Env } from '../../config/env';

/** Query names and durations go to the Nest logger; parameter values never do (GraphKit does not pass them). */
function nestGraphLogger(): GraphLogger {
  const logger = new Logger('GraphKit');
  const line = (message: string, meta?: Record<string, unknown>) =>
    meta ? `${message} ${JSON.stringify(meta)}` : message;
  return {
    debug: (message, meta) => logger.debug(line(message, meta)),
    warn: (message, meta) => logger.warn(line(message, meta)),
    error: (message, meta) => logger.error(line(message, meta)),
  };
}

@Injectable()
class GraphLifecycle implements OnApplicationShutdown {
  constructor(@Inject(GraphKit) private readonly graph: GraphKit) {}

  async onApplicationShutdown(): Promise<void> {
    await this.graph.close();
  }
}

/** Global. Provides `GraphKit` bound to `GRAPH_NAME`; the connection is lazy, so a stopped FalkorDB does not stop the API. */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: GraphKit,
      inject: [ENV],
      useFactory: (env: Env) =>
        GraphKit.create({
          host: env.FALKORDB_HOST,
          port: env.FALKORDB_PORT,
          ...(env.FALKORDB_USERNAME ? { username: env.FALKORDB_USERNAME } : {}),
          ...(env.FALKORDB_PASSWORD ? { password: env.FALKORDB_PASSWORD } : {}),
          graphName: env.GRAPH_NAME,
          logger: nestGraphLogger(),
        }),
    },
    GraphLifecycle,
  ],
  exports: [GraphKit],
})
export class GraphModule {}
