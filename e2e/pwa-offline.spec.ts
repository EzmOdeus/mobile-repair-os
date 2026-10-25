import { expect, test } from '@playwright/test';
import { loginAsOwner } from './helpers';

const QUEUE_KEY = 'mros.offlineQueue.v1';

test.describe('PWA وطابور عدم الاتصال', () => {
  test('manifest عربي وService Worker مسجّل', async ({ page }) => {
    const manifestResponse = await page.request.get('/manifest.webmanifest');
    expect(manifestResponse.ok()).toBeTruthy();
    const manifest = (await manifestResponse.json()) as {
      lang: string;
      dir: string;
      start_url: string;
      icons: { sizes: string; purpose?: string }[];
    };
    expect(manifest.lang).toBe('ar');
    expect(manifest.dir).toBe('rtl');
    expect(manifest.start_url).toBe('/dashboard');
    expect(manifest.icons.some((icon) => icon.sizes === '192x192')).toBeTruthy();
    expect(manifest.icons.some((icon) => icon.sizes === '512x512' && icon.purpose === 'maskable')).toBeTruthy();

    await page.goto('/login');
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');

    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            if (!('serviceWorker' in navigator)) return 'unsupported';
            const registration = await navigator.serviceWorker.getRegistration('/');
            if (!registration) return 'none';
            if (registration.active) return 'active';
            if (registration.installing) return 'installing';
            if (registration.waiting) return 'waiting';
            return 'pending';
          }),
        { timeout: 20_000 },
      )
      .toMatch(/active|installing|waiting/);
  });

  test('Service Worker يعرض صفحة عدم الاتصال عند فشل التنقل', async ({ page, context }) => {
    await page.goto('/login');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 20_000 });

    await context.setOffline(true);
    await page.goto('/tickets');
    await expect(page.getByRole('heading', { name: 'لا يوجد اتصال بالإنترنت' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'إعادة المحاولة' })).toBeVisible();
  });

  test('إنشاء تذكرة بلا اتصال ثم مزامنتها تلقائيًا عند العودة', async ({ page, context }) => {
    await page.addInitScript((key) => window.localStorage.removeItem(key), QUEUE_KEY);
    await loginAsOwner(page);
    await page.goto('/tickets');
    await expect(page.getByRole('button', { name: /تذكرة جديدة/ })).toBeVisible();

    await context.setOffline(true);
    await page.getByRole('button', { name: /تذكرة جديدة/ }).click();

    await expect(page.getByText(/لا يوجد اتصال بالإنترنت. أدخل بيانات العميل والجهاز يدويًا/)).toBeVisible();

    await page.locator('label').filter({ hasText: 'اسم العميل *' }).locator('input').fill('عميل طابور أوفلاين');
    await page.locator('label').filter({ hasText: 'رقم الموبايل *' }).locator('input').fill('01099887766');
    await page.getByRole('button', { name: 'التالي', exact: true }).click();

    await page.locator('label').filter({ hasText: 'الماركة *' }).locator('input').fill('Samsung');
    await page.locator('label').filter({ hasText: 'الموديل *' }).locator('input').fill('Galaxy A15');
    await page.getByRole('button', { name: 'التالي', exact: true }).click();

    await page.getByRole('textbox', { name: /شكوى العميل/ }).fill('الشاشة مكسورة واللمس لا يعمل');
    await page.getByRole('button', { name: 'حفظ التذكرة محليًا' }).click();

    await expect(page.getByText(/حُفظت التذكرة على هذا الجهاز/)).toBeVisible();
    await expect(page.getByRole('button', { name: /عرض الطابور \(1\)/ })).toBeVisible();

    const queuedLength = await page.evaluate((key) => {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as unknown[]).length : 0;
    }, QUEUE_KEY);
    expect(queuedLength).toBe(1);

    // اعتراض طلب المزامنة حتى لا نضيف تذاكر اختبار لقاعدة البيانات
    await page.route('**/api/v1/tickets', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: { ticket: { _id: '64b000000000000000000001', ticketNumber: 'REP-TEST-000001' } },
          }),
        });
        return;
      }
      await route.continue();
    });

    await context.setOffline(false);

    await expect(page.getByText('تمت مزامنة تذكرة واحدة بنجاح')).toBeVisible({ timeout: 20_000 });

    await expect
      .poll(
        () =>
          page.evaluate((key) => {
            const raw = window.localStorage.getItem(key);
            return raw ? (JSON.parse(raw) as unknown[]).length : 0;
          }, QUEUE_KEY),
        { timeout: 10_000 },
      )
      .toBe(0);
  });
});
