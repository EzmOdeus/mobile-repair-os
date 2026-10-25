import { expect, test } from '@playwright/test';
import { loginAsOwner } from './helpers';

test.describe('الدخول والصلاحيات', () => {
  test('الزائر غير المسجل يُحوَّل إلى صفحة الدخول', async ({ page }) => {
    await page.goto('/invoices');
    await expect(page).toHaveURL(/\/login/);
  });

  test('المالك يدخل إلى لوحة التحكم', async ({ page }) => {
    await loginAsOwner(page);
    await expect(page.getByRole('button', { name: 'تسجيل الخروج' }).first()).toBeVisible();
  });
});
