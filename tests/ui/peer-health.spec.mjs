import { expect, test } from '@playwright/test';

const HOST_KEY = '192.168.1.20:4444';

const COPY = {
  en: {
    ok: 'OK',
    okReason: 'Link healthy',
    unstable: 'UNSTABLE',
    unstableBadge: 'LINK UNSTABLE',
    recentDrop: 'Recent drop',
    warmingUp: 'Warming up (20 s)',
    oscillating: 'Link oscillating (5 min hold)',
    down: 'DOWN',
    downBadge: 'LINK DOWN',
    linkDown: 'Link down',
    versionMismatch: 'DIFFERENT VERSIONS',
    certChanged: 'CERTIFICATE CHANGED',
    certBadge: 'CERT MISMATCH',
    ack: 'Acknowledge',
    drops2: '2 drops (5m)',
    lastDrop: /last drop \d+[smh]/,
    seenAgo: /seen \d+[smh]/,
    alarmTitle: 'SECOND COMPUTER LINK DOWN',
  },
  'pt-BR': {
    ok: 'OK',
    okReason: 'Link est\u00e1vel',
    unstable: 'INST\u00c1VEL',
    unstableBadge: 'LINK INST\u00c1VEL',
    recentDrop: 'Queda recente',
    warmingUp: 'Aquecendo (20 s)',
    oscillating: 'Link oscilando (trava 5 min)',
    down: 'CA\u00cdDO',
    downBadge: 'LINK CA\u00cdDO',
    linkDown: 'Link ca\u00eddo',
    versionMismatch: 'VERS\u00d5ES DIFERENTES',
    certChanged: 'CERTIFICADO MUDOU',
    certBadge: 'CERTIFICADO MUDOU',
    ack: 'Confirmar',
    drops2: '2 quedas (5m)',
    lastDrop: /\u00faltima queda h\u00e1 \d+[smh]/,
    seenAgo: /visto h\u00e1 \d+[smh]/,
    alarmTitle: 'LINK DO SEGUNDO COMPUTADOR CA\u00cdDO',
  },
};

function makeRow(overrides = {}) {
  return {
    key: HOST_KEY,
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
    rttP95Ms: 20,
    drops5m: 0,
    lastDropAt: null,
    ...overrides,
  };
}

function makePeerState(base, { peer = {}, row = {}, state = {} } = {}) {
  const fullRow = makeRow(row);
  return {
    type: 'state',
    state: {
      ...base.state,
      ...state,
      peerStatus: {
        paired: true,
        connected: fullRow.connected,
        markersMatch: fullRow.markersMatch,
        fingerprintMismatch: fullRow.fingerprintMismatch,
        versionMismatch: fullRow.versionMismatch,
        health: fullRow.health,
        reason: fullRow.reason,
        canAcknowledge: fullRow.canAcknowledge,
        rttP95Ms: fullRow.rttP95Ms,
        drops5m: fullRow.drops5m,
        lastDropAt: fullRow.lastDropAt,
        ...peer,
      },
      peerStatuses: [fullRow],
    },
  };
}

async function openLocalized(page, route, locale) {
  await page.addInitScript((loc) => localStorage.setItem('rc-setlist.locale', loc), locale);
  await page.goto(route);
  await expect(page.locator('#statusDot')).toHaveClass(/connected/);
}

async function emitPeerState(request, base, opts) {
  await request.post('/__test__/emit', { data: makePeerState(base, opts) });
}

async function emitLastSeen(request, ageMs = 2000) {
  const serverNow = Date.now();
  await request.post('/__test__/emit', {
    data: { type: 'peer_health', key: HOST_KEY, lastSeenAt: serverNow - ageMs, serverNow },
  });
}

async function expectPeerBar(page, { pillText, pillClass, dotClass, reasonText }) {
  const bar = page.locator('#peerHealthBar');
  await expect(bar).toBeVisible();
  const pill = bar.locator('.peer-health-pill');
  await expect(pill).toHaveText(pillText);
  await expect(pill).toHaveClass(pillClass);
  await expect(page.locator('#peerStatusDot')).toHaveClass(dotClass);
  if (reasonText) await expect(bar).toContainText(reasonText);
}

