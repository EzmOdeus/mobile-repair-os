import { expect, type Page } from '@playwright/test';

export const OWNER = { username: 'owner', password: 'Owner@1234' };

export async function loginAsOwner(page: Page): Promise<void> {
  await page.goto('/login');
  await page.locator('input[autocomplete="username"]').fill(OWNER.username);
  await page.locator('input[autocomplete="current-password"]').fill(OWNER.password);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page).toHaveURL(/\/(dashboard|tickets|invoices)/);
}
