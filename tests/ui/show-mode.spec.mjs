import { expect, test } from '@playwright/test';

async function openSetlist(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/setlist/');
  await page.locator('.song-item').first().waitFor();
  await expect(page.locator('#profileSelect option')).toHaveCount(2);
  return errors;
}

async function emitExtendedState(request, activeSongIndex, songCount = 24) {
  const fixture = await request.get('/__test__/state').then((response) => response.json());
  const baseSongs = fixture.state.songs;
  const songs = Array.from({ length: songCount }, (_, index) => {
    const template = baseSongs[index % baseSongs.length];
    return {
      ...template,
      title: `${template.title} ${index + 1}`,
      time: index * 128,
      sections: template.sections.map((section, sectionIndex) => ({
        ...section,
        time: index * 128 + sectionIndex * 24,
      })),
    };
  });
  await request.post('/__test__/emit', {
    data: {
      type: 'state',
      state: {
        ...fixture.state,
        songs,
        activeSongIndex,
        activeSectionIndex: 0,
        currentSongTime: activeSongIndex * 128,
      },
    },
  });
}

async function expectEditControlsVisible(page) {
  await expect(page.locator('body')).not.toHaveClass(/show-mode/);
  await expect(page.locator('[data-stage-mode="edit"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-stage-mode="show"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.tools-menu > summary')).toBeVisible();
  await expect(page.locator('#btnManageProfiles')).toBeVisible();
  await expect(page.locator('#btnMetronome')).toBeVisible();
  await expect(page.locator('#btnPreRoll')).toBeVisible();
  await expect(page.locator('#btnRefresh')).toBeVisible();
  await expect(page.locator('#quantizationSelect')).toBeVisible();
  await expect(page.locator('.log-drawer > summary')).toBeVisible();
  await expect(page.locator('#btnFoldAllSongs')).toBeVisible();
}

async function expectShowControlsApplied(page) {
  await expect(page.locator('body')).toHaveClass(/show-mode/);
  await expect(page.locator('[data-stage-mode="edit"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-stage-mode="show"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.tools-menu')).toBeHidden();
  await expect(page.locator('#btnManageProfiles')).toBeHidden();
  await expect(page.locator('#btnMetronome')).toBeHidden();
  await expect(page.locator('#btnPreRoll')).toBeHidden();
  await expect(page.locator('#btnRefresh')).toBeHidden();
  await expect(page.locator('#quantizationSelect')).toBeHidden();
  await expect(page.locator('.log-drawer')).toBeHidden();
  await expect(page.locator('#btnFoldAllSongs')).toBeHidden();
  await expect(page.locator('#btnLock')).toBeVisible();
  await expect(page.locator('.hud')).toBeVisible();
  await expect(page.locator('#btnPlay')).toBeVisible();
}

test('default mode is Edit with Tools and Show logs visible', async ({ page }) => {
  const errors = await openSetlist(page);
  await expectEditControlsVisible(page);
  expect(errors).toEqual([]);
});

test('clicking Show hides setup controls, keeps stage controls, and survives reload', async ({
  page,
}) => {
  const errors = await openSetlist(page);

  await page.locator('[data-stage-mode="show"]').click();
  await expectShowControlsApplied(page);

  await page.reload();
  await page.locator('.song-item').first().waitFor();
  await expectShowControlsApplied(page);
  expect(errors).toEqual([]);
});

test('in Show mode, active song pins to top and only its sections stay visible', async ({
  page,
  request,
}) => {
  const errors = await openSetlist(page);
  await emitExtendedState(request, 1, 24);
  await expect(page.locator('#songList .song-item')).toHaveCount(24);

  // Fold song 6 in Edit mode so we also verify Show reveals active song sections
  // without altering Edit mode's stored fold state.
  await page.locator('.song-item[data-song="6"] .song-reorder-handle').click();
  await expect(page.locator('.song-item[data-song="6"] .song-sections')).toBeHidden();

  await page.locator('[data-stage-mode="show"]').click();
  await emitExtendedState(request, 6, 24);

  const activeSong = page.locator('.song-item[data-song="6"]');
  await expect(activeSong).toHaveClass(/\bactive\b/);
  await expect(activeSong.locator('.song-sections')).toBeVisible();
  await expect(page.locator('.song-item[data-song="1"] .song-sections')).toBeHidden();

  const positions = await page.evaluate(() => {
    const listTop = document.querySelector('#songList').getBoundingClientRect().top;
    const itemTop = document.querySelector('.song-item[data-song="6"]').getBoundingClientRect().top;
    return { difference: Math.abs(itemTop - listTop) };
  });
  expect(positions.difference).toBeLessThanOrEqual(4);
  expect(errors).toEqual([]);
});

test('switching back to Edit restores setup controls and Edit fold state', async ({
  page,
  request,
}) => {
  const errors = await openSetlist(page);
  await emitExtendedState(request, 1, 24);
  await expect(page.locator('#songList .song-item')).toHaveCount(24);

  await page.locator('.song-item[data-song="6"] .song-reorder-handle').click();
  await page.locator('[data-stage-mode="show"]').click();
  await expectShowControlsApplied(page);

  await page.locator('[data-stage-mode="edit"]').click();
  await expectEditControlsVisible(page);
  await expect(page.locator('.song-item[data-song="1"] .song-sections')).toBeVisible();
  await expect(page.locator('.song-item[data-song="6"] .song-sections')).toBeHidden();
  expect(errors).toEqual([]);
});
