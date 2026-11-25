import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { Env, ENV } from '../config/config.module';
import { createEmailProvider, EMAIL_PROVIDER } from '../notify/email.provider';
import { createSmsProvider, SMS_PROVIDER } from '../notify/sms.provider';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { OtpService } from './otp.service';
import { TokenService } from './token.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    OtpService,
    TokenService,
    { provide: SMS_PROVIDER, inject: [ENV], useFactory: (env: Env) => createSmsProvider(env) },
    { provide: EMAIL_PROVIDER, inject: [ENV], useFactory: (env: Env) => createEmailProvider(env) },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [TokenService],
})
export class AuthModule {}