async function expectUnstableTelemetry(page, copy) {
  await expectPeerBar(page, {
    pillText: copy.unstable,
    pillClass: /is-warning/,
    dotClass: /warning/,
    reasonText: copy.recentDrop,
  });
  const bar = page.locator('#peerHealthBar');
  await expect(bar).toContainText('192.168.1.20:4444');
  await expect(bar).toContainText('RTT 180 ms');
  await expect(bar).toContainText(copy.drops2);
  await expect(bar).toContainText(copy.lastDrop);
  await expect(bar).toContainText(copy.seenAgo);
}

for (const locale of ['en', 'pt-BR']) {
  const c = COPY[locale];

  test(`Stage Control (${locale}) renders OK without connected and unstable metrics/ack`, async ({
    page,
    request,
  }) => {
    await openLocalized(page, '/setlist/', locale);
    const base = await request.get('/__test__/state').then((r) => r.json());

    await emitPeerState(request, base, { row: { connected: false, health: 'ok', reason: 'ok' } });
    await expectPeerBar(page, {
      pillText: c.ok,
      pillClass: /is-ok/,
      dotClass: /connected/,
      reasonText: c.okReason,
    });
    await expect(page.locator('#peerTransportBadge')).toBeHidden();
    await expect(page.locator('#peerHealthBar [data-peer-ack-key]')).toHaveCount(0);

    await emitPeerState(request, base, {
      row: {
        health: 'unstable',
        reason: 'recent_drop',
        canAcknowledge: true,
        rttP95Ms: 180,
        drops5m: 2,
        lastDropAt: Date.now() - 15_000,
      },
    });
    await emitLastSeen(request, 2000);
    await expectUnstableTelemetry(page, c);
    await expect(page.locator('#peerTransportBadge')).toHaveClass(/is-warning/);
    await expect(page.locator('#peerTransportBadge')).toHaveText(c.unstableBadge);

    await expect(page.locator('#btnPeerAck')).toHaveText(c.ack);
    await page.locator('#btnPeerAck').click();
    await expect
      .poll(async () => {
        const msgs = await request.get('/__test__/messages').then((r) => r.json());
        return msgs.find((m) => m.type === 'peer_health_ack');
      })
      .toEqual({ type: 'peer_health_ack', peerKey: HOST_KEY });
  });

  test(`Stage Control (${locale}) hides ack on warming/oscillating and keeps peer UI in Show mode`, async ({
    page,
    request,
  }) => {
    await openLocalized(page, '/setlist/', locale);
    const base = await request.get('/__test__/state').then((r) => r.json());

    await emitPeerState(request, base, {
      row: { health: 'unstable', reason: 'warming_up', canAcknowledge: false },
    });
    await expect(page.locator('#peerHealthBar')).toContainText(c.warmingUp);
    await expect(page.locator('#peerHealthBar [data-peer-ack-key]')).toHaveCount(0);

    await emitPeerState(request, base, {
      row: { health: 'unstable', reason: 'link_oscillating', canAcknowledge: false },
    });
    await expect(page.locator('#peerHealthBar')).toContainText(c.oscillating);
    await expect(page.locator('#peerHealthBar [data-peer-ack-key]')).toHaveCount(0);

    await page.locator('[data-stage-mode="show"]').click();
    await expect(page.locator('body')).toHaveClass(/show-mode/);
    await emitPeerState(request, base, {
      row: { health: 'unstable', reason: 'recent_drop', canAcknowledge: true },
    });
    await expect(page.locator('#peerHealthBar')).toBeVisible();
    await expect(page.locator('#peerTransportBadge')).toHaveText(c.unstableBadge);
    await expect(page.locator('#btnPeerAck')).toBeVisible();
  });

  test(`Stage Control (${locale}) renders down, version mismatch, cert mismatch in Edit & Show`, async ({
    page,
    request,
  }) => {
    await openLocalized(page, '/setlist/', locale);
    const base = await request.get('/__test__/state').then((r) => r.json());

    await emitPeerState(request, base, {
      state: { isPlaying: false },
      row: { connected: true, health: 'down', reason: 'link_down' },
    });
    await expectPeerBar(page, {
      pillText: c.down,
      pillClass: /is-error/,
      dotClass: /error/,
      reasonText: c.linkDown,
    });
    await expect(page.locator('#peerTransportBadge')).toHaveClass(/is-error/);
    await expect(page.locator('#peerTransportBadge')).toHaveText(c.downBadge);
    await page.locator('#btnPeerAlarmDismiss').click();

    await emitPeerState(request, base, {
      state: { isPlaying: false },
      row: { versionMismatch: true, health: 'down', reason: 'link_down' },
    });
    await expectPeerBar(page, {
      pillText: c.versionMismatch,
      pillClass: /is-error/,
      dotClass: /error/,
    });
    await expect(page.locator('#peerTransportBadge')).toHaveText(c.versionMismatch);
    await expect(page.locator('#peerHealthBar [data-peer-ack-key]')).toHaveCount(0);

    await emitPeerState(request, base, {
      state: { isPlaying: false },
      row: { fingerprintMismatch: true, versionMismatch: true, health: 'ok' },
    });
    await expectPeerBar(page, {
      pillText: c.certChanged,
      pillClass: /is-error/,
      dotClass: /error/,
    });
    await expect(page.locator('#peerTransportBadge')).toHaveText(c.certBadge);

    await page.locator('[data-stage-mode="show"]').click();
    await emitPeerState(request, base, {
      state: { isPlaying: false },
      row: { health: 'down', reason: 'link_down' },
    });
    await page.locator('#btnPeerAlarmDismiss').click();
    await expect(page.locator('#peerHealthBar')).toBeVisible();
    await expect(page.locator('#peerTransportBadge')).toHaveText(c.downBadge);
  });

  test(`Stage Control (${locale}) enforces R2-11 alarm transition, dismiss, recovery, re-entry`, async ({
    page,
    request,
  }) => {
    await openLocalized(page, '/setlist/', locale);
    const base = await request.get('/__test__/state').then((r) => r.json());
    await emitPeerState(request, base, { state: { isPlaying: false }, row: { health: 'ok' } });

    await emitPeerState(request, base, {
      state: { isPlaying: false },
      row: { health: 'down', reason: 'link_down' },
    });
    const alarm = page.locator('#peerAlarmOverlay');
    await expect(alarm).toBeVisible();
    await expect(page.locator('#peerAlarmTitle')).toHaveText(c.alarmTitle);
    await expect(page.locator('#peerAlarmReason')).toHaveText(c.linkDown);

    await page.locator('#btnPeerAlarmDismiss').click();
    await expect(alarm).toBeHidden();
    await expect(page.locator('#peerTransportBadge')).toHaveClass(/is-error/);
    await expect(page.locator('#peerHealthBar')).toHaveClass(/is-error/);

    await emitPeerState(request, base, { state: { isPlaying: true }, row: { health: 'down' } });
    await expect(alarm).toBeHidden();

    await emitPeerState(request, base, { row: { health: 'unstable', reason: 'recent_drop' } });
    await expect(alarm).toBeHidden();

    await emitPeerState(request, base, { state: { isPlaying: false }, row: { health: 'down' } });
    await expect(alarm).toBeVisible();
  });

  for (const route of ['/setlist/', '/performance/']) {
    test(`${route} (${locale}) shows full-screen alarm immediately on reload while down & playing`, async ({
      page,
    }) => {
      await openLocalized(page, `${route}?scenario=peer-down-playing`, locale);
      await expect(page.locator('#peerAlarmOverlay')).toBeVisible();
      await expect(page.locator('#peerAlarmTitle')).toHaveText(c.alarmTitle);

      await page.reload();
      await expect(page.locator('#peerAlarmOverlay')).toBeVisible();
      await page.locator('#btnPeerAlarmDismiss').click();
      await expect(page.locator('#peerAlarmOverlay')).toBeHidden();
      await expect(page.locator('#peerHealthBar')).toHaveClass(/is-error/);
      if (route === '/setlist/') {
        await expect(page.locator('#peerTransportBadge')).toHaveClass(/is-error/);
      }
    });
  }

  test(`Performance (${locale}) renders ok/unstable metrics without Acknowledge`, async ({
    page,
    request,
  }) => {
    await openLocalized(page, '/performance/', locale);
    const base = await request.get('/__test__/state').then((r) => r.json());

    await emitPeerState(request, base, { row: { connected: false, health: 'ok', reason: 'ok' } });
    await expectPeerBar(page, {
      pillText: c.ok,
      pillClass: /is-ok/,
      dotClass: /connected/,
      reasonText: c.okReason,
    });

    await emitPeerState(request, base, {
      row: {
        health: 'unstable',
        reason: 'recent_drop',
        canAcknowledge: true,
        rttP95Ms: 180,
        drops5m: 2,
        lastDropAt: Date.now() - 15_000,
      },
    });
    await emitLastSeen(request, 2000);
    await expectUnstableTelemetry(page, c);
    await expect(page.locator('#peerHealthBar [data-peer-ack-key]')).toHaveCount(0);
  });

  test(`Performance (${locale}) renders down alarm, version mismatch, and cert mismatch`, async ({
    page,
    request,
  }) => {
    await openLocalized(page, '/performance/', locale);
    const base = await request.get('/__test__/state').then((r) => r.json());

    await emitPeerState(request, base, {
      state: { isPlaying: false },
      row: { connected: true, health: 'down', reason: 'link_down' },
    });
    await expectPeerBar(page, {
      pillText: c.down,
      pillClass: /is-error/,
      dotClass: /error/,
      reasonText: c.linkDown,
    });
    await expect(page.locator('#peerAlarmOverlay')).toBeVisible();
    await page.locator('#btnPeerAlarmDismiss').click();
    await expect(page.locator('#peerAlarmOverlay')).toBeHidden();

    await emitPeerState(request, base, { row: { versionMismatch: true, health: 'ok' } });
    await expectPeerBar(page, {
      pillText: c.versionMismatch,
      pillClass: /is-error/,
      dotClass: /error/,
    });

    await emitPeerState(request, base, { row: { fingerprintMismatch: true, health: 'ok' } });
    await expectPeerBar(page, {
      pillText: c.certChanged,
      pillClass: /is-error/,
      dotClass: /error/,
    });
    await expect(page.locator('#peerHealthBar [data-peer-ack-key]')).toHaveCount(0);
  });
}

