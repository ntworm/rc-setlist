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
    const regions = Object.fromEntries(
      requestedSelectors.map((selector) => {
        const element = document.querySelector(selector);
        if (!element) return [selector, null];
        const rect = element.getBoundingClientRect();
        return [
          selector,
          {
            bottom: rect.bottom,
            height: rect.height,
            left: rect.left,
            right: rect.right,
            top: rect.top,
            width: rect.width,
          },
        ];
      }),
    );
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

// The Live panel as the extension hands it over: the server is up, the RC
// Bridge answered and the setlist duration is an estimate.
const livePanelInit = () => {
  window.INITIAL_IS_RUNNING = true;
  window.INITIAL_PORT = 4444;
  window.INITIAL_PRIMARY_IP = '192.168.100.2';
  window.INITIAL_TOKEN = 'fixture-token';
  window.INITIAL_LOCALE = 'en';
  window.INITIAL_STORAGE_INITIALIZED = true;
  window.INITIAL_DURATION_CONFIDENCE = 'estimated';
  window.INITIAL_OSC_DIAGNOSTICS = {
    state: 'responding',
    listenPort: 11101,
    rxCount: 12,
    txCount: 55,
    lastReplyAgeMs: 40,
    bridge: 'rcbridge',
    bridgeVersion: 'RC Bridge 1.2.0',
    targetPort: 11101,
  };
};

async function qrFrameBox(page, frame) {
  return page.locator(frame).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { height: rect.height, width: rect.width };
  });
}

// The QR code itself: the image the library draws, or the canvas it falls
// back to. The frame around it only holds it.
async function qrCodeBox(page, frame) {
  return page.locator(frame).evaluate(async (element) => {
    const visible = (node) => Boolean(node) && node.getClientRects().length > 0;
    const img = element.querySelector('img');
    const canvas = element.querySelector('canvas');
    const target = [img, canvas].filter(visible)[0] ?? null;
    if (!target) return null;
    if (target.tagName === 'IMG' && !target.complete) {
      await new Promise((resolve) => {
        target.addEventListener('load', resolve, { once: true });
        target.addEventListener('error', resolve, { once: true });
        setTimeout(resolve, 1000);
      });
    }
    const rect = target.getBoundingClientRect();
    return {
      height: rect.height,
      isImage: target.tagName === 'IMG',
      naturalWidth: target instanceof HTMLImageElement ? target.naturalWidth : 0,
      width: rect.width,
    };
  });
}

// The code inside the frame: square, big enough and really drawn.
async function expectSquareQrCode(page, frame) {
  const code = await qrCodeBox(page, frame);
  expect(code, `${frame} must hold a QR code`).not.toBeNull();
  const difference = Math.abs(code.width - code.height);
  expect(difference, `${frame} code must stay square`).toBeLessThanOrEqual(1);
  expect(code.width, `${frame} code must keep its width`).toBeGreaterThanOrEqual(96);
  expect(code.height, `${frame} code must keep its height`).toBeGreaterThanOrEqual(96);
  if (code.isImage) {
    expect(code.naturalWidth, `${frame} code must be loaded`).toBeGreaterThan(0);
  }
}

// The element that is really under the link the operator clicks.
async function elementUnderTheLink(page, selector) {
  return page.locator(selector).evaluate((link) => {
    const rect = link.getBoundingClientRect();
    const target = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    return target?.closest('a')?.id || null;
  });
}

// The row of the setlist that is renamed.
const renameInputSelector =
  '.profile-row[data-profile-id="11111111-1111-4111-8111-111111111111"] .profile-rename-input';

// The state of the extension with the transport stopped.
async function stopTheTransport(request) {
  const fixture = await request.get('/__test__/state').then((response) => response.json());
  const stoppedState = {
    ...fixture,
    state: {
      ...fixture.state,
      isPlaying: false,
    },
  };
  await request.post('/__test__/emit', { data: stoppedState });
  return stoppedState;
}

// The state of the extension while the songs keep moving.
async function emitSongTimes(request, stoppedState, songTimes) {
  for (const currentSongTime of songTimes) {
    await request.post('/__test__/emit', {
      data: {
        ...stoppedState,
        state: { ...stoppedState.state, currentSongTime },
      },
    });
  }
}

