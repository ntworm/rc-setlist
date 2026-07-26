import { expect, test } from '@playwright/test';

async function receivedControlMessages(page) {
  return page.evaluate(async () => fetch('/__test__/messages').then((response) => response.json()));
}

async function emitServerMessage(page, payload) {
  await page.evaluate(async (message) => {
    await fetch('/__test__/emit', { method: 'POST', body: JSON.stringify(message) });
  }, payload);
}

async function installFullscreenStubs(page, options = {}) {
  const modes = {
    fullscreenMode: options.fullscreenMode || 'success',
    wakeLockMode: options.wakeLockMode || 'success',
  };
  await page.addInitScript(({ fullscreenMode, wakeLockMode }) => {
    let fullscreenElement = null;
    let visibilityState = 'visible';
    let latestLock = null;
    window.__fullscreenRequests = 0;
    window.__wakeLockRequests = 0;
    window.__wakeLockReleases = 0;
    Object.defineProperty(Document.prototype, 'fullscreenElement', {
      configurable: true,
      get: () => fullscreenElement,
    });
    Object.defineProperty(Document.prototype, 'visibilityState', {
      configurable: true,
      get: () => visibilityState,
    });
    window.__setVisibility = (value) => {
      visibilityState = value;
      document.dispatchEvent(new Event('visibilitychange'));
    };
    Object.defineProperty(Element.prototype, 'requestFullscreen', {
      configurable: true,
      value: fullscreenMode === 'unavailable' ? undefined : async function requestFullscreen() {
        window.__fullscreenRequests += 1;
        if (fullscreenMode === 'reject') throw new Error('fullscreen denied');
        fullscreenElement = this;
        document.dispatchEvent(new Event('fullscreenchange'));
      },
    });
    Object.defineProperty(Document.prototype, 'exitFullscreen', {
      configurable: true,
      value: async () => {
        fullscreenElement = null;
        document.dispatchEvent(new Event('fullscreenchange'));
      },
    });
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: wakeLockMode === 'unavailable' ? undefined : {
        request: async () => {
          window.__wakeLockRequests += 1;
          if (wakeLockMode === 'reject') throw new Error('wake lock denied');
          const listeners = new Set();
          latestLock = {
            released: false,
            addEventListener: (_type, listener) => listeners.add(listener),
            release: async function release() {
              this.released = true;
              window.__wakeLockReleases += 1;
              for (const listener of listeners) listener();
            },
          };
          return latestLock;
        },
      },
    });
    window.__releaseWakeLock = async () => latestLock?.release();
  }, modes);
}

for (const route of ['/performance/', '/setlist/']) {
  test(`Fullscreen button and F shortcut control Wake Lock on ${route}`, async ({ page }) => {
    await installFullscreenStubs(page);
    await page.goto(route);
    const button = page.locator('#fullscreenButton');

    await button.click();
    await expect.poll(() => page.evaluate(() => window.__fullscreenRequests)).toBe(1);
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => page.evaluate(() => window.__wakeLockRequests)).toBe(1);

    await page.keyboard.press('f');
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => page.evaluate(() => window.__wakeLockReleases)).toBe(1);
  });
}

