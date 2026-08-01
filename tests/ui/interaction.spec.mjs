import { expect, test } from '@playwright/test';

async function receivedControlMessages(page) {
  return page.evaluate(async () => fetch('/__test__/messages').then((response) => response.json()));
}

async function emitServerMessage(page, payload) {
  await page.evaluate(async (message) => {
    await fetch('/__test__/emit', { method: 'POST', body: JSON.stringify(message) });
  }, payload);
}

async function emitPlayingState(page, isPlaying) {
  await page.evaluate(async (playing) => {
    const message = await fetch('/__test__/state').then((response) => response.json());
    message.state.isPlaying = playing;
    await fetch('/__test__/emit', { method: 'POST', body: JSON.stringify(message) });
  }, isPlaying);
}

async function expectControlMessage(page, predicate) {
  await expect.poll(async () => (await receivedControlMessages(page)).find(predicate)).toBeTruthy();
}

test('Setlist opens without JavaScript module parse errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/setlist/');
  await page.locator('.setlist-page').waitFor();

  expect(errors).toEqual([]);
});

test('Setlist renders durations and sends UUID-based profile actions safely', async ({ page }) => {
  await page.goto('/setlist/');

  await expect(page.locator('.song-time').nth(0)).toHaveText('1:00');
  await expect(page.locator('.song-time').nth(1)).toHaveText('2:00');
  await expect(page.locator('#totalSetlistDuration')).toHaveText('3:00');
  await expect(page.locator('#profileSelect')).toContainText('<Festival>');
  await expect(page.locator('#profileSelect festival')).toHaveCount(0);

  await page.locator('#profileSelect').selectOption('22222222-2222-4222-8222-222222222222');
  await expectControlMessage(
    page,
    (message) => message.type === 'profile_select' &&
      message.id === '22222222-2222-4222-8222-222222222222' &&
      /^profile-select-/.test(message.commandId)
  );

  await page.locator('#btnManageProfiles').click();
  await expect(page.locator('#profileManageModal')).toHaveClass(/open/);
  await expect(
    page.locator('[data-profile-id="11111111-1111-4111-8111-111111111111"] .profile-delete-button')
  ).toHaveCount(0);

  await page.locator('#profileCreateName').fill('Tour Set');
  await page.locator('#btnCreateProfile').click();
  await expectControlMessage(
    page,
    (message) => message.type === 'profile_create' &&
      message.name === 'Tour Set' &&
      /^profile-create-/.test(message.commandId)
  );

  const festivalRow = page.locator('[data-profile-id="22222222-2222-4222-8222-222222222222"]');
  await festivalRow.locator('.profile-rename-input').fill('Festival 2027');
  await festivalRow.locator('.profile-rename-button').click();
  await expectControlMessage(
    page,
    (message) => message.type === 'profile_rename' &&
      message.id === '22222222-2222-4222-8222-222222222222' &&
      message.name === 'Festival 2027' &&
      /^profile-rename-/.test(message.commandId)
  );

  const deleteButton = festivalRow.locator('.profile-delete-button');
  await expect(deleteButton).toBeDisabled();
  await festivalRow.locator('.profile-delete-confirmation').fill('<Festival>');
  await expect(deleteButton).toBeEnabled();
  await deleteButton.click();
  await expectControlMessage(
    page,
    (message) => message.type === 'profile_delete' &&
      message.id === '22222222-2222-4222-8222-222222222222' &&
      message.confirmationName === '<Festival>' &&
      /^profile-delete-/.test(message.commandId)
  );

  await page
    .locator('[data-deleted-profile-id="33333333-3333-4333-8333-333333333333"] .profile-restore-button')
    .click();
  await expectControlMessage(
    page,
    (message) => message.type === 'profile_restore' &&
      message.id === '33333333-3333-4333-8333-333333333333' &&
      /^profile-restore-/.test(message.commandId)
  );
});

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