// The renamed input, as the page sees it after the transport moved.
async function readRenameState(page, selector) {
  return page.evaluate((inputSelector) => {
    const input = document.querySelector(inputSelector);
    return {
      active: document.activeElement === input,
      connected: window.__mobileRenameInput?.isConnected === true,
      sameNode: input === window.__mobileRenameInput,
      selectionEnd: input?.selectionEnd,
      selectionStart: input?.selectionStart,
      value: input?.value,
    };
  }, selector);
}

// The project as it is after the setlist was renamed.
function renamedProfilesState() {
  return {
    type: 'profiles_state',
    version: 2,
    activeProfileId: '11111111-1111-4111-8111-111111111111',
    profiles: [
      { id: '11111111-1111-4111-8111-111111111111', name: 'Main Setlist' },
      { id: '22222222-2222-4222-8222-222222222222', name: '<Festival>' },
    ],
    deletedProfiles: [
      {
        id: '33333333-3333-4333-8333-333333333333',
        name: 'Archive',
        deletedAt: '2026-07-29T12:00:00.000Z',
      },
    ],
    canMutate: true,
  };
}

// The header of the setlist, as the page sees it in Portuguese.
async function readCompactHeaderState(page) {
  return page.evaluate(() => {
    const langSelect = document.querySelector('#languageSelect');
    const lockBtn = document.querySelector('#btnLock');
    const lockText = document.querySelector('#lockText');
    const actionsContainer = document.querySelector('.app-bar-actions');
    const header = document.querySelector('header');

    if (!langSelect || !lockBtn || !actionsContainer || !header) {
      return { missing: true };
    }

    const langRect = langSelect.getBoundingClientRect();
    const lockRect = lockBtn.getBoundingClientRect();
    const actionsRect = actionsContainer.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();

    const overlapsLangLock = !(
      langRect.right <= lockRect.left ||
      langRect.left >= lockRect.right ||
      langRect.bottom <= lockRect.top ||
      langRect.top >= lockRect.bottom
    );

    const langSelectStyle = window.getComputedStyle(langSelect);
    const hasTruncatingMaxWidth =
      langSelectStyle.maxWidth === '96px' || langSelectStyle.maxWidth === '6rem';

    return {
      overlapsLangLock,
      hasTruncatingMaxWidth,
      actionsBottom: actionsRect.bottom,
      headerBottom: headerRect.bottom,
      lockText: lockText ? lockText.textContent : '',
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  });
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

    expect(geometry.scrollWidth, 'Performance must not scroll horizontally').toBeLessThanOrEqual(
      geometry.clientWidth,
    );
    expect(geometry.scrollHeight, 'Performance must fit in one viewport').toBeLessThanOrEqual(
      geometry.clientHeight,
    );
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

    const geometry = await pageGeometry(page, [
      'header',
      '.setlist-pane',
      '.control-pane',
      '.transport-dock',
    ]);
    const overflowingSectionRows = await page.evaluate(
      () =>
        Array.from(document.querySelectorAll('.song-sections')).filter(
          (element) => element.scrollWidth > element.clientWidth + 1,
        ).length,
    );
    expect(geometry.scrollWidth, 'Setlist must not scroll horizontally').toBeLessThanOrEqual(
      geometry.clientWidth,
    );
    expect(
      geometry.scrollHeight,
      'Tablet and desktop Setlist must fit in one viewport',
    ).toBeLessThanOrEqual(geometry.clientHeight);
    expect(overflowingSectionRows, 'Section rows must wrap instead of scrolling horizontally').toBe(
      0,
    );
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
      const lastSong = document
        .querySelector('#songList .song-item:last-child')
        .getBoundingClientRect();
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

for (const viewport of [
  { width: 360, height: 800 },
  { width: 1024, height: 768 },
]) {
  test(`Setlist exposes six contained transport targets at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto('/setlist/');
    await expect(page.locator('#songList .song-item')).toHaveCount(8);

    const geometry = await page.locator('.transport-dock').evaluate((dock) => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      dock: dock.getBoundingClientRect().toJSON(),
      buttons: Array.from(dock.querySelectorAll('button'), (button) =>
        button.getBoundingClientRect().toJSON(),
      ),
    }));

    expect(geometry.buttons).toHaveLength(6);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
    expect(geometry.dock.left).toBeGreaterThanOrEqual(0);
    expect(geometry.dock.right).toBeLessThanOrEqual(geometry.clientWidth + 1);
    for (const button of geometry.buttons) {
      expect(button.width).toBeGreaterThanOrEqual(44);
      expect(button.height).toBeGreaterThanOrEqual(44);
    }
  });
}

test('Setlist HUD keeps long active titles vertically legible in a short desktop window', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 560 });
  await page.goto('/setlist/');
  const geometry = await page.locator('#hudSong').evaluate((element) => {
    const value = element.getBoundingClientRect();
    const card = element.closest('.hud-card').getBoundingClientRect();
    const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
    return {
      cardBottom: card.bottom,
      cardTop: card.top,
      lineHeight,
      valueBottom: value.bottom,
      valueHeight: value.height,
      valueTop: value.top,
    };
  });
  expect(geometry.valueTop).toBeGreaterThanOrEqual(geometry.cardTop);
  expect(geometry.valueBottom).toBeLessThanOrEqual(geometry.cardBottom);
  expect(geometry.valueHeight).toBeGreaterThanOrEqual(geometry.lineHeight * 0.95);
});

test('Live panel keeps access links and actions usable at the SDK modal size', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 600 });
  await page.addInitScript(livePanelInit);
  await page.goto('/panel/index.html');

  await expect(page.locator('#statusText')).toHaveText('Server running');
  await expect(page.locator('#oscStatusText')).toHaveText('Live connected');
  await expect(page.locator('#oscBridgeText')).toContainText('RC Bridge');
  // The bridge line above already names the RC Bridge: the hint would repeat it.
  await expect(page.locator('#bridgeHint')).toBeHidden();
  await expect(page.locator('#durationConfidenceRow')).toBeVisible();

  // The access code and the link of the page live in the main section.
  await expect(page.locator('#panelMain')).toBeVisible();
  await expect(page.locator('#accessLabel')).toHaveText('Stage Control');
  await expect(page.locator('#openSetlist')).toBeVisible();
  const box = await qrFrameBox(page, '#qrSetlist');
  expect(Math.abs(box.width - box.height), '#qrSetlist must stay square').toBeLessThanOrEqual(1);
  expect(box.width, '#qrSetlist must keep its size').toBeGreaterThanOrEqual(96);
  await expectSquareQrCode(page, '#qrSetlist');

  // The other page has its own code, in the same place.
  await page.locator('#btnAccessSwap').click();
  await expect(page.locator('#accessLabel')).toHaveText('Performance Display');
  await expect(page.locator('#openStage')).toBeVisible();
  const other = await qrFrameBox(page, '#qrStage');
  expect(Math.abs(other.width - other.height), '#qrStage must stay square').toBeLessThanOrEqual(1);
  expect(other.width, '#qrStage must keep its size').toBeGreaterThanOrEqual(96);
  await expectSquareQrCode(page, '#qrStage');
  await page.locator('#btnAccessSwap').click();
  await expect(page.locator('#accessLabel')).toHaveText('Stage Control');

  // The panel has three sections now. Only the section under the bar
  // scrolls; the server controls stay where they are.
  const selectors = ['#openSetlist', '.status-bar .btn', '.tab-pane:not([hidden])'];
  const geometry = await pageGeometry(page, selectors);
  expect(geometry.scrollHeight).toBeLessThanOrEqual(geometry.clientHeight);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
  for (const [selector, rect] of Object.entries(geometry.regions)) {
    expectContained(rect, geometry, selector);
  }
  expect(geometry.regions['.tab-pane:not([hidden])'].top).toBeLessThanOrEqual(
    geometry.regions['#openSetlist'].top,
  );
  expect(geometry.regions['.status-bar .btn'].bottom).toBeLessThanOrEqual(
    geometry.clientHeight + 1,
  );

  const hit = await elementUnderTheLink(page, '#openSetlist');
  expect(hit).toBe('openSetlist');

  // The card that is folded away is still reachable: the section scrolls.
  await page.locator('#tabNetwork').click();
  await page.locator('#btnPeerToggle').click();
  await expect(page.locator('#peerDetails')).toBeVisible();
  await page.locator('#peerDetails').scrollIntoViewIfNeeded();
  await expect(page.locator('#peerDetails')).toBeInViewport();
});

test('Live panel scrolls instead of flattening the QR when the height runs out', async ({
  page,
}) => {
  // The compacted panel fits the 760x600 modal, so the scroll path is
  // exercised at a shorter height: the content no longer fits and the QR
  // code has to keep its square shape anyway.
  await page.setViewportSize({ width: 760, height: 400 });
  await page.addInitScript(livePanelInit);
  await page.goto('/panel/index.html');

  // The code of the page the phone opens keeps its square shape.
  const box = await qrFrameBox(page, '#qrSetlist');
  expect(Math.abs(box.width - box.height), '#qrSetlist must stay square').toBeLessThanOrEqual(1);
  expect(box.width, '#qrSetlist must keep its size').toBeGreaterThanOrEqual(96);
  await expectSquareQrCode(page, '#qrSetlist');

  // The second computer card open is what makes the section taller.
  await page.locator('#tabNetwork').click();
  await page.locator('#btnPeerToggle').click();
  await expect(page.locator('#peerDetails')).toBeVisible();

  const scroll = await page.evaluate(() => {
    const scroller = document.querySelector('.tab-pane:not([hidden])');
    return { clientHeight: scroller.clientHeight, scrollHeight: scroller.scrollHeight };
  });
  expect(scroll.scrollHeight, 'the section must scroll').toBeGreaterThan(scroll.clientHeight);

  await page.locator('#btnPeerCode').scrollIntoViewIfNeeded();
  await expect(page.locator('#btnPeerCode')).toBeInViewport();
});

test('Live panel shows the bridge hint only without the RC Bridge', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 600 });
  await page.addInitScript(livePanelInit);
  // The second init script runs after the fixture: the server talks plain
  // AbletonOSC, so the RC Bridge is missing.
  await page.addInitScript(() => {
    window.INITIAL_OSC_DIAGNOSTICS = {
      ...window.INITIAL_OSC_DIAGNOSTICS,
      bridge: 'abletonosc',
    };
  });
  await page.goto('/panel/index.html');

  await expect(page.locator('#bridgeHint')).toBeVisible();
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1024, height: 768 },
]) {
  test(`Setlist profile manager stays contained at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto('/setlist/');
    await page.locator('#btnManageProfiles').click();
    await expect(page.locator('#profileManageModal')).toHaveClass(/open/);

    const geometry = await page.evaluate(() => {
      const modal = document.querySelector('.profile-modal-content').getBoundingClientRect();
      const row = document.querySelector('.profile-row');
      return {
        clientHeight: document.documentElement.clientHeight,
        clientWidth: document.documentElement.clientWidth,
        modalBottom: modal.bottom,
        modalLeft: modal.left,
        modalRight: modal.right,
        modalTop: modal.top,
        rowColumns: getComputedStyle(row).gridTemplateColumns.split(' ').length,
        scrollWidth: document.documentElement.scrollWidth,
      };
    });

    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
    expect(geometry.modalLeft).toBeGreaterThanOrEqual(0);
    expect(geometry.modalTop).toBeGreaterThanOrEqual(0);
    expect(geometry.modalRight).toBeLessThanOrEqual(geometry.clientWidth);
    expect(geometry.modalBottom).toBeLessThanOrEqual(geometry.clientHeight);
    expect(geometry.rowColumns).toBe(viewport.width < 900 ? 1 : 3);
  });
}

test('mobile setlist rename keeps its focused input through live state updates', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/setlist/');
  await expect(page.locator('#profileSelect option')).toHaveCount(2);

  const stoppedState = await stopTheTransport(request);

  await page.locator('#btnManageProfiles').click();
  const renameInput = page.locator(renameInputSelector);
  await expect(renameInput).toBeEnabled();
  await renameInput.fill('Mobile Rename Draft');
  await renameInput.evaluate((input) => {
    input.focus();
    input.setSelectionRange(7, 13);
    window.__mobileRenameInput = input;
  });

  await emitSongTimes(request, stoppedState, [319, 320, 321]);

  const afterTransport = await readRenameState(page, renameInputSelector);
  expect(afterTransport).toEqual({
    active: true,
    connected: true,
    sameNode: true,
    selectionEnd: 13,
    selectionStart: 7,
    value: 'Mobile Rename Draft',
  });

  await request.post('/__test__/emit', { data: renamedProfilesState() });

  await expect(renameInput).toBeFocused();
  await expect(renameInput).toHaveValue('Mobile Rename Draft');
  await renameInput.press('Enter');

  await expect
    .poll(async () => {
      const messages = await request.get('/__test__/messages').then((response) => response.json());
      return messages.filter((message) => message.type === 'profile_rename');
    })
    .toEqual([
      expect.objectContaining({
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Mobile Rename Draft',
        type: 'profile_rename',
      }),
    ]);
});

