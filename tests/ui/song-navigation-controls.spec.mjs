import { expect, test } from '@playwright/test';

async function fixtureState(page) {
  return page.evaluate(async () => fetch('/__test__/state').then((response) => response.json()));
}

async function jumpMessages(page) {
  const messages = await page.evaluate(async () => (
    fetch('/__test__/messages').then((response) => response.json())
  ));
  return messages.filter((message) => message.type === 'jump');
}

async function emitServerMessage(page, payload) {
  await page.evaluate(async (message) => {
    await fetch('/__test__/emit', { method: 'POST', body: JSON.stringify(message) });
  }, payload);
}

async function pointerHold(page, locator, pointerId, holdMs = 550) {
  await locator.dispatchEvent('pointerdown', {
    button: 0,
    pointerId,
    pointerType: 'touch',
    isPrimary: true,
    clientX: 10,
    clientY: 10,
  });
  await page.waitForTimeout(holdMs);
  await locator.dispatchEvent('pointerup', {
    button: 0,
    pointerId,
    pointerType: 'touch',
    isPrimary: true,
  });
}

async function expectAllDisabled(locator) {
  await expect.poll(() => locator.evaluateAll((buttons) => buttons.every((button) => button.disabled))).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/setlist/');
  await expect(page.locator('#songList .song-item')).toHaveCount(8);
});

test('Stage Control renders six ordered icon-only transport controls with explicit labels', async ({ page }) => {
  const ids = ['btnPreviousSong', 'btnPrevious', 'btnPlay', 'btnStop', 'btnNext', 'btnNextSong'];
  await expect(page.locator('.transport-dock > button')).toHaveCount(6);
  expect(await page.locator('.transport-dock > button').evaluateAll((buttons) => buttons.map((button) => button.id))).toEqual(ids);
  await expect(page.locator('#btnPreviousSong')).toHaveAttribute('aria-label', 'Previous song — press and hold');
  await expect(page.locator('#btnPrevious')).toHaveAttribute('aria-label', 'Previous section — press and hold');
  await expect(page.locator('#btnNext')).toHaveAttribute('aria-label', 'Next section — press and hold');
  await expect(page.locator('#btnNextSong')).toHaveAttribute('aria-label', 'Next song — press and hold');
});

test('a 100 ms section hold stays inert', async ({ page }) => {
  await pointerHold(page, page.locator('#btnNext'), 1, 100);
  expect(await jumpMessages(page)).toEqual([]);
});

test('inner next hold preserves section navigation', async ({ page }) => {
  const fixture = await fixtureState(page);
  await pointerHold(page, page.locator('#btnNext'), 2);
  await expect.poll(() => jumpMessages(page)).toEqual([
    { type: 'jump', songIndex: fixture.state.activeSongIndex, sectionIndex: fixture.state.activeSectionIndex + 1 },
  ]);
});

test('outer song holds jump to adjacent whole-song starts exactly once', async ({ page }) => {
  const fixture = await fixtureState(page);
  await pointerHold(page, page.locator('#btnPreviousSong'), 3);
  await expect.poll(() => jumpMessages(page)).toEqual([
    { type: 'jump', songIndex: fixture.state.activeSongIndex - 1, sectionIndex: null },
  ]);

  await page.goto('/setlist/');
  await expect(page.locator('#songList .song-item')).toHaveCount(8);
  await pointerHold(page, page.locator('#btnNextSong'), 4, 1150);
  await expect.poll(() => jumpMessages(page)).toEqual([
    { type: 'jump', songIndex: fixture.state.activeSongIndex + 1, sectionIndex: null },
  ]);
  await page.waitForTimeout(150);
  expect(await jumpMessages(page)).toHaveLength(1);
});

test('outer song controls disable at first and last song boundaries', async ({ page }) => {
  const fixture = await fixtureState(page);
  await emitServerMessage(page, {
    ...fixture,
    state: { ...fixture.state, activeSongIndex: 0, activeSectionIndex: 0 },
  });
  await expect(page.locator('#btnPreviousSong')).toBeDisabled();
  await expect(page.locator('#btnNextSong')).toBeEnabled();
  await pointerHold(page, page.locator('#btnPreviousSong'), 5);
  expect(await jumpMessages(page)).toEqual([]);

  await emitServerMessage(page, {
    ...fixture,
    state: { ...fixture.state, activeSongIndex: fixture.state.songs.length - 1, activeSectionIndex: 0 },
  });
  await expect(page.locator('#btnNextSong')).toBeDisabled();
  await expect(page.locator('#btnPreviousSong')).toBeEnabled();
  await pointerHold(page, page.locator('#btnNextSong'), 6);
  expect(await jumpMessages(page)).toEqual([]);
});

test('all directional holds disable under Lock Mode and lost controller authority', async ({ page }) => {
  const controls = page.locator('#btnPreviousSong, #btnPrevious, #btnNext, #btnNextSong');
  await expect(controls).toHaveCount(4);
  await page.locator('#btnLock').click();
  await expectAllDisabled(controls);
  await pointerHold(page, page.locator('#btnNextSong'), 7);
  expect(await jumpMessages(page)).toEqual([]);

  await page.locator('#btnLock').click();
  await emitServerMessage(page, { type: 'auth_status', isController: false });
  await expectAllDisabled(controls);
  await pointerHold(page, page.locator('#btnNextSong'), 8);
  expect(await jumpMessages(page)).toEqual([]);

  await page.goto('/setlist/?scenario=read-only');
  await expect(page.locator('#songList .song-item')).toHaveCount(8);
  const readOnlyControls = page.locator('#btnPreviousSong, #btnPrevious, #btnNext, #btnNextSong');
  await expectAllDisabled(readOnlyControls);
  await pointerHold(page, page.locator('#btnNextSong'), 9);
  expect(await jumpMessages(page)).toEqual([]);
});
