import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { resolve } from 'node:path';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ENV, Env } from './config/config.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: true,
    // Keeps the raw body on req.rawBody so payment webhooks can be signature-checked byte for byte.
    rawBody: true,
  });
  const env = app.get<Env>(ENV);
  const logger = new Logger('Bootstrap');

  if (env.TRUST_PROXY) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.useBodyParser('json', { limit: '100kb' });
  app.enableCors({
    // Native apps send no Origin header; browsers (admin panel) must be on the allow-list.
    origin: env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : env.NODE_ENV !== 'production',
    credentials: true,
  });
  app.useStaticAssets(resolve(env.UPLOAD_DIR), { prefix: '/uploads/', maxAge: '7d', index: false });
  app.enableShutdownHooks();

  await app.listen(env.PORT, '0.0.0.0');
  logger.log(`Dream New 11 API on http://localhost:${env.PORT} — APP_MODE=${env.APP_MODE}, SPORTS_PROVIDER=${env.SPORTS_PROVIDER}`);
}

void bootstrap();
