/**
 * مدخل Vercel Serverless للـAPI (إطار Express).
 *
 * Vercel يكتشف تلقائيًا `server.js` في جذر الخدمة ويحوّله إلى دالة واحدة.
 * نبني التطبيق من `dist` بعد تشغيل `npm run build`، بدل ترك Vercel يترجم
 * مصادر TypeScript بامتدادات NodeNext (‎.js‎) التي قد لا تُحلّ في بيئة البناء.
 *
 * `registerAllModels()` قبل `createApp()` يضمن تسجيل كل الموديلات حتى في
 * التشغيل البارد، بخلاف `src/server.ts` الذي يسجّلها قبل الاتصال.
 */
import express from 'express';
import { createApp } from './dist/app.js';
import { registerAllModels } from './dist/models/register.js';

void express;
registerAllModels();

export default createApp();
