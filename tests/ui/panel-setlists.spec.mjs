import { expect, test } from '@playwright/test';

// The setlists tab of the panel: the setlists of the project Live has open,
// the packages that carry them in and out, and the songs of the setlist
// that is active.
const LIVE_PROJECT = {
  projectName: 'Summer Tour',
  profiles: [
    { id: 'one', name: 'Main Setlist' },
    { id: 'two', name: 'Festival' },
  ],
  deletedProfiles: [{ id: 'three', name: 'Archive', deletedAt: '2026-07-29T12:00:00.000Z' }],
  activeProfileId: 'one',
  canMutate: true,
  locked: false,
  lockReason: null,
};

const LIVE_PACKAGES = {
  dir: '/Users/op/Library/Application Support/RC Setlist/packages',
  files: [
    { file: 'Summer Tour 2026-11-06 21h00.rcsetlist', modifiedAt: 1762362000000 },
    { file: 'Winter Set.rcsetlist', modifiedAt: 1761000000000 },
  ],
};

const LIVE_SONGS = [
  { title: 'Alpha', durationSeconds: 210, sectionCount: 4, color: '#ff8800' },
  { title: 'Beta', durationSeconds: 305, sectionCount: 6, color: '#22aa66' },
  { title: 'Gamma', durationSeconds: 240, sectionCount: 2, color: '#3366ff' },
];

const LIVE_PLAYBACK = {
  isPlaying: false,
  songCount: LIVE_SONGS.length,
  durationSeconds: 755,
  tempo: 128,
  activeSongIndex: 1,
  songs: LIVE_SONGS,
};

const LIVE_FIXTURE = {
  packages: LIVE_PACKAGES,
  playback: LIVE_PLAYBACK,
  project: LIVE_PROJECT,
};

// The panel as the extension hands it over: the values above reach the
// page as they are.
const livePanelInit = (fixture) => {
  window.INITIAL_IS_RUNNING = true;
  window.INITIAL_PORT = 4444;
  window.INITIAL_TLS = true;
  window.INITIAL_PRIMARY_IP = '192.168.1.50';
  window.INITIAL_TOKEN = 'fixture-token';
  window.INITIAL_LOCALE = 'en';
  window.INITIAL_STORAGE_INITIALIZED = true;
  window.INITIAL_DURATION_CONFIDENCE = 'estimated';
  window.INITIAL_PROJECT = fixture.project;
  window.INITIAL_PLAYBACK = fixture.playback;
  window.INITIAL_PACKAGES = fixture.packages;
};

// The host of the panel: every answer the page sends is kept, so that the
// test can see what the panel asked for.
const hostInit = () => {
  window.__messages = [];
  window.webkit = {
    messageHandlers: {
      live: {
        postMessage: (message) => {
          window.__messages.push(message);
        },
      },
    },
  };
};

async function openPanel(page, { size = { width: 760, height: 600 } } = {}) {
  await page.setViewportSize(size);
  await page.addInitScript(livePanelInit, LIVE_FIXTURE);
  await page.addInitScript(hostInit);
  await page.goto('/panel/index.html');
}

async function sentEnvelopes(page) {
  return page.evaluate(() =>
    (window.__messages || []).map((message) => JSON.parse(message.params[0])),
  );
}

// The code inside the frame: the image the library draws, or the canvas it
// falls back to.
async function qrSource(page, frame) {
  return page.locator(frame).evaluate((element) => {
    const image = element.querySelector('img');
    if (image) return image.src;
    const canvas = element.querySelector('canvas');
    return canvas ? canvas.toDataURL() : '';
  });
}

// The row of a setlist of the project.
function setlistRow(page, name) {
  return page.locator('#setlistProfiles .setlist-row').filter({ hasText: name });
}

test('the setlists of the project are rows with their actions', async ({ page }) => {
  await openPanel(page);
  await page.locator('#tabSetlist').click();

  await expect(page.locator('#setlistHeading')).toContainText('Summer Tour');
  await expect(page.locator('#tabSetlistCount')).toHaveText('2');
  await expect(page.locator('#setlistProfiles .setlist-row')).toHaveCount(2);
  await expect(page.locator('#setlistProfiles')).toContainText('Main Setlist');
  await expect(page.locator('#setlistProfiles')).toContainText('Festival');
  // The setlist that is active says so and offers no button to choose it.
  await expect(setlistRow(page, 'Main Setlist')).toContainText('Active');
  await expect(
    setlistRow(page, 'Main Setlist').getByRole('button', { name: 'Activate' }),
  ).toHaveCount(0);
  await expect(setlistRow(page, 'Festival').getByRole('button', { name: 'Rename' })).toBeVisible();
  await expect(setlistRow(page, 'Festival').getByRole('button', { name: 'Delete' })).toBeVisible();
});

