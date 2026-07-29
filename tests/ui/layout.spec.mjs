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

test('Live panel keeps access links and actions usable at the SDK modal size', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 600 });
  await page.addInitScript(() => {
    window.INITIAL_IS_RUNNING = true;
    window.INITIAL_PORT = 4444;
    window.INITIAL_PRIMARY_IP = '192.168.100.2';
    window.INITIAL_TOKEN = 'fixture-token';
    window.INITIAL_LOCALE = 'en';
    window.INITIAL_OSC_DIAGNOSTICS = {
      state: 'port-conflict',
      listenPort: 11101,
      rxCount: 0,
      txCount: 55,
      lastReplyAgeMs: null,
    };
  });
  await page.goto('/panel/index.html');

  await expect(page.locator('#statusText')).toHaveText('Server running');
  await expect(page.locator('#oscStatusText')).toHaveText('Live active · OSC return port busy');

  const selectors = ['#openSetlist', '#openStage', '.footer', '.auto-start-row'];
  const geometry = await pageGeometry(page, selectors);
  expect(geometry.scrollHeight).toBeLessThanOrEqual(geometry.clientHeight);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
  for (const [selector, rect] of Object.entries(geometry.regions)) {
    expectContained(rect, geometry, selector);
  }
  expect(geometry.regions['#openSetlist'].bottom).toBeLessThanOrEqual(geometry.regions['.footer'].top);
  expect(geometry.regions['#openStage'].bottom).toBeLessThanOrEqual(geometry.regions['.footer'].top);
  expect(geometry.regions['.footer'].bottom).toBeLessThanOrEqual(geometry.regions['.auto-start-row'].top);

  for (const selector of ['#openSetlist', '#openStage']) {
    const hit = await page.locator(selector).evaluate((link) => {
      const rect = link.getBoundingClientRect();
      const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return target?.closest('a')?.id || null;
    });
    expect(hit).toBe(selector.slice(1));
  }
});

for (const viewport of [{ width: 390, height: 844 }, { width: 1024, height: 768 }]) {
  test(`Setlist profile manager stays contained at ${viewport.width}x${viewport.height}`, async ({ page }) => {
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

test('mobile setlist rename keeps its focused input through live state updates', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/setlist/');
  await expect(page.locator('#profileSelect option')).toHaveCount(2);

  const fixture = await request.get('/__test__/state').then((response) => response.json());
  const stoppedState = {
    ...fixture,
    state: {
      ...fixture.state,
      isPlaying: false,
    },
  };
  await request.post('/__test__/emit', { data: stoppedState });

  await page.locator('#btnManageProfiles').click();
  const renameInput = page.locator('.profile-row[data-profile-id="11111111-1111-4111-8111-111111111111"] .profile-rename-input');
  await expect(renameInput).toBeEnabled();
  await renameInput.fill('Mobile Rename Draft');
  await renameInput.evaluate((input) => {
    input.focus();
    input.setSelectionRange(7, 13);
    window.__mobileRenameInput = input;
  });

  for (const currentSongTime of [319, 320, 321]) {
    await request.post('/__test__/emit', {
      data: {
        ...stoppedState,
        state: { ...stoppedState.state, currentSongTime },
      },
    });
  }

  const afterTransport = await page.evaluate(() => {
    const input = document.querySelector(
      '.profile-row[data-profile-id="11111111-1111-4111-8111-111111111111"] .profile-rename-input',
    );
    return {
      active: document.activeElement === input,
      connected: window.__mobileRenameInput?.isConnected === true,
      sameNode: input === window.__mobileRenameInput,
      selectionEnd: input?.selectionEnd,
      selectionStart: input?.selectionStart,
      value: input?.value,
    };
  });
  expect(afterTransport).toEqual({
    active: true,
    connected: true,
    sameNode: true,
    selectionEnd: 13,
    selectionStart: 7,
    value: 'Mobile Rename Draft',
  });

  await request.post('/__test__/emit', {
    data: {
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
    },
  });

  await expect(renameInput).toBeFocused();
  await expect(renameInput).toHaveValue('Mobile Rename Draft');
  await renameInput.press('Enter');

  await expect.poll(async () => {
    const messages = await request.get('/__test__/messages').then((response) => response.json());
    return messages.filter((message) => message.type === 'profile_rename');
  }).toEqual([
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
