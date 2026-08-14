import { expect, test } from '@playwright/test';

test('Setlist shows relative show and song time for first and later songs', async ({ page }) => {
  await page.goto('/setlist/?scenario=relative-first');
  await expect(page.locator('#hudTime')).toHaveText('0:00 / 5:43');
  await expect(page.locator('#hudSongTime')).toHaveText('Song 0:00 / 1:46');

  await page.goto('/setlist/?scenario=relative-later');
  await expect(page.locator('#hudTime')).toHaveText('1:46 / 5:43');
  await expect(page.locator('#hudSongTime')).toHaveText('Song 0:00 / 3:57');
});

test('Setlist recomputes relative show time after a visible-order state update', async ({ page, request }) => {
  await page.goto('/setlist/?scenario=relative-later');
  await expect(page.locator('#hudTime')).toHaveText('1:46 / 5:43');

  const fixture = await request.get('/__test__/state?scenario=relative-later').then((response) => response.json());
  const [intro, julia] = fixture.state.songs;
  await request.post('/__test__/emit', {
    data: {
      ...fixture,
      state: {
        ...fixture.state,
        songs: [julia, intro],
        activeSongIndex: 0,
        currentSongTime: julia.time,
      },
    },
  });

  await expect(page.locator('#hudTime')).toHaveText('0:00 / 5:43');
  await expect(page.locator('#hudSongTime')).toHaveText('Song 0:00 / 3:57');
});

test('Setlist show and song time stay put when the live tempo changes', async ({ page, request }) => {
  await page.goto('/setlist/?scenario=relative-later');
  const fixture = await request.get('/__test__/state?scenario=relative-later').then((response) => response.json());
  const advanced = {
    ...fixture,
    state: { ...fixture.state, currentSongTime: fixture.state.songs[1].time + 60 },
  };

  await expect(page.locator('#hudTime')).toHaveText('1:46 / 5:43');
  await request.post('/__test__/emit', { data: advanced });
  await expect(page.locator('#hudTime')).toHaveText('2:16 / 5:43');
  await expect(page.locator('#hudSongTime')).toHaveText('Song 0:30 / 3:57');

  // A jump writes the destination BPM before the cue, so the tempo changes
  // but playback progress stays anchored to its previous duration.
  await request.post('/__test__/emit', {
    data: { ...advanced, state: { ...advanced.state, tempo: 180 } },
  });
  await expect(page.locator('#hudTime')).toHaveText('2:16 / 5:43');
  await expect(page.locator('#hudSongTime')).toHaveText('Song 0:30 / 3:57');
});

test('Setlist keeps its known total visible when no song is active', async ({ page }) => {
  await page.goto('/setlist/?scenario=no-song');

  await expect(page.locator('#hudTime')).toHaveText('— / 3:00');
  await expect(page.locator('#hudSongTime')).toHaveText('Song — / —');
});

test('Setlist localizes the empty song-time fallback before any state arrives', async ({ page }) => {
  await page.goto('/setlist/?scenario=never-connected');
  await expect(page.locator('#hudSongTime')).toHaveText('Song — / —');

  await page.locator('#languageSelect').selectOption('pt-BR');
  await expect(page.locator('#hudSongTime')).toHaveText('Música — / —');
});

for (const viewport of [{ width: 390, height: 844 }, { width: 1024, height: 768 }]) {
  test(`Setlist relative time card stays contained at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/setlist/?scenario=relative-later');
    await page.locator('#languageSelect').selectOption('pt-BR');

    await expect(page.locator('.hud-time-card .hud-label')).toHaveText('Tempo do show');
    await expect(page.locator('#hudSongTime')).toHaveText('Música 0:00 / 3:57');
    const geometry = await page.locator('.hud-time-card').evaluate((card) => {
      const rect = card.getBoundingClientRect();
      return {
        cardLeft: rect.left,
        cardRight: rect.right,
        cardWidth: rect.width,
        gridColumn: getComputedStyle(card).gridColumn,
        documentWidth: document.documentElement.scrollWidth,
        hudWidth: card.querySelector('#hudTime').getBoundingClientRect().width,
        viewportWidth: document.documentElement.clientWidth,
      };
    });

    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.cardLeft).toBeGreaterThanOrEqual(0);
    expect(geometry.cardRight).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect(geometry.hudWidth).toBeLessThanOrEqual(geometry.cardWidth);
    expect(geometry.gridColumn).toBe(viewport.width < 900 ? '1 / -1' : 'auto');
  });
}

for (const viewport of [{ width: 390, height: 844 }, { width: 1024, height: 768 }, { width: 1366, height: 768 }]) {
  test(`Setlist contains hour-long show progress at ${viewport.width}px`, async ({ page, request }) => {
    await page.setViewportSize(viewport);
    await page.goto('/setlist/?scenario=relative-later');
    await expect(page.locator('#hudTime')).toHaveText('1:46 / 5:43');
    const fixture = await request.get('/__test__/state?scenario=relative-later').then((response) => response.json());
    await request.post('/__test__/emit', {
      data: {
        ...fixture,
        state: { ...fixture.state, totalDurationSeconds: 4179 },
      },
    });

    await expect(page.locator('#hudTime')).toHaveText('0:01:46 / 1:09:39');
    const geometry = await page.locator('#hudTime').evaluate((time) => ({
      clientWidth: time.clientWidth,
      scrollWidth: time.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
    expect(geometry.clientWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  });
}
