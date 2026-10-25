import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { loginAsOwner } from './helpers';

test('فتح فاتورة وتحميل PDF من الخادم', async ({ page }) => {
  await loginAsOwner(page);
  await page.goto('/invoices');

  const invoiceLink = page.locator('a[href^="/invoices/"]').filter({ hasText: /INV-/ }).first();
  await expect(invoiceLink).toBeVisible();
  const invoiceNumber = (await invoiceLink.innerText()).trim();

  await invoiceLink.click();
  await expect(page).toHaveURL(/\/invoices\/[a-f0-9]{24}$/);

  const downloadButton = page.getByRole('button', { name: /تحميل PDF/ });
  await expect(downloadButton).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await downloadButton.click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe(`${invoiceNumber}.pdf`);
  const path = await download.path();
  expect(path).not.toBeNull();
  expect(readFileSync(path!, { encoding: 'latin1', flag: 'r' }).slice(0, 5)).toBe('%PDF-');
});
