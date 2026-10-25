/**
 * نسخ أصول Swagger UI إلى dist حتى يتضمّنها حزم Vercel.
 * متتبّع الملفات لا يرى ملفات swagger-ui-dist الثابتة لأن swagger-ui-express
 * يقرأها عبر مسار محسوب وقت التشغيل، فتظهر صفحة /docs بلا CSS/JS على Serverless.
 */
import { createRequire } from 'node:module';
import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const source = path.dirname(require.resolve('swagger-ui-dist/package.json'));
const target = path.resolve(process.cwd(), 'dist/swagger-ui');

const files = [
  'swagger-ui.css',
  'swagger-ui-bundle.js',
  'swagger-ui-standalone-preset.js',
  'favicon-32x32.png',
  'favicon-16x16.png',
  'oauth2-redirect.html',
];

await mkdir(target, { recursive: true });
await Promise.all(files.map((file) => cp(path.join(source, file), path.join(target, file))));