test('choosing a setlist asks the extension for it', async ({ page }) => {
  await openPanel(page);
  await page.locator('#tabSetlist').click();

  await setlistRow(page, 'Festival').getByRole('button', { name: 'Activate' }).click();

  const envelopes = await sentEnvelopes(page);
  expect(envelopes).toHaveLength(1);
  expect(envelopes[0]).toMatchObject({
    action: 'select-profile',
    profileId: 'two',
    tab: 'setlist',
  });
});

test('a new setlist is asked for by its name', async ({ page }) => {
  await openPanel(page);
  await page.locator('#tabSetlist').click();

  await page.locator('#setlistCreateName').fill('Encore');
  await page.locator('#btnCreateSetlist').click();

  const envelopes = await sentEnvelopes(page);
  expect(envelopes).toHaveLength(1);
  expect(envelopes[0]).toMatchObject({ action: 'create-profile', name: 'Encore' });
});

test('a name that is empty asks nothing and keeps the field', async ({ page }) => {
  await openPanel(page);
  await page.locator('#tabSetlist').click();

  await page.locator('#btnCreateSetlist').click();

  expect(await sentEnvelopes(page)).toHaveLength(0);
  await expect(page.locator('#setlistCreateName')).toBeFocused();
});

test('a setlist is renamed with the keyboard', async ({ page }) => {
  await openPanel(page);
  await page.locator('#tabSetlist').click();

  const row = setlistRow(page, 'Festival');
  await row.getByRole('button', { name: 'Rename' }).click();
  // The name turns into the field: the row no longer holds its name as text.
  const field = page.locator('#setlistProfiles input.text-input');
  await expect(field).toBeVisible();
  await field.fill('Festival Night');
  await field.press('Enter');

  const envelopes = await sentEnvelopes(page);
  expect(envelopes).toHaveLength(1);
  expect(envelopes[0]).toMatchObject({
    action: 'rename-profile',
    name: 'Festival Night',
    profileId: 'two',
  });
});

test('a setlist is deleted only after the question', async ({ page }) => {
  await openPanel(page);
  await page.locator('#tabSetlist').click();

  const row = setlistRow(page, 'Festival');
  await row.getByRole('button', { name: 'Delete' }).click();
  // The question comes first: nothing is asked until it is answered.
  await expect(row.locator('.confirm-text')).toHaveText('Delete it?');
  expect(await sentEnvelopes(page)).toHaveLength(0);

  await row.getByRole('button', { name: 'Delete' }).click();

  const envelopes = await sentEnvelopes(page);
  expect(envelopes).toHaveLength(1);
  expect(envelopes[0]).toMatchObject({
    action: 'delete-profile',
    profileId: 'two',
    name: 'Festival',
  });
});

test('a deleted setlist comes back', async ({ page }) => {
  await openPanel(page);
  await page.locator('#tabSetlist').click();

  await expect(page.locator('#deletedProfiles .setlist-row')).toHaveCount(1);
  await expect(page.locator('#deletedProfiles')).toContainText('Archive');
  await page.locator('#deletedProfiles').getByRole('button', { name: 'Restore' }).click();

  const envelopes = await sentEnvelopes(page);
  expect(envelopes).toHaveLength(1);
  expect(envelopes[0]).toMatchObject({ action: 'restore-profile', profileId: 'three' });
});

test('the deleted list is hidden when nothing was deleted', async ({ page }) => {
  await openPanel(page);
  await page.addInitScript(() => {
    window.INITIAL_PROJECT = { ...window.INITIAL_PROJECT, deletedProfiles: [] };
  });
  await page.reload();
  await page.locator('#tabSetlist').click();

  await expect(page.locator('#deletedProfiles')).toBeHidden();
  await expect(page.locator('#deletedHead')).toBeHidden();
});

