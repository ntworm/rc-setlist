import { expect, test } from '@playwright/test';

async function jumpMessages(page) {
  const messages = await page.evaluate(async () => (
    fetch('/__test__/messages').then((response) => response.json())
  ));
  return messages.filter((message) => message.type === 'jump');
}

async function reorderMessages(page) {
  const messages = await page.evaluate(async () => (
    fetch('/__test__/messages').then((response) => response.json())
  ));
  return messages.filter((message) => message.type === 'reorder');
}

async function emitServerMessage(page, payload) {
  await page.evaluate(async (message) => {
    await fetch('/__test__/emit', { method: 'POST', body: JSON.stringify(message) });
  }, payload);
}

async function touchHold(page, locator, pointerId, holdMs = 550) {
  await locator.dispatchEvent('pointerdown', {
    pointerType: 'touch',
    pointerId,
    isPrimary: true,
    button: 0,
    clientX: 10,
    clientY: 10,
  });
  await page.waitForTimeout(holdMs);
  await locator.dispatchEvent('pointerup', {
    pointerType: 'touch',
    pointerId,
    isPrimary: true,
  });
  await locator.dispatchEvent('click', { detail: 1 });
}

async function nativeTouch(session, type, x, y) {
  await session.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: type === 'touchEnd' ? [] : [{ x, y, radiusX: 1, radiusY: 1, force: 1, id: 0 }],
  });
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/setlist/');
  await expect(page.locator('.song-item')).toHaveCount(8);
});

test('mobile song and section targets require hold and fire once while playing', async ({ page }) => {
  const section = page.locator('.section-btn[data-song="1"][data-section="1"]');
  await section.dispatchEvent('pointerdown', {
    pointerType: 'touch',
    pointerId: 11,
    isPrimary: true,
    button: 0,
    clientX: 10,
    clientY: 10,
  });
  await page.waitForTimeout(100);
  await section.dispatchEvent('pointerup', {
    pointerType: 'touch',
    pointerId: 11,
    isPrimary: true,
  });
  await section.dispatchEvent('click', { detail: 1 });
  expect(await jumpMessages(page)).toEqual([]);

  await touchHold(page, section, 12);
  await expect.poll(() => jumpMessages(page)).toEqual([
    { type: 'jump', songIndex: 1, sectionIndex: 1 },
  ]);
});

test('mobile hold works while stopped, active targets stay inert, and drag cancels', async ({ page }) => {
  const fixture = await page.evaluate(async () => (
    fetch('/__test__/state').then((response) => response.json())
  ));
  await emitServerMessage(page, { ...fixture, state: { ...fixture.state, isPlaying: false } });

  await touchHold(page, page.locator('.song-header[data-song="2"]'), 21);
  expect(await jumpMessages(page)).toEqual([]);

  const target = page.locator('.section-btn[data-song="0"][data-section="0"]');
  await target.dispatchEvent('pointerdown', {
    pointerType: 'touch',
    pointerId: 22,
    isPrimary: true,
    button: 0,
    clientX: 10,
    clientY: 10,
  });
  await target.dispatchEvent('pointermove', {
    pointerType: 'touch',
    pointerId: 22,
    isPrimary: true,
    clientX: 10,
    clientY: 24,
  });
  await page.waitForTimeout(550);
  await target.dispatchEvent('pointerup', {
    pointerType: 'touch',
    pointerId: 22,
    isPrimary: true,
  });
  await target.dispatchEvent('click', { detail: 1 });
  expect(await jumpMessages(page)).toEqual([]);
});

test('armed mobile song movement previews one insertion slot and commits the adjusted order', async ({ page }) => {
  const source = page.locator('.song-header[data-song="0"] .song-reorder-handle');
  const target = page.locator('.song-item[data-song="2"]');
  const titles = await page.locator('.song-title').allTextContents();
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();

  await source.dispatchEvent('pointerdown', {
    pointerType: 'touch', pointerId: 41, isPrimary: true, button: 0, clientX: sourceBox.x + 10, clientY: sourceBox.y + 10,
  });
  await page.waitForTimeout(550);
  await source.dispatchEvent('pointermove', {
    pointerType: 'touch', pointerId: 41, isPrimary: true, clientX: targetBox.x + 10, clientY: targetBox.y + targetBox.height - 4,
  });

  await expect(page.locator('.song-item[data-song="0"]')).toHaveClass(/is-reordering/);
  await expect(page.locator('.song-item.drop-before, .song-item.drop-after')).toHaveCount(1);
  await expect(page.locator('.song-item[data-song="3"]')).toHaveClass(/drop-before/);

  await source.dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 41, isPrimary: true });
  await source.dispatchEvent('click', { detail: 1 });
  await expect.poll(() => reorderMessages(page)).toEqual([{
    type: 'reorder',
    songTitles: [titles[1], titles[2], titles[0], ...titles.slice(3)],
  }]);
  expect(await jumpMessages(page)).toEqual([]);
  await expect(page.locator('.song-item.is-reordering, .song-item.drop-before, .song-item.drop-after')).toHaveCount(0);
});

