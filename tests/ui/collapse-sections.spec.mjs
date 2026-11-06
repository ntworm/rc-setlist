import { expect, test } from '@playwright/test';

// One place for each job on a song card:
//   the song name          jumps to the song (hold), double click edits the marker
//   the three dots         fold and unfold the sections of that song only
//   the grip on the right  drags the song to reorder it
//   "Fold all / Unfold all" in the "Songs in project" bar acts on every song
// Nothing changes with the number of clicks on the dots.

const HOLD_PAST_GATE_MS = 900;

async function messagesOfType(page, type) {
  const messages = await page.evaluate(async () =>
    fetch('/__test__/messages').then((response) => response.json()),
  );
  return messages.filter((message) => message.type === type);
}

function dots(page, songIndex) {
  return page.locator(`.song-item[data-song="${songIndex}"] .song-reorder-handle`);
}

function grip(page, songIndex) {
  return page.locator(`.song-item[data-song="${songIndex}"] .song-drag-grip`);
}

function sections(page, songIndex) {
  return page.locator(`.song-item[data-song="${songIndex}"] .song-sections`);
}

async function songsWithSections(page) {
  return page
    .locator('.song-item')
    .evaluateAll((items) =>
      items.filter((item) => item.querySelector('.song-sections')).map((item) => item.dataset.song),
    );
}

async function touchHold(page, locator, pointerId) {
  await locator.dispatchEvent('pointerdown', {
    pointerType: 'touch',
    pointerId,
    isPrimary: true,
    button: 0,
    clientX: 10,
    clientY: 10,
  });
  await page.waitForTimeout(HOLD_PAST_GATE_MS);
  await locator.dispatchEvent('pointerup', { pointerType: 'touch', pointerId, isPrimary: true });
  await locator.dispatchEvent('click', { detail: 1 });
}

async function openSetlist(page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/setlist/');
  await page.locator('.song-item').first().waitFor();
}

test('each click on the dots toggles only that song', async ({ page }) => {
  await openSetlist(page);
  const withSections = await songsWithSections(page);
  expect(withSections.length).toBeGreaterThanOrEqual(2);
  const [first, second] = withSections;

  await dots(page, first).click();
  await expect(sections(page, first)).toBeHidden();
  await expect(sections(page, second)).toBeVisible();
  await expect(dots(page, first)).toHaveAttribute('aria-expanded', 'false');

  // A second quick click is just another toggle of the same song.
  await dots(page, first).click();
  await expect(sections(page, first)).toBeVisible();
  await expect(sections(page, second)).toBeVisible();
  await expect(dots(page, first)).toHaveAttribute('aria-expanded', 'true');
});

test('the bar button folds and unfolds every song', async ({ page }) => {
  await openSetlist(page);
  const withSections = await songsWithSections(page);
  const button = page.locator('#btnFoldAllSongs');
  await expect(button).toBeVisible();

  await button.click();
  for (const songIndex of withSections) {
    await expect(sections(page, songIndex)).toBeHidden();
  }
  await button.click();
  for (const songIndex of withSections) {
    await expect(sections(page, songIndex)).toBeVisible();
  }
});

test('the bar button folds all when any song is open, and says so', async ({ page }) => {
  await openSetlist(page);
  const withSections = await songsWithSections(page);
  const button = page.locator('#btnFoldAllSongs');
  const unfoldedLabel = await button.textContent();

  for (const songIndex of withSections.slice(1)) await dots(page, songIndex).click();
  await expect(sections(page, withSections[0])).toBeVisible();
  await expect(button).toHaveText(unfoldedLabel);

  await button.click();
  await expect(sections(page, withSections[0])).toBeHidden();
  await expect(button).not.toHaveText(unfoldedLabel);
});

test('the dots and the grip never jump and never open the marker editor', async ({ page }) => {
  await openSetlist(page);
  const [first] = await songsWithSections(page);

  await touchHold(page, dots(page, first), 31);
  await touchHold(page, grip(page, first), 32);
  await dots(page, first).dblclick();
  await grip(page, first).dblclick();

  expect(await messagesOfType(page, 'jump')).toEqual([]);
  await expect(page.locator('#markerEditor')).toBeHidden();
});

test('the number and the name of a song jump to it, the time does not', async ({ page }) => {
  await openSetlist(page);
  const header = page.locator('.song-header[data-song="2"]');

  await touchHold(page, header.locator('.song-time'), 41);
  expect(await messagesOfType(page, 'jump')).toEqual([]);

  await touchHold(page, header.locator('.song-index'), 42);
  await expect
    .poll(async () => (await messagesOfType(page, 'jump')).map((message) => message.songIndex))
    .toEqual([2]);
});

test('a click anywhere along the name of a song jumps to it', async ({ page }) => {
  await openSetlist(page);
  const title = page.locator('.song-header[data-song="1"] .song-title');
  const box = await title.boundingBox();
  // The last letters, not the first: the whole name is the target.
  await page.mouse.click(box.x + box.width - 3, box.y + box.height / 2);
  await expect
    .poll(async () => (await messagesOfType(page, 'jump')).map((message) => message.songIndex))
    .toEqual([1]);
});

test('the grip sits on the right edge of the card and is the only native drag source', async ({
  page,
}) => {
  await openSetlist(page);
  const item = page.locator('.song-item[data-song="0"]');
  await expect(grip(page, 0)).toBeVisible();
  await expect(grip(page, 0)).toHaveAttribute('draggable', 'true');
  await expect(item).not.toHaveAttribute('draggable', 'true');

  const itemBox = await item.boundingBox();
  const gripBox = await grip(page, 0).boundingBox();
  expect(itemBox.x + itemBox.width - (gripBox.x + gripBox.width)).toBeLessThanOrEqual(12);
  expect(gripBox.x).toBeGreaterThan(itemBox.x + itemBox.width / 2);
});

test('the folded songs stay folded after a reload', async ({ page }) => {
  await openSetlist(page);
  const [first, second] = await songsWithSections(page);
  await dots(page, first).click();
  await expect(sections(page, first)).toBeHidden();

  await page.reload();
  await page.locator('.song-item').first().waitFor();
  await expect(sections(page, first)).toBeHidden();
  await expect(sections(page, second)).toBeVisible();
});

test('a folded song still shows its name, number, time and grip', async ({ page }) => {
  await openSetlist(page);
  const [first] = await songsWithSections(page);
  await dots(page, first).click();
  const header = page.locator(`.song-item[data-song="${first}"] .song-header`);
  await expect(header.locator('.song-title')).toBeVisible();
  await expect(header.locator('.song-index')).toBeVisible();
  await expect(header.locator('.song-time')).toBeVisible();
  await expect(grip(page, first)).toBeVisible();
});
