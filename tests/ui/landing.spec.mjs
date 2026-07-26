import { expect, test } from '@playwright/test';

test('landing exposes current metadata, calls to action and legal positioning', async ({ page }) => {
  await page.goto('/landing/');

  await expect(page).toHaveTitle(/^Ableton RC Setlist/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://ntworm.github.io/rc-setlist/');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /setlist extension for Ableton Live/i);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Ableton RC Setlist');
  await expect(page.getByText('source-available', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('PolyForm Noncommercial 1.0.0', { exact: false }).first()).toBeVisible();
  await expect(page.getByText(/independent project and is not affiliated with or endorsed by Ableton AG/i)).toBeVisible();

  await expect(page.locator('#download')).toHaveAttribute('href', 'https://github.com/ntworm/rc-setlist/releases/latest');
  await expect(page.locator('#documentation')).toHaveAttribute('href', './README.md');
  await expect(page.locator('#source')).toHaveAttribute('href', 'https://github.com/ntworm/rc-setlist');

  const text = await page.locator('body').innerText();
  expect(text).toContain('Neon Signal');
});

for (const viewport of [
  { width: 390, height: 844, name: 'phone portrait' },
  { width: 844, height: 390, name: 'phone landscape' },
  { width: 1440, height: 900, name: 'desktop' },
]) {
  test(`landing has no horizontal overflow at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/landing/');
    const geometry = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
  });
}

test('landing keeps keyboard focus visible and loads no external runtime asset', async ({ page }) => {
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('/landing/');
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toBeVisible();
  const focusOutline = await page.locator(':focus').evaluate((element) => getComputedStyle(element).outlineStyle);
  expect(focusOutline).not.toBe('none');

  const external = requests.filter((url) => !url.startsWith('http://127.0.0.1:4173/'));
  expect(external).toEqual([]);
});
