/* global cancelCountIn */
import { expect, test } from '@playwright/test';

async function receivedControlMessages(page) {
  return page.evaluate(async () => fetch('/__test__/messages').then((response) => response.json()));
}

async function emitServerMessage(page, payload) {
  await page.evaluate(async (message) => {
    await fetch('/__test__/emit', { method: 'POST', body: JSON.stringify(message) });
  }, payload);
}

test('Setlist count-in toggle waits for authoritative server state', async ({ page }) => {
  await page.goto('/setlist/');
  const button = page.locator('#btnPreRoll');
  const fixture = await page.evaluate(async () =>
    fetch('/__test__/state').then((response) => response.json()),
  );

  await expect(button).toBeEnabled();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect(button).not.toHaveClass(/btn-preroll-active/);

  await button.click();
  await expect
    .poll(async () =>
      (await receivedControlMessages(page)).find(
        (message) => message.type === 'set_pre_roll' && message.value === true,
      ),
    )
    .toBeTruthy();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect(button).not.toHaveClass(/btn-preroll-active/);

  await emitServerMessage(page, {
    ...fixture,
    state: { ...fixture.state, preRollEnabled: true },
  });
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(button).toHaveClass(/btn-preroll-active/);
});

test('the count-in delegates playback to the server and cleans up its UI when the bar is over', async ({ page }) => {
  await page.goto('/setlist/');
  const fixture = await page.evaluate(async () =>
    fetch('/__test__/state').then((response) => response.json()),
  );

  // 160 BPM in 4/4 is a two-second bar, so Play must not be on the wire
  // immediately — and the button counts while it waits.
  await emitServerMessage(page, {
    ...fixture,
    state: {
      ...fixture.state,
      preRollEnabled: true,
      isPlaying: false,
      currentSongTime: 64,
      declaredTempo: 160,
      tempo: 110,
      signatureNumerator: 4,
      signatureDenominator: 4,
    },
  });
  // Wait for the UI to process the state
  await expect(page.locator('#btnPreRoll')).toHaveClass(/btn-preroll-active/);

  await page.locator('#btnPlay').click();
  await expect(page.locator('#btnPlay')).toHaveClass(/is-counting/);
  
  // The client must send trigger_count_in, NOT play
  const triggerSent = (await receivedControlMessages(page)).some((m) => m.type === 'trigger_count_in');
  expect(triggerSent, 'Client must trigger count-in via server').toBe(true);

  const playSentDuringCount = (await receivedControlMessages(page)).some((m) => m.type === 'play');
  expect(playSentDuringCount, 'Play must not be sent by the client').toBe(false);

  await expect(page.locator('#btnPlay')).not.toHaveClass(/is-counting/, { timeout: 6000 });
});

test('a second press during the count starts immediately instead of counting again', async ({
  page,
}) => {
  await page.goto('/setlist/');
  const fixture = await page.evaluate(async () =>
    fetch('/__test__/state').then((response) => response.json()),
  );
  await emitServerMessage(page, {
    ...fixture,
    state: {
      ...fixture.state,
      preRollEnabled: true,
      isPlaying: false,
      currentSongTime: 64,
      declaredTempo: 60,
      signatureNumerator: 4,
    },
  });
  await expect(page.locator('#btnPreRoll')).toHaveClass(/btn-preroll-active/);

  const play = page.locator('#btnPlay');
  await play.click();
  await expect(play).toHaveClass(/is-counting/);
  await play.click();

  await expect
    .poll(
      async () =>
        (await receivedControlMessages(page)).filter((message) => message.type === 'play').length,
    )
    .toBe(1);
  await expect(play).not.toHaveClass(/is-counting/);
});

test('Stop cancels an armed count instead of leaving Play to fire later', async ({ page }) => {
  await page.goto('/setlist/');
  const fixture = await page.evaluate(async () =>
    fetch('/__test__/state').then((response) => response.json()),
  );
  await emitServerMessage(page, {
    ...fixture,
    state: {
      ...fixture.state,
      preRollEnabled: true,
      isPlaying: false,
      currentSongTime: 64,
      declaredTempo: 60,
      signatureNumerator: 4,
    },
  });
  await expect(page.locator('#btnPreRoll')).toHaveClass(/btn-preroll-active/);

  await page.locator('#btnPlay').click();
  await expect(page.locator('#btnPlay')).toHaveClass(/is-counting/);
  await page.evaluate(() => cancelCountIn());
  await expect(page.locator('#btnPlay')).not.toHaveClass(/is-counting/);

  await page.waitForTimeout(1_200);
  const played = (await receivedControlMessages(page)).some((message) => message.type === 'play');
  expect(played, 'a cancelled count must not send Play afterwards').toBe(false);
});

test('the count-in toggle off starts playback with no count at all', async ({ page }) => {
  await page.goto('/setlist/');
  const fixture = await page.evaluate(async () =>
    fetch('/__test__/state').then((response) => response.json()),
  );
  await emitServerMessage(page, {
    ...fixture,
    state: { ...fixture.state, preRollEnabled: false, isPlaying: false, declaredTempo: 160 },
  });

  await page.locator('#btnPlay').click();
  await expect(page.locator('#btnPlay')).not.toHaveClass(/is-counting/);
  await expect
    .poll(async () =>
      (await receivedControlMessages(page)).some((message) => message.type === 'play'),
    )
    .toBe(true);
});

test('Setlist count-in is disabled without control authority and in Lock Mode', async ({
  page,
}) => {
  await page.goto('/setlist/?scenario=never-connected');
  await expect(page.locator('#btnPreRoll')).toBeDisabled();

  await page.goto('/setlist/?scenario=read-only');
  await expect(page.locator('#btnPreRoll')).toBeDisabled();

  await page.goto('/setlist/');
  await expect(page.locator('#btnPreRoll')).toBeEnabled();
  await page.locator('#btnLock').click();
  await expect(page.locator('#btnPreRoll')).toBeDisabled();
});