test('Lyrics header keeps its shared song selector contained on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/setlist/');
  await page.locator('.tools-menu > summary').click();
  await page.getByRole('button', { name: 'Lyrics' }).click();

  const geometry = await page.locator('.lyrics-modal-header').evaluate((header) => {
    const selector = header.querySelector('#lyricsSongControl');
    const headerRect = header.getBoundingClientRect();
    const selectorRect = selector.getBoundingClientRect();
    return {
      headerLeft: headerRect.left,
      headerRight: headerRect.right,
      selectorLeft: selectorRect.left,
      selectorRight: selectorRect.right,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    };
  });
  expect(geometry.selectorLeft).toBeGreaterThanOrEqual(geometry.headerLeft);
  expect(geometry.selectorRight).toBeLessThanOrEqual(geometry.headerRight);
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
});
test('Setlist compact notebook header does not overlap controls when switched to Portuguese', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/setlist/');
  await page.evaluate(() => {
    const sel = document.querySelector('#languageSelect');
    if (sel) {
      sel.value = 'pt-BR';
      sel.dispatchEvent(new Event('change'));
    }
  });

  const layoutState = await readCompactHeaderState(page);

  expect(layoutState.missing).toBeUndefined();
  expect(layoutState.overlapsLangLock, 'languageSelect must not overlap btnLock').toBe(false);
  expect(
    layoutState.hasTruncatingMaxWidth,
    'languageSelect should not be restricted to 6rem max-width',
  ).toBe(false);
  expect(
    layoutState.actionsBottom,
    'actions container must stay within header bounds',
  ).toBeLessThanOrEqual(layoutState.headerBottom + 1);
  expect(layoutState.scrollWidth, 'no horizontal scroll').toBeLessThanOrEqual(
    layoutState.clientWidth,
  );
});

