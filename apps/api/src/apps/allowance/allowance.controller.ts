import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { RedeemRequest, type AllowanceDto, type RedeemResult } from '@coach/types';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/auth/decorators';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { AllowanceService } from './allowance.service';
import { CodesService } from './codes.service';

@Controller('me')
export class AllowanceController {
  constructor(
    @Inject(AllowanceService) private readonly allowance: AllowanceService,
    @Inject(CodesService) private readonly codes: CodesService,
  ) {}

  /** What the caller can still create. Reads only. */
  @Get('allowance')
  usage(@CurrentUser() user: AuthUser): Promise<AllowanceDto> {
    return this.allowance.usage(user);
  }

  /** Redeems an access code once. The body is never logged. */
  @Post('codes/redeem')
  @HttpCode(200)
  redeem(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(RedeemRequest)) body: RedeemRequest,
  ): Promise<RedeemResult> {
    return this.codes.redeem(user, body.code);
  }
}