test('native Chrome touch hold then vertical drag previews and commits a song reorder', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'CDP native touch input is Chromium-specific');
  await page.setViewportSize({ width: 390, height: 1_600 });
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const source = page.locator('.song-header[data-song="0"] .song-reorder-handle');
  const target = page.locator('.song-item[data-song="2"]');
  const titles = await page.locator('.song-title').allTextContents();
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  const x = sourceBox.x + sourceBox.width / 2;
  const startY = sourceBox.y + sourceBox.height / 2;
  const destinationY = targetBox.y + targetBox.height - 4;

  await nativeTouch(session, 'touchStart', x, startY);
  await page.waitForTimeout(550);
  await nativeTouch(session, 'touchMove', x, startY + 24);
  await nativeTouch(session, 'touchMove', x, destinationY);
  await expect(page.locator('.song-item[data-song="0"]')).toHaveClass(/is-reordering/);
  await expect(page.locator('.song-item.drop-before, .song-item.drop-after')).toHaveCount(1);
  await nativeTouch(session, 'touchEnd', x, destinationY);

  await expect.poll(() => reorderMessages(page)).toEqual([{
    type: 'reorder',
    songTitles: [titles[1], titles[2], titles[0], ...titles.slice(3)],
  }]);
});

test('direct-touch drag suppression restores draggable cards for cancellation, blur, and render reset', async ({ page }) => {
  const source = page.locator('.song-header[data-song="0"]');
  const item = page.locator('.song-item[data-song="0"]');
  const begin = async (pointerId) => {
    await source.dispatchEvent('pointerdown', {
      pointerType: 'touch', pointerId, isPrimary: true, button: 0, clientX: 12, clientY: 12,
    });
    await expect(item).toHaveAttribute('draggable', 'false');
  };

  await begin(61);
  await source.dispatchEvent('pointerleave', { pointerType: 'touch', pointerId: 61, isPrimary: true });
  await expect(item).toHaveAttribute('draggable', 'true');

  await begin(62);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(item).toHaveAttribute('draggable', 'true');

  await begin(63);
  const fixture = await page.evaluate(async () => fetch('/__test__/state').then((response) => response.json()));
  await emitServerMessage(page, { ...fixture, state: { ...fixture.state, setlistVersion: 63 } });
  await expect(item).toHaveAttribute('draggable', 'true');
});

test('native Chrome render during a direct touch preserves compatibility-click suppression', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'CDP native touch input is Chromium-specific');
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const target = page.locator('.section-btn[data-song="1"][data-section="1"]');
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const fixture = await page.evaluate(async () => fetch('/__test__/state').then((response) => response.json()));

  for (const [setlistVersion, holdMs] of [[71, 100], [72, 550]]) {
    await nativeTouch(session, 'touchStart', x, y);
    await page.waitForTimeout(holdMs);
    await emitServerMessage(page, { ...fixture, state: { ...fixture.state, setlistVersion } });
    await nativeTouch(session, 'touchEnd', x, y);
    await page.waitForTimeout(150);
  }

  expect(await jumpMessages(page)).toEqual([]);
  expect(await reorderMessages(page)).toEqual([]);
  await page.waitForTimeout(850);
  await target.click();
  await expect.poll(() => jumpMessages(page)).toEqual([
    { type: 'jump', songIndex: 1, sectionIndex: 1 },
  ]);
});

test('armed mobile section movement cancels without a jump or reorder', async ({ page }) => {
  const section = page.locator('.section-btn[data-song="1"][data-section="0"]');
  const box = await section.boundingBox();
  expect(box).not.toBeNull();
  await section.dispatchEvent('pointerdown', {
    pointerType: 'pen', pointerId: 42, isPrimary: true, button: 0, clientX: box.x + 10, clientY: box.y + 10,
  });
  await page.waitForTimeout(550);
  await section.dispatchEvent('pointermove', {
    pointerType: 'pen', pointerId: 42, isPrimary: true, clientX: box.x + 10, clientY: box.y + 28,
  });
  await section.dispatchEvent('pointerup', { pointerType: 'pen', pointerId: 42, isPrimary: true });
  await section.dispatchEvent('click', { detail: 1 });

  expect(await jumpMessages(page)).toEqual([]);
  expect(await reorderMessages(page)).toEqual([]);
});

