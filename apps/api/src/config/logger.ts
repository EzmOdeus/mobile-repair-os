import pino from 'pino';
import { env } from './env.js';

export const logger = pino({
  level: env.isTest ? 'silent' : env.isDev ? 'debug' : 'info',
  base: { service: 'mros-api', env: env.NODE_ENV },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.passwordHash',
      '*.refreshTokenHash',
      '*.deviceLockCode',
    ],
    censor: '[REDACTED]',
  },
  transport: env.isDev
    ? { target: 'pino/file', options: { destination: 1 } }
    : undefined,
});

export type Logger = typeof logger;
