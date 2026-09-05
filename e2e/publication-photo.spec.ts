import { expect, test } from '@playwright/test';

test('removing a photo and closing without saving preserves Storage', async ({ page }) => {
  test.skip(process.env.E2E_LIVE_API === 'true', 'Uses a local Vite component fixture, not a deployed admin session.');
  await page.route('https://photo.test/**', (route) => route.fulfill({
    contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
  }));
  await page.goto('/e2e/fixtures/publication-photo.html');
  await page.getByRole('button', { name: 'Remover foto', exact: true }).click();
  await expect(page.getByText('Nenhuma foto selecionada.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { photoEvents: unknown[] }).photoEvents)).toEqual([]);
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remover foto', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { photoEvents: unknown[] }).photoEvents)).toEqual([]);
});
