import { Controller, Get, Header, Inject, Param } from '@nestjs/common';
import { z } from 'zod';
import type { PlayPuzzleDto, PuzzleSummaryDto } from '@coach/types';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/auth/decorators';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { PuzzlesService } from './puzzles.service';

const IdParam = z.string().min(1).max(64);

@Controller('puzzles')
export class PuzzlesController {
  constructor(@Inject(PuzzlesService) private readonly puzzles: PuzzlesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<PuzzleSummaryDto[]> {
    return this.puzzles.list(user);
  }

  @Get(':id/play')
  @Header('Cache-Control', 'no-store')
  play(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(IdParam)) id: string,
  ): Promise<PlayPuzzleDto> {
    return this.puzzles.play(user, id);
  }
}
