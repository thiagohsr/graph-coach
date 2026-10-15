import { Module } from '@nestjs/common';
import { GraphKit } from '@coach/graph-kit';
import { SQL_CLIENT, type SqlClient } from '../../common/db/db.module';
import { AdminController } from './admin.controller';
import { ADMIN_PORTS, createGraphPort, createSqlPort, type AdminPorts } from './admin.ports';
import { AdminProviders } from './admin.providers';
import { AdminService } from './admin.service';

/** The admin kit's API (spec 006). Feature modules do not import it: they add a `*.admin.ts` file instead. */
@Module({
  controllers: [AdminController],
  providers: [
    {
      provide: ADMIN_PORTS,
      inject: [GraphKit, SQL_CLIENT],
      useFactory: (graph: GraphKit, client: SqlClient): AdminPorts => ({
        graph: createGraphPort(graph),
        sql: createSqlPort(client),
      }),
    },
    AdminProviders,
    AdminService,
  ],
})
export class AdminModule {}