test('Setlist Previous and Next require a real 500 ms pointer hold while Play and Stop click immediately', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/setlist/');
  const transportSafety = await page.locator('.transport-dock .btn').evaluateAll((buttons) => buttons.map((button) => ({
    svgCount: button.querySelectorAll('svg').length,
    text: button.textContent.trim(),
    touchAction: getComputedStyle(button).touchAction,
    userSelect: getComputedStyle(button).userSelect,
  })));
  expect(transportSafety).toHaveLength(4);
  expect(transportSafety.every((button) => (
    button.svgCount === 1
      && button.text === ''
      && button.touchAction === 'manipulation'
      && button.userSelect === 'none'
  ))).toBe(true);

  for (const id of ['btnPrevious', 'btnNext']) {
    const contextMenuAllowed = await page.locator(`#${id}`).evaluate((button) => (
      button.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    ));
    expect(contextMenuAllowed).toBe(false);
  }
  const next = page.locator('#btnNext');

  await next.dispatchEvent('pointerdown', { button: 0, pointerId: 1, pointerType: 'touch', isPrimary: true });
  await page.waitForTimeout(250);
  await next.dispatchEvent('pointerup', { button: 0, pointerId: 1, pointerType: 'touch', isPrimary: true });
  expect((await receivedControlMessages(page)).filter((message) => message.type === 'jump')).toHaveLength(0);

  await next.dispatchEvent('pointerdown', { button: 0, pointerId: 2, pointerType: 'touch', isPrimary: true });
  await page.waitForTimeout(550);
  await next.dispatchEvent('pointerup', { button: 0, pointerId: 2, pointerType: 'touch', isPrimary: true });
  const jumps = (await receivedControlMessages(page)).filter((message) => message.type === 'jump');
  expect(jumps).toEqual([{ type: 'jump', songIndex: 2, sectionIndex: 3 }]);

  await page.locator('#btnPlay').click();
  await page.locator('#btnStop').click();
  const messages = await receivedControlMessages(page);
  expect(messages.some((message) => message.type === 'play')).toBe(true);
  expect(messages.some((message) => message.type === 'stop')).toBe(true);

  await page.locator('#btnPrevious').focus();
  await page.keyboard.down('Enter');
  await page.waitForTimeout(550);
  await page.keyboard.up('Enter');
  const keyboardJumps = (await receivedControlMessages(page)).filter((message) => message.type === 'jump');
  expect(keyboardJumps.at(-1)).toEqual({ type: 'jump', songIndex: 2, sectionIndex: 1 });
});

test('Setlist keeps quantization pending until authoritative Ableton state arrives', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/setlist/');
  const fixture = await page.evaluate(async () => fetch('/__test__/state').then((response) => response.json()));
  const select = page.locator('#quantizationSelect');

  await expect(select).toHaveValue('4');
  await select.selectOption('7');
  await expect(select).toHaveValue('7');
  await expect(select).toHaveAttribute('aria-busy', 'true');
  await page.waitForTimeout(80);
  await expect(select).toHaveValue('7');

  await emitServerMessage(page, fixture);
  await expect(select).toHaveValue('7');
  await emitServerMessage(page, {
    ...fixture,
    state: { ...fixture.state, clipTriggerQuantization: 7 },
  });
  await expect(select).toHaveValue('7');
  await expect(select).toHaveAttribute('aria-busy', 'false');

  const sent = (await receivedControlMessages(page)).find((message) => message.type === 'set_quantization');
  expect(sent.value).toBe(7);
  expect(sent.commandId).toMatch(/^quantization-/);
});

test('Setlist disables transport for read-only and locally locked controllers', async ({ page }) => {
  await page.goto('/setlist/?scenario=never-connected');
  await expect(page.locator('.transport-dock .btn:enabled')).toHaveCount(0);

  await page.goto('/setlist/?scenario=read-only');
  await expect(page.locator('.transport-dock .btn:enabled')).toHaveCount(0);

  await page.goto('/setlist/');
  await expect(page.locator('#btnPlay')).toBeEnabled();
  await page.locator('#btnLock').click();
  await expect(page.locator('.transport-dock .btn:enabled')).toHaveCount(0);
  await expect(page.locator('.secondary-controls button:enabled')).toHaveCount(0);
  await expect(page.locator('#quantizationSelect')).toBeDisabled();
});

test('Setlist jump feedback stays stable until authoritative state confirmation', async ({ page }) => {
  await page.goto('/setlist/');
  const fixtureState = await page.evaluate(async () => fetch('/__test__/state').then((response) => response.json()));
  const oldSection = page.locator('.section-btn[data-song="2"][data-section="2"]');
  const target = page.locator('.section-btn[data-song="2"][data-section="3"]');
  await expect(oldSection).toHaveClass(/active/);

  await emitServerMessage(page, { type: 'jump_pending', songIndex: 2, sectionIndex: 3, landingTime: 320 });
  await expect(target).toHaveClass(/jumping/);
  await emitServerMessage(page, { type: 'jump_executed', songIndex: 2, sectionIndex: 3 });
  await expect(target).toHaveClass(/jump-confirming/);

  await emitServerMessage(page, { ...fixtureState, state: { ...fixtureState.state, activeSongIndex: 2, activeSectionIndex: 2 } });
  await expect(oldSection).toHaveClass(/active/);
  await expect(target).toHaveClass(/jump-confirming/);

  await emitServerMessage(page, { ...fixtureState, state: { ...fixtureState.state, activeSongIndex: 2, activeSectionIndex: 3 } });
  await expect(target).toHaveClass(/active/);
  await expect(target).not.toHaveClass(/jump-confirming/);
  await expect(oldSection).not.toHaveClass(/active/);
});

