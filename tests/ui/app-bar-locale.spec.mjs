import { expect, test } from '@playwright/test';

// The Stage Control top bar keeps one line, the same shape in English and in
// Portuguese, on every desktop width above the stacked layout. Longer words
// shrink the bar's text instead of pushing buttons to a second row.
const widths = [1440, 1366, 1280, 1200];

async function setLocale(page, locale) {
  await page.evaluate((value) => {
    const select = document.querySelector('#languageSelect');
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, locale);
  await page.waitForTimeout(150);
}

async function barGeometry(page) {
  return page.evaluate(() => {
    const bar = document.querySelector('header.app-bar');
    const rect = bar.getBoundingClientRect();
    const tops = [
      ...bar.querySelectorAll(
        '.app-brand, .profile-select-control, #btnManageProfiles, .language-control, #btnLock, .tools-menu > summary, #fullscreenButton, .status-badge',
      ),
    ].map((element) => Math.round(element.getBoundingClientRect().top));
    const clipped = [...bar.querySelectorAll('.ui-button, .tools-menu > summary, .status-badge')]
      .filter((element) => element.scrollWidth > element.clientWidth + 1)
      .map((element) => element.id || element.textContent.trim());
    const button = document.querySelector('#btnLock');
    return {
      height: Math.round(rect.height),
      overflow: bar.scrollWidth - bar.clientWidth,
      rows: new Set(tops.map((top) => Math.round(top / 20))).size,
      clipped,
      selectWidth: Math.round(
        document.querySelector('#profileSelect').getBoundingClientRect().width,
      ),
      fontSize: parseFloat(getComputedStyle(button).fontSize),
    };
  });
}

for (const width of widths) {
  test(`top bar keeps one row in EN and PT at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/setlist/');
    await setLocale(page, 'en');
    const english = await barGeometry(page);
    await setLocale(page, 'pt-BR');
    const portuguese = await barGeometry(page);

    for (const [name, geometry] of [
      ['en', english],
      ['pt-BR', portuguese],
    ]) {
      expect(geometry.rows, `${name}: every bar item on one row`).toBe(1);
      expect(geometry.overflow, `${name}: nothing overflows the bar`).toBeLessThanOrEqual(1);
      expect(geometry.clipped, `${name}: no button text is cut`).toEqual([]);
      expect(
        geometry.selectWidth,
        `${name}: the setlist name stays readable`,
      ).toBeGreaterThanOrEqual(96);
      expect(geometry.fontSize, `${name}: text never shrinks below 9.5px`).toBeGreaterThanOrEqual(
        9.5,
      );
    }
    expect(
      Math.abs(portuguese.height - english.height),
      'same bar height in both languages',
    ).toBeLessThanOrEqual(2);
  });
}

test('the bar fits again when the status text grows after load', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto('/setlist/');
  await setLocale(page, 'pt-BR');
  await page.evaluate(() => {
    document.querySelector('#statusText').textContent = 'Reconectando ao Live...';
  });
  await page.waitForTimeout(150);
  const geometry = await barGeometry(page);
  expect(geometry.rows).toBe(1);
  expect(geometry.overflow).toBeLessThanOrEqual(1);
  expect(geometry.clipped).toEqual([]);
});
