import http from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { registerAllModels } from './models/register.js';
import { startSlaScheduler } from './services/slaScheduler.js';

async function main(): Promise<void> {
  // تسجيل الموديلات كلها قبل الاتصال لضمان بناء الفهارس
  registerAllModels();

  await connectDatabase();

  const app = createApp();
  const server = http.createServer(app);
  const stopSlaScheduler = startSlaScheduler();

  server.listen(env.PORT, () => {
    logger.info(
      {
        port: env.PORT,
        env: env.NODE_ENV,
        apiPrefix: env.API_PREFIX,
        corsOrigins: env.corsOrigins,
      },
      `Mobile Repair OS API يعمل على http://localhost:${env.PORT}${env.API_PREFIX}`,
    );
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'إيقاف السيرفر...');
    stopSlaScheduler();
    server.close(() => void 0);
    await disconnectDatabase();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'وعد مرفوض بدون معالجة');
  });
  process.on('uncaughtException', (err) => {
    logger.error({ err }, 'استثناء غير معالج - إيقاف العملية');
    process.exit(1);
  });
}

main().catch((err) => {
  logger.error({ err }, 'فشل بدء السيرفر');
  process.exit(1);
});