test('Setlist bar display rejects poll jitter and accepts a real sub-threshold cue jump', async ({ page }) => {
  await page.goto('/setlist/');
  const fixture = await page.evaluate(async () => fetch('/__test__/state').then((response) => response.json()));
  const baseline = {
    ...fixture,
    state: {
      ...fixture.state,
      currentSongTime: 84,
      isPlaying: true,
    },
  };
  await page.evaluate(() => {
    window.__barHistory = [];
    window.__barObserver?.disconnect();
    const target = document.querySelector('#hudBar');
    window.__barObserver = new MutationObserver(() => window.__barHistory.push(target.textContent));
    window.__barObserver.observe(target, { childList: true, characterData: true, subtree: true });
  });
  await emitServerMessage(page, baseline);
  await page.waitForTimeout(40);
  expect(await page.locator('#hudBar').textContent()).toMatch(/^22\.1\./);
  await page.evaluate(() => { window.__barHistory = []; });

  const smallRollback = {
    ...baseline,
    state: { ...baseline.state, currentSongTime: 83.75 },
  };
  await emitServerMessage(page, smallRollback);
  await page.waitForTimeout(120);
  let history = await page.evaluate(() => window.__barHistory);
  expect(history.some((value) => /^21\.4\./.test(value))).toBe(false);

  await page.evaluate(() => { window.__barHistory = []; });
  await emitServerMessage(page, {
    ...smallRollback,
    state: {
      ...smallRollback.state,
      activeSectionIndex: smallRollback.state.activeSectionIndex + 1,
    },
  });
  await page.waitForTimeout(120);
  history = await page.evaluate(() => window.__barHistory);
  expect(history.some((value) => /^21\.4\./.test(value))).toBe(true);
});

