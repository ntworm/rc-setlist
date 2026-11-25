import { expect, test } from '@playwright/test';

const HOST_KEY = '192.168.1.20:4444';

const COPY = {
  en: {
    pending: '192.168.1.20:4444 \u00b7 jump: Pending',
    confirmed: '192.168.1.20:4444 \u00b7 jump: Executed',
    failed: '192.168.1.20:4444 \u00b7 jump: Failed',
    notExecuted: 'SLAVE DID NOT EXECUTE: jump',
    executedLate: 'Executed late: jump',
    stillNotStopped: 'SLAVE STILL NOT STOPPED',
    followModeLabel: 'Slave mode',
    followAll: 'Follow all',
    followTransport: 'Follow transport',
    independent: 'Independent',
  },
  'pt-BR': {
    pending: '192.168.1.20:4444 \u00b7 jump: Pendente',
    confirmed: '192.168.1.20:4444 \u00b7 jump: Executou',
    failed: '192.168.1.20:4444 \u00b7 jump: Falhou',
    notExecuted: 'SLAVE N\u00c3O EXECUTOU: jump',
    executedLate: 'Executou atrasado: jump',
    stillNotStopped: 'SLAVE AINDA N\u00c3O PAROU',
    followModeLabel: 'Modo do slave',
    followAll: 'Segue tudo',
    followTransport: 'Segue transporte',
    independent: 'Independente',
  },
};

const PANEL_FIXTURE = {
  oscDiagnostics: {
    state: 'responding',
    listenPort: 11101,
    bridge: 'rcbridge',
    bridgeVersion: 'RC Bridge 1.2.0',
    targetPort: 11101,
  },
  network: {
    candidates: [],
    primaryIp: '192.168.1.50',
    selectedAddress: '',
    announcedIp: '192.168.1.50',
    protocol: 'https',
    port: 4444,
    caPort: 4445,
    caAvailable: true,
    certCoversSelected: true,
    tls: true,
  },
  packages: { dir: '/tmp', files: [] },
  playback: {
    isPlaying: false,
    songCount: 1,
    durationSeconds: 180,
    tempo: 120,
    activeSongIndex: 0,
    songs: [{ title: 'Alpha', durationSeconds: 180, sectionCount: 2, color: '#ff8800' }],
  },
  project: {
    projectName: 'Tour',
    profiles: [{ id: 'one', name: 'Main' }],
    deletedProfiles: [],
    activeProfileId: 'one',
    canMutate: true,
    locked: false,
    lockReason: null,
  },
};

async function openLocalizedStage(page, locale) {
  await page.addInitScript((loc) => localStorage.setItem('rc-setlist.locale', loc), locale);
  await page.goto('/setlist/');
  await expect(page.locator('#statusDot')).toHaveClass(/connected/);
}

async function emitCommandStatus(request, overrides) {
  await request.post('/__test__/emit', {
    data: {
      type: 'peer_command_status',
      peerKey: HOST_KEY,
      host: '192.168.1.20',
      port: 4444,
      commandId: 'cmd-1',
      peerCommandId: 'peer:cmd-1',
      commandType: 'jump',
      status: 'pending',
      ...overrides,
    },
  });
}

async function openLocalizedPanel(page, locale, peerOverrides) {
  await page.setViewportSize({ width: 760, height: 600 });
  await page.addInitScript(
    ({ fixture, loc, peer }) => {
      window.INITIAL_IS_RUNNING = true;
      window.INITIAL_PORT = 4444;
      window.INITIAL_TLS = true;
      window.INITIAL_PRIMARY_IP = '192.168.1.50';
      window.INITIAL_TOKEN = 'fixture-token';
      window.INITIAL_LOCALE = loc;
      window.INITIAL_STORAGE_INITIALIZED = true;
      window.INITIAL_DURATION_CONFIDENCE = 'estimated';
      window.INITIAL_OSC_DIAGNOSTICS = fixture.oscDiagnostics;
      window.INITIAL_NETWORK = fixture.network;
      window.INITIAL_PROJECT = fixture.project;
      window.INITIAL_PLAYBACK = fixture.playback;
      window.INITIAL_PACKAGES = fixture.packages;
      window.INITIAL_CERT_URL = 'http://192.168.1.50:4445/ca';
      window.INITIAL_PEER = {
        statusText: 'Second computer connected',
        paired: true,
        host: '192.168.1.20',
        port: 4444,
        localIp: '192.168.1.50',
        code: null,
        canGenerateCode: true,
        codeHint: '',
        role: 'slave',
        followMode: 'follow',
        peers: [],
        ...peer,
      };
      window.__messages = [];
      window.webkit = {
        messageHandlers: {
          live: {
            postMessage: (m) => window.__messages.push(m),
          },
        },
      };
    },
    { fixture: PANEL_FIXTURE, loc: locale, peer: peerOverrides },
  );
  await page.goto('/panel/index.html');
  await page.locator('#tabNetwork').click();
}

