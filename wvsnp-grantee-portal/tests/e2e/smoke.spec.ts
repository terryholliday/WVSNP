import { test, expect } from '@playwright/test';

test('home renders and has primary navigation links', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: /West Virginia Spay\/Neuter Program/i })).toBeVisible();

  await expect(page.getByRole('link', { name: /Start Application/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /Check Status/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /Access Reporting Portal/i })).toBeVisible();
});

test('apply page renders', async ({ page }) => {
  await page.goto('/apply');
  await expect(page.getByRole('heading', { name: /WVSNP Grantee Application/i })).toBeVisible();
});

test('status page renders', async ({ page }) => {
  await page.goto('/status');
  await expect(page.getByRole('heading', { name: /Check Application Status/i })).toBeVisible();
});

test('reporting page renders', async ({ page }) => {
  await page.goto('/reporting');
  await expect(page.getByRole('heading', { name: /Grantee Reporting Portal/i })).toBeVisible();
});
