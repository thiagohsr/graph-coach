import { Controller, Get } from '@nestjs/common';
import type { HealthDto } from '@coach/types';
import { Public } from '../common/auth/decorators';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** Always 200 while the process runs; the body says which store is down. */
  @Public()
  @Get()
  check(): Promise<HealthDto> {
    return this.health.check();
  }
}
