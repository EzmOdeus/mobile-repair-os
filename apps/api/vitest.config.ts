import { defineConfig } from 'vitest/config';

/**
 * إعداد vitest لواجهة الـAPI.
 *
 * الاختبارات المتكاملة (ترقيم العدّادات) تتصل بقاعدة MongoDB محلية على قاعدة
 * اختبار معزولة `mobile_repair_os_vitest` (تُسقط في البداية والنهاية) — لا تلمس
 * قاعدة التطوير. يمكن تجاوز العنوان عبر متغير البيئة MONGODB_TEST_URI.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    /**
     * كل ملفات الاختبار تتشارك قاعدة الاختبار نفسها وتُسقطها في beforeEach،
     * فتشغيلها بالتوازي يسبب تداخلًا (عدّادات/مستندات تختفي أثناء اختبار آخر).
     */
    fileParallelism: false,
  },
  resolve: {
    // مشروع NodeNext: الاستيرادات تستخدم امتداد .js وهي تشير إلى ملفات .ts
    extensionAlias: { '.js': ['.ts', '.js'] },
  },
});
