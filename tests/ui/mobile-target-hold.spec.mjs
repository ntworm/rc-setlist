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

  // A version bump that changes nothing visible no longer rebuilds the list, so
  // the card the finger is on survives and the gesture is left alone. Only a
  // render that actually replaces the DOM has to hand the card back.
  await begin(63);
  const fixture = await page.evaluate(async () => fetch('/__test__/state').then((response) => response.json()));
  await emitServerMessage(page, { ...fixture, state: { ...fixture.state, setlistVersion: 63 } });
  await expect(item).toHaveAttribute('draggable', 'false');

  const renamed = JSON.parse(JSON.stringify(fixture.state));
  renamed.songs[0].title = 'RENDER RESET';
  renamed.setlistVersion = 64;
  await emitServerMessage(page, { ...fixture, state: renamed });
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

test('desktop double-click opens the marker panel when stopped and blocks it during performance', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await page.evaluate(async () => (
    fetch('/__test__/state').then((response) => response.json())
  ));

  // 1. Stopped (rehearsal / editing): double-click opens the marker panel.
  // The raw-text editor this replaced let a [bpm] tag be deleted by accident,
  // and that tag feeds the show duration.
  await emitServerMessage(page, { ...fixture, state: { ...fixture.state, isPlaying: false } });
  const section = page.locator('.section-btn[data-song="0"][data-section="0"]');
  await section.dblclick();
  await expect(page.locator('#markerEditor')).toBeVisible();
  await expect(page.locator('#markerPanel [data-field="name"]')).toHaveCount(1);
  await expect(page.locator('.section-edit-input')).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(page.locator('#markerEditor')).toBeHidden();

  // 2. Playing (during performance): a rename is a delete plus a recreate at the
  // playhead, so the panel must not open at all.
  await emitServerMessage(page, { ...fixture, state: { ...fixture.state, isPlaying: true } });
  await section.dblclick();
  await expect(page.locator('#markerEditor')).toBeHidden();
});

test('double-clicking anywhere on the song header opens the song panel', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await page.evaluate(async () => (
    fetch('/__test__/state').then((response) => response.json())
  ));
  await emitServerMessage(page, { ...fixture, state: { ...fixture.state, isPlaying: false } });

  // The handler used to sit on the title span alone, so a double-click that
  // landed a few pixels off did nothing and the panel felt broken.
  await page.locator('.song-header[data-song="0"] .song-time').dblclick();
  await expect(page.locator('#markerEditor')).toBeVisible();
  await expect(page.locator('#markerSectionsField')).toBeVisible();
});

test('every tag the marker panel writes has a badge on the card', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await page.evaluate(async () => (
    fetch('/__test__/state').then((response) => response.json())
  ));
  const state = { ...fixture.state, isPlaying: false };
  state.songs = JSON.parse(JSON.stringify(state.songs));
  state.songs[0].skip = true;
  state.songs[0].autoClick = false;
  state.songs[0].sections[0].skip = true;
  state.songs[0].sections[1].autoClick = true;
  await emitServerMessage(page, { ...fixture, state });

  // Setting [skip] or [click] used to leave no mark anywhere, which read as a
  // save that had silently failed.
  const header = page.locator('.song-header[data-song="0"]');
  await expect(header.locator('.skip-badge')).toHaveCount(1);
  await expect(header.locator('.click-badge')).toHaveText(/CLICK OFF/);
  await expect(page.locator('.section-btn[data-song="0"][data-section="0"] .skip-badge')).toHaveCount(1);
  await expect(page.locator('.section-btn[data-song="0"][data-section="1"] .click-badge')).toHaveText(/CLICK/);
});

test('a marker with a save still in flight cannot be reopened onto stale values', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await page.evaluate(async () => (
    fetch('/__test__/state').then((response) => response.json())
  ));
  await emitServerMessage(page, { ...fixture, state: { ...fixture.state, isPlaying: false } });

  await page.locator('.song-header[data-song="0"]').dblclick();
  await page.locator('#markerPanel [data-field="name"]').fill('ABERTURA');
  await page.locator('#markerSave').click();
  await expect(page.locator('#markerEditor')).toBeHidden();

  // Live has not reported the new name back yet. Reopening here would populate
  // the panel from the name before the edit and write it back on the next save.
  await page.locator('.song-header[data-song="0"]').dblclick();
  await expect(page.locator('#markerEditor')).toBeHidden();

  // A different marker is unaffected.
  await page.locator('.song-header[data-song="1"]').dblclick();
  await expect(page.locator('#markerEditor')).toBeVisible();
});

