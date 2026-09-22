import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('landing exposes current metadata, calls to action and legal positioning', async ({
  page,
}) => {
  await page.goto('/landing/');

  await expect(page).toHaveTitle(/^RC Setlist/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://ntworm.github.io/rc-setlist/',
  );
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    'content',
    /setlist extension for Ableton Live/i,
  );
  await expect(page.getByRole('heading', { level: 1 })).toContainText('RC Setlist');
  await expect(page.getByText('source-available', { exact: false }).first()).toBeVisible();
  await expect(
    page.getByText('PolyForm Noncommercial 1.0.0', { exact: false }).first(),
  ).toBeVisible();
  await expect(
    page.getByText(/independent project and is not affiliated with or endorsed by Ableton AG/i),
  ).toBeVisible();

  await expect(page.locator('#download')).toHaveAttribute(
    'href',
    'https://github.com/ntworm/rc-setlist/releases/latest',
  );
  await expect(page.locator('#documentation')).toHaveAttribute(
    'href',
    'https://github.com/ntworm/rc-setlist/blob/main/docs/README.md',
  );
  await expect(page.locator('#source')).toHaveAttribute(
    'href',
    'https://github.com/ntworm/rc-setlist',
  );

  const text = await page.locator('body').innerText();
  expect(text).toContain('Performance');
  expect(text).toMatch(/Stage Control/i);
  expect(text).toMatch(/from Arrangement\s+to stage/i);
  expect(text).not.toContain('Neon Signal');
  expect(text).not.toContain('Drift');
  expect(text).not.toContain('Synchronized demo text');

  await expect(page.locator('.hero-visual img[src="./media/en/stage-control.png"]')).toBeVisible();
  await expect(
    page.locator('.hero-visual img[src="./media/en/performance-phone.png"]'),
  ).toBeVisible();
  // The one link whose markup is rebuilt from its string on every language
  // switch pointed at "undefined" once; no link may.
  await expect(page.locator('a[href="undefined"]')).toHaveCount(0);
  await page.locator('label[for="view-performance"]').click();
  await expect(
    page.locator('.pane-performance img[src="./media/en/performance.png"]'),
  ).toBeVisible();
  await page.locator('label[for="view-phone"]').click();
  await expect(
    page.locator('.pane-phone img[src="./media/en/performance-phone.png"]'),
  ).toBeVisible();
});

