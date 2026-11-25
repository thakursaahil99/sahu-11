import { Global, Inject, Module } from '@nestjs/common';
import { Env, loadEnv } from './env';

export const ENV = Symbol('ENV');

/** Injects the validated environment: `constructor(@InjectEnv() env: Env)`. */
export const InjectEnv = () => Inject(ENV);

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: loadEnv }],
  exports: [ENV],
})
export class ConfigModule {}

export type { Env };