test('Read-only Stage Control hides Acknowledge and live language switch re-translates peer UI', async ({
  page,
  request,
}) => {
  await openLocalized(page, '/setlist/?scenario=read-only', 'en');
  const roBase = await request.get('/__test__/state').then((r) => r.json());
  await emitPeerState(request, roBase, {
    row: { health: 'unstable', reason: 'recent_drop', canAcknowledge: true },
  });
  await expect(page.locator('#peerHealthBar')).toContainText(COPY.en.unstable);
  await expect(page.locator('#peerHealthBar [data-peer-ack-key]')).toHaveCount(0);

  await openLocalized(page, '/setlist/', 'en');
  const base = await request.get('/__test__/state').then((r) => r.json());
  await emitPeerState(request, base, {
    state: { isPlaying: false },
    row: { health: 'unstable', reason: 'recent_drop', canAcknowledge: true },
  });
  await expect(page.locator('#btnPeerAck')).toHaveText(COPY.en.ack);
  await page.locator('#languageSelect').selectOption('pt-BR');
  await expect(page.locator('#peerHealthBar .peer-health-pill')).toHaveText(COPY['pt-BR'].unstable);
  await expect(page.locator('#peerTransportBadge')).toHaveText(COPY['pt-BR'].unstableBadge);
  await expect(page.locator('#btnPeerAck')).toHaveText(COPY['pt-BR'].ack);
});
