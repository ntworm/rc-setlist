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
  const fixture = await page.evaluate(async () => fetch('/__test__/state').then((response) => response.json()));

  await expect(button).toBeEnabled();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect(button).not.toHaveClass(/btn-preroll-active/);

  await button.click();
  await expect.poll(async () => (
    await receivedControlMessages(page)
  ).find((message) => message.type === 'set_pre_roll' && message.value === true)).toBeTruthy();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect(button).not.toHaveClass(/btn-preroll-active/);

  await emitServerMessage(page, {
    ...fixture,
    state: { ...fixture.state, preRollEnabled: true },
  });
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(button).toHaveClass(/btn-preroll-active/);

  await emitServerMessage(page, {
    ...fixture,
    state: {
      ...fixture.state,
      preRollEnabled: true,
      isPlaying: false,
      currentSongTime: 2,
      signatureNumerator: 4,
    },
  });
  await page.locator('#btnPlay').click();
  await expect(page.locator('#operationToast')).toContainText('shortened');
});

test('Setlist shortened count-in warning uses denominator-aware bar distance', async ({ page }) => {
  await page.goto('/setlist/');
  const fixture = await page.evaluate(async () => fetch('/__test__/state').then((response) => response.json()));
  const toast = page.locator('#operationToast');

  await emitServerMessage(page, {
    ...fixture,
    state: {
      ...fixture.state,
      preRollEnabled: true,
      isPlaying: false,
      currentSongTime: 4,
      signatureNumerator: 6,
      signatureDenominator: 8,
    },
  });
  await page.locator('#btnPlay').click();
  await expect(toast).not.toContainText('shortened');

  await emitServerMessage(page, {
    ...fixture,
    state: {
      ...fixture.state,
      preRollEnabled: true,
      isPlaying: false,
      currentSongTime: 4,
      signatureNumerator: 3,
      signatureDenominator: 2,
    },
  });
  await page.locator('#btnPlay').click();
  await expect(toast).toContainText('shortened');
});

test('Setlist count-in is disabled without control authority and in Lock Mode', async ({ page }) => {
  await page.goto('/setlist/?scenario=never-connected');
  await expect(page.locator('#btnPreRoll')).toBeDisabled();

  await page.goto('/setlist/?scenario=read-only');
  await expect(page.locator('#btnPreRoll')).toBeDisabled();

  await page.goto('/setlist/');
  await expect(page.locator('#btnPreRoll')).toBeEnabled();
  await page.locator('#btnLock').click();
  await expect(page.locator('#btnPreRoll')).toBeDisabled();
});
