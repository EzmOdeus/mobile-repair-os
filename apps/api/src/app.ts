import express, { type Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { corsOptions } from './config/cors.js';
import { connectDatabase, dbState } from './config/database.js';
import { requestIdMiddleware, authenticate } from './middleware/auth.js';
import { subscriptionWriteGuard } from './middleware/subscriptionGuard.js';
import { uploadAccessGate, uploadAuthorization, serveUploadedFile } from './middleware/uploadAuth.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { auditMiddleware } from './services/auditService.js';
import { registerRoutes } from './routes/index.js';
import cronRouter from './routes/cronRoutes.js';
import { registerAllModels } from './models/register.js';
import { resolveUploadDir } from './services/storageDrivers.js';

export function createApp(): Application {
  // تسجيل الموديلات قبل بناء المسارات يضمن جاهزيتها لأي populate
  registerAllModels();
  const app = express();

  // توثيق OpenAPI متاح عبر Swagger UI دون الحاجة إلى تسجيل الدخول.
  // في بيئة Serverless قد لا يكون الملف مضمّنًا في الحزمة، فنستخدم مستندًا بسيطًا بدلًا من الانهيار.
  // نبحث أولًا بجوار جذر المستودع (حتى يعمل التشغيل من داخل مجلد الـworkspace)، ثم في cwd.
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const openApiPath = [
    path.resolve(moduleDir, '../../../docs/openapi.yaml'),
    path.resolve(process.cwd(), 'docs/openapi.yaml'),
    path.resolve(process.cwd(), 'apps/api/docs/openapi.yaml'),
  ].find((candidate) => fs.existsSync(candidate)) ?? path.resolve(process.cwd(), 'docs/openapi.yaml');
  let openApiDocument: Record<string, unknown>;
  try {
    openApiDocument = YAML.parse(fs.readFileSync(openApiPath, 'utf8'));
  } catch {
    openApiDocument = {
      openapi: '3.0.3',
      info: { title: 'Mobile Repair OS Egypt API', version: '1.0.0' },
      paths: {},
    };
    logger.warn({ openApiPath }, 'تعذر قراءة docs/openapi.yaml - استخدام مستند فارغ');
  }
  openApiDocument.servers = [{ url: `${env.PUBLIC_API_URL}${env.API_PREFIX}`, description: 'API server' }];
  app.get('/docs/openapi.json', (_req, res) => res.json(openApiDocument));

  // نفضّل نسخة الأصول المنسوخة إلى dist (تُضمَّن في حزمة Vercel)؛ وإلا نستخدم حزمة swagger-ui-dist محليًا.
  const swaggerAssetsDir = [
    path.resolve(moduleDir, 'swagger-ui'),
    path.resolve(process.cwd(), 'dist/swagger-ui'),
    path.resolve(process.cwd(), 'apps/api/dist/swagger-ui'),
  ].find((candidate) => fs.existsSync(path.join(candidate, 'swagger-ui.css')));

  const swaggerSetup = swaggerUi.setup(openApiDocument, {
    customSiteTitle: 'Mobile Repair OS API Docs',
    swaggerOptions: { persistAuthorization: true },
  });
  if (swaggerAssetsDir) {
    app.use('/docs', swaggerUi.serve[0], express.static(swaggerAssetsDir, { index: false, redirect: false }), swaggerSetup);
  } else {
    app.use('/docs', swaggerUi.serve, swaggerSetup);
  }

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

  // --- اتصال قاعدة البيانات عند أول طلب (بيئة Serverless) ---
  // في السيرفر الدائم يستبق server.ts الاتصال فلا يفعل هذا الوسيط شيئًا.
  // الوصول لقاعدة البيانات مسموح للـ /health بلا اتصال ليعرض الحالة 'degraded'.
  let dbPromise: Promise<unknown> | null = null;
  app.use((_req, _res, next) => {
    if (dbState() === 'connected') return next();
    if (!dbPromise) {
      dbPromise = connectDatabase();
      // عند الفشل اسمح بمحاولة جديدة في الطلب التالي
      dbPromise.catch(() => {
        dbPromise = null;
      });
    }
    return void dbPromise.then(
      () => next(),
      (err) => next(err),
    );
  });

  // --- مهام دورية خارجية (Vercel Cron) — قبل مصادقة المستخدمين ---
  app.use(`${env.API_PREFIX}/internal/cron`, cronRouter);

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
  if (env.STORAGE_DRIVER === 'local') {
    const uploadDir = resolveUploadDir();
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
  }
  app.use('/uploads', uploadAccessGate, uploadAuthorization('evidence:read'), serveUploadedFile);

  // --- مصادقة على مستوى التطبيق (المسارات العامة تُعلن نفسها) ---
  app.use(`${env.API_PREFIX}`, (req, res, next) => {
    // نستخدم originalUrl ثم نُزيل البادئة لأن req.path داخل app.use قد يختلف حسب نسخة Express
    const rawPath = (req.originalUrl || req.url || '').split('?')[0] ?? '';
    const path = rawPath.startsWith(env.API_PREFIX) ? rawPath.slice(env.API_PREFIX.length) : rawPath;
    const normalized = path.startsWith('/') ? path : `/${path}`;

    const publicPrefixes = [
      '/auth/login',
      '/auth/2fa/verify',
      '/auth/refresh',
      '/auth/register',
      '/auth/forgot-password',
      '/auth/reset-password',
      '/public',
      '/health',
      '/meta',
    ];
    const isPublic = publicPrefixes.some(
      (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
    );
    if (isPublic) {
      return next();
    }
    return authenticate(req, res, next);
  });

  app.use(`${env.API_PREFIX}`, subscriptionWriteGuard);

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

/**
 * نسخة افتراضية لبيئات Serverless: Vercel يستورد التطبيق مباشرة من `dist/app.js`
 * ويتوقع تصديرًا افتراضيًا جاهزًا، بدلًا من استدعاء `createApp()` بنفسه.
 */
export default createApp();