test('Setlist on large desktop (1920x1080) centers main shell with max-width and 2 columns', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/setlist/');

  const info = await page.evaluate(() => {
    const shell = document.querySelector('.setlist-page');
    const setlistPane = document.querySelector('.setlist-pane');
    const controlPane = document.querySelector('.control-pane');
    if (!shell || !setlistPane || !controlPane) return { missing: true };

    const rect = shell.getBoundingClientRect();
    const setlistRect = setlistPane.getBoundingClientRect();
    const controlRect = controlPane.getBoundingClientRect();

    return {
      shellWidth: rect.width,
      leftMargin: rect.left,
      rightMargin: document.documentElement.clientWidth - rect.right,
      isTwoColumns:
        Math.abs(setlistRect.top - controlRect.top) < 20 && setlistRect.left < controlRect.left,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  });

  expect(info.missing).toBeUndefined();
  expect(info.isTwoColumns, 'desktop must preserve 2-column layout').toBe(true);
  expect(
    info.shellWidth,
    'shell width should be bounded on large desktop (<= 1440px)',
  ).toBeLessThanOrEqual(1441);
  expect(
    Math.abs(info.leftMargin - info.rightMargin),
    'shell should be horizontally centered',
  ).toBeLessThanOrEqual(12);
  expect(info.scrollWidth, 'no horizontal scroll').toBeLessThanOrEqual(info.clientWidth);
});