test('Setlist bar display freezes its last valid value while disconnected', async ({ page }) => {
  await page.goto('/setlist/?scenario=stale');
  await expect(page.locator('body')).toHaveClass(/connection-stale/);
  const frozenBar = await page.locator('#hudBar').textContent();

  await page.waitForTimeout(350);

  await expect(page.locator('#hudBar')).toHaveText(frozenBar || '');
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
  await emitPlayingState(page, false);
  await page.keyboard.press('Tab');
  const state = await page.evaluate(() => ({
    activeId: document.activeElement?.id,
    outlineWidth: parseFloat(getComputedStyle(document.activeElement).outlineWidth),
    transitionSeconds: parseFloat(getComputedStyle(document.activeElement).transitionDuration),
  }));
  expect(['profileSelect', 'languageSelect']).toContain(state.activeId);
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

test('Setlist language safety follows playback and lock state and retranslates warnings', async ({ page }) => {
  await page.goto('/setlist/');
  const language = page.locator('#languageSelect');
  const lock = page.locator('#btnLock');
  const section = page.locator('.section-btn').first();

  await expect(language).toBeDisabled();
  await emitPlayingState(page, false);
  await expect(language).toBeEnabled();

  await lock.click();
  await expect(language).toBeDisabled();
  await section.click();
  await expect(page.locator('#lockToast')).toContainText('PANEL LOCKED');

  await lock.click();
  await expect(language).toBeEnabled();
  await language.selectOption('pt-BR');
  await lock.click();
  await section.click();
  await expect(page.locator('#lockToast')).toContainText('PAINEL BLOQUEADO');
});

test('Lyrics ownership keeps the active HUD while one selector drives every editor tab', async ({ page }) => {
  await page.goto('/setlist/');
  const activeTitle = 'OPEN CIRCUIT — EXTENDED DEMO TITLE FOR RESPONSIVE TESTING';
  const hudLyric = page.locator('#hudLyric');
  await expect(hudLyric).not.toHaveText('—');
  const originalHudLine = await hudLyric.textContent();

  await page.locator('.tools-menu > summary').click();
  await page.getByRole('button', { name: 'Lyrics' }).click();
  const selector = page.locator('#lyricsSongSelect');
  await expect(selector).toHaveValue(activeTitle);
  await expect(page.locator('#lyricsRawText')).toHaveValue(/Demo line one for synchronized text/);
  const selectorPrecedesTabs = await page.locator('#lyricsSongControl').evaluate((node) =>
    Boolean(node.compareDocumentPosition(document.querySelector('#lyricsTabCreate')) & Node.DOCUMENT_POSITION_FOLLOWING)
  );
  expect(selectorPrecedesTabs).toBe(true);

  await page.locator('#lyricsTabEdit').click();
  await expect(page.locator('.lyric-edit-ts').first()).toHaveText('[00:00.00]');
  await page.locator('#lyricsTabCreate').click();

  await selector.selectOption('WALK-IN');
  await expectControlMessage(page, (message) => message.type === 'get_lyrics' && message.song === 'WALK-IN');
  await page.locator('#lyricsTabSync').click();
  await expect(selector).toHaveValue('WALK-IN');
  await expect(page.locator('#lyricsSyncSongTitle')).toHaveText('WALK-IN');
  await page.locator('#lyricsTabEdit').click();
  await expect(selector).toHaveValue('WALK-IN');
  await expect(page.locator('#lyricsEditSongTitle')).toHaveText('WALK-IN');
  await expect(hudLyric).toHaveText(originalHudLine || '');

  const messages = await receivedControlMessages(page);
  expect(messages.some((message) => message.type === 'save_lyrics')).toBe(false);
});

test('Lyrics keeps an unsaved edit when the modal closes and reopens', async ({ page }) => {
  await page.goto('/setlist/');
  await page.locator('.tools-menu > summary').click();
  await page.getByRole('button', { name: 'Lyrics' }).click();
  await page.locator('#lyricsTabEdit').click();

  await page.locator('.lyric-edit-text').first().dblclick();
  const inlineEditor = page.locator('#lyricsEditList input[type="text"]');
  await inlineEditor.fill('Unsaved rehearsal draft');
  await inlineEditor.press('Enter');
  await expect(page.locator('#btnSaveEditedLyrics')).toBeEnabled();

  await page.locator('.lyrics-modal-header .btn-close').click();
  await page.getByRole('button', { name: 'Lyrics' }).click();
  await page.locator('#lyricsTabEdit').click();

  await expect(page.locator('.lyric-edit-text').first()).toHaveText('Unsaved rehearsal draft');
  await expect(page.locator('#btnSaveEditedLyrics')).toBeEnabled();
  const messages = await receivedControlMessages(page);
  expect(messages.some((message) => message.type === 'save_lyrics')).toBe(false);
});

test('Lyrics keeps a failed save dirty and clears it only after confirmation', async ({ page }) => {
  await page.goto('/setlist/?scenario=lyrics-save-fails');
  await page.locator('.tools-menu > summary').click();
  await page.getByRole('button', { name: 'Lyrics' }).click();
  await page.locator('#lyricsTabEdit').click();
  await page.locator('.lyric-edit-text').first().dblclick();
  const failedEditor = page.locator('#lyricsEditList input[type="text"]');
  await failedEditor.fill('Draft that must survive a disk failure');
  await failedEditor.press('Enter');
  await page.locator('#btnSaveEditedLyrics').click();

  await expectControlMessage(
    page,
    (message) => message.type === 'save_lyrics' && /^lyrics-edit-/.test(message.commandId)
  );
  await expect(page.locator('#btnSaveEditedLyrics')).toBeEnabled();
  await expect(page.locator('#lyricsDirtyBadge')).toBeVisible();
  await expect(page.locator('.lyric-edit-text').first()).toHaveText('Draft that must survive a disk failure');
  await expect(page.locator('#operationToast')).toContainText('not saved');

  await page.goto('/setlist/');
  await page.locator('.tools-menu > summary').click();
  await page.getByRole('button', { name: 'Lyrics' }).click();
  await page.locator('#lyricsTabEdit').click();
  await page.locator('.lyric-edit-text').first().dblclick();
  const confirmedEditor = page.locator('#lyricsEditList input[type="text"]');
  await confirmedEditor.fill('Confirmed draft');
  await confirmedEditor.press('Enter');
  await page.locator('#btnSaveEditedLyrics').click();

  await expect(page.locator('#btnSaveEditedLyrics')).toBeDisabled();
  await expect(page.locator('#lyricsDirtyBadge')).toBeHidden();
});

test('Lyrics refuses to report success while an edited line has no timestamp', async ({ page }) => {
  await page.goto('/setlist/');
  await page.locator('.tools-menu > summary').click();
  await page.getByRole('button', { name: 'Lyrics' }).click();
  await page.locator('#lyricsTabEdit').click();
  await page.getByRole('button', { name: '+ Line', exact: true }).click();

  const inlineEditor = page.locator('#lyricsEditList input[type="text"]');
  await inlineEditor.fill('This line must not disappear');
  await inlineEditor.press('Enter');
  await page.locator('#btnSaveEditedLyrics').click();

  await expect(page.locator('#operationToast')).toContainText('timestamp');
  await expect(page.locator('#lyricsDirtyBadge')).toBeVisible();
  await expect(page.locator('.lyric-edit-text').last()).toHaveText('This line must not disappear');
  const messages = await receivedControlMessages(page);
  expect(messages.some((message) =>
    message.type === 'save_lyrics' && message.text.includes('This line must not disappear')
  )).toBe(false);
});

test('Synchronized lyrics stay open until the matching save is confirmed', async ({ page }) => {
  await page.goto('/setlist/?scenario=lyrics-save-pending');
  await page.locator('.tools-menu > summary').click();
  await page.getByRole('button', { name: 'Lyrics' }).click();
  await page.locator('#lyricsRawText').fill('One synchronized line');
  await page.getByRole('button', { name: 'Start synchronization', exact: false }).click();
  await page.locator('#btnLyricsTap').click();
  await page.locator('#btnSaveSyncLyrics').click();

  await expect.poll(async () => (
    await receivedControlMessages(page)
  ).find((message) => message.type === 'save_lyrics' && /^lyrics-sync-/.test(message.commandId))).toBeTruthy();
  await expect(page.locator('#lyricsModal')).toHaveClass(/open/);
  await expect(page.locator('#btnSaveSyncLyrics')).toBeDisabled();

  const pendingSave = (await receivedControlMessages(page)).find(
    (message) => message.type === 'save_lyrics' && /^lyrics-sync-/.test(message.commandId)
  );
  expect(pendingSave).toBeTruthy();
  await emitServerMessage(page, {
    type: 'command_status',
    commandId: pendingSave.commandId,
    status: 'confirmed',
  });
  await expect(page.locator('#lyricsModal')).not.toHaveClass(/open/);
});

test('Synchronized lyrics confirmation never reopens a manually closed modal', async ({ page }) => {
  await page.goto('/setlist/?scenario=lyrics-save-pending');
  await page.locator('.tools-menu > summary').click();
  await page.getByRole('button', { name: 'Lyrics' }).click();
  await page.locator('#lyricsRawText').fill('One synchronized line');
  await page.getByRole('button', { name: 'Start synchronization', exact: false }).click();
  await page.locator('#btnLyricsTap').click();
  await page.locator('#btnSaveSyncLyrics').click();

  await expect.poll(async () => (
    await receivedControlMessages(page)
  ).find((message) => message.type === 'save_lyrics' && /^lyrics-sync-/.test(message.commandId))).toBeTruthy();

  const pendingSave = (await receivedControlMessages(page)).find(
    (message) => message.type === 'save_lyrics' && /^lyrics-sync-/.test(message.commandId)
  );
  expect(pendingSave).toBeTruthy();
  await page.locator('.lyrics-modal-header .btn-close').click();
  await expect(page.locator('#lyricsModal')).not.toHaveClass(/open/);

  await emitServerMessage(page, {
    type: 'command_status',
    commandId: pendingSave.commandId,
    status: 'confirmed',
  });
  await expect(page.locator('#lyricsModal')).not.toHaveClass(/open/);
});

for (const surface of [
  {
    route: '/performance/?scenario=marketing',
    translatedLabel: 'Música atual',
  },
  {
    route: '/setlist/?scenario=marketing',
    translatedLabel: 'Música ativa',
  },
]) {
  test(`${surface.route} switches to Portuguese without translating show data and persists it`, async ({ page }) => {
    await page.goto(surface.route);
    await expect(page.getByText('SONG 03', { exact: true }).first()).toBeVisible();
    if (surface.route.startsWith('/setlist/')) await emitPlayingState(page, false);

    await page.locator('#languageSelect').selectOption('pt-BR');
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
    await expect(page.getByText(surface.translatedLabel, { exact: true }).first()).toBeVisible();
    await expect(page.getByText('SONG 03', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('CHORUS', { exact: true }).first()).toBeVisible();

    await page.reload();
    if (surface.route.startsWith('/setlist/')) await emitPlayingState(page, false);
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
    await expect(page.getByText(surface.translatedLabel, { exact: true }).first()).toBeVisible();

    await page.locator('#languageSelect').selectOption('en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });
}