for (const locale of ['en', 'pt-BR']) {
  const c = COPY[locale];

  test(`Stage Control (${locale}) renders 3s ticks, expired, late_confirmed, and stop_unacked`, async ({
    page,
    request,
  }) => {
    await openLocalizedStage(page, locale);
    const ticks = page.locator('#peerCommandTicks');
    const alert = page.locator('#peerCommandAlert');

    await emitCommandStatus(request, { status: 'pending' });
    await expect(ticks).toBeVisible();
    await expect(ticks).toContainText(c.pending);

    await emitCommandStatus(request, { status: 'expired' });
    await expect(ticks).toContainText(c.failed);
    await expect(alert).toBeVisible();
    await expect(alert).toHaveClass(/is-error/);
    await expect(alert).toHaveText(c.notExecuted);

    await emitCommandStatus(request, { status: 'late_confirmed' });
    await expect(ticks).toContainText(c.confirmed);
    await expect(alert).toHaveClass(/is-warning/);
    await expect(alert).toHaveText(c.executedLate);

    await emitCommandStatus(request, {
      commandId: 'stop-1',
      commandType: 'stop',
      status: 'stop_unacked',
    });
    await expect(alert).toHaveClass(/is-error/);
    await expect(alert).toHaveText(c.stillNotStopped);

    await emitCommandStatus(request, {
      commandId: 'other-jump-1',
      commandType: 'jump',
      status: 'confirmed',
    });
    await expect(alert).toHaveText(c.stillNotStopped);

    await emitCommandStatus(request, {
      commandId: 'other-jump-2',
      commandType: 'jump',
      status: 'expired',
    });
    await expect(alert).toHaveText(c.stillNotStopped);

    await emitCommandStatus(request, {
      commandId: 'other-panic-off',
      commandType: 'set_panic',
      status: 'confirmed',
    });
    await expect(alert).toHaveText(c.stillNotStopped);

    await emitCommandStatus(request, {
      commandId: 'stop-1',
      commandType: 'stop',
      status: 'confirmed',
    });
    await expect(alert).toBeHidden();
    await expect(ticks).toBeHidden({ timeout: 4500 });
  });

  test(`Live Panel (${locale}) renders peer command alerts and the slave follow-mode selector`, async ({
    page,
  }) => {
    await openLocalizedPanel(page, locale, {
      role: 'slave',
      followMode: 'transport',
      alerts: {
        [HOST_KEY]: {
          peerKey: HOST_KEY,
          commandId: 'c1',
          commandType: 'jump',
          status: 'expired',
          text: c.notExecuted,
        },
        '192.168.1.21:4444': {
          peerKey: '192.168.1.21:4444',
          commandId: 'c2',
          commandType: 'stop',
          status: 'stop_unacked',
          text: c.stillNotStopped,
        },
        '192.168.1.22:4444': {
          peerKey: '192.168.1.22:4444',
          commandId: 'c3',
          commandType: 'jump',
          status: 'late_confirmed',
          text: c.executedLate,
        },
      },
    });

    const box = page.locator('#peerAlertsBox');
    await expect(box).toBeVisible();
    await expect(box).toContainText(c.notExecuted);
    await expect(box).toContainText(c.stillNotStopped);
    await expect(box).toContainText(c.executedLate);

    const row = page.locator('#peerFollowModeRow');
    await expect(row).toBeVisible();
    await expect(row).toContainText(c.followModeLabel);
    const follow = row.locator('[data-follow-mode="follow"]');
    const transport = row.locator('[data-follow-mode="transport"]');
    const independent = row.locator('[data-follow-mode="independent"]');
    await expect(follow).toHaveText(c.followAll);
    await expect(transport).toHaveText(c.followTransport);
    await expect(independent).toHaveText(c.independent);
    await expect(follow).toHaveAttribute('aria-pressed', 'false');
    await expect(transport).toHaveAttribute('aria-pressed', 'true');
    await expect(independent).toHaveAttribute('aria-pressed', 'false');

    // The active mode does not resend itself; another mode sends one action.
    await transport.click();
    await independent.click();

    const envelopes = await page.evaluate(() =>
      (window.__messages || []).map((m) => JSON.parse(m.params[0])),
    );
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0].action).toBe('set-follow-mode:independent');
  });

  test(`Live Panel (${locale}) hides the follow-mode selector on the main computer and tags an Independent slave`, async ({
    page,
  }) => {
    await openLocalizedPanel(page, locale, {
      role: 'master',
      followMode: 'follow',
      peers: [
        {
          key: HOST_KEY,
          host: '192.168.1.20',
          port: 4444,
          connected: true,
          markersMatch: true,
          fingerprintMismatch: false,
          health: 'ok',
          reason: 'ok',
          followMode: 'independent',
        },
        {
          key: '192.168.1.21:4444',
          host: '192.168.1.21',
          port: 4444,
          connected: true,
          markersMatch: true,
          fingerprintMismatch: false,
          health: 'ok',
          reason: 'ok',
          followMode: null,
        },
      ],
    });

    await expect(page.locator('#peerFollowModeRow')).toBeHidden();
    const items = page.locator('#peerList li');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0).locator('.peer-list-status')).toHaveClass(/active/);
    await expect(items.nth(0).locator('.peer-list-mode-tag')).toHaveText(c.independent);
    await expect(items.nth(1).locator('.peer-list-mode-tag')).toHaveCount(0);
  });
}