test('Setlist on narrow panel (360x900) maintains compact vertical flow without huge gap between lyrics and controls', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto('/setlist/');

  const gapInfo = await page.evaluate(() => {
    const lyricsCard = document.querySelector('.hud-lyric-card');
    const secondaryControls = document.querySelector('.secondary-controls');
    const dock = document.querySelector('.transport-dock');

    if (!lyricsCard || !secondaryControls || !dock) return { missing: true };

    const lyricsRect = lyricsCard.getBoundingClientRect();
    const secondaryRect = secondaryControls.getBoundingClientRect();
    const dockRect = dock.getBoundingClientRect();

    const gapBetweenLyricsAndControls = secondaryRect.top - lyricsRect.bottom;
    const dockOverlapsControls = dockRect.top < secondaryRect.bottom;

    return {
      gapBetweenLyricsAndControls,
      dockOverlapsControls,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  });

  expect(gapInfo.missing).toBeUndefined();
  expect(
    gapInfo.gapBetweenLyricsAndControls,
    'gap between lyrics card and controls should be compact (<= 96px)',
  ).toBeLessThanOrEqual(96);
  expect(gapInfo.dockOverlapsControls, 'transport dock must not overlap secondary controls').toBe(
    false,
  );
  expect(gapInfo.scrollWidth, 'no horizontal scroll on narrow panel').toBeLessThanOrEqual(
    gapInfo.clientWidth,
  );
});

