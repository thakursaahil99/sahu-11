import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { Env, ENV } from '../config/config.module';
import { LedgerService } from './ledger.service';
import { PAYMENT_PROVIDER, RazorpayProvider } from './payment-provider';
import { PaymentsController } from './payments.controller';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [WalletController, PaymentsController],
  providers: [
    LedgerService,
    WalletService,
    {
      provide: PAYMENT_PROVIDER,
      inject: [ENV],
      // No gateway is configured in demo mode — nothing can take real money.
      useFactory: (env: Env) =>
        env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET && env.RAZORPAY_WEBHOOK_SECRET
          ? new RazorpayProvider(env.RAZORPAY_KEY_ID, env.RAZORPAY_KEY_SECRET, env.RAZORPAY_WEBHOOK_SECRET)
          : null,
    },
  ],
  exports: [WalletService, LedgerService],
})
export class WalletModule {}