test('desktop native drag shares the insertion preview and reorder calculation', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const titles = await page.locator('.song-title').allTextContents();
  const previewSong = await page.evaluate(() => {
    const source = document.querySelector('.song-item[data-song="0"]');
    const target = document.querySelector('.song-item[data-song="2"]');
    const transfer = new DataTransfer();
    const targetBox = target.getBoundingClientRect();
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    target.dispatchEvent(new DragEvent('dragover', {
      bubbles: true,
      cancelable: true,
      clientY: targetBox.bottom - 4,
      dataTransfer: transfer,
    }));
    const preview = document.querySelector('.song-item.drop-before, .song-item.drop-after');
    target.dispatchEvent(new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      clientY: targetBox.bottom - 4,
      dataTransfer: transfer,
    }));
    source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer }));
    return preview?.dataset.song || null;
  });

  expect(previewSong).toBe('3');
  await expect.poll(() => reorderMessages(page)).toEqual([{
    type: 'reorder',
    songTitles: [titles[1], titles[2], titles[0], ...titles.slice(3)],
  }]);
});

test('native Chromium touch suppresses compatibility click and pans without a jump', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'CDP native touch input is Chromium-specific');
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  const tapTarget = page.locator('.section-btn[data-song="1"][data-section="1"]');
  await tapTarget.scrollIntoViewIfNeeded();
  const tapBox = await tapTarget.boundingBox();
  expect(tapBox).not.toBeNull();
  const tapX = tapBox.x + tapBox.width / 2;
  const tapY = tapBox.y + tapBox.height / 2;
  await nativeTouch(session, 'touchStart', tapX, tapY);
  await page.waitForTimeout(100);
  await nativeTouch(session, 'touchEnd', tapX, tapY);
  await page.waitForTimeout(200);
  expect(await jumpMessages(page)).toEqual([]);

  const panTarget = page.locator('.song-header[data-song="3"]');
  await panTarget.scrollIntoViewIfNeeded();
  const panBox = await panTarget.boundingBox();
  expect(panBox).not.toBeNull();
  const panX = panBox.x + panBox.width / 2;
  const panY = panBox.y + panBox.height / 2;
  const scrollBefore = await page.evaluate(() => document.scrollingElement.scrollTop);
  await nativeTouch(session, 'touchStart', panX, panY);
  for (const delta of [20, 45, 75, 110]) {
    await nativeTouch(session, 'touchMove', panX, panY - delta);
    await page.waitForTimeout(20);
  }
  await nativeTouch(session, 'touchEnd', panX, panY - 110);
  await expect.poll(() => page.evaluate(() => document.scrollingElement.scrollTop)).toBeGreaterThan(scrollBefore);
  expect(await jumpMessages(page)).toEqual([]);
});

test('desktop mouse and keyboard activation remain immediate', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const mouseTarget = page.locator('.section-btn[data-song="0"][data-section="1"]');
  await mouseTarget.click();
  await expect.poll(() => jumpMessages(page)).toContainEqual({
    type: 'jump',
    songIndex: 0,
    sectionIndex: 1,
  });

  const keyboardTarget = page.locator('.section-btn[data-song="1"][data-section="0"]');
  await keyboardTarget.focus();
  await keyboardTarget.press('Enter');
  await expect.poll(() => jumpMessages(page)).toContainEqual({
    type: 'jump',
    songIndex: 1,
    sectionIndex: 0,
  });
});

test('Lock Mode and read-only authority block a completed mobile hold', async ({ page }) => {
  const target = page.locator('.section-btn[data-song="0"][data-section="0"]');
  await page.locator('#btnLock').click();
  await touchHold(page, target, 31);
  expect(await jumpMessages(page)).toEqual([]);

  await page.goto('/setlist/?scenario=read-only');
  await expect(page.locator('.song-item')).toHaveCount(8);
  await touchHold(page, page.locator('.section-btn[data-song="0"][data-section="0"]'), 32);
  expect(await jumpMessages(page)).toEqual([]);
});

test('desktop double-click still opens inline section editing', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await page.evaluate(async () => (
    fetch('/__test__/state').then((response) => response.json())
  ));
  await emitServerMessage(page, { ...fixture, state: { ...fixture.state, isPlaying: false } });
  const section = page.locator('.section-btn[data-song="0"][data-section="0"]');
  await section.dblclick();
  await expect(page.locator('.section-edit-input[data-song-index="0"][data-section-index="0"]')).toBeVisible();
});