test('Performance preserves its last state while reconnecting', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/performance/?scenario=stale');
  await expect(page.locator('#songTitle')).toContainText('OPEN CIRCUIT');
  await expect(page.locator('body')).toHaveClass(/connection-stale/);
  await expect(page.locator('#statusText')).toHaveText('RECONNECTING');
  await expect(page.locator('#networkErrorOverlay')).toHaveClass(/visible/);
  await expect(page.locator('#songTitle')).toContainText('OPEN CIRCUIT');
});

for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`Performance reclaims the lyrics area at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/performance/?scenario=no-lyrics');
    await expect(page.locator('#lyricsCard')).toBeHidden();
    const geometry = await page.evaluate(() => {
      const grid = document.querySelector('.stage-grid');
      const nowPlaying = document.querySelector('.now-playing');
      const footer = document.querySelector('.performance-footer');
      const gridRect = grid.getBoundingClientRect();
      const nowRect = nowPlaying.getBoundingClientRect();
      const footerRect = footer.getBoundingClientRect();
      return {
        clientHeight: document.documentElement.clientHeight,
        scrollHeight: document.documentElement.scrollHeight,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        gridColumns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
        gridRows: getComputedStyle(grid).gridTemplateRows.split(' ').length,
        nowWidthRatio: nowRect.width / gridRect.width,
        nowHeightRatio: nowRect.height / gridRect.height,
        footerWidthRatio: footerRect.width / gridRect.width,
      };
    });
    expect(geometry.scrollHeight).toBeLessThanOrEqual(geometry.clientHeight);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
    expect(geometry.gridColumns).toBe(1);
    expect(geometry.gridRows).toBe(2);
    expect(geometry.nowWidthRatio).toBeGreaterThan(0.98);
    expect(geometry.nowHeightRatio).toBeGreaterThan(0.65);
    expect(geometry.footerWidthRatio).toBeGreaterThan(0.98);
  });
}

for (const route of ['/performance/', '/setlist/']) {
  test(`${route} exposes an actionable first-connection failure`, async ({ page }) => {
    await page.goto(`${route}?scenario=never-connected`);
    await expect(page.locator('#networkErrorOverlay')).toHaveClass(/visible/);
    await expect(page.locator('body')).toHaveClass(/connection-empty/);
    await expect(page.locator('#statusText')).toContainText(route === '/performance/' ? 'OFFLINE' : 'Disconnected');
    await expect(page.locator('#networkErrorOverlay h2')).toHaveText('Bridge unavailable');
    await expect(page.locator('#networkErrorOverlay p')).toContainText('No show state has been received');
    const overlay = await page.locator('#networkErrorOverlay').evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height, pointerEvents: getComputedStyle(element).pointerEvents };
    });
    expect(overlay.width).toBe(page.viewportSize().width);
    expect(overlay.height).toBe(page.viewportSize().height);
    expect(overlay.pointerEvents).toBe('auto');
  });
}

for (const route of ['/performance/', '/setlist/']) {
  test(`${route} stale state remains nonblocking and uses reconnect copy`, async ({ page }) => {
    await page.goto(`${route}?scenario=stale`);
    await expect(page.locator('body')).toHaveClass(/connection-stale/);
    await expect(page.locator('body')).not.toHaveClass(/connection-empty/);
    await expect(page.locator('#networkErrorOverlay h2')).toHaveText('Reconnecting');
    await expect(page.locator('#networkErrorOverlay p')).toContainText('last valid state');
    await expect(page.locator('#networkErrorOverlay')).toHaveCSS('pointer-events', 'none');
  });
}

for (const route of ['/performance/', '/setlist/']) {
  test(`${route} keeps primary stage targets at least 44px`, async ({ page }) => {
    await page.setViewportSize(route === '/performance/' ? { width: 844, height: 390 } : { width: 1024, height: 768 });
    await page.goto(route);
    const selector = route === '/performance/'
      ? '#fullscreenButton'
      : '.app-bar button, .app-bar summary, .quantization-control, .section-btn, .transport-dock .btn, .secondary-controls .btn, .log-drawer > summary';
    const undersized = await page.locator(selector).evaluateAll((elements) => elements
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height < 44;
      })
      .map((element) => ({ text: element.textContent.trim(), height: element.getBoundingClientRect().height })));
    expect(undersized).toEqual([]);
  });
}

test('Fullscreen failures stay usable with an accessible notice', async ({ page }) => {
  await installFullscreenStubs(page, { fullscreenMode: 'reject' });
  await page.goto('/performance/');
  await page.locator('#fullscreenButton').click();
  await expect(page.locator('#fullscreenButton')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#stageNotice')).toContainText('Could not enter full screen');
  await expect(page.locator('#stageNotice')).toBeVisible();
});

test('Unavailable fullscreen exposes a fallback', async ({ page }) => {
  await installFullscreenStubs(page, { fullscreenMode: 'unavailable' });
  await page.goto('/performance/');
  await page.locator('#fullscreenButton').click();
  await expect(page.locator('#stageNotice')).toContainText('Full screen is not available');
});

test('Unavailable Wake Lock exposes a fallback', async ({ page }) => {
  await installFullscreenStubs(page, { wakeLockMode: 'unavailable' });
  await page.goto('/performance/');
  await page.locator('#fullscreenButton').click();
  await expect(page.locator('#fullscreenButton')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#stageNotice')).toContainText('does not support Screen Wake Lock');
});

test('Wake Lock rejection and reacquisition are handled in the browser', async ({ page }) => {
  await installFullscreenStubs(page, { wakeLockMode: 'reject' });
  await page.goto('/performance/');
  await page.locator('#fullscreenButton').click();
  await expect(page.locator('#stageNotice')).toContainText('did not allow the screen to stay awake');

  const secondPage = await page.context().newPage();
  await installFullscreenStubs(secondPage);
  await secondPage.goto('/performance/');
  await secondPage.locator('#fullscreenButton').click();
  await expect.poll(() => secondPage.evaluate(() => window.__wakeLockRequests)).toBe(1);
  await secondPage.evaluate(async () => {
    await window.__releaseWakeLock();
    window.__setVisibility('hidden');
    window.__setVisibility('visible');
  });
  await expect.poll(() => secondPage.evaluate(() => window.__wakeLockRequests)).toBe(2);
});

test('Reduced motion and keyboard focus remain visible', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/setlist/');
  await page.keyboard.press('Tab');
  const state = await page.evaluate(() => ({
    activeId: document.activeElement?.id,
    outlineWidth: parseFloat(getComputedStyle(document.activeElement).outlineWidth),
    transitionSeconds: parseFloat(getComputedStyle(document.activeElement).transitionDuration),
  }));
  expect(state.activeId).toBe('btnLock');
  expect(state.outlineWidth).toBeGreaterThanOrEqual(2);
  expect(state.transitionSeconds).toBeLessThanOrEqual(0.001);
});

test('Performance handles an empty project without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/performance/?scenario=no-song');
  await expect(page.locator('#songTitle')).toHaveText('NONE');
  await expect(page.locator('#lyricsCard')).toBeHidden();
  const geometry = await page.evaluate(() => ({
    clientHeight: document.documentElement.clientHeight,
    scrollHeight: document.documentElement.scrollHeight,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(geometry.scrollHeight).toBeLessThanOrEqual(geometry.clientHeight);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
});

test('Setlist explains an empty project and keeps its workspace contained', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/setlist/?scenario=no-song');
  await expect(page.locator('#songList')).toContainText('No songs with locators were found in the project.');
  const geometry = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
});

test('Setlist closes a modal with Escape and restores focus to its opener', async ({ page }) => {
  await page.goto('/setlist/');
  await page.locator('.tools-menu > summary').click();
  const opener = page.getByRole('button', { name: 'Lyrics' });
  await opener.click();
  await expect(page.locator('#lyricsModal')).toHaveClass(/open/);

  await page.keyboard.press('Escape');
  await expect(page.locator('#lyricsModal')).not.toHaveClass(/open/);
  await expect(opener).toBeFocused();
});
