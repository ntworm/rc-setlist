// Copyright (c) 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Stage Control on a slave that follows the main computer: navigation and play
// are read-only, Stop stays usable, and the banner follows the language. On the
// main computer, a slave in Independent mode carries an "Independent" tag.

import { expect, test } from '@playwright/test';

const COPY = {
  en: {
    banner: 'Slave following the main computer. To navigate, switch to Independent in Live.',
    independent: 'Independent',
    ok: 'OK',
  },
  'pt-BR': {
    banner: 'Slave seguindo o master. Para navegar, mude para Independente no Live.',
    independent: 'Independente',
    ok: 'OK',
  },
};

const LOCKED_CONTROLS = [
  '#btnPlay',
  '#btnPreviousSong',
  '#btnPrevious',
  '#btnNext',
  '#btnNextSong',
  '#btnMetronome',
  '#btnPreRoll',
  '#quantizationSelect',
];

async function openLocalizedStage(page, locale) {
  await page.addInitScript((loc) => localStorage.setItem('rc-setlist.locale', loc), locale);
  await page.goto('/setlist/');
  await expect(page.locator('#statusDot')).toHaveClass(/connected/);
}

async function emitState(request, base, patch) {
  await request.post('/__test__/emit', {
    data: { type: 'state', state: { ...base.state, ...patch } },
  });
}

function independentPeerPatch() {
  const row = {
    key: '192.168.1.20:4444',
    role: 'outbound',
    host: '192.168.1.20',
    port: 4444,
    connected: true,
    markersMatch: true,
    fingerprintMismatch: false,
    versionMismatch: false,
    health: 'ok',
    reason: 'ok',
    canAcknowledge: false,
    followMode: 'independent',
  };
  return {
    peerStatus: {
      paired: true,
      connected: true,
      markersMatch: true,
      fingerprintMismatch: false,
      versionMismatch: false,
      health: 'ok',
      reason: 'ok',
      canAcknowledge: false,
    },
    peerStatuses: [row],
  };
}

for (const locale of ['en', 'pt-BR']) {
  const c = COPY[locale];

  test(`Stage Control (${locale}) on a locked slave disables Play and jumps, keeps Stop`, async ({
    page,
    request,
  }) => {
    await openLocalizedStage(page, locale);
    const base = await request.get('/__test__/state').then((r) => r.json());
    const banner = page.locator('#slaveLockBanner');

    await emitState(request, base, { slaveLock: false });
    await expect(banner).toBeHidden();
    await expect(page.locator('#btnPlay')).toBeEnabled();
    await expect(page.locator('#btnNext')).toBeEnabled();
    await expect(page.locator('#btnStop')).toBeEnabled();

    await emitState(request, base, { slaveLock: true });
    await expect(banner).toBeVisible();
    await expect(banner).toHaveText(c.banner);
    for (const selector of LOCKED_CONTROLS) {
      await expect(page.locator(selector), selector).toBeDisabled();
    }
    await expect(page.locator('#btnStop')).toBeEnabled();

    // The lock holds behind the buttons too: mapped keyboard and MIDI actions
    // and the play path send nothing upstream, while Stop still goes out.
    await page.evaluate(() => {
      for (const action of ['play', 'next_song', 'next_section', 'toggle_click']) {
        globalThis.executeSetlistAction(action);
      }
      globalThis.requestPlay();
      globalThis.executeSetlistAction('stop');
    });
    await expect
      .poll(async () => {
        const msgs = await request.get('/__test__/messages').then((r) => r.json());
        return msgs.some((m) => m.type === 'stop');
      })
      .toBe(true);
    const messages = await request.get('/__test__/messages').then((r) => r.json());
    const blocked = ['play', 'jump', 'trigger_count_in', 'metronome'];
    expect(messages.filter((m) => blocked.includes(m.type))).toEqual([]);

    await emitState(request, base, { slaveLock: false });
    await expect(banner).toBeHidden();
    await expect(page.locator('#btnPlay')).toBeEnabled();
  });

  test(`Stage Control (${locale}) on the main computer tags an Independent slave`, async ({
    page,
    request,
  }) => {
    await openLocalizedStage(page, locale);
    const base = await request.get('/__test__/state').then((r) => r.json());

    await emitState(request, base, independentPeerPatch());
    const bar = page.locator('#peerHealthBar');
    await expect(bar).toBeVisible();
    await expect(bar.locator('.peer-health-pill')).toHaveText(c.ok);
    await expect(bar.locator('.peer-health-pill')).toHaveClass(/is-ok/);
    await expect(bar.locator('.peer-health-mode-tag')).toHaveText(c.independent);
  });
}

test('Stage Control retranslates the slave lock banner when the language changes', async ({
  page,
  request,
}) => {
  await openLocalizedStage(page, 'en');
  const base = await request.get('/__test__/state').then((r) => r.json());
  await emitState(request, base, { slaveLock: true });
  const banner = page.locator('#slaveLockBanner');
  await expect(banner).toHaveText(COPY.en.banner);

  await page.evaluate(() => globalThis.RcSetlistI18n.setLocale('pt-BR'));
  await expect(banner).toHaveText(COPY['pt-BR'].banner);

  await page.evaluate(() => globalThis.RcSetlistI18n.setLocale('en'));
  await expect(banner).toHaveText(COPY.en.banner);
});
