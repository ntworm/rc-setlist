import { expect, test } from '@playwright/test';

const performanceViewports = [
  { width: 390, height: 844, name: 'phone portrait' },
  { width: 844, height: 390, name: 'phone landscape' },
  { width: 1024, height: 768, name: 'compact notebook' },
  { width: 1366, height: 768, name: 'notebook' },
];

const compactSetlistViewports = [
  { width: 390, height: 844, name: 'phone portrait' },
  { width: 844, height: 390, name: 'phone landscape' },
  { width: 768, height: 1024, name: 'portrait tablet' },
];

const desktopSetlistViewports = [
  { width: 1024, height: 768, name: 'compact notebook' },
  { width: 1366, height: 768, name: 'notebook' },
  { width: 1440, height: 900, name: 'large notebook' },
];

async function pageGeometry(page, selectors) {
  return page.evaluate((requestedSelectors) => {
    const regions = Object.fromEntries(requestedSelectors.map((selector) => {
      const element = document.querySelector(selector);
      if (!element) return [selector, null];
      const rect = element.getBoundingClientRect();
      return [selector, {
        bottom: rect.bottom,
        height: rect.height,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        width: rect.width,
      }];
    }));
    return {
      clientHeight: document.documentElement.clientHeight,
      clientWidth: document.documentElement.clientWidth,
      regions,
      scrollHeight: document.documentElement.scrollHeight,
      scrollWidth: document.documentElement.scrollWidth,
    };
  }, selectors);
}

function expectContained(rect, viewport, selector) {
  expect(rect, `${selector} must exist`).not.toBeNull();
  expect(rect.left, `${selector} left edge`).toBeGreaterThanOrEqual(0);
  expect(rect.top, `${selector} top edge`).toBeGreaterThanOrEqual(0);
  expect(rect.right, `${selector} right edge`).toBeLessThanOrEqual(viewport.clientWidth + 1);
  expect(rect.bottom, `${selector} bottom edge`).toBeLessThanOrEqual(viewport.clientHeight + 1);
}

for (const viewport of performanceViewports) {
  test(`Performance contains the full stage UI at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/performance/');
    await expect(page.locator('#lyricsCard')).toBeVisible();
    await expect(page.locator('.lyric-line')).toHaveCount(8);

    const geometry = await pageGeometry(page, [
      '#songCard',
      '#sectionCard',
      '#lyricsCard',
      '.performance-footer',
    ]);

    expect(geometry.scrollWidth, 'Performance must not scroll horizontally').toBeLessThanOrEqual(geometry.clientWidth);
    expect(geometry.scrollHeight, 'Performance must fit in one viewport').toBeLessThanOrEqual(geometry.clientHeight);
    for (const [selector, rect] of Object.entries(geometry.regions)) {
      expectContained(rect, geometry, selector);
    }
  });
}

for (const viewport of desktopSetlistViewports) {
  test(`Setlist keeps controls and content bounded at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/setlist/');
    await expect(page.locator('#songList .song-item')).toHaveCount(8);

    const geometry = await pageGeometry(page, ['header', '.setlist-pane', '.control-pane', '.transport-dock']);
    const overflowingSectionRows = await page.evaluate(() => (
      Array.from(document.querySelectorAll('.song-sections'))
        .filter((element) => element.scrollWidth > element.clientWidth + 1)
        .length
    ));
    expect(geometry.scrollWidth, 'Setlist must not scroll horizontally').toBeLessThanOrEqual(geometry.clientWidth);
    expect(geometry.scrollHeight, 'Tablet and desktop Setlist must fit in one viewport').toBeLessThanOrEqual(geometry.clientHeight);
    expect(overflowingSectionRows, 'Section rows must wrap instead of scrolling horizontally').toBe(0);
    expectContained(geometry.regions.header, geometry, 'header');
    expectContained(geometry.regions['.setlist-pane'], geometry, '.setlist-pane');
    expectContained(geometry.regions['.control-pane'], geometry, '.control-pane');
    expectContained(geometry.regions['.transport-dock'], geometry, '.transport-dock');
  });
}

for (const viewport of compactSetlistViewports) {
  test(`Setlist keeps a non-overlapping bottom dock at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/setlist/');
    await expect(page.locator('#songList .song-item')).toHaveCount(8);

    const before = await page.evaluate(() => {
      const dock = document.querySelector('.transport-dock').getBoundingClientRect();
      return {
        clientHeight: document.documentElement.clientHeight,
        clientWidth: document.documentElement.clientWidth,
        dockBottom: dock.bottom,
        dockPosition: getComputedStyle(document.querySelector('.transport-dock')).position,
        scrollHeight: document.documentElement.scrollHeight,
        scrollWidth: document.documentElement.scrollWidth,
      };
    });
    expect(before.dockPosition).toBe('fixed');
    expect(Math.abs(before.dockBottom - before.clientHeight)).toBeLessThanOrEqual(1);
    expect(before.scrollHeight).toBeGreaterThan(before.clientHeight);
    expect(before.scrollWidth).toBeLessThanOrEqual(before.clientWidth);

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const after = await page.evaluate(() => {
      const dock = document.querySelector('.transport-dock').getBoundingClientRect();
      const lastSong = document.querySelector('#songList .song-item:last-child').getBoundingClientRect();
      return {
        clientHeight: document.documentElement.clientHeight,
        dockBottom: dock.bottom,
        dockTop: dock.top,
        lastSongBottom: lastSong.bottom,
      };
    });
    expect(Math.abs(after.dockBottom - after.clientHeight)).toBeLessThanOrEqual(1);
    expect(after.lastSongBottom).toBeLessThanOrEqual(after.dockTop - 1);
  });
}

test('Setlist HUD keeps long active titles vertically legible in a short desktop window', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 560 });
  await page.goto('/setlist/');
  const geometry = await page.locator('#hudSong').evaluate((element) => {
    const value = element.getBoundingClientRect();
    const card = element.closest('.hud-card').getBoundingClientRect();
    const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
    return { cardBottom: card.bottom, cardTop: card.top, lineHeight, valueBottom: value.bottom, valueHeight: value.height, valueTop: value.top };
  });
  expect(geometry.valueTop).toBeGreaterThanOrEqual(geometry.cardTop);
  expect(geometry.valueBottom).toBeLessThanOrEqual(geometry.cardBottom);
  expect(geometry.valueHeight).toBeGreaterThanOrEqual(geometry.lineHeight * 0.95);
});