test('a selection drag that ends outside the panel does not dismiss it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await page.evaluate(async () => (
    fetch('/__test__/state').then((response) => response.json())
  ));
  await emitServerMessage(page, { ...fixture, state: { ...fixture.state, isPlaying: false } });

  await page.locator('.song-header[data-song="0"]').dblclick();
  await expect(page.locator('#markerEditor')).toBeVisible();

  // click fires on the common ancestor of press and release, so releasing past
  // the panel edge produced a backdrop click and closed the panel mid-edit.
  const field = page.locator('#markerPanel [data-field="name"]');
  const box = await field.boundingBox();
  await page.mouse.move(box.x + 10, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(12, 12);
  await page.mouse.up();
  await expect(page.locator('#markerEditor')).toBeVisible();

  // A press that starts on the backdrop still dismisses.
  await page.mouse.move(12, 12);
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.locator('#markerEditor')).toBeHidden();
});

test('a song with many sections lists them without a scrollbar on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await page.evaluate(async () => (
    fetch('/__test__/state').then((response) => response.json())
  ));
  const state = { ...fixture.state, isPlaying: false };
  state.songs = JSON.parse(JSON.stringify(state.songs));
  // Thirteen parts is an ordinary song, not an edge case. In a single column it
  // showed four at a time and the rest lived behind a scrollbar.
  state.songs[0].sections = Array.from({ length: 13 }, (_, index) => ({
    name: `PART ${index + 1}`,
    rawName: `> PART ${index + 1}`,
    time: index * 32,
    loopCount: null,
    autoStop: false,
    autoNext: false,
    bpm: null,
    autoClick: null,
    skip: false,
  }));
  await emitServerMessage(page, { ...fixture, state });

  await page.locator('.song-header[data-song="0"]').dblclick();
  await expect(page.locator('#markerEditor')).toBeVisible();

  const list = await page.locator('#markerSections').evaluate((el) => ({
    columns: getComputedStyle(el).gridTemplateColumns.split(' ').length,
    scrolls: el.scrollHeight > el.clientHeight + 1,
  }));
  expect(list.columns, 'sections should flow into more than one column').toBeGreaterThan(1);
  expect(list.scrolls, 'thirteen sections should fit without scrolling').toBe(false);

  // The panel still has to fit the window, Save included.
  const fits = await page.locator('#markerPanel').evaluate((el) => {
    const box = el.getBoundingClientRect();
    return box.right <= window.innerWidth + 1 && box.bottom <= window.innerHeight + 1;
  });
  expect(fits, 'the panel must fit the viewport').toBe(true);
});

test('the jump ring clears the song title instead of cutting through it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await page.evaluate(async () => (
    fetch('/__test__/state').then((response) => response.json())
  ));
  await emitServerMessage(page, { ...fixture, state: { ...fixture.state, isPlaying: false } });

  // The header carries no padding of its own, so an inset ring landed flush
  // against the title and read as a box slicing the text.
  const ring = await page.locator('.song-header[data-song="0"]').evaluate((el) => {
    el.classList.add('jumping');
    const style = getComputedStyle(el);
    return {
      outlineWidth: style.outlineWidth,
      outlineOffset: parseFloat(style.outlineOffset),
      inset: style.boxShadow.includes('inset'),
    };
  });
  expect(ring.outlineWidth).toBe('1px');
  expect(ring.outlineOffset).toBeGreaterThan(0);
  expect(ring.inset, 'the ring must not be an inset shadow').toBe(false);
});

test('a state push that changes nothing visible never replaces the song list', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await page.evaluate(async () => (
    fetch('/__test__/state').then((response) => response.json())
  ));
  await emitServerMessage(page, { ...fixture, state: { ...fixture.state, isPlaying: false } });
  await expect(page.locator('.song-item')).toHaveCount(8);

  await page.evaluate(() => {
    window.__rebuilds = 0;
    const host = document.getElementById('songList');
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.target === host && record.addedNodes.length) window.__rebuilds += 1;
      }
    }).observe(host, { childList: true });
  });

  // Cues arrive from three sync sources at three rates and do not agree to the
  // last decimal, so setlistVersion moves without the setlist meaning anything
  // different. Rebuilding the DOM on that read as the page flickering every two
  // seconds, and threw away the scroll position with it.
  for (let i = 0; i < 6; i++) {
    await emitServerMessage(page, {
      ...fixture,
      state: {
        ...fixture.state,
        isPlaying: false,
        setlistVersion: (fixture.state.setlistVersion ?? 1) + i + 1,
        currentSongTime: 40 + i,
      },
    });
    await page.waitForTimeout(60);
  }

  const rebuilds = await page.evaluate(() => window.__rebuilds);
  expect(rebuilds, 'identical markup must not be written back to the DOM').toBe(0);
  await expect(page.locator('.song-item')).toHaveCount(8);
});
