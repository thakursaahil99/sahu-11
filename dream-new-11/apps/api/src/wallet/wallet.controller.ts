import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { depositSchema, kycSchema, txHistoryQuerySchema, withdrawalSchema } from '@dream11/shared';
import type { z } from 'zod';
import { AuthUser, CurrentUser } from '../auth/jwt-auth.guard';
import { Meta, RequestMeta } from '../common/request-meta';
import { zodBody, zodQuery } from '../common/zod-validation.pipe';
import { WalletService } from './wallet.service';

const MONEY_LIMIT = { default: { limit: 10, ttl: 60_000 } };

@Controller()
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get('wallet')
  get(@CurrentUser() user: AuthUser) {
    return this.wallet.wallet(user.id);
  }

  @Get('wallet/transactions')
  history(@CurrentUser() user: AuthUser, @Query(zodQuery(txHistoryQuerySchema)) q: z.output<typeof txHistoryQuerySchema>) {
    return this.wallet.history(user.id, q.limit, q.cursor);
  }

  @Post('wallet/deposits')
  @Throttle(MONEY_LIMIT)
  deposit(@CurrentUser() user: AuthUser, @Body(zodBody(depositSchema)) body: z.output<typeof depositSchema>, @Meta() meta: RequestMeta) {
    return this.wallet.createDeposit(user.id, body.amount, meta);
  }

  @Post('wallet/withdrawals')
  @Throttle(MONEY_LIMIT)
  withdraw(@CurrentUser() user: AuthUser, @Body(zodBody(withdrawalSchema)) body: z.output<typeof withdrawalSchema>) {
    return this.wallet.requestWithdrawal(user.id, body.amount);
  }

  @Get('me/kyc')
  kyc(@CurrentUser() user: AuthUser) {
    return this.wallet.kyc(user.id);
  }

  @Post('me/kyc')
  @Throttle(MONEY_LIMIT)
  submitKyc(@CurrentUser() user: AuthUser, @Body(zodBody(kycSchema)) body: z.output<typeof kycSchema>, @Meta() meta: RequestMeta) {
    return this.wallet.submitKyc(user.id, body, meta);
  }
}
