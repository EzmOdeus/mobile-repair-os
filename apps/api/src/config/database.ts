import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from './logger.js';

mongoose.set('strictQuery', true);
if (env.isDev) {
  mongoose.set('debug', false);
}

let listenersBound = false;

function bindConnectionEvents(): void {
  if (listenersBound) return;
  listenersBound = true;

  mongoose.connection.on('connected', () => logger.info('MongoDB متصل'));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB انقطع الاتصال'));
  mongoose.connection.on('reconnected', () => logger.info('MongoDB أعاد الاتصال'));
  mongoose.connection.on('error', (err) => logger.error({ err }, 'خطأ في MongoDB'));
}

/**
 * الاتصال بقاعدة البيانات مع إعادة محاولة بسيطة عند بدء السيرفر.
 */
export async function connectDatabase(retries = 5): Promise<typeof mongoose> {
  bindConnectionEvents();

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const conn = await mongoose.connect(env.MONGODB_URI, {
        maxPoolSize: env.MONGODB_MAX_POOL_SIZE,
        serverSelectionTimeoutMS: 8_000,
        socketTimeoutMS: 45_000,
        autoIndex: !env.isProd,
      });
      return conn;
    } catch (err) {
      const isLast = attempt === retries;
      logger.error(
        { attempt, retries, err: (err as Error).message },
        isLast ? 'فشل الاتصال بـ MongoDB نهائيًا' : 'فشل الاتصال بـ MongoDB، إعادة محاولة',
      );
      if (isLast) throw err;
      await new Promise((r) => setTimeout(r, 1_500 * attempt));
    }
  }

  throw new Error('unreachable');
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.connection.close(false);
  logger.info('تم إغلاق اتصال MongoDB');
}

export function dbState(): string {
  const states: Record<number, string> = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  };
  return states[mongoose.connection.readyState] ?? 'unknown';
}

export { mongoose };