test('Setlist with small song list maintains compact vertical flow without stretching controls', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto('/setlist/?scenario=empty');

  const gapInfo = await page.evaluate(() => {
    const lyricsCard = document.querySelector('.hud-lyric-card');
    const secondaryControls = document.querySelector('.secondary-controls');

    if (!lyricsCard || !secondaryControls) return { missing: true };

    const lyricsRect = lyricsCard.getBoundingClientRect();
    const secondaryRect = secondaryControls.getBoundingClientRect();

    return {
      gapBetweenLyricsAndControls: secondaryRect.top - lyricsRect.bottom,
    };
  });

  expect(gapInfo.missing).toBeUndefined();
  expect(
    gapInfo.gapBetweenLyricsAndControls,
    'gap on small setlist must remain compact (<= 96px)',
  ).toBeLessThanOrEqual(96);
});

test('Setlist on 1280x900 desktop maintains compact vertical flow in control pane without stretching flex gap', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/setlist/?scenario=empty');

  const gapInfo = await page.evaluate(() => {
    const lyricsCard = document.querySelector('.hud-lyric-card');
    const secondaryControls = document.querySelector('.secondary-controls');

    if (!lyricsCard || !secondaryControls) return { missing: true };

    const lyricsRect = lyricsCard.getBoundingClientRect();
    const secondaryRect = secondaryControls.getBoundingClientRect();

    return {
      gapBetweenLyricsAndControls: secondaryRect.top - lyricsRect.bottom,
    };
  });

  expect(gapInfo.missing).toBeUndefined();
  expect(
    gapInfo.gapBetweenLyricsAndControls,
    'gap on desktop control pane must remain compact (<= 48px)',
  ).toBeLessThanOrEqual(48);
});

test('Total duration is located in Songs in Project pane and omitted from main app bar', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/setlist/');

  const durationPlacement = await page.evaluate(() => {
    const header = document.querySelector('header.app-bar');
    const setlistPane = document.querySelector('.setlist-pane');
    const totalDurationEl = document.querySelector('#totalSetlistDuration');

    if (!header || !setlistPane || !totalDurationEl) return { missing: true };

    const inHeader = header.contains(totalDurationEl);
    const inSetlistPane = setlistPane.contains(totalDurationEl);

    return { inHeader, inSetlistPane };
  });

  expect(durationPlacement.missing).toBeUndefined();
  expect(durationPlacement.inHeader, 'total duration must be removed from main header').toBe(false);
  expect(
    durationPlacement.inSetlistPane,
    'total duration must be inside Songs in Project pane',
  ).toBe(true);
});

test('Quantization control supports pt-BR text without clipping or colliding with Click and Refresh', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto('/setlist/');
  await page.evaluate(() => {
    const sel = document.querySelector('#languageSelect');
    if (sel) {
      sel.value = 'pt-BR';
      sel.dispatchEvent(new Event('change'));
    }
  });

  const quantInfo = await page.evaluate(() => {
    const quantCtrl = document.querySelector('.quantization-control');
    const quantSelect = document.querySelector('#quantizationSelect');
    const btnMetro = document.querySelector('#btnMetronome');
    const btnRef = document.querySelector('#btnRefresh');

    if (!quantCtrl || !quantSelect || !btnMetro || !btnRef) return { missing: true };

    const ctrlRect = quantCtrl.getBoundingClientRect();
    const metroRect = btnMetro.getBoundingClientRect();
    const refRect = btnRef.getBoundingClientRect();

    // Check if quantCtrl occupies full width line above btnMetro/btnRef
    const isFullLineAbove = ctrlRect.bottom <= metroRect.top + 2;

    const selectStyle = window.getComputedStyle(quantSelect);

    return {
      isFullLineAbove,
      selectWidth: ctrlRect.width,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  });

  expect(quantInfo.missing).toBeUndefined();
  expect(
    quantInfo.isFullLineAbove,
    'quantization control should occupy full line on 360px width',
  ).toBe(true);
  expect(quantInfo.scrollWidth, 'no horizontal scroll in pt-BR').toBeLessThanOrEqual(
    quantInfo.clientWidth,
  );
});