test('the packages of the folder are listed and one of them is chosen', async ({ page }) => {
  await openPanel(page);
  await page.locator('#tabSetlist').click();

  await expect(page.locator('#packagesDir')).toHaveText(LIVE_PACKAGES.dir);
  const items = page.locator('#packageList .package-item');
  await expect(items).toHaveCount(2);
  await expect(items.first()).toHaveAttribute('aria-pressed', 'true');
  await expect(items.nth(1)).toHaveAttribute('aria-pressed', 'false');

  await page.locator('#btnImportPackage').click();

  let envelopes = await sentEnvelopes(page);
  expect(envelopes).toHaveLength(1);
  expect(envelopes[0]).toMatchObject({
    action: 'import-package',
    packageFile: 'Summer Tour 2026-11-06 21h00.rcsetlist',
  });

  // Another package of the folder is the one that travels now.
  await items.nth(1).click();
  await expect(items.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#btnImportPackage').click();

  envelopes = await sentEnvelopes(page);
  expect(envelopes).toHaveLength(2);
  expect(envelopes[1]).toMatchObject({
    action: 'import-package',
    packageFile: 'Winter Set.rcsetlist',
  });
});

test('every setlist of the project leaves as one package', async ({ page }) => {
  await openPanel(page);
  await page.locator('#tabSetlist').click();

  await page.locator('#btnExportPackage').click();

  const envelopes = await sentEnvelopes(page);
  expect(envelopes).toHaveLength(1);
  expect(envelopes[0]).toMatchObject({ action: 'export-package' });
});

test('a project that cannot change asks nothing', async ({ page }) => {
  await openPanel(page);
  await page.addInitScript(() => {
    window.INITIAL_PROJECT = {
      ...window.INITIAL_PROJECT,
      canMutate: false,
      locked: true,
      lockReason: 'playing',
    };
  });
  await page.reload();
  await page.locator('#tabSetlist').click();

  await expect(page.locator('#btnCreateSetlist')).toBeDisabled();
  await expect(page.locator('#setlistCreateName')).toBeDisabled();
  await expect(page.locator('#btnExportPackage')).toBeDisabled();
  await expect(page.locator('#btnImportPackage')).toBeDisabled();
  const row = setlistRow(page, 'Festival');
  await expect(row.getByRole('button', { name: 'Activate' })).toBeDisabled();
  await expect(row.getByRole('button', { name: 'Rename' })).toBeDisabled();
  await expect(row.getByRole('button', { name: 'Delete' })).toBeDisabled();
  expect(await sentEnvelopes(page)).toHaveLength(0);
});

test('the songs of the setlist that is active are rows', async ({ page }) => {
  await openPanel(page);

  const rows = page.locator('#mainSongs .song-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Alpha');
  await expect(rows.nth(0).locator('.song-sections')).toHaveText('4 sections');
  await expect(rows.nth(0).locator('.song-time')).toHaveText('3:30');
  // The song that plays now is the one the operator sees marked.
  await expect(rows.nth(1)).toHaveClass(/is-now/);
  await expect(rows.nth(1).locator('.song-now')).toHaveText('Now');
  await expect(rows.nth(0).locator('.song-now')).toHaveCount(0);
  const stripe = await rows
    .nth(0)
    .locator('.song-stripe')
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(stripe).toBe('rgb(255, 136, 0)');
});

test('the code on show can be swapped for the other page', async ({ page }) => {
  await openPanel(page);

  await expect(page.locator('#accessLabel')).toHaveText('Stage Control');
  await expect(page.locator('#qrSetlist')).toBeVisible();
  await expect(page.locator('#qrStage')).toBeHidden();
  // The library draws the code as an image that loads a moment later.
  await expect.poll(() => qrSource(page, '#qrSetlist')).not.toBe('');
  const stageCode = await qrSource(page, '#qrSetlist');

  await page.locator('#btnAccessSwap').click();

  await expect(page.locator('#accessLabel')).toHaveText('Performance Display');
  await expect(page.locator('#accessSwapText')).toHaveText('Stage Control');
  await expect(page.locator('#qrStage')).toBeVisible();
  await expect(page.locator('#qrSetlist')).toBeHidden();
  await expect.poll(() => qrSource(page, '#qrStage')).not.toBe('');
  const performanceCode = await qrSource(page, '#qrStage');
  expect(performanceCode).not.toBe(stageCode);

  await page.locator('#btnAccessSwap').click();

  await expect(page.locator('#accessLabel')).toHaveText('Stage Control');
  await expect(page.locator('#accessSwapText')).toHaveText('Performance Display');
  await expect(page.locator('#qrSetlist')).toBeVisible();
  await expect(page.locator('#qrStage')).toBeHidden();
  await expect.poll(() => qrSource(page, '#qrSetlist')).not.toBe('');
});

test('the notice of the last action is shown', async ({ page }) => {
  await openPanel(page);
  await page.addInitScript(() => {
    window.INITIAL_NOTICE = { tone: 'ok', key: 'notice.created', params: { name: 'Encore' } };
  });
  await page.reload();

  await expect(page.locator('#panelNotice')).toBeVisible();
  await expect(page.locator('#panelNotice')).toHaveText('Setlist "Encore" created and active.');
  await expect(page.locator('#panelNotice')).toHaveClass(/is-ok/);
});