test('real interfaces expose neutral marketing state', async ({ page }) => {
  await page.goto('/performance/?scenario=marketing');
  await expect(page.getByText('SONG 03', { exact: true })).toBeVisible();
  await expect(page.getByText('CHORUS', { exact: true })).toBeVisible();
  await expect(page.getByText('SONG 04', { exact: true })).toBeVisible();
  await expect(page.getByText('Neon Signal')).toHaveCount(0);

  await page.goto('/setlist/?scenario=marketing');
  await expect(page.getByText('SONG 03', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('CHORUS', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('SONG 04', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('10:40', { exact: true })).toBeVisible();
  await expect(page.getByText('2:08', { exact: true })).toHaveCount(5);
  await expect(page.getByText('Neon Signal')).toHaveCount(0);
});

for (const viewport of [
  { width: 320, height: 640, name: 'small phone (400% zoom reflow)' },
  { width: 360, height: 740, name: 'common Android phone' },
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

test('landing preserves the product-truth hero artwork aspect ratio', async ({ page }) => {
  await page.setViewportSize({ width: 777, height: 819 });
  await page.goto('/landing/');

  const geometry = await page.locator('.hero-visual .hero-stage').evaluate((image) => {
    const rect = image.getBoundingClientRect();
    return {
      naturalRatio: image.naturalWidth / image.naturalHeight,
      renderedRatio: rect.width / rect.height,
    };
  });

  expect(geometry.naturalRatio).toBeCloseTo(16 / 9, 4);
  // Sub-pixel column widths round the rendered height; a distortion would be
  // orders of magnitude larger than this tolerance.
  expect(geometry.renderedRatio).toBeCloseTo(geometry.naturalRatio, 3);
});

test('landing preserves every public product screenshot aspect ratio', async ({ page }) => {
  for (const viewport of [
    { width: 1413, height: 1024 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/landing/');
    for (const view of ['stage', 'performance', 'phone']) {
      await page.locator(`label[for="view-${view}"]`).click();
      const image = page.locator(`.pane-${view} .shot img`);
      await image.scrollIntoViewIfNeeded();
      await image.evaluate((element) => element.decode());
      const geometry = await image.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          naturalRatio: element.naturalWidth / element.naturalHeight,
          renderedRatio: rect.width / rect.height,
        };
      });
      expect(geometry.renderedRatio).toBeCloseTo(geometry.naturalRatio, 2);
    }
  }
});

test('landing pins hang on their capture in both languages', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const locale of ['en', 'pt-BR']) {
    await page.goto(`/landing/?lang=${locale}`);
    for (const view of ['stage', 'performance', 'phone']) {
      await page.locator(`label[for="view-${view}"]`).click();
      const astray = await page.locator(`.pane-${view} .shot`).evaluate((shot) => {
        const frame = shot.getBoundingClientRect();
        const body = shot.closest('.fig-body').getBoundingClientRect();
        return [...shot.querySelectorAll('.pin')]
          .map((pin) => {
            const rect = pin.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            // A pin hangs from the top edge of its region: its foot is on the
            // capture, and the whole pin stays inside the figure.
            const onCapture =
              x >= frame.left - 1 &&
              x <= frame.right + 1 &&
              rect.bottom >= frame.top - 3 &&
              rect.bottom <= frame.bottom + 1;
            const insideFigure = rect.top >= body.top && rect.left >= body.left - 1;
            return onCapture && insideFigure ? null : pin.textContent;
          })
          .filter(Boolean);
      });
      expect(astray, `${locale} ${view}`).toEqual([]);
    }
  }
});

test('landing does not expose an owner media kit', async ({ page }) => {
  await page.goto('/landing/');

  await expect(page.locator('a[href="./media-kit.html"]')).toHaveCount(0);
  await expect(
    page.getByText('Need artwork for a post or community listing?', { exact: true }),
  ).toHaveCount(0);
});

test('landing keeps keyboard focus visible and loads no external runtime asset', async ({
  page,
}) => {
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('/landing/');
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toBeVisible();
  const focusOutline = await page
    .locator(':focus')
    .evaluate((element) => getComputedStyle(element).outlineStyle);
  expect(focusOutline).not.toBe('none');

  const external = requests.filter((url) => !url.startsWith('http://127.0.0.1:4173/'));
  expect(external).toEqual([]);
});

test('landing switches between English and Portuguese at the canonical URL', async ({ page }) => {
  await page.goto('/landing/');
  await expect(page.locator('#languageSelect')).toHaveValue('en');

  await page.locator('#languageSelect').selectOption('pt-BR');
  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
  await expect(page.locator('#locators-title')).toHaveText(
    /Localizadores\s+— do Arrangement ao palco/,
  );
  await expect(page.locator('#download')).toHaveText('Baixar .ablx');
  await expect(page.locator('.hero-visual .hero-stage')).toHaveAttribute('src', /media\/pt-BR\//);
  await expect(page.locator('a[href="undefined"]')).toHaveCount(0);
  await expect(page.locator('#documentation')).toHaveAttribute('href', './pt-BR/README.html');
  await expect(page).toHaveTitle(/^RC Setlist/);

  await page.reload();
  await expect(page.locator('#languageSelect')).toHaveValue('pt-BR');
  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');

  await page.locator('#languageSelect').selectOption('en');
  await expect(page.locator('#locators-title')).toHaveText(
    /Locators\s+— from Arrangement to stage/,
  );
  await expect(page.locator('#download')).toHaveText('Download .ablx');
  await expect(page.locator('.hero-visual .hero-stage')).toHaveAttribute('src', /media\/en\//);
  await expect(page.locator('a[href="undefined"]')).toHaveCount(0);
  await expect(page.locator('#install a', { hasText: 'installation guide' })).toHaveAttribute(
    'href',
    'https://github.com/ntworm/rc-setlist/blob/main/docs/INSTALL.md',
  );
  await expect(page.locator('#documentation')).toHaveAttribute(
    'href',
    'https://github.com/ntworm/rc-setlist/blob/main/docs/README.md',
  );
});

test('every Portuguese document the landing links to exists', async ({ page, request }) => {
  await page.goto('/landing/?lang=pt-BR');
  const hrefs = await page
    .locator('a[href^="./pt-BR/"]')
    .evaluateAll((links) => [...new Set(links.map((link) => link.getAttribute('href')))]);
  expect(hrefs.length).toBeGreaterThan(4);
  for (const href of hrefs) {
    const response = await request.get(`/landing/${href.slice(2)}`);
    expect(response.status(), href).toBe(200);
  }
});

test('landing has no serious or critical axe-core accessibility violations', async ({ page }) => {
  await page.goto('/landing/');
  const results = await new AxeBuilder({ page })
    // The language switcher exposes a real `<select>`; axe flags the
    // auto-translation buttons used in some themes but RC Setlist does
    // not use them.
    .disableRules(['button-name'])
    .analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
  expect(
    blocking,
    `axe-core blocking violations: ${JSON.stringify(
      blocking.map((v) => ({ id: v.id, nodes: v.nodes.length })),
      null,
      2,
    )}`,
  ).toEqual([]);
});

test('landing axe check covers both EN and pt-BR', async ({ page }) => {
  for (const locale of ['en', 'pt-BR']) {
    await page.goto('/landing/');
    await page.locator('#languageSelect').selectOption(locale);
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page }).disableRules(['button-name']).analyze();
    const blocking = results.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    );
    expect(blocking, `blocking axe violations at locale ${locale}`).toEqual([]);
  }
});