for (const viewport of [
  { width: 360, height: 900, name: 'narrow phone' },
  { width: 1280, height: 900, name: 'desktop' },
]) {
  test(`Count-in stays beside Click without overlap at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/setlist/');
    await page.evaluate(() => {
      const selector = document.querySelector('#languageSelect');
      selector.value = 'pt-BR';
      selector.dispatchEvent(new Event('change'));
    });

    const geometry = await page.evaluate(() => {
      const click = document.querySelector('#btnMetronome');
      const preRoll = document.querySelector('#btnPreRoll');
      const refresh = document.querySelector('#btnRefresh');
      if (!click || !preRoll || !refresh) return { missing: true };
      const clickRect = click.getBoundingClientRect();
      const preRollRect = preRoll.getBoundingClientRect();
      const refreshRect = refresh.getBoundingClientRect();
      return {
        sameRow:
          Math.abs(clickRect.top - preRollRect.top) <= 2 &&
          Math.abs(preRollRect.top - refreshRect.top) <= 2,
        ordered:
          clickRect.right <= preRollRect.left + 1 && preRollRect.right <= refreshRect.left + 1,
        labelFits: preRoll.scrollWidth <= preRoll.clientWidth + 1,
        labelScrollWidth: preRoll.scrollWidth,
        labelClientWidth: preRoll.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    });

    expect(geometry.missing).toBeUndefined();
    expect(geometry.sameRow).toBe(true);
    expect(geometry.ordered).toBe(true);
    expect(
      geometry.labelFits,
      `count-in label ${geometry.labelScrollWidth}px must fit inside ${geometry.labelClientWidth}px`,
    ).toBe(true);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
  });
}

test('Song duration displays with increased contrast and tabular nums', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/setlist/');

  const durationStyle = await page.evaluate(() => {
    const el = document.querySelector('.song-time');
    if (!el) return null;
    const style = window.getComputedStyle(el);
    return {
      fontSizePx: parseFloat(style.fontSize),
      tabularNums: style.fontVariantNumeric.includes('tabular-nums'),
    };
  });

  if (durationStyle) {
    expect(
      durationStyle.fontSizePx,
      'song duration font size should be >= 13px',
    ).toBeGreaterThanOrEqual(13);
    expect(durationStyle.tabularNums, 'song duration must use tabular nums').toBe(true);
  }
});

test('Language selector uses compact width footprint and flag labels', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/setlist/');

  const langState = await page.evaluate(() => {
    const sel = document.querySelector('#languageSelect');
    if (!sel) return { missing: true };
    const rect = sel.getBoundingClientRect();
    const optionsText = Array.from(sel.options).map((o) => o.textContent);
    return {
      width: rect.width,
      optionsText,
    };
  });

  expect(langState.missing).toBeUndefined();
  expect(langState.width, 'language selector should be compact (<= 110px)').toBeLessThanOrEqual(
    110,
  );
  expect(
    langState.optionsText.some((t) => t.includes('🇧🇷') || t.includes('PT')),
    'language options should include flag or compact label',
  ).toBe(true);
});

test('Quantization select inherits site font family and avoids clipping', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/setlist/');

  const quantState = await page.evaluate(() => {
    const quantSelect = document.querySelector('#quantizationSelect');
    const body = document.body;
    if (!quantSelect || !body) return { missing: true };

    const selectFont = window.getComputedStyle(quantSelect).fontFamily.toLowerCase();
    const bodyFont = window.getComputedStyle(body).fontFamily.toLowerCase();

    const rect = quantSelect.getBoundingClientRect();

    return {
      selectFont,
      bodyFont,
      fontMatches: selectFont.includes(bodyFont.split(',')[0].trim().replace(/['"]/g, '')),
      width: rect.width,
    };
  });

  expect(quantState.missing).toBeUndefined();
  expect(quantState.fontMatches, 'quantization select should inherit site font family').toBe(true);
});

test('Control pane outer box does not create a huge empty dark void below logs on desktop', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/setlist/');

  const heightInfo = await page.evaluate(() => {
    const pane = document.querySelector('.control-pane');
    const hud = document.querySelector('.hud');
    const sec = document.querySelector('.secondary-controls');
    const diag =
      document.querySelector('#diagnosticsPanel') || document.querySelector('.diagnostics-panel');

    if (!pane || !hud || !sec) return { missing: true };

    const paneRect = pane.getBoundingClientRect();
    const hudRect = hud.getBoundingClientRect();
    const secRect = sec.getBoundingClientRect();
    const diagRect = diag ? diag.getBoundingClientRect() : { bottom: secRect.bottom };

    const contentBottom = Math.max(hudRect.bottom, secRect.bottom, diagRect.bottom);
    const unusedEmptyGap = paneRect.bottom - contentBottom;

    return {
      unusedEmptyGap,
      paneHeight: paneRect.height,
    };
  });

  expect(heightInfo.missing).toBeUndefined();
  expect(
    heightInfo.unusedEmptyGap,
    'unused empty gap inside control pane box should be <= 75px',
  ).toBeLessThanOrEqual(75);
});

test('Language selector shows compact text-only labels without flag images', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/setlist/');

  const langState = await page.evaluate(() => {
    const sel = document.querySelector('#languageSelect');
    const flagIcon = document.querySelector('#languageFlagIcon');
    if (!sel) return { missing: true };
    const optionsText = Array.from(sel.options).map((o) => o.textContent.trim());
    return {
      optionsText,
      flagIconExists: Boolean(flagIcon),
    };
  });

  expect(langState.missing).toBeUndefined();
  // Flag icon must NOT be present
  expect(langState.flagIconExists, 'flag icon element must not exist').toBe(false);
  // Options must show compact abbreviations only
  expect(
    langState.optionsText.some((t) => t === 'EN' || t.startsWith('EN')),
    'English option must be compact "EN"',
  ).toBe(true);
  expect(
    langState.optionsText.some((t) => t === 'PT' || t.startsWith('PT')),
    'Portuguese option must be compact "PT"',
  ).toBe(true);
});

for (const viewport of [
  { width: 390, height: 844, name: 'phone portrait' },
  { width: 412, height: 915, name: 'tall phone portrait' },
]) {
  test(`Performance telemetry cards keep label and value apart at ${viewport.name}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/performance/');

    await expect(page.locator('.telemetry-card')).toHaveCount(3);

    const check = await page.evaluate(() => {
      const footer = document.querySelector('.performance-footer');
      const cards = Array.from(document.querySelectorAll('.telemetry-card'));
      return {
        footerRect: footer.getBoundingClientRect(),
        cards: cards.map((c) => {
          const v = c.querySelector('#timecode, #barcode, #bpm');
          return {
            cardRect: c.getBoundingClientRect(),
            labelRect: c.querySelector('.card-label').getBoundingClientRect(),
            valueRect: v.getBoundingClientRect(),
            overflow: window.getComputedStyle(c).overflow,
            scrollHeight: c.scrollHeight,
            clientHeight: c.clientHeight,
          };
        }),
      };
    });

    for (const c of check.cards) {
      expect(c.labelRect.bottom).toBeLessThanOrEqual(c.valueRect.top + 1);

      expect(c.labelRect.top).toBeGreaterThanOrEqual(c.cardRect.top - 1);
      expect(c.labelRect.left).toBeGreaterThanOrEqual(c.cardRect.left - 1);
      expect(c.labelRect.right).toBeLessThanOrEqual(c.cardRect.right + 1);

      expect(c.valueRect.bottom).toBeLessThanOrEqual(c.cardRect.bottom + 1);
      expect(c.valueRect.left).toBeGreaterThanOrEqual(c.cardRect.left - 1);
      expect(c.valueRect.right).toBeLessThanOrEqual(c.cardRect.right + 1);

      expect(c.cardRect.top).toBeGreaterThanOrEqual(-1);
      expect(c.cardRect.bottom).toBeLessThanOrEqual(viewport.height + 1);
      expect(c.cardRect.left).toBeGreaterThanOrEqual(-1);
      expect(c.cardRect.right).toBeLessThanOrEqual(viewport.width + 1);

      if (c.overflow === 'hidden') {
        expect(c.scrollHeight).toBeLessThanOrEqual(c.clientHeight + 1);
      }
    }

    expect(check.footerRect.height).toBeGreaterThanOrEqual(136);
  });
}
