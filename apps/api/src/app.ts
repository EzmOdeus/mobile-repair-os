import express, { type Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { corsOptions } from './config/cors.js';
import { dbState } from './config/database.js';
import { requestIdMiddleware, authenticate } from './middleware/auth.js';
import { uploadAccessGate, uploadAuthorization, serveUploadedFile } from './middleware/uploadAuth.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { auditMiddleware } from './services/auditService.js';
import { registerRoutes } from './routes/index.js';
import { resolveUploadDir } from './services/storageService.js';

export function createApp(): Application {
  const app = express();

  // توثيق OpenAPI متاح عبر Swagger UI دون الحاجة إلى تسجيل الدخول.
  const openApiPath = path.resolve(process.cwd(), 'docs/openapi.yaml');
  const openApiDocument = YAML.parse(fs.readFileSync(openApiPath, 'utf8'));
  openApiDocument.servers = [{ url: `${env.PUBLIC_API_URL}${env.API_PREFIX}`, description: 'API server' }];
  app.get('/docs/openapi.json', (_req, res) => res.json(openApiDocument));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument, {
    customSiteTitle: 'Mobile Repair OS API Docs',
    swaggerOptions: { persistAuthorization: true },
  }));

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // --- الأمان ---
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: false,
    }),
  );

  app.use(cors(corsOptions));

  app.use(compression());
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  app.use(requestIdMiddleware);

  if (!env.isTest) {
    app.use(
      morgan(env.isDev ? 'dev' : 'combined', {
        stream: { write: (message: string) => logger.info(message.trim()) },
        skip: (req) => req.path === '/health' || req.path === `${env.API_PREFIX}/health`,
      }),
    );
  }

  // --- حد معدل الطلبات ---
  app.use(
    rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MINUTES * 60_000,
      max: env.RATE_LIMIT_MAX,
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        success: false,
        error: { code: 'RATE_LIMITED', message: 'عدد الطلبات كبير، حاول بعد قليل' },
      },
    }),
  );

  // --- فحص الصحة ---
  const health = (_req: express.Request, res: express.Response) => {
    res.json({
      success: true,
      data: {
        service: 'mobile-repair-os-api',
        status: dbState() === 'connected' ? 'ok' : 'degraded',
        database: dbState(),
        uptimeSeconds: Math.round(process.uptime()),
        version: '1.0.0',
        time: new Date().toISOString(),
      },
    });
  };
  app.get('/health', health);
  app.get(`${env.API_PREFIX}/health`, health);

  /**
   * --- الملفات المرفوعة ---
   *
   * لا نستخدم `express.static` مباشرة: كانت تخدم أي ملف لأي مستخدم مُصادَق بغض
   * النظر عن مؤسسته (المسار يبدأ بـ`<organizationId>`). الآن كل طلب يمر على
   * `uploadAccessGate` (رابط موقّع صالح أو جلسة) ثم `uploadAuthorization` الذي
   * يتحقق من مطابقة المؤسسة والصلاحية ويمنع الهروب من المجلد، ثم نُقدّم الملف
   * بأنفسنا. البوابة قبل `authenticate` لأن وسوم `<img>` لا تحمل رأس Authorization
   * فتعتمد على التوقيع المرفق بالرابط.
   */
  const uploadDir = resolveUploadDir();
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
  app.use('/uploads', uploadAccessGate, uploadAuthorization('evidence:read'), serveUploadedFile);

  // --- مصادقة على مستوى التطبيق (المسارات العامة تُعلن نفسها) ---
  app.use(`${env.API_PREFIX}`, (req, res, next) => {
    // نستخدم originalUrl ثم نُزيل البادئة لأن req.path داخل app.use قد يختلف حسب نسخة Express
    const rawPath = (req.originalUrl || req.url || '').split('?')[0] ?? '';
    const path = rawPath.startsWith(env.API_PREFIX) ? rawPath.slice(env.API_PREFIX.length) : rawPath;
    const normalized = path.startsWith('/') ? path : `/${path}`;

    const publicPrefixes = ['/auth/login', '/auth/refresh', '/auth/register', '/public', '/health', '/meta'];
    const isPublic = publicPrefixes.some(
      (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
    );
    if (isPublic) {
      return next();
    }
    return authenticate(req, res, next);
  });

  app.use(`${env.API_PREFIX}`, auditMiddleware);

  // --- المسارات ---
  registerRoutes(app);

  app.get('/', (_req, res) => {
    res.json({
      success: true,
      data: {
        name: 'Mobile Repair OS Egypt API',
        description: 'منصة إدارة وتشغيل مراكز صيانة الموبايل',
        apiPrefix: env.API_PREFIX,
        docs: `${env.API_PREFIX}/meta/endpoints`,
        health: '/health',
      },
    });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export function resolveStaticPath(...segments: string[]): string {
  return path.join(process.cwd(), ...segments);
}
